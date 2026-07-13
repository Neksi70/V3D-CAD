// VolmeSlice Drucker-Brücke (Multi-User): Nutzer melden sich aus der Web-App mit
// ihrem eigenen Bambu-Konto an, sehen ihre eigenen Drucker und senden G-Code.
// Cloud-first (Session je Nutzer); LAN optional, wenn ein Drucker per IP erreichbar.
// Zusätzlich: lokale Flotte aus printers.json (Snapmaker U1 / Elegoo Giga via
// Moonraker, Anycubic Kobra X via LAN-Modus) — ohne Bambu-Login nutzbar, weil
// die Brücke nur im LAN/Tailnet erreichbar ist.
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const express = require('express');
const lan = require('./lan');
const cloud = require('./cloud');
const camera = require('./camera');
const adapters = {
  moonraker: require('./adapters/moonraker'),
  anycubic:  require('./adapters/anycubic'),
};
const nativeSlicer = require('./native-slicer');

const PORT = process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : 7781;

const app = express();
app.use(express.json({ limit: '256mb' }));

// [\w.-]+\.ts\.net: erlaubt mehrteilige MagicDNS-Namen (v3da.tailf05fe9.ts.net)
const OK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[\w.-]+\.ts\.net)(:\d+)?$/;
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && OK_ORIGIN.test(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  // Die App läuft unter COEP require-corp (WASM-Threads). Cross-Origin-
  // Ressourcen — vor allem das Kamera-<img> ohne Origin-Header — werden sonst
  // vom Browser blockiert. Dieser Header erlaubt die Einbettung.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Session-ID aus dem Authorization-Header (Bearer <sid>)
const sidOf = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;

// ---- Lokale Flotte (printers.json): Nicht-Bambu-Drucker im eigenen LAN ----
// IDs bekommen das Präfix "fleet:", damit sie in denselben Endpunkten wie die
// Bambu-Seriennummern laufen. Kein Bambu-Login nötig — wer die Brücke erreicht
// (LAN/Tailnet), darf die Flotte sehen und steuern.
const FLEET_FILE = path.join(__dirname, 'printers.json');
let fleet = [];
function loadFleet() {
  try {
    fleet = (JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8')).printers || [])
      .filter(p => p.id && p.ip && adapters[p.type]);
    console.log('[fleet]', fleet.length, 'Drucker aus printers.json');
  } catch (e) { fleet = []; if (e.code !== 'ENOENT') console.warn('[fleet] printers.json fehlerhaft:', e.message); }
}
loadFleet();
try { fs.watch(FLEET_FILE, () => setTimeout(loadFleet, 300)); } catch {}

const fleetOf = (id) => typeof id === 'string' && id.startsWith('fleet:')
  ? fleet.find(p => 'fleet:' + p.id === id) : null;
const adapterOf = (p) => adapters[p.type];
const caps = (p) => ({
  camera: p.cam !== false,                    // false in printers.json = keine Kamera
  light: p.type === 'anycubic',               // Moonraker-Geräte: (noch) kein Licht-Befehl
  ams: true,
});

// ---- Bambu-Cloud-Login (Passwort nur durchreichen, nie speichern) ----
app.post('/api/login', async (req, res) => {
  const { email, password, region } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort nötig' });
  try { res.json(await cloud.login({ email, password, region })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/request-code', async (req, res) => {
  const { email, region } = req.body || {};
  try { res.json(await cloud.requestCode({ email, region })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/verify', async (req, res) => {
  const { email, code, region } = req.body || {};
  try { res.json(await cloud.verifyCode({ email, code, region })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/logout', (req, res) => { const sid = sidOf(req); if (sid) cloud.logout(sid); res.json({ ok: true }); });

// Session prüfen + Kontoinfo
app.get('/api/me', (req, res) => {
  const s = cloud.session(sidOf(req));
  if (!s) return res.status(401).json({ error: 'nicht angemeldet' });
  res.json({ email: s.email, region: s.region });
});

// Drucker-Liste: lokale Flotte (immer) + Bambu-Cloud-Drucker des angemeldeten
// Nutzers. Ohne Login und ohne Flotte → 401, damit die App das Login-Gate zeigt.
app.get('/api/printers', async (req, res) => {
  const sid = sidOf(req);
  const list = await Promise.all(fleet.map(async p => ({
    serial: 'fleet:' + p.id, name: p.name || p.id, model: p.model || p.type,
    online: await adapterOf(p).online(p).catch(() => false),
    type: p.type, caps: caps(p),
  })));
  if (cloud.session(sid)) {
    try {
      const r = await cloud.listDevices(sid);
      list.push(...(r.devices || []).map(d => ({
        serial: d.serial, name: d.name, model: d.model, online: d.online, type: 'bambu',
        caps: { camera: true, light: true, ams: true },
      })));
    } catch (e) { return res.status(500).json({ error: e.message }); }
  } else if (!list.length) {
    return res.status(401).json({ error: 'nicht angemeldet' });
  }
  res.json(list);
});

// Kurzstatus (für das Sende-Panel)
app.get('/api/status/:serial', async (req, res) => {
  const fp = fleetOf(req.params.serial);
  if (fp) {
    try {
      const st = await adapterOf(fp).status(fp);
      return res.json({ online: st.online, gcode_state: st.state,
        nozzle_temper: st.nozzle, bed_temper: st.bed,
        percent: st.percent, layer: st.layer });
    } catch { return res.json({ online: false }); }
  }
  const sid = sidOf(req);
  if (!cloud.session(sid)) return res.status(401).json({ error: 'nicht angemeldet' });
  try {
    const st = await cloud.getStatus(sid, req.params.serial).catch(() => null);
    res.json({ online: Boolean(st), gcode_state: st?.gcode_state,
      nozzle_temper: st?.nozzle_temper, bed_temper: st?.bed_temper,
      percent: st?.mc_percent, layer: st?.layer_num });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Voll-Dashboard: alle Kennwerte + AMS für die Geräte-Übersicht
function fanPct(v) { const n = Number(v); return Number.isFinite(n) ? (n <= 15 ? Math.round(n / 15 * 100) : n) : null; }
app.get('/api/device/:serial', async (req, res) => {
  const fp = fleetOf(req.params.serial);
  if (fp) {
    try {
      const st = await adapterOf(fp).status(fp);
      return res.json({ ...st, caps: caps(fp) });
    } catch { return res.json({ online: false }); }
  }
  const sid = sidOf(req);
  if (!cloud.session(sid)) return res.status(401).json({ error: 'nicht angemeldet' });
  try {
    const st = await cloud.getStatus(sid, req.params.serial).catch(() => null);
    if (!st) return res.json({ online: false });
    // AMS-Slots einsammeln (Farbe hex RRGGBBAA, Typ)
    const trays = [];
    for (const unit of (st.ams?.ams || [])) for (const t of (unit.tray || [])) {
      if (t.tray_type || t.tray_color)
        trays.push({ id: t.id, type: t.tray_type || '', color: (t.tray_color || '').slice(0, 6),
                     sub: t.tray_sub_brands || '', idx: t.tray_info_idx || '' });
    }
    if (st.vt_tray && (st.vt_tray.tray_type || st.vt_tray.tray_color))
      trays.push({ id: 'ext', type: st.vt_tray.tray_type || '', color: (st.vt_tray.tray_color || '').slice(0, 6),
                   sub: st.vt_tray.tray_sub_brands || '', idx: st.vt_tray.tray_info_idx || '', external: true });
    // H2-Serie (Dual-Düse): externe Spulen kommen als vir_slot-Array (id 254/255)
    for (const v of (st.vir_slot || [])) {
      if (!v.tray_type) continue;   // leerer virtueller Slot
      trays.push({ id: 'ext' + (v.id === '255' ? '2' : ''), type: v.tray_type || '',
                   color: (v.tray_color || '').slice(0, 6),
                   sub: v.tray_sub_brands || '', idx: v.tray_info_idx || '', external: true });
    }
    const light = (st.lights_report || []).find(l => l.node === 'chamber_light')?.mode;
    res.json({
      online: true, state: st.gcode_state, subtask: st.subtask_name,
      percent: st.mc_percent, remaining: st.mc_remaining_time,
      layer: st.layer_num, total: st.total_layer_num,
      nozzle: st.nozzle_temper, nozzle_target: st.nozzle_target_temper,
      bed: st.bed_temper, bed_target: st.bed_target_temper,
      chamber: st.chamber_temper,
      fan_part: fanPct(st.cooling_fan_speed), fan_aux: fanPct(st.big_fan1_speed), fan_cham: fanPct(st.big_fan2_speed),
      speed_lvl: st.spd_lvl, light, trays,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Steuerbefehle: pause/resume/stop/light_on/light_off/speed
app.post('/api/control/:serial', async (req, res) => {
  const fp = fleetOf(req.params.serial);
  if (fp) {
    const { command, level } = req.body || {};
    try { return res.json({ ok: true, ...(await adapterOf(fp).control(fp, command, { level })) }); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  const sid = sidOf(req);
  if (!cloud.session(sid)) return res.status(401).json({ error: 'nicht angemeldet' });
  const { command, level } = req.body || {};
  const map = {
    pause:  { print: { sequence_id: '0', command: 'pause' } },
    resume: { print: { sequence_id: '0', command: 'resume' } },
    stop:   { print: { sequence_id: '0', command: 'stop' } },
    light_on:  { system: { sequence_id: '0', command: 'ledctrl', led_node: 'chamber_light', led_mode: 'on' } },
    light_off: { system: { sequence_id: '0', command: 'ledctrl', led_node: 'chamber_light', led_mode: 'off' } },
    speed:  { print: { sequence_id: '0', command: 'print_speed', param: String(level || 2) } },
  };
  const payload = map[command];
  if (!payload) return res.status(400).json({ error: 'unbekannter Befehl' });
  try {
    const r = await cloud.sendCommand(sid, req.params.serial, payload, { waitMs: 0 });
    res.json({ ok: true, sent: r.sent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// G-Code senden: { serial, filename, gcode, start }
app.post('/api/send', async (req, res) => {
  const { serial, filename, gcode, start, lanIp, lanCode, useAms } = req.body || {};
  if (!serial || !gcode) return res.status(400).json({ error: 'serial/gcode nötig' });
  const name = (filename || 'volmeslice.gcode').replace(/[^\w.\-]/g, '_');
  const buf = Buffer.from(gcode, 'utf8');
  const fp = fleetOf(serial);
  if (fp) {
    try {
      const r = await adapterOf(fp).send(fp, name, buf, Boolean(start));
      return res.json({ ok: true, path: fp.type, ...r });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  const sid = sidOf(req);
  if (!cloud.session(sid)) return res.status(401).json({ error: 'nicht angemeldet' });
  try {
    // Wenn der Nutzer LAN-Zugangsdaten mitschickt und der Drucker erreichbar
    // ist: Dateiversand robust über LAN-FTP.
    if (lanIp && lanCode) {
      const p = { ip: lanIp, access_code: lanCode, serial };
      if (await lan.reachable(p)) {
        await lan.uploadGcode(p, name, buf);
        let pr = null;
        if (start) pr = await lan.sendCommand(p, { print: { sequence_id: '0', command: 'project_file',
          param: name, subtask_name: name.replace(/\.[^.]+$/, ''), url: `ftp://${name}`,
          bed_type: 'auto', use_ams: Boolean(useAms), timelapse: false, bed_leveling: true } }, { waitMs: 3000 });
        return res.json({ ok: true, path: 'lan', uploaded: name, print: pr });
      }
    }
    // Cloud-Fallback: Steuerung/Start geht; Dateiversand an entfernte Drucker
    // ist experimentell (Bambu-Cloudspeicher, inoffiziell).
    if (start) {
      const r = await cloud.sendCommand(sid, serial, { print: { sequence_id: '0',
        command: 'project_file', param: name, subtask_name: name.replace(/\.[^.]+$/, ''),
        use_ams: Boolean(useAms) } }, { waitMs: 3000 }).catch(e => ({ error: e.message }));
      return res.json({ ok: !r.error, path: 'cloud', experimental: true,
        note: 'Cloud-Dateiversand ist experimentell — Datei muss ggf. schon auf dem Drucker liegen.', print: r });
    }
    return res.status(501).json({ error: 'Cloud-Upload frischer Dateien noch nicht unterstützt — Drucker per LAN verbinden (IP + Code angeben).' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Nativer Slice-Dienst (2–3× schneller als Browser-WASM) ----
// Kein Login nötig — Brücke ist tailnet-only, gleiche Policy wie die Flotte.
app.get('/api/slice/health', (req, res) => res.json({ available: nativeSlicer.available() }));

// Job einreichen: { filename, model (base64), profiles, overrides, transforms, filamentChains }
app.post('/api/slice', (req, res) => {
  if (!nativeSlicer.available())
    return res.status(503).json({ error: 'nativer Slicer nicht gebaut' });
  const { filename, model, profiles, overrides, transforms, filamentChains } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model (base64) nötig' });
  try {
    const id = nativeSlicer.submit({
      filename, bytes: Buffer.from(model, 'base64'),
      profiles, overrides, transforms, filamentChains,
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/slice/:id/status', (req, res) => {
  const s = nativeSlicer.status(req.params.id);
  if (!s) return res.status(404).json({ error: 'unbekannter Job' });
  res.json({ state: s.state, percent: s.percent, text: s.text, error: s.error, warnings: s.warnings });
});

app.get('/api/slice/:id/gcode', (req, res) => {
  const p = nativeSlicer.takeGcode(req.params.id);
  if (!p) return res.status(404).json({ error: 'kein G-Code (Job nicht fertig?)' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  fs.createReadStream(p).pipe(res);
});

// Live-Kamera: Einzelbild-Polling. RTSP-over-TLS (Port 322, X1-Protokoll) hält
// die Brücke offen (camera.js); der Browser holt hier das neueste JPEG.
// Robust durch Proxys, weil jede Anfrage eine normale kurze Antwort ist.
// sid im Query (img kann keine Header setzen); ip/code streng validiert.
app.get('/api/camera/snapshot', async (req, res) => {
  // Flotten-Drucker: die Brücke kennt IP/Protokoll selbst (?id=fleet:<id>)
  const fp = fleetOf(String(req.query.id || ''));
  if (fp) {
    try {
      const jpg = await adapterOf(fp).snapshot(fp);
      if (!jpg) return res.status(503).end();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(jpg);
    } catch { return res.status(503).end(); }
  }
  if (!cloud.session(req.query.sid)) return res.status(401).end();
  const ip = String(req.query.ip || ''), code = String(req.query.code || '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || !/^[A-Za-z0-9]{4,16}$/.test(code))
    return res.status(400).end('ungültige IP/Code');
  const jpg = camera.snapshot(ip, code);
  console.log(`[cam-http] ${ip} → ${jpg ? jpg.length + 'B' : '503 (kein Bild)'}`);
  if (!jpg) return res.status(503).end();   // Verbindung startet gerade — Browser pollt weiter
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.end(jpg);
});

function start() {
  const keyP = process.env.BRIDGE_KEY, crtP = process.env.BRIDGE_CRT;
  if (keyP && crtP && fs.existsSync(keyP) && fs.existsSync(crtP)) {
    https.createServer({ key: fs.readFileSync(keyP), cert: fs.readFileSync(crtP) }, app)
      .listen(PORT, '0.0.0.0', () => console.log(`Bridge (HTTPS) :${PORT}`));
  } else {
    http.createServer(app).listen(PORT, '0.0.0.0', () => console.log(`Bridge (HTTP) :${PORT}`));
  }
}
start();
