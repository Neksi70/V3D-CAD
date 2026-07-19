// VolmeSlice Drucker-Brücke (Multi-User): Nutzer melden sich aus der Web-App mit
// ihrem eigenen Bambu-Konto an, sehen ihre eigenen Drucker und senden G-Code.
// Cloud-first (Session je Nutzer); LAN optional, wenn ein Drucker per IP erreichbar.
// Zusätzlich: lokale Flotte aus printers.json (Snapmaker U1 / Elegoo Giga via
// Moonraker, Anycubic Kobra X via LAN-Modus) — ohne Bambu-Login nutzbar, weil
// die Brücke nur im LAN/Tailnet erreichbar ist.
const fs = require('fs');
const os = require('os');
const { execFileSync, execFile } = require('child_process');
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
const gcode3mf = require('./gcode3mf');
const injectConfig = require('./inject-config'); // H2C: Hotend-Topologie-Keys im G-Code-Header auf Studio-Werte (2 statt 4) → behebt 0500-4047

const PORT = process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : 7781;

const app = express();

// Funnel-Pfad: öffentlich läuft die Brücke unter https://…:10000/bridge/…
// (tailscale serve reicht den Präfix mit durch) — hier abstreifen.
app.use((req, res, next) => {
  if (req.url === '/bridge' || req.url.startsWith('/bridge/')) req.url = req.url.slice(7) || '/';
  next();
});

app.use(express.json({ limit: '256mb' }));

// [\w.-]+\.ts\.net: erlaubt mehrteilige MagicDNS-Namen (v3da.tailf05fe9.ts.net)
const OK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[\w.-]+\.ts\.net)(:\d+)?$/;
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && OK_ORIGIN.test(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Fleet-Code');
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
let fleetCode = null;   // printers.json "fleetCode": Druckcode für Funnel-Zugriff
function loadFleet() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FLEET_FILE, 'utf8'));
    fleet = (parsed.printers || []).filter(p => p.id && p.ip && adapters[p.type]);
    fleetCode = typeof parsed.fleetCode === 'string' && parsed.fleetCode.trim() ? parsed.fleetCode.trim() : null;
    console.log('[fleet]', fleet.length, 'Drucker aus printers.json' + (fleetCode ? ' (Druckcode aktiv)' : ''));
  } catch (e) { fleet = []; fleetCode = null; if (e.code !== 'ENOENT') console.warn('[fleet] printers.json fehlerhaft:', e.message); }
}
loadFleet();
try { fs.watch(FLEET_FILE, () => setTimeout(loadFleet, 300)); } catch {}

const fleetOf = (id) => typeof id === 'string' && id.startsWith('fleet:')
  ? fleet.find(p => 'fleet:' + p.id === id) : null;

// ---- LAN-Autodiscovery: Bambu-Drucker senden SSDP-Ankündigungen auf UDP 2021
// (USN = Seriennummer, Location = IP). Passiv lauschen genügt — der Datei-
// versand kann dann automatisch den robusten LAN-Weg nehmen (Zugangscode
// kommt aus der Bambu-Cloud), ohne dass der Nutzer IP/Code eintippt.
const dgram = require('dgram');
const ssdpSeen = new Map();   // serial -> { ip, name, model, ts }
(function startSsdp() {
  try {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('message', (msg, rinfo) => {
      const t = msg.toString();
      const usn = (t.match(/^USN:\s*(\S+)/mi) || [])[1];
      if (usn) ssdpSeen.set(usn, {
        ip: (t.match(/^Location:\s*(\S+)/mi) || [])[1] || rinfo.address,
        name: (t.match(/^DevName\.bambu\.com:\s*(.*)$/mi) || [])[1]?.trim() || '',
        model: (t.match(/^DevModel\.bambu\.com:\s*(.*)$/mi) || [])[1]?.trim() || '',
        ts: Date.now() });
    });
    sock.on('error', (e) => console.warn('[ssdp]', e.message));
    sock.bind(2021, () => console.log('[ssdp] LAN-Discovery auf UDP 2021'));
  } catch (e) { console.warn('[ssdp]', e.message); }
})();
const ssdpFresh = (serial) => {
  const h = ssdpSeen.get(serial);
  return h && Date.now() - h.ts < 30 * 60e3 ? h : null;
};

