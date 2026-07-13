// Anycubic-LAN-Adapter (Kobra X / Kobra 3 / S1, "LAN Mode" am Display aktivieren).
// Protokoll (Community-RE, u.a. chrisfore/anycubic_ha_local, grunna/ha-anycubic-
// kobra-x-lan, tspi.at):
//   1. Handshake: GET :18910/info -> signierter POST auf ctrlInfoUrl ->
//      AES-CBC-Entschlüsselung -> lokale MQTT-Zugangsdaten
//   2. MQTT über TLS :9883 (self-signed), Topics anycubic/anycubicCloud/v1/...
//   3. G-Code-Upload: POST :18910/gcode_upload, Druckstart via slicer/...-Topic
//   4. Kamera: video/startCapture per MQTT, dann RTSP-/FLV-Stream (:18088/flv)
// Achtung Firmware-Eigenheit: der Temperatur-Typ heißt wirklich "tempature".
const crypto = require('crypto');
const mqtt = require('mqtt');
const ffcam = require('./ffcam');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const rnd = (n, chars) => Array.from(crypto.randomBytes(n), b => chars[b % chars.length]).join('');
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Eine "PC-Geräte-ID" je Bridge-Lauf — der Drucker merkt sich damit den Client.
const PC_DID = rnd(32, UPNUM);

async function getJson(url, { method = 'GET', timeoutMs = 8000 } = {}) {
  const r = await fetch(url, { method, signal: AbortSignal.timeout(timeoutMs) });
  const t = await r.text();
  try { return JSON.parse(t); }
  catch { throw new Error(`Antwort von ${url} ist kein JSON: ${t.slice(0, 120)}`); }
}

// ---- Handshake: /info -> signierter /ctrl -> AES-CBC decrypt ----
async function handshake(p) {
  const info = await getJson(`http://${p.ip}:18910/info`);
  if (info.ctrlType === 'cloud')
    throw new Error('Drucker ist im Cloud-Modus — am Display den LAN-Modus aktivieren');
  const { token, ctrlInfoUrl } = info;
  if (!token || !ctrlInfoUrl)
    throw new Error('Drucker liefert keinen LAN-Handshake (Firmware zu alt?)');
  const ts = Date.now();
  const nonce = rnd(6, ALNUM);
  const sign = md5(md5(token.slice(0, 16)) + String(ts) + nonce);
  const qs = new URLSearchParams({ ts: String(ts), nonce, sign, did: PC_DID });
  const ctrl = await getJson(`${ctrlInfoUrl}?${qs}`, { method: 'POST' });
  if (ctrl.code !== 200) throw new Error(`Handshake /ctrl fehlgeschlagen: ${ctrl.message || ctrl.code}`);
  // AES-128-CBC: Key = token[16..32], IV = ctrl.data.token (auf 16 Byte gebracht)
  const key = Buffer.from(token.slice(16, 32));
  const iv = Buffer.alloc(16); Buffer.from(String(ctrl.data.token)).copy(iv, 0, 0, 16);
  const dec = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const plain = Buffer.concat([dec.update(Buffer.from(ctrl.data.info, 'base64')), dec.final()]);
  const cred = JSON.parse(plain.toString('utf8'));
  const m = /^mqtts?:\/\/([^:/]+)(?::(\d+))?/.exec(cred.broker || '');
  return {
    host: m ? m[1] : p.ip, port: m && m[2] ? Number(m[2]) : 9883,
    username: cred.username, password: cred.password || cred.passWd,
    deviceId: cred.deviceId, modeId: String(cred.modeId || cred.modelId || info.modelId),
    uploadToken: token, modelName: cred.modelName || info.modelName,
  };
}

// ---- Persistente Verbindung je Drucker (Handshake + TLS sind teuer) ----
const conns = new Map();   // p.id -> { hs, client, latest: Map(type->data), lastUse, ready }
const IDLE_MS = 120000;

