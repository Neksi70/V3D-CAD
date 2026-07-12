// Bambu-Cloud-Anbindung, SESSION-basiert (Multi-User): jeder Browser meldet sich
// mit seinem eigenen Bambu-Konto an und bekommt eine Session-ID (sid). Tokens
// liegen nur im Speicher der Brücke, je Session getrennt. Passwörter werden nur
// gegen ein Token getauscht und nie gespeichert. Inoffizielle API.
const crypto = require('crypto');
const mqtt = require('mqtt');

const HOSTS = {
  global: { api: 'https://api.bambulab.com', mqtt: 'mqtts://us.mqtt.bambulab.com:8883' },
  china:  { api: 'https://api.bambulab.cn',  mqtt: 'mqtts://cn.mqtt.bambulab.com:8883' },
};
const host = (region) => HOSTS[region === 'china' ? 'china' : 'global'];

// sid -> { access, uid, region, email, created }
const sessions = new Map();
const SESSION_TTL = 12 * 3600 * 1000;   // 12 h

function gc() {
  const now = Date.now();
  for (const [sid, s] of sessions) if (now - s.created > SESSION_TTL) sessions.delete(sid);
}
setInterval(gc, 3600 * 1000).unref?.();

async function api(region, pathname, body) {
  const r = await fetch(host(region).api + pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let j = {}; try { j = JSON.parse(await r.text()); } catch {}
  return { status: r.status, json: j };
}

function uidFromToken(access) {
  try {
    const p = JSON.parse(Buffer.from(access.split('.')[1], 'base64').toString());
    return p.username || ('u_' + (p.uid || p.sub || ''));
  } catch { return null; }
}

function newSession(access, region, email) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { access, uid: uidFromToken(access), region, email, created: Date.now() });
  return sid;
}

// Login → { ok, sid } | { needCode:true } | { error }
async function login({ email, password, region }) {
  const { json } = await api(region, '/v1/user-service/user/login', { account: email, password });
  if (json.accessToken) return { ok: true, sid: newSession(json.accessToken, region, email) };
  if (json.loginType === 'verifyCode' || json.tfaKey || json.loginType === 'tfa') {
    await api(region, '/v1/user-service/user/sendemail/code', { email, type: 'codeLogin' });
    return { ok: false, needCode: true };
  }
  return { ok: false, error: json.error || json.message || 'Login fehlgeschlagen' };
}

// Passwortlos: nur einen Login-Code per E-Mail anfordern (für Google-/Apple-
// Konten ohne Bambu-Passwort). Danach mit verifyCode() abschließen.
async function requestCode({ email, region }) {
  if (!email) return { ok: false, error: 'E-Mail nötig' };
  const { status } = await api(region, '/v1/user-service/user/sendemail/code', { email, type: 'codeLogin' });
  return { ok: status >= 200 && status < 300, needCode: true };
}

// 2FA-/Login-Mailcode einlösen → { ok, sid }
async function verifyCode({ email, code, region }) {
  const { json } = await api(region, '/v1/user-service/user/login', { account: email, code });
  if (json.accessToken) return { ok: true, sid: newSession(json.accessToken, region, email) };
  return { ok: false, error: json.error || json.message || 'Code ungültig' };
}

function session(sid) { return sessions.get(sid); }
function logout(sid) { sessions.delete(sid); }

async function listDevices(sid) {
  const s = sessions.get(sid); if (!s) return { error: 'nicht angemeldet' };
  const r = await fetch(host(s.region).api + '/v1/iot-service/api/user/bind', {
    headers: { Authorization: 'Bearer ' + s.access },
  });
  const j = await r.json().catch(() => ({}));
  return { devices: (j.devices || []).map(d => ({
    serial: d.dev_id, name: d.name, model: d.dev_model_name, online: d.online })) };
}

function cloudMqtt(sid) {
  const s = sessions.get(sid); if (!s) throw new Error('nicht angemeldet');
  return mqtt.connect(host(s.region).mqtt, {
    username: s.uid, password: s.access, rejectUnauthorized: true,
    connectTimeout: 8000, reconnectPeriod: 0,
  });
}

function getStatus(sid, serial, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let c; try { c = cloudMqtt(sid); } catch (e) { return reject(e); }
    let done = false; const fin = (fn, a) => { if (done) return; done = true; try { c.end(true); } catch {} fn(a); };
    c.on('connect', () => {
      c.subscribe(`device/${serial}/report`);
      c.publish(`device/${serial}/request`, JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }), { qos: 1 });
    });
    c.on('message', (_t, m) => { let j; try { j = JSON.parse(m.toString()); } catch { return; } if (j.print) fin(resolve, j.print); });
    c.on('error', (e) => fin(reject, e));
    setTimeout(() => fin(reject, new Error('Cloud-Status Timeout')), timeoutMs);
  });
}

function sendCommand(sid, serial, payload, { waitMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let c; try { c = cloudMqtt(sid); } catch (e) { return reject(e); }
    let done = false; const fin = (fn, a) => { if (done) return; done = true; try { c.end(true); } catch {} fn(a); };
    c.on('connect', () => {
      if (waitMs > 0) c.subscribe(`device/${serial}/report`);
      c.publish(`device/${serial}/request`, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) return fin(reject, err);
        if (waitMs === 0) return fin(resolve, { sent: true });
      });
    });
    c.on('message', (_t, m) => { let j; try { j = JSON.parse(m.toString()); } catch { return; }
      if (j.print && (j.print.command || j.print.gcode_state !== undefined)) fin(resolve, { sent: true, acked: true, report: j.print }); });
    c.on('error', (e) => fin(reject, e));
    setTimeout(() => fin(resolve, { sent: true, timeout: true }), (waitMs || 6000) + 6000);
  });
}

module.exports = { login, requestCode, verifyCode, session, logout, listDevices, getStatus, sendCommand };