// Zugangscodes für LAN-only Bambu-Drucker (Entwicklermodus): kommen nicht mehr
// aus der Cloud, sondern vom Drucker-Display. Die App meldet sie via
// /api/lan-auth; persistent gehalten (überlebt Bridge-Neustarts), damit
// Status/Kamera/Senden sie nutzen können. { serial -> { ip, code } }
const LANAUTH_FILE = path.join(__dirname, 'lan-auth.json');
const lanAuth = new Map();
(function loadLanAuth() {
  try { for (const [s, v] of JSON.parse(fs.readFileSync(LANAUTH_FILE, 'utf8'))) lanAuth.set(s, v); } catch {}
})();
function persistLanAuth() {
  try { fs.writeFileSync(LANAUTH_FILE, JSON.stringify([...lanAuth]), { mode: 0o600 }); } catch {}
}
// IP + Code eines (evtl. LAN-only) Bambu-Druckers auflösen: explizit > gemeldet
// > SSDP-IP + Cloud-Code. Gibt { ip, code, auto } oder { ip:null }.
async function resolveLan(sid, serial, lanIp, lanCode) {
  let ip = lanIp || lanAuth.get(serial)?.ip;
  let code = lanCode || lanAuth.get(serial)?.code;
  const explicit = Boolean(lanIp && lanCode);
  if (!ip) ip = ssdpFresh(serial)?.ip || null;
  if (ip && !code) code = await cloud.accessCode(sid, serial).catch(() => null);
  return { ip, code, auto: Boolean(ip && code && !explicit) };
}
// Vollstatus (pushall-print-Objekt) holen: LAN-only Bambu (lanAuth bekannt) über
// LAN, sonst über die Cloud. Beide liefern dieselbe Struktur.
function printStatus(sid, serial) {
  const la = lanAuth.get(serial);
  if (la) return lan.getStatus({ ip: la.ip, access_code: la.code, serial }).catch(() => null);
  return cloud.getStatus(sid, serial).catch(() => null);
}

// ---- Druckcode-Gate: Flotte/Kamera/nativer Slicer nur für LAN/Tailnet ODER
// mit Code (Header X-Fleet-Code bzw. ?fc=). Über den Funnel setzt tailscaled
// X-Forwarded-For auf die öffentliche Client-IP; LAN-Direktzugriffe haben kein
// XFF, Tailnet-Proxys eine CGNAT-/private IP. Letzten Hop prüfen (der stammt
// von tailscaled, nicht vom Client).
const PRIV_IP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|fd7a:115c:|::1$|::ffff:127\.|fe80:)/i;
function isTrusted(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!xff.length) return true;
  return PRIV_IP.test(xff[xff.length - 1]);
}
function fleetOk(req) {
  if (isTrusted(req)) return true;
  if (!fleetCode) return false;   // ohne konfigurierten Code bleibt öffentlich alles zu
  const got = String(req.headers['x-fleet-code'] || req.query.fc || '');
  return got.length === fleetCode.length &&
    require('crypto').timingSafeEqual(Buffer.from(got), Buffer.from(fleetCode));
}
const needCode = (res) => res.status(403).json({ error: 'Druckcode nötig', needCode: true });
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

// LAN-Zugangscode eines Entwicklermodus-Druckers hinterlegen, damit Status/
// Kamera/Senden ohne Cloud laufen. IP ist optional (sonst aus SSDP).
app.post('/api/lan-auth', async (req, res) => {
  if (!cloud.session(sidOf(req)) && !fleetOk(req)) return res.status(401).json({ error: 'nicht angemeldet' });
  const { serial, ip, code } = req.body || {};
  if (!serial || !code) return res.status(400).json({ error: 'serial + code nötig' });
  const useIp = ip || ssdpFresh(serial)?.ip;
  if (!useIp) return res.status(400).json({ error: 'Drucker-IP unbekannt (nicht im LAN gesehen) — bitte IP angeben' });
  const p = { ip: useIp, access_code: String(code), serial };
  const ok = await lan.reachable(p).catch(() => false);
  if (!ok) return res.status(502).json({ error: 'Drucker antwortet nicht — IP/Code prüfen (LAN-Modus aktiv?)' });
  lanAuth.set(serial, { ip: useIp, code: String(code) });
  persistLanAuth();
  res.json({ ok: true, ip: useIp });
});

// Drucker-Liste: lokale Flotte (immer) + Bambu-Cloud-Drucker des angemeldeten
// Nutzers. Ohne Login und ohne Flotte → 401, damit die App das Login-Gate zeigt.
app.get('/api/printers', async (req, res) => {
  const sid = sidOf(req);
  const list = await Promise.all((fleetOk(req) ? fleet : []).map(async p => ({
    serial: 'fleet:' + p.id, name: p.name || p.id, model: p.model || p.type,
    online: await adapterOf(p).online(p).catch(() => false),
    type: p.type, caps: caps(p),
  })));
  const cloudSerials = new Set();
  if (cloud.session(sid)) {
    try {
      const r = await cloud.listDevices(sid);
      list.push(...(r.devices || []).map(d => {
        cloudSerials.add(d.serial);
        return { serial: d.serial, name: d.name, model: d.model, online: d.online, type: 'bambu',
                 caps: { camera: true, light: true, ams: true } };
      }));
    } catch (e) {
      // Bambu-API-Schluckauf soll nicht die ganze Liste killen — Flotte
      // trotzdem liefern; ganz ohne Drucker bleibt der Fehler sichtbar.
      console.warn('[cloud] listDevices:', e.message);
      if (!list.length) return res.status(500).json({ error: e.message });
    }
    // Per SSDP im LAN gesehene Bambu-Drucker, die NICHT in der Cloud sind
    // (Entwicklermodus = LAN-only). Als eigener Typ "bambu-lan": Steuerung
    // läuft über LAN mit dem Zugangscode vom Drucker-Display (lanCode).
    for (const [serial, h] of ssdpSeen) {
      if (cloudSerials.has(serial) || Date.now() - h.ts > 30 * 60e3) continue;
      list.push({ serial, name: h.name || ('Bambu ' + serial.slice(-4)),
        model: h.model || 'Bambu (LAN)', online: true, type: 'bambu-lan', ip: h.ip,
        caps: { camera: true, light: true, ams: true } });
    }
  } else if (!list.length) {
    // needCode: es gäbe eine Flotte, aber der (öffentliche) Client hat keinen Code
    return res.status(401).json({ error: 'nicht angemeldet', needCode: fleet.length > 0 && !fleetOk(req) });
  }
  res.json(list);
});

