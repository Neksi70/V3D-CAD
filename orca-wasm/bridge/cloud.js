// Bambu-Cloud-Anbindung: Login (inkl. 2FA-Mailcode), Geräteliste, MQTT für
// Status/Steuerung. Inoffizielle API (wie Home-Assistant-Integration).
// Passwort wird NUR gegen ein Token getauscht und nicht gespeichert.
const mqtt = require('mqtt');

const HOSTS = {
  global: { api: 'https://api.bambulab.com', mqtt: 'mqtts://us.mqtt.bambulab.com:8883' },
  china:  { api: 'https://api.bambulab.cn',  mqtt: 'mqtts://cn.mqtt.bambulab.com:8883' },
};
const host = (region) => HOSTS[region === 'china' ? 'china' : 'global'];

// In-Memory-Token-Cache je Drucker-ID (überlebt Prozessneustart nicht → Re-Login)
const tokens = new Map();   // id -> { access, uid, region }

async function api(region, pathname, body) {
  const r = await fetch(host(region).api + pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j };
}

// uid aus dem JWT (mittleres Segment, base64url) für den MQTT-Nutzernamen
function uidFromToken(access) {
  try {
    const payload = JSON.parse(Buffer.from(access.split('.')[1], 'base64').toString());
    return payload.username || ('u_' + (payload.uid || payload.sub || ''));
  } catch { return null; }
}

// Schritt 1: Login mit E-Mail+Passwort. Ergebnis entweder Token oder
// { needCode:true } — dann Mailcode anfordern und mit verifyCode() abschließen.
async function login(id, { email, password, region }) {
  const { json } = await api(region, '/v1/user-service/user/login', { account: email, password });
  if (json.accessToken) {
    tokens.set(id, { access: json.accessToken, uid: uidFromToken(json.accessToken), region });
    return { ok: true };
  }
  if (json.loginType === 'verifyCode' || json.tfaKey || json.loginType === 'tfa') {
    // Mailcode anfordern
    await api(region, '/v1/user-service/user/sendemail/code', { email, type: 'codeLogin' });
    return { ok: false, needCode: true, tfaKey: json.tfaKey || null };
  }
  return { ok: false, error: json.error || json.message || 'Login fehlgeschlagen' };
}

// Schritt 2 (nur wenn needCode): Mailcode einlösen
async function verifyCode(id, { email, code, region }) {
  const { json } = await api(region, '/v1/user-service/user/login', { account: email, code });
  if (json.accessToken) {
    tokens.set(id, { access: json.accessToken, uid: uidFromToken(json.accessToken), region });
    return { ok: true };
  }
  return { ok: false, error: json.error || json.message || 'Code ungültig' };
}

function isLoggedIn(id) { return tokens.has(id); }

async function listDevices(id) {
  const t = tokens.get(id);
  if (!t) return { error: 'nicht angemeldet' };
  const r = await fetch(host(t.region).api + '/v1/iot-service/api/user/bind', {
    headers: { Authorization: 'Bearer ' + t.access },
  });
  const j = await r.json().catch(() => ({}));
  return { devices: (j.devices || []).map(d => ({
    serial: d.dev_id, name: d.name, model: d.dev_model_name, online: d.online })) };
}

function cloudMqtt(id) {
  const t = tokens.get(id);
  if (!t) throw new Error('nicht angemeldet');
  return mqtt.connect(host(t.region).mqtt, {
    username: t.uid, password: t.access,
    rejectUnauthorized: true, connectTimeout: 8000, reconnectPeriod: 0,
  });
}

// Vollstatus (pushall) über die Cloud
function getStatus(id, serial, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let c; try { c = cloudMqtt(id); } catch (e) { return reject(e); }
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; try { c.end(true); } catch {} fn(arg); };
    c.on('connect', () => {
      c.subscribe(`device/${serial}/report`);
      c.publish(`device/${serial}/request`,
        JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }), { qos: 1 });
    });
    c.on('message', (_t, msg) => { let j; try { j = JSON.parse(msg.toString()); } catch { return; }
      if (j.print) finish(resolve, j.print); });
    c.on('error', (e) => finish(reject, e));
    setTimeout(() => finish(reject, new Error('Cloud-Status Timeout')), timeoutMs);
  });
}

// Steuerbefehl über die Cloud senden
function sendCommand(id, serial, payload, { waitMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let c; try { c = cloudMqtt(id); } catch (e) { return reject(e); }
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; try { c.end(true); } catch {} fn(arg); };
    c.on('connect', () => {
      if (waitMs > 0) c.subscribe(`device/${serial}/report`);
      c.publish(`device/${serial}/request`, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) return finish(reject, err);
        if (waitMs === 0) return finish(resolve, { sent: true });
      });
    });
    c.on('message', (_t, msg) => { let j; try { j = JSON.parse(msg.toString()); } catch { return; }
      if (j.print && (j.print.command || j.print.gcode_state !== undefined))
        finish(resolve, { sent: true, acked: true, report: j.print }); });
    c.on('error', (e) => finish(reject, e));
    setTimeout(() => finish(resolve, { sent: true, timeout: true }), (waitMs || 6000) + 6000);
  });
}

module.exports = { login, verifyCode, isLoggedIn, listDevices, getStatus, sendCommand };
