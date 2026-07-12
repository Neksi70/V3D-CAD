// VolmeSlice Drucker-Brücke: nimmt G-Code von der Web-App entgegen und schickt
// ihn an einen Bambu-Drucker — bevorzugt per LAN, sonst (später) über die Cloud.
// Muster wie occt-server: HTTPS auf 0.0.0.0, Origin-Allowlist auf Tailnet/LAN.
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const express = require('express');
const lan = require('./lan');
const cloud = require('./cloud');

const PORT = process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : 7781;
const CFG = path.join(__dirname, 'printers.json');

function loadPrinters() {
  if (!fs.existsSync(CFG)) return [];
  try { return JSON.parse(fs.readFileSync(CFG, 'utf8')).printers || []; }
  catch (e) { console.error('printers.json fehlerhaft:', e.message); return []; }
}

const app = express();
app.use(express.json({ limit: '256mb' }));

// Nur Tailnet/LAN/localhost dürfen zugreifen (wie occt-server)
const OK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[\w-]+\.ts\.net)(:\d+)?$/;
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && OK_ORIGIN.test(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Druckerliste (ohne Geheimnisse) — für das "Senden"-Dropdown
app.get('/api/printers', (req, res) => {
  res.json(loadPrinters().map(p => ({
    id: p.id, name: p.name, model: p.model,
    lan: Boolean(p.ip && p.access_code && p.serial),
    cloud: Boolean(p.cloud && p.cloud.enabled),
    cloudReady: cloud.isLoggedIn(p.id),
  })));
});

// --- Cloud-Login (Passwort nur durchreichen, nie speichern) ---
// { id, email, password, region }  → { ok } | { needCode }
app.post('/api/cloud/login', async (req, res) => {
  const { id, email, password, region } = req.body || {};
  if (!id || !email || !password) return res.status(400).json({ error: 'id/email/password nötig' });
  try { res.json(await cloud.login(id, { email, password, region })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// { id, email, code, region }  → { ok }
app.post('/api/cloud/verify', async (req, res) => {
  const { id, email, code, region } = req.body || {};
  try { res.json(await cloud.verifyCode(id, { email, code, region })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// Geräteliste aus der Cloud (zum Abgleich der Seriennummer)
app.get('/api/cloud/devices/:id', async (req, res) => {
  try { res.json(await cloud.listDevices(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Erreichbarkeit + Kurzstatus eines Druckers
app.get('/api/status/:id', async (req, res) => {
  const p = loadPrinters().find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Drucker unbekannt' });
  const fmt = (path, st) => ({ path, online: true,
    gcode_state: st?.gcode_state, nozzle_temper: st?.nozzle_temper,
    bed_temper: st?.bed_temper, percent: st?.mc_percent, layer: st?.layer_num });
  try {
    if (p.ip && await lan.reachable(p)) {
      return res.json(fmt('lan', await lan.getStatus(p).catch(() => null)));
    }
    if (cloud.isLoggedIn(p.id) && p.serial) {
      return res.json(fmt('cloud', await cloud.getStatus(p.id, p.serial).catch(() => null)));
    }
    return res.json({ path: p.cloud?.enabled ? 'cloud' : 'none', online: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// G-Code senden: { printerId, filename, gcode }  → Upload + Druckstart
app.post('/api/send', async (req, res) => {
  const { printerId, filename, gcode, start } = req.body || {};
  const p = loadPrinters().find(x => x.id === printerId);
  if (!p) return res.status(404).json({ error: 'Drucker unbekannt' });
  if (!gcode) return res.status(400).json({ error: 'gcode fehlt' });
  const name = (filename || 'volmeslice.gcode').replace(/[^\w.\-]/g, '_');
  const buf = Buffer.from(gcode, 'utf8');
  try {
    if (p.ip && await lan.reachable(p)) {
      await lan.uploadGcode(p, name, buf);
      let printResult = null;
      if (start) {
        // Druckstart via project_file-Kommando (Bambu-LAN). Verweist auf die
        // hochgeladene Datei im Druckerspeicher. HINWEIS: Feldwerte sind
        // modellabhängig — beim ersten echten Drucker verifizieren.
        printResult = await lan.sendCommand(p, {
          print: {
            sequence_id: '0', command: 'project_file',
            param: name, subtask_name: name.replace(/\.[^.]+$/, ''),
            url: `ftp://${name}`, bed_type: 'auto',
            use_ams: false, timelapse: false, flow_cali: false,
            bed_leveling: true, layer_inspect: false, vibration_cali: false,
          },
        }, { waitMs: 3000 });
      }
      return res.json({ ok: true, path: 'lan', uploaded: name, print: printResult });
    }
    // Cloud-Fallback: Steuerung/Start geht, Dateiübertragung an ENTFERNTE
    // Drucker ist experimentell (Bambu-Cloudspeicher, inoffiziell)
    if (cloud.isLoggedIn(p.id) && p.serial) {
      if (start) {
        const r = await cloud.sendCommand(p.id, p.serial, {
          print: { sequence_id: '0', command: 'project_file', param: name,
            subtask_name: name.replace(/\.[^.]+$/, ''), use_ams: false },
        }, { waitMs: 3000 }).catch(e => ({ error: e.message }));
        return res.json({ ok: !r.error, path: 'cloud', experimental: true,
          note: 'Cloud-Dateiversand ist experimentell — Datei muss ggf. schon auf dem Drucker/SD liegen.',
          print: r });
      }
      return res.status(501).json({ error: 'Cloud-Upload frischer Dateien noch nicht unterstützt — Drucker per LAN verbinden zum Übertragen.' });
    }
    if (p.cloud?.enabled)
      return res.status(401).json({ error: 'Cloud konfiguriert, aber nicht angemeldet — bitte in der App einloggen.' });
    return res.status(502).json({ error: 'Drucker per LAN nicht erreichbar und keine Cloud verfügbar' });
  } catch (e) {
    res.status(500).json({ error: 'LAN-Fehler: ' + e.message });
  }
});

// HTTPS wenn Zertifikate vorhanden (occt-Zertifikat wiederverwenden), sonst HTTP
function start() {
  const certDir = path.join(process.env.HOME, '.mitmproxy');
  const keyP = process.env.BRIDGE_KEY, crtP = process.env.BRIDGE_CRT;
  if (keyP && crtP && fs.existsSync(keyP) && fs.existsSync(crtP)) {
    https.createServer({ key: fs.readFileSync(keyP), cert: fs.readFileSync(crtP) }, app)
      .listen(PORT, '0.0.0.0', () => console.log(`Bridge (HTTPS) :${PORT}`));
  } else {
    http.createServer(app).listen(PORT, '0.0.0.0', () => console.log(`Bridge (HTTP) :${PORT}`));
  }
}
start();