// Kurzstatus (für das Sende-Panel)
app.get('/api/status/:serial', async (req, res) => {
  const fp = fleetOf(req.params.serial);
  if (fp) {
    if (!fleetOk(req)) return needCode(res);
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
    const st = await printStatus(sid, req.params.serial);
    res.json({ online: Boolean(st), gcode_state: st?.gcode_state,
      nozzle_temper: st?.nozzle_temper, bed_temper: st?.bed_temper,
      percent: st?.mc_percent, layer: st?.layer_num });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Voll-Dashboard: alle Kennwerte + AMS für die Geräte-Übersicht
function fanPct(v) { const n = Number(v); return Number.isFinite(n) ? (n <= 15 ? Math.round(n / 15 * 100) : n) : null; }

// Düsenstatus. H2-Serie (Dual-Extruder + Induktions-Hotend-Magazin):
// device.extruder.info[].hnow = id der montierten Düse; Extruder id 0 = Haupt-
// Extruder = RECHTS, id 1 = links (Bambu-Studio-Konvention). device.nozzle.info
// listet alle physisch vorhandenen Düsen (montiert + Magazin, Magazin-ids 16+);
// nur das Magazin des Haupt-Extruders wird automatisch gewechselt.
// Typ-Code: "HS…" = Standard, "HH…" = High Flow. Einzeldüsen-Drucker (A1 …)
// melden nur nozzle_diameter/nozzle_type auf oberster Ebene.
function nozzleInfo(st) {
  const dev = st.device;
  const pack = (n) => n && n.diameter != null ? {
    diameter: n.diameter, type: n.type || '', wear: n.wear ?? null,
    color: (n.color_m && n.color_m !== '00000000') ? n.color_m.slice(0, 6) : '',
  } : null;
  if (Array.isArray(dev?.nozzle?.info) && dev.nozzle.info.length) {
    const byId = new Map(dev.nozzle.info.map(n => [n.id, n]));
    const exts = Array.isArray(dev.extruder?.info) ? dev.extruder.info : [];
    const mounted = new Set(exts.map(e => e.hnow));
    return {
      multi: true,
      extruders: exts.map(e => ({ id: e.id, side: e.id === 0 ? 'right' : 'left',
                                  nozzle: pack(byId.get(e.hnow)) })),
      magazine: dev.nozzle.info.filter(n => !mounted.has(n.id))
        .map(n => ({ id: n.id, ...pack(n) })),
    };
  }
  const d = parseFloat(st.nozzle_diameter);
  if (!Number.isFinite(d)) return null;
  return { multi: false, magazine: [],
    extruders: [{ id: 0, side: 'right', nozzle: { diameter: d, type: String(st.nozzle_type || ''), wear: null, color: '' } }] };
}
app.get('/api/device/:serial', async (req, res) => {
  const fp = fleetOf(req.params.serial);
  if (fp) {
    if (!fleetOk(req)) return needCode(res);
    try {
      const st = await adapterOf(fp).status(fp);
      return res.json({ ...st, caps: caps(fp) });
    } catch { return res.json({ online: false }); }
  }
  const sid = sidOf(req);
  if (!cloud.session(sid)) return res.status(401).json({ error: 'nicht angemeldet' });
  try {
    const st = await printStatus(sid, req.params.serial);
    if (!st) return res.json({ online: false });
    // AMS-Slots einsammeln (Farbe hex RRGGBBAA, Typ). gid = globale Tray-Nummer
    // (AMS-Einheit × 4 + Slot) — die braucht ams_mapping beim Druckstart.
    const trays = [];
    for (const unit of (st.ams?.ams || [])) for (const t of (unit.tray || [])) {
      if (t.tray_type || t.tray_color)
        trays.push({ id: t.id, gid: Number(unit.id || 0) * 4 + Number(t.id || 0),
                     type: t.tray_type || '', color: (t.tray_color || '').slice(0, 6),
                     sub: t.tray_sub_brands || '', idx: t.tray_info_idx || '' });
    }
    if (st.vt_tray && (st.vt_tray.tray_type || st.vt_tray.tray_color))
      trays.push({ id: 'ext', gid: 254, type: st.vt_tray.tray_type || '', color: (st.vt_tray.tray_color || '').slice(0, 6),
                   sub: st.vt_tray.tray_sub_brands || '', idx: st.vt_tray.tray_info_idx || '', external: true });
    // H2-Serie (Dual-Düse): externe Spulen kommen als vir_slot-Array (id 254/255)
    for (const v of (st.vir_slot || [])) {
      if (!v.tray_type) continue;   // leerer virtueller Slot
      trays.push({ id: 'ext' + (v.id === '255' ? '2' : ''), gid: Number(v.id) || 254,
                   type: v.tray_type || '', color: (v.tray_color || '').slice(0, 6),
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
      speed_lvl: st.spd_lvl, light, trays, nozzles: nozzleInfo(st),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Steuerbefehle: pause/resume/stop/light_on/light_off/speed
app.post('/api/control/:serial', async (req, res) => {
  const fp = fleetOf(req.params.serial);
  if (fp) {
    if (!fleetOk(req)) return needCode(res);
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

// G-Code senden: { serial, filename, gcode, start } + Druckoptionen
// { timelapse, bedLeveling, flowCali, amsMapping } aus dem Sende-Dialog.
// Antwort: { ok, id } — der Versand läuft als Job, die App pollt
// /api/send/:id/status für den Übertragungs-Fortschritt (Ladebalken).
const sendJobs = new Map();   // id -> { phase, percent, result, error, ts }
setInterval(() => {
  const now = Date.now();
  for (const [k, j] of sendJobs) if (now - j.ts > 15 * 60e3) sendJobs.delete(k);
}, 60e3).unref?.();

// H2/Dual-Düse: AMS-Zuordnung im project_file-Befehl EXAKT wie Bambu Studio bauen.
// Per echtem MQTT-Mitschnitt von Studios project_file-Befehl (2026-07-19) verifiziert:
//   ams_mapping   = Array LÄNGE=Slots, tray-gid fürs benutzte, -1 sonst  (z.B. [-1,0,-1,-1,-1])
//   ams_mapping2  = gleiche Länge, {ams_id,slot_id} bzw. {255,255}  (KEY OHNE Unterstrich!)
//   nozzle_mapping= 32-Array, Düsen-POSITION (device.nozzle.tar_id, z.B. 17) am benutzten
//                   Slot-Index, -1 sonst.  DAS mappt Filament→physische Düse; fehlte uns.
// Studio sendet KEIN ams_mapping_info / nozzles_info im project_file (das war ein anderer
// Query-Flow, get_auto_nozzle_mapping). Unser falscher Key "ams_mapping_2" + fehlendes
// nozzle_mapping ließen "AMS-Zuordnungstabelle konnte nicht abgerufen werden" [0x7FF8012].
function buildAmsFieldsFromFile(nativePath, gids, nozzleTar) {
  if (!nativePath || !Array.isArray(gids) || !gids.length) return null;
  let si;
  try { si = execFileSync('unzip', ['-p', nativePath, 'Metadata/slice_info.config'],
                          { maxBuffer: 1 << 24 }).toString(); } catch { return null; }
  const fmMatch = si.match(/filament_maps"\s+value="([^"]*)"/);
  const fmap = fmMatch ? fmMatch[1].trim().split(/\s+/).map(Number).filter(Number.isFinite) : [];
  const N = fmap.length || gids.length;
  // Filament-Elemente je Slot parsen (Farbe/Typ/Filament-ID) — der Drucker braucht die,
  // um die "AMS-Zuordnungstabelle" zu bauen (sonst [0x7FF8012]). RRGGBB → RRGGBBAA.
  const toRGBA = (c) => { const h = String(c || '').replace('#', '').toUpperCase(); return h.length === 6 ? h + 'FF' : (h || ''); };
  const filBySlot = {};
  for (const m of si.matchAll(/<filament\s+([^>]*?)\/?>/g)) {
    const a = m[1];
    const id = +((a.match(/\bid="(\d+)"/) || [])[1]);
    if (!id) continue;
    filBySlot[id] = {
      color: toRGBA((a.match(/\bcolor="([^"]*)"/) || [])[1]),
      type: (a.match(/\btype="([^"]*)"/) || [])[1] || 'PLA',
      fid: (a.match(/\btray_info_idx="([^"]*)"/) || [])[1] || '',
      used: /used_for_object="true"/.test(a),
    };
  }
  // benutzte Filament-Slots (1-basiert), in Datei-Reihenfolge
  const usedIds = Object.keys(filBySlot).map(Number).filter(id => filBySlot[id].used).sort((x, y) => x - y);
  const used = usedIds.length ? usedIds : gids.map((_, i) => i + 1);
  // benutzten Slot → Tray-gid. Der Sende-Dialog liefert EINEN gid je Projekt-Filament
  // in Slot-Reihenfolge (gids[slot-1]). Nur wenn die Laengen nicht passen (Einfarb-Fall:
  // 1 gid, aber 5 Profil-Slots in filament_maps), positional auf die benutzten mappen —
  // sonst verrutscht die Zuordnung, sobald ein mittleres Filament unbenutzt ist.
  const trayBySlot = {};
  if (gids.length === N || gids.length >= Math.max(...used)) {
    used.forEach((slot) => { trayBySlot[slot] = gids[slot - 1] != null ? gids[slot - 1] : gids[gids.length - 1]; });
  } else {
    used.forEach((slot, i) => { trayBySlot[slot] = gids[i] != null ? gids[i] : gids[gids.length - 1]; });
  }
  const tar = Number.isFinite(nozzleTar) ? nozzleTar : 17; // aktive Düsen-Position
  const v0 = [], v1 = [];
  const nozMap = new Array(32).fill(-1);
  for (let slot = 1; slot <= N; slot++) {
    const g = trayBySlot[slot];
    if (g != null) {
      v0.push(g);
      v1.push(g >= 254 ? { ams_id: g, slot_id: 0 } : { ams_id: Math.floor(g / 4), slot_id: g % 4 });
      if (slot - 1 < 32) nozMap[slot - 1] = tar; // benutztes Filament → aktive Düse
    } else { v0.push(-1); v1.push({ ams_id: 0xff, slot_id: 0xff }); }
  }
  // benutzte Filamente mit Details (für die get_auto_nozzle_mapping-Vorabfrage)
  const usedFil = used.map((slot) => ({
    slot, gid: trayBySlot[slot],
    fid: (filBySlot[slot] || {}).fid || 'GFA00',
    color: (filBySlot[slot] || {}).color || '',
    direction: fmap[slot - 1] || 2, // 1=links, 2=rechts (aus filament_maps)
  }));
  return { ams_mapping: v0, ams_mapping2: v1, nozzle_mapping: nozMap, usedFil };
}

// (get_auto_nozzle_mapping-Vorabquery entfernt 2026-07-19: LAN-AMS-Druck braucht sie nicht.
// Der Drucker baut die AMS-Zuordnung allein aus ams_mapping/ams_mapping2 des project_file,
// sofern die Datei slot-konsistent ist. Belegt via Isolationstest + OrcaSlicer/OBN-Quellcode.)

// H2-Serie: 3MF auf den INTERNEN Speicher (emmc) laden — über Port 6000
// (BambuTunnelLocal, emmc_upload.py). Studio macht das so; FTP/SD löst den
// "AMS-Zuordnungstabelle nicht abrufbar"-Bug [0700-8012] aus. Datei-URL wird dann
// brtc://emmc/<name>. Gibt true bei Erfolg.
function emmcUpload(printer, buf, remoteName) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), 'emmc-' + Date.now().toString(36) + '.3mf');
    fs.writeFileSync(tmp, buf);
    execFile('python3', [path.join(__dirname, 'emmc_upload.py'),
      printer.ip, printer.access_code, tmp, remoteName],
      { timeout: 120000 }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmp); } catch {}
        if (err) return reject(new Error((stderr || err.message || '').trim()));
        if (String(stdout).includes('OK')) return resolve(true);
        reject(new Error('emmc-Upload: unerwartete Antwort ' + stdout));
      });
  });
}

async function runSend(job, { fp, sid, serial, name, buf, start, lanIp, lanCode, printOpts, modelId, settings, sliceId }) {
  if (fp) {
    job.phase = 'upload'; job.percent = -1;   // Adapter melden keinen Fortschritt
    try {
      const r = await adapterOf(fp).send(fp, name, buf, Boolean(start));
      return { path: fp.type, ...r };
    } catch (e) {
      throw new Error(`${fp.name || fp.id} nicht erreichbar (${e.message})`);
    }
  }
  // LAN-Zugang auflösen: explizit vom Nutzer > hinterlegter LAN-Code
  // (Entwicklermodus) > SSDP-IP + Cloud-Code. Nur über LAN lässt sich eine
  // frische Datei zuverlässig auf den Drucker bringen.
  const isLanOnly = lanAuth.has(serial);   // Entwicklermodus, nicht in der Cloud
  const { ip, code, auto } = await resolveLan(sid, serial, lanIp, lanCode);
  if (ip && code) {
    const p = { ip, access_code: code, serial };
    if (await lan.reachable(p)) {
      // Rohes .gcode startet auf neuerer Firmware (H2-Serie) nicht mehr —
      // als .gcode.3mf verpacken und die Plate darin drucken lassen.
      // Job-Name EINDEUTIG machen: hat der Drucker bereits einen fertigen Job
      // gleichen Namens (z.B. denselben von Studio gedruckt), no-oped die Firmware
      // ein gleichnamiges project_file mit task_id:'0' → "direkt fertig", nichts
      // passiert. Kurzer Zeitstempel-Suffix (base36) erzwingt einen neuen Job.
      const uniq = Date.now().toString(36).slice(-4);
      const jobName = name.replace(/\.gcode$/i, '') + '-' + uniq;
      const name3 = jobName + '.gcode.3mf';
      // Bevorzugt das vollständige, vom nativen OrcaSlicer erzeugte .gcode.3mf
      // (gültige slice_info mit Dual-Extruder-Feldern). Fällt auf das selbst
      // gebaute Paket zurück, wenn lokal gesliced wurde / kein natives 3MF da.
      let nativePath = sliceId ? nativeSlicer.gcode3mfPath(sliceId) : null;
      // H2C: unser nativer Pfad schreibt die per-VARIANTEN-Hotend-Arrays (4 Werte) roh
      // in den G-Code-Header; die Firmware zählt daraus 4 Hotends → [0500-4047]. Die
      // Injektion kontrahiert genau 7 Header-Keys auf Studios per-Extruder-Werte
      // (2 Werte) + ergänzt fehlende (extruder_nozzle_stats etc.) + md5 neu.
      if (nativePath) {
        try { const r = injectConfig.injectMissingKeys(nativePath);
          console.log('[send] header-fix: gfix=' + r.gfix + ' Keys'); nativePath = r.path; }
        catch (e) { console.log('[send] header-fix fehlgeschlagen (sende original):', e.message); }
      }
      const pack = nativePath ? fs.readFileSync(nativePath) : gcode3mf.wrap(buf, { modelId, settings });
      // AMS-Zuordnung aus der ECHTEN Datei per-Filament neu bauen (Studio-Format),
      // überschreibt das simple 1-Element-amsFields aus printOpts. Behebt [0500-4047].
      let amsOverride = null;
      if (nativePath && Array.isArray(printOpts.ams_mapping) && printOpts.ams_mapping.length) {
        // aktive Düsen-Position (nozzle.tar_id) für nozzle_mapping holen
        let nozzleTar = 17;
        try { const devStatus = await lan.getStatus(p, 6000);
          const t = (devStatus.device?.nozzle || devStatus.nozzle || {}).tar_id;
          if (Number.isFinite(t)) nozzleTar = t; } catch {}
        amsOverride = buildAmsFieldsFromFile(nativePath, printOpts.ams_mapping, nozzleTar);
        if (amsOverride)
          console.log('[send] ams-fix: mapping=' + JSON.stringify(amsOverride.ams_mapping) +
            ' nozzle_tar=' + nozzleTar);
      }
      console.log('[send]', nativePath ? 'natives 3MF' : 'eigenes 3MF', name3);
      job.phase = 'upload'; job.percent = 0;
      // AMS-Druck (H2): auf emmc laden (Port 6000) statt FTP/SD — sonst
      // "AMS-Zuordnungstabelle nicht abrufbar" [0700-8012]. Datei-URL wird brtc://emmc/.
      // Scheitert der emmc-Upload, Fallback auf FTP (dann ggf. AMS-Bug, aber Druck lädt).
      let fileUrl = `ftp://${name3}`;
      if (amsOverride) {
        try {
          await emmcUpload(p, pack, name3);
          fileUrl = `brtc://emmc/${name3}`;
          job.percent = 100;
          console.log('[send] emmc-Upload (Port 6000) ok → ' + fileUrl);
        } catch (e) {
          console.log('[send] emmc-Upload fehlgeschlagen, Fallback FTP:', e.message);
          await lan.uploadGcode(p, name3, pack,
            (sent) => { job.percent = Math.min(100, Math.round(sent / pack.length * 100)); });
        }
      } else {
        await lan.uploadGcode(p, name3, pack,
          (sent) => { job.percent = Math.min(100, Math.round(sent / pack.length * 100)); });
      }
      let pr = null;
      if (start) {
        job.phase = 'start'; job.percent = 100;
        const isOk = (r) => r && String(r.result || '').toLowerCase() === 'success';
        const { usedFil, ...amsPrint } = amsOverride || {}; // usedFil NICHT in den Befehl
        // Für AMS-Drucke die letzten Befehl-Diffs auf Studio zwingen: flow_cali=false,
        // bed_type=textured_plate (Studios Werte im Mitschnitt). Sonst printOpts.
        const amsCmdMatch = amsOverride ? { flow_cali: false, bed_type: 'textured_plate' } : {};
        const basePrint = { sequence_id: '0', command: 'project_file',
          param: 'Metadata/plate_1.gcode', subtask_name: jobName,
          // Felder wie Bambu Studio: IDs + MD5 + Dateiname
          project_id: '0', profile_id: '0', task_id: '0', subtask_id: '0', file: name3,
          md5: require('crypto').createHash('md5').update(pack).digest('hex').toUpperCase(),
          ...printOpts, ...amsPrint, ...amsCmdMatch };
        // URL passend zum Upload-Ort: brtc://emmc/ (emmc, umgeht AMS-Bug) oder ftp://.
        const projPayload = { print: { ...basePrint, url: fileUrl } };
        // LAN-AMS-Druck = EIN project_file (Quellen: OrcaSlicer start_local_print +
        // ClusterM/open-bamboo-networking run_local_print_job). KEIN get_auto_nozzle_mapping,
        // kein Zweischritt — die AMS-Zuordnung steckt allein im ams_mapping/ams_mapping2.
        // Voraussetzung: Datei ist slot-konsistent (inject-config macht KEINEN Slot-2-Relabel
        // mehr), sonst 0x7008012 (Header Slot 1 vs Kommando Slot 2). Verifiziert 2026-07-19.
        pr = await lan.sendCommand(p, projPayload, { waitMs: 8000 }).catch(() => null);
        console.log('[send] lan-start', serial, name3, 'result:', pr?.result, pr?.reason || '');
        // Bambu Authorization Control (Firmware 01.09+): Druckbefehle müssen
        // signiert sein → "mqtt message verify failed", über LAN wie Cloud.
        // Dann ist der Cloud-Versuch zwecklos (spart 2 Runden); nur bei
        // anderen Fehlern lohnt der Cloud-Start (Datei liegt lokal).
        // LAN-only (Entwicklermodus) verlangt keine Signatur → LAN-Start gilt.
        // Sonst (Cloud-Drucker mit Signaturpflicht) Cloud-Start versuchen,
        // außer bei "verify failed" (zwecklos, spart 2 Runden).
        const verifyBlocked = /verify failed/i.test(pr?.reason || '');
        if (!isLanOnly && !isOk(pr) && !verifyBlocked) {
          for (const u of [`file:///sdcard/${name3}`, `file:///mnt/sdcard/${name3}`]) {
            const cr = await cloud.sendCommand(sid, serial,
              { print: { ...basePrint, url: u } }, { waitMs: 8000 }).catch(() => null);
            console.log('[send] cloud-start', u, 'result:', cr?.result, cr?.reason || '');
            if (cr) pr = { ...cr, startedVia: 'cloud' };
            if (isOk(cr)) break;
          }
        }
      }
      return { path: 'lan', auto, uploaded: name3, print: pr };
    }
  }
  // LAN-only-Drucker ohne gültigen Zugang → klarer Hinweis statt Cloud-Versuch.
  if (isLanOnly)
    throw new Error('Drucker (Entwicklermodus) nicht erreichbar — IP + LAN-Zugangscode vom Drucker-Display prüfen.');
  // Cloud-Fallback: Steuerung/Start geht; Dateiversand an entfernte Drucker
  // ist experimentell (Bambu-Cloudspeicher, inoffiziell).
  if (start) {
    job.phase = 'start'; job.percent = -1;
    const r = await cloud.sendCommand(sid, serial, { print: { sequence_id: '0',
      command: 'project_file', param: name, subtask_name: name.replace(/\.[^.]+$/, ''),
      ...printOpts } }, { waitMs: 3000 }).catch(e => ({ error: e.message }));
    return { path: 'cloud', experimental: true,
      note: 'Cloud-Dateiversand ist experimentell — Datei muss ggf. schon auf dem Drucker liegen.', print: r };
  }
  throw new Error('Cloud-Upload frischer Dateien noch nicht unterstützt — Drucker per LAN verbinden (IP + Code angeben).');
}

app.post('/api/send', (req, res) => {
  const { serial, filename, gcode, start, lanIp, lanCode, useAms,
          timelapse, bedLeveling, flowCali, nozzleOffsetCali, amsMapping, modelId, settings, sliceId } = req.body || {};
  if (!serial || !gcode) return res.status(400).json({ error: 'serial/gcode nötig' });
  const name = (filename || 'volmeslice.gcode').replace(/[^\w.\-]/g, '_');
  const buf = Buffer.from(gcode, 'utf8');
  // Druckoptionen für project_file. Achtung Schreibweise: der Drucker erwartet
  // "bed_levelling" (britisch, wie OpenBambuAPI) — bed_leveling bleibt als
  // Doppelgänger drin, falls ältere Firmware die US-Schreibweise liest.
  // Filament→AMS-Zuordnung: der Sende-Dialog liefert je Job-Filament eine
  // globale Tray-ID (gid). Zwei Felder müssen ins project_file-Kommando:
  //   ams_mapping   = [gid, ...]                (altes Format, alle Serien)
  //   ams_mapping_2 = [{ams_id, slot_id}, ...]  (neues Format, H2/Dual-Düse)
  // gid → ams_id/slot_id: normaler AMS-Slot gid<254 → ams_id=gid/4, slot_id=gid%4;
  // externe Spule 255 (Haupt/rechts) bzw. 254 (Deputy/links) → ams_id=gid, slot_id=0.
  // Ref: OrcaSlicer CalibUtils.cpp ~1916-1956 (ams_mapping/ams_mapping_2) und
  // DevMapping.cpp _parse_tray_info (ext-Tray: ams_id=255/254, slot_id=0).
  const gids = Array.isArray(amsMapping) ? amsMapping.map(Number).filter(Number.isFinite) : [];
  // Roh-gids durchreichen; das echte per-Filament-Mapping (ams_mapping/ams_mapping2/
  // nozzle_mapping wie Studio) baut buildAmsFieldsFromFile() in runSend aus der Datei
  // + aktiver Düse und überschreibt diese hier. (Studio-MQTT-Mitschnitt 2026-07-19.)
  const amsFields = gids.length ? { ams_mapping: gids } : {};
  // TEST-Schalter: TEST_NO_AMS=1 → sende OHNE AMS-Parameter (wie USB-Laden), um zu
  // isolieren, ob die AMS-Zuordnung im Sendebefehl den 0500-4047 auslöst.
  const testNoAms = process.env.TEST_NO_AMS === '1';
  // Felder + Typen exakt wie Studios echter project_file-Befehl (MQTT-Mitschnitt
  // 2026-07-19): bed_leveling=bool + auto_bed_leveling=2, flow_cali=bool +
  // extrude_cali_flag=2, nozzle_offset_cali=int (0=aus/gespeichert, 1=neu),
  // layer_inspect=true, vibration_cali=false. Kali-Tri-State auto=2.
  const printOpts = {
    bed_type: 'auto', cfg: '0', use_ams: testNoAms ? false : Boolean(useAms),
    timelapse: Boolean(timelapse),
    bed_leveling: bedLeveling !== false, auto_bed_leveling: 2,
    flow_cali: Boolean(flowCali), extrude_cali_flag: 2, extrude_cali_manual_mode: 0,
    vibration_cali: false, layer_inspect: true,
    nozzle_offset_cali: nozzleOffsetCali ? 1 : 0,
    ...(testNoAms ? {} : amsFields),
  };
  const fp = fleetOf(serial);
  if (fp && !fleetOk(req)) return needCode(res);
  const sid = sidOf(req);
  if (!fp && !cloud.session(sid)) return res.status(401).json({ error: 'nicht angemeldet' });
  const id = require('crypto').randomBytes(8).toString('hex');
  const job = { phase: 'prepare', percent: 0, ts: Date.now() };
  sendJobs.set(id, job);
  runSend(job, { fp, sid, serial, name, buf, start, lanIp, lanCode, printOpts, modelId, settings, sliceId })
    .then((r) => { job.phase = 'done'; job.percent = 100; job.result = r; })
    .catch((e) => { job.phase = 'error'; job.error = e.message; });
  res.json({ ok: true, id });
});

app.get('/api/send/:id/status', (req, res) => {
  const j = sendJobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'unbekannter Job' });
  res.json({ phase: j.phase, percent: j.percent, result: j.result, error: j.error });
});

// ---- Nativer Slice-Dienst (2–3× schneller als Browser-WASM) ----
// Gleiche Policy wie die Flotte: LAN/Tailnet frei, öffentlich nur mit Druckcode
// (ohne Code meldet health "nicht verfügbar" → App sliced im Browser weiter).
app.get('/api/slice/health', (req, res) => res.json({ available: nativeSlicer.available() && fleetOk(req) }));

// Job einreichen: { filename, model (base64), profiles, overrides, transforms,
//                   filamentChains, paints } — paints (Mal-Werkzeug): je
//                   (Objekt,Instanz) null oder { verts, tris, states } als base64
app.post('/api/slice', (req, res) => {
  if (!fleetOk(req)) return needCode(res);
  if (!nativeSlicer.available())
    return res.status(503).json({ error: 'nativer Slicer nicht gebaut' });
  const { filename, model, profiles, overrides, transforms, filamentChains, paints, ops,
          printerModelId, extruderAmsCount, filamentIds } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model (base64) nötig' });
  try {
    const id = nativeSlicer.submit({
      filename, bytes: Buffer.from(model, 'base64'),
      profiles, overrides, transforms, filamentChains, paints, ops, printerModelId,
      extruderAmsCount, filamentIds,
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/slice/:id/status', (req, res) => {
  if (!fleetOk(req)) return needCode(res);
  const s = nativeSlicer.status(req.params.id);
  if (!s) return res.status(404).json({ error: 'unbekannter Job' });
  res.json({ state: s.state, percent: s.percent, text: s.text, error: s.error, warnings: s.warnings });
});

app.get('/api/slice/:id/gcode', (req, res) => {
  if (!fleetOk(req)) return needCode(res);
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
    if (!fleetOk(req)) return res.status(403).end();   // Code via ?fc= (img kann keine Header)
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