const PREFIX = 'anycubic/anycubicCloud/v1';
const pubTopic = (hs, type, ns = 'web') => `${PREFIX}/${ns}/printer/${hs.modeId}/${hs.deviceId}/${type}`;

function buildMsg(type, action, data = null) {
  return JSON.stringify({ type, action, timestamp: Date.now(), msgid: crypto.randomUUID(), data });
}

async function connect(p) {
  let c = conns.get(p.id);
  if (c && c.client?.connected) { c.lastUse = Date.now(); return c; }
  if (c) { try { c.client?.end(true); } catch {} conns.delete(p.id); }
  const hs = await handshake(p);
  const client = mqtt.connect(`mqtts://${hs.host}:${hs.port}`, {
    username: hs.username, password: hs.password,
    clientId: `volme_${hs.deviceId.slice(-8)}`,
    rejectUnauthorized: false, connectTimeout: 8000, reconnectPeriod: 0,
  });
  c = { hs, client, latest: new Map(), lastUse: Date.now() };
  conns.set(p.id, c);
  c.ready = new Promise((resolve, reject) => {
    client.on('connect', () => {
      client.subscribe(`${PREFIX}/printer/+/${hs.modeId}/${hs.deviceId}/#`, (e) => e ? reject(e) : resolve());
    });
    client.on('error', reject);
    setTimeout(() => reject(new Error('MQTT-Timeout (LAN-Modus aktiv?)')), 10000);
  });
  client.on('message', (_t, msg) => {
    let j; try { j = JSON.parse(msg.toString()); } catch { return; }
    // eigenes Query-Echo ignorieren
    if (j.action === 'query' && j.data == null) return;
    if (j.type && j.data != null) c.latest.set(j.type, j.data);
  });
  client.on('close', () => { if (conns.get(p.id) === c) conns.delete(p.id); });
  await c.ready;
  return c;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, c] of conns) if (now - c.lastUse > IDLE_MS) { try { c.client.end(true); } catch {} conns.delete(id); }
}, 30000).unref?.();

function query(c, type) {
  // Die ACE-Box antwortet nur auf getInfo, alles andere auf query
  const action = type === 'multiColorBox' ? 'getInfo' : 'query';
  c.client.publish(pubTopic(c.hs, type), buildMsg(type, action));
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Status: info-Report enthält Temperaturen, Projekt, Fortschritt ----
const PAUSE_STATE = { 1: 'PAUSE', 2: 'PAUSE', 3: 'RUNNING', 4: 'RUNNING' };
async function status(p) {
  const c = await connect(p);
  for (const t of ['info', 'light', 'multiColorBox']) query(c, t);
  // auf den info-Report warten (Reports laufen in c.latest ein)
  for (let i = 0; i < 40 && !c.latest.has('info'); i++) await wait(200);
  const d = c.latest.get('info');
  if (!d) throw new Error('kein Status-Report vom Drucker');
  const temp = d.temp || {};
  const proj = d.project || d.last_project || {};
  let state = 'IDLE';
  if (d.state !== 'free') {
    if (proj.state === 'printing') state = PAUSE_STATE[proj.pause] || 'RUNNING';
    else if (/finish|done|complete/i.test(proj.state || '')) state = 'FINISH';
    else if (proj.state) state = String(proj.state).toUpperCase();
    else state = 'RUNNING';
  } else if (/finish|done|complete/i.test(proj.state || '')) state = 'FINISH';
  // ACE-Slots als Trays (color = [r,g,b])
  const trays = [];
  for (const box of (c.latest.get('multiColorBox')?.multi_color_box || []))
    for (const s of (box.slots || [])) {
      const col = Array.isArray(s.color) && s.color.length >= 3
        ? s.color.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase() : '';
      if (s.type || col) trays.push({ id: String(s.index), type: s.type || '', color: col });
    }
  const light = (c.latest.get('light')?.lights || [])[0];
  return {
    online: true, state,
    subtask: proj.filename ? String(proj.filename).replace(/\.gcode$/i, '') : null,
    percent: proj.progress ?? null, remaining: proj.remain_time ?? null,
    layer: proj.curr_layer ?? null, total: proj.total_layers ?? null,
    nozzle: temp.curr_nozzle_temp ?? null, nozzle_target: temp.target_nozzle_temp ?? null,
    bed: temp.curr_hotbed_temp ?? null, bed_target: temp.target_hotbed_temp ?? null,
    chamber: temp.curr_chamber_temp ?? null,
    fan_part: d.fan_speed_pct ?? null, fan_aux: d.aux_fan_speed_pct ?? null,
    speed_lvl: d.print_speed_mode ?? null,
    light: light ? (light.status === 1 ? 'on' : 'off') : undefined,
    trays,
  };
}

// ---- Steuerung ----
async function control(p, command, { level } = {}) {
  const c = await connect(p);
  if (command === 'pause' || command === 'resume' || command === 'stop') {
    c.client.publish(pubTopic(c.hs, 'print'), buildMsg('print', command, { taskid: '-1' }));
  } else if (command === 'light_on' || command === 'light_off') {
    const on = command === 'light_on';
    c.client.publish(pubTopic(c.hs, 'light'),
      buildMsg('light', 'control', { type: 2, status: on ? 1 : 0, brightness: on ? 100 : 0 }));
  } else if (command === 'speed') {
    c.client.publish(pubTopic(c.hs, 'print'),
      buildMsg('print', 'update', { taskid: '-1', settings: { print_speed_mode: Number(level) || 2 } }));
  } else {
    throw new Error(`Befehl "${command}" wird von diesem Drucker nicht unterstützt`);
  }
  return { ok: true };
}

// ---- G-Code hochladen (+ optional Druck starten) ----
// Upload über den HTTP-Dienst des Handshakes, Start über das slicer-Topic.
async function send(p, filename, gcodeBuffer, start) {
  const c = await connect(p);
  const fd = new FormData();
  fd.append('file', new Blob([gcodeBuffer], { type: 'application/octet-stream' }), filename);
  const r = await fetch(`http://${p.ip}:18910/gcode_upload?s=${encodeURIComponent(c.hs.uploadToken)}`, {
    method: 'POST', body: fd, signal: AbortSignal.timeout(120000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Upload fehlgeschlagen (${r.status}): ${body.slice(0, 160)}`);
  let uploaded = {}; try { uploaded = JSON.parse(body); } catch {}
  if (!start) return { ok: true, uploaded: filename };
  const payload = {
    taskid: '-1',
    filename: uploaded?.data?.filename || uploaded?.filename || filename,
    filetype: 1,
    md5: crypto.createHash('md5').update(gcodeBuffer).digest('hex'),
    filesize: gcodeBuffer.length,
  };
  c.client.publish(pubTopic(c.hs, 'print', 'slicer'), buildMsg('print', 'start', payload));
  return { ok: true, uploaded: filename, started: true };
}

// ---- Kamera: startCapture per MQTT, Stream via RTSP (aus info.urls) oder FLV ----
const capStarted = new Map();   // p.id -> ts
async function snapshot(p) {
  let c;
  try { c = await connect(p); } catch { return null; }
  const now = Date.now();
  if ((capStarted.get(p.id) || 0) < now - 25000) {
    capStarted.set(p.id, now);
    c.client.publish(pubTopic(c.hs, 'video'), buildMsg('video', 'startCapture'));
    query(c, 'info');   // info liefert ggf. urls.rtspUrl nach
  }
  const rtsp = c.latest.get('info')?.urls?.rtspUrl;
  const url = rtsp || `http://${p.ip}:18088/flv`;
  const args = rtsp ? ['-rtsp_transport', 'tcp'] : [];
  return ffcam.snapshot('anycubic:' + p.id, url, args);
}

// ---- Erreichbarkeit: kurzer /info-Check ----
async function online(p, timeoutMs = 2500) {
  try { await getJson(`http://${p.ip}:18910/info`, { timeoutMs }); return true; }
  catch { return false; }
}

module.exports = { status, control, send, snapshot, online };
