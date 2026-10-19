#!/usr/bin/env node
// V3D CAD MCP-Server — KI-Agenten bauen in V3D CAD.
//
// Transport: stdio, JSON-RPC 2.0, eine Nachricht pro Zeile (wie SolidCraft).
// Hält einen unsichtbaren Chromium mit V3D CAD offen und ruft dort window.v3dApi
// auf (Befehlssatz in volme3d.html, Block „V3D-API"). Dafür startet er einen
// eigenen Dev-Server (nur 127.0.0.1, ohne Login) — oder nimmt --url.
//
// Start:  node server.mjs [--url http://127.0.0.1:8766/volme3d.html] [--allow-path DIR]... [--show]
// stdout gehört NUR dem Protokoll; Diagnosen gehen nach stderr.

import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';

const APP_DIR = '/home/v3da';
const OUT_DIR = path.join(os.homedir(), 'v3d-cad-mcp', 'ausgabe');
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const args = process.argv.slice(2);
const argVal = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const allowPaths = [OUT_DIR];
args.forEach((a, i) => { if (a === '--allow-path' && args[i + 1]) allowPaths.push(path.resolve(args[i + 1])); });
const log = (...m) => process.stderr.write('[v3d-cad-mcp] ' + m.join(' ') + '\n');

// ── Browser + App ─────────────────────────────────────────────────────────
let devSrv = null, browser = null, page = null, starting = null;

async function freePort() {
  const net = await import('net');
  return new Promise((res, rej) => {
    const s = net.createServer(); s.unref(); s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

async function startApp() {
  let url = argVal('--url');
  if (!url) {
    const port = await freePort();
    devSrv = spawn('python3', ['volme3d_server.py', String(port), '--dev'],
                   { cwd: APP_DIR, stdio: ['ignore', 'ignore', 'ignore'] });
    url = `http://127.0.0.1:${port}/volme3d.html`;
    for (let i = 0; i < 50; i++) {                      // warten, bis der Server antwortet
      try { const r = await fetch(url, { method: 'HEAD' }); if (r.ok) break; } catch (_) {}
      await new Promise(r => setTimeout(r, 200));
    }
  }
  browser = await chromium.launch({ headless: !args.includes('--show'),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('dialog', d => d.accept().catch(() => {}));      // Netz: kein Dialog blockiert
  page.on('pageerror', e => log('Seitenfehler:', e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.v3dApi && window.v3dApi.ready(), null, { timeout: 120000 });
  await page.evaluate(() => {
    try { hideStarter(); } catch (_) {}
    document.getElementById('auth-overlay')?.classList.add('hidden');
    _newCreate(false);
  });
  log('bereit:', url);
}

async function app() {
  if (page && !page.isClosed()) return page;
  if (!starting) starting = startApp().catch(e => { starting = null; throw e; });
  await starting;
  return page;
}

const call = async (fn, ...a) => (await app()).evaluate(fn, ...a);
const execute = (command, params) =>
  call(([c, p]) => window.v3dApi.execute(c, p), [command, params || {}]);

// ── Dateien: nur in erlaubten Ordnern ─────────────────────────────────────
function safePath(p, ext) {
  const full = path.resolve(path.isAbsolute(p) ? p : path.join(OUT_DIR, p));
  if (!allowPaths.some(d => full === d || full.startsWith(d + path.sep)))
    throw new Error(`Pfad nicht erlaubt: ${full} — erlaubt: ${allowPaths.join(', ')} (weitere per --allow-path)`);
  if (ext && !full.toLowerCase().endsWith(ext)) return full + ext;
  return full;
}

// ── Werkzeuge ─────────────────────────────────────────────────────────────
const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };

const INSTRUCTIONS = `V3D CAD (Browser-CAD von Volme 3D) per Befehl steuern.
- Maße in mm, Z zeigt nach oben, die Bauplatte liegt bei Z=0. "center" ist die Mitte der Bounding-Box.
- Körper haben eine numerische id. Boolesche Operationen (bool.union/subtract/intersect) erzeugen einen NEUEN Körper mit NEUER id — die id aus "created" weiterverwenden.
- Vorgehen: erst planen (Maße, Positionen, erwartetes Volumen), dann mit batch in wenigen Schritten bauen, danach mit measure gegen die erwarteten Werte prüfen. "ok" allein heißt nicht, dass ein Schnitt getroffen hat.
- Ein execute oder ein ganzer batch ist EIN Undo-Schritt; bei Fehler bleibt die Szene unverändert.
- list_commands zeigt alle Befehle mit Parametern; shape.types die Grundformen.
- Werkzeuge: Grundformen (shape.add), Skizzen extrudieren/anfügen/abziehen (sketch.extrude), Kanten runden/fasen (body.fillet/body.chamfer — VOR Bool-Operationen und VOR dem Drehen), Bool (bool.*), Generatoren für Kinder-/Spielmodelle (gen.list/gen.run/gen.edit).
- VOR dem ersten Bauen einmal das Werkzeug "anleitung" lesen (Vorgehen, Ebenen, Rezepte, Grenzen).
- Zum Schluss ein kleiner screenshot (z. B. 480×320) zur Sichtkontrolle.`;

const ANLEITUNG = () => fs.readFileSync(new URL('./ANLEITUNG.md', import.meta.url), 'utf8');

const TOOLS = [
  { name: 'anleitung', description: 'Anleitung zum Modellieren in V3D CAD: Koordinaten, Vorgehen, Skizzen-Ebenen, Runden-Grenzen, Rezepte (Box mit Deckel, Gehäuse, Lochplatte). Vor dem ersten Bauen lesen.',
    inputSchema: obj({}), annotations: { readOnlyHint: true },
    run: async () => ({ content: [{ type: 'text', text: ANLEITUNG() }] }) },
  { name: 'list_commands', description: 'Alle V3D-CAD-Befehle mit Parametern (für execute/batch).',
    inputSchema: obj({ filter: { type: 'string', description: 'Teilstring in Befehl oder Beschreibung' } }),
    annotations: { readOnlyHint: true },
    run: async a => text(await call(f => window.v3dApi.commands(f), a.filter || '')) },
  { name: 'execute', description: 'Einen Befehl ausführen (z. B. shape.add, body.transform, bool.subtract). Ein Undo-Schritt; bei Fehler unverändert.',
    inputSchema: obj({ command: { type: 'string' }, params: { type: 'object' } }, ['command']),
    run: async a => engine(await execute(a.command, a.params)) },
  { name: 'batch', description: 'Mehrere Befehle der Reihe nach, Stopp beim ersten Fehler; standardmäßig alles oder nichts. Zusammen EIN Undo-Schritt.',
    inputSchema: obj({ commands: { type: 'array', items: obj({ command: { type: 'string' }, params: { type: 'object' } }, ['command']) },
                       rollback: { type: 'boolean', description: 'bei Fehler alles zurück (Standard true)' } }, ['commands']),
    run: async a => engine(await call(([s, o]) => window.v3dApi.batch(s, o),
      [a.commands.map(c => ({ command: c.command, params: c.params || {} })), { rollback: a.rollback !== false }])) },
  { name: 'inspect_scene', description: 'Alle Körper: id, Name, Typ, Bohrung?, Mitte/Größe/BBox (mm), Drehung (°); optional mit Volumen/Fläche.',
    inputSchema: obj({ measure: { type: 'boolean' } }), annotations: { readOnlyHint: true },
    run: async a => engine(await execute('scene.inspect', { measure: !!a.measure })) },
  { name: 'measure', description: 'Volumen (mm³), Oberfläche (mm²), BBox je Körper und gesamt. Mit a+b: Abstand zweier Körper.',
    inputSchema: obj({ id: { type: 'integer' }, a: { type: 'integer' }, b: { type: 'integer' } }), annotations: { readOnlyHint: true },
    run: async a => engine(await (a.a !== undefined && a.b !== undefined
      ? execute('measure.distance', { a: a.a, b: a.b })
      : execute('measure', a.id !== undefined ? { id: a.id } : {}))) },
  { name: 'screenshot', description: 'PNG der Szene aus einer Standardansicht.',
    inputSchema: obj({ view: { type: 'string', enum: ['iso', 'front', 'back', 'top', 'bottom', 'left', 'right'] },
                       width: { type: 'integer' }, height: { type: 'integer' },
                       ids: { type: 'array', items: { type: 'integer' }, description: 'nur diese Körper zeigen' },
                       grid: { type: 'boolean' }, axes: { type: 'boolean', description: 'Achsenkreuz zeigen (Standard aus)' },
                       path: { type: 'string', description: 'zusätzlich als Datei speichern' } }),
    annotations: { readOnlyHint: true },
    run: async a => {
      const { path: p, ...rest } = a;
      const r = await execute('view.screenshot', rest);
      if (!r.ok) return engine(r);
      const b64 = r.result.png.replace(/^data:image\/png;base64,/, '');
      const meta = { width: r.result.width, height: r.result.height, view: r.result.view };
      if (p) { const f = safePath(p, '.png'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b64, 'base64')); meta.path = f; }
      return { content: [{ type: 'image', mimeType: 'image/png', data: b64 }, { type: 'text', text: JSON.stringify(meta) }] };
    } },
  { name: 'export', description: 'Exportiert STL, 3MF oder STEP (mm, Z oben) in eine Datei. Bohrungen werden nicht exportiert.',
    inputSchema: obj({ path: { type: 'string', description: `Dateiname (relativ zu ${OUT_DIR}) oder absoluter Pfad in einem erlaubten Ordner` },
                       format: { type: 'string', enum: ['stl', '3mf', 'step'] },
                       ids: { type: 'array', items: { type: 'integer' } } }, ['path']),
    run: async a => {
      const fmt = a.format || (path.extname(a.path).slice(1).toLowerCase().replace('stp', 'step') || 'stl');
      const f = safePath(a.path, '.' + fmt);
      const r = await execute('file.export', { format: fmt, ids: a.ids });
      if (!r.ok) return engine(r);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const buf = Buffer.from(r.result.base64, 'base64'); fs.writeFileSync(f, buf);
      const { base64, ...rest } = r.result;
      return text({ ...rest, path: f, bytes: buf.length });
    } },
  { name: 'save', description: 'Szene als V3D-JSON speichern (später mit open laden).',
    inputSchema: obj({ path: { type: 'string' } }, ['path']),
    run: async a => {
      const f = safePath(a.path, '.json'); const r = await execute('scene.save');
      if (!r.ok) return engine(r);
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, r.result.json);
      return text({ path: f, bytes: r.result.json.length });
    } },
  { name: 'open', description: 'V3D-JSON-Szene laden (ersetzt die aktuelle Szene).',
    inputSchema: obj({ path: { type: 'string' } }, ['path']),
    run: async a => engine(await execute('scene.load', { json: fs.readFileSync(safePath(a.path), 'utf8') })) },
  { name: 'new_scene', description: 'Leere Szene (destruktiv).', inputSchema: obj({}),
    annotations: { destructiveHint: true }, run: async () => engine(await execute('scene.new')) },
  { name: 'undo', description: 'Einen Schritt zurück.', inputSchema: obj({}), run: async () => engine(await execute('edit.undo')) },
  { name: 'redo', description: 'Einen Schritt vor.', inputSchema: obj({}), run: async () => engine(await execute('edit.redo')) },
];

function text(v) { return { content: [{ type: 'text', text: JSON.stringify(v, null, 1) }] }; }
// Engine-Fehler sind normale Tool-Ergebnisse mit isError (das Modell kann korrigieren)
function engine(r) { const t = text(r); if (r && r.ok === false) t.isError = true; return t; }

// Argumente auf oberster Ebene prüfen: Pflichtfelder, unbekannte Felder, Typen
function checkArgs(tool, a) {
  const s = tool.inputSchema;
  if (a === null || typeof a !== 'object' || Array.isArray(a)) return 'arguments muss ein Objekt sein';
  for (const k of s.required || []) if (!(k in a)) return `Pflichtfeld fehlt: ${k}`;
  for (const [k, v] of Object.entries(a)) {
    const d = s.properties[k];
    if (!d) return `Unbekanntes Argument: ${k} (erlaubt: ${Object.keys(s.properties).join(', ') || 'keine'})`;
    const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    const want = d.type === 'integer' ? 'number' : d.type;
    if (want && t !== want) return `${k} muss ${d.type} sein`;
    if (d.type === 'integer' && !Number.isInteger(v)) return `${k} muss eine ganze Zahl sein`;
    if (d.enum && !d.enum.includes(v)) return `${k} muss eins von ${d.enum.join(', ')} sein`;
  }
  return null;
}

// ── Agent-Monitor: Weboberfläche zum Mitverfolgen (nur localhost) ─────────
// Jeder Werkzeug-Aufruf landet im Verlauf (Speicher + Protokolldatei) und geht
// per Server-Sent Events an offene Monitor-Seiten. Nach jedem Bauschritt ein Bild.
// Hub (--hub): Dauerdienst auf 8830 hinter dem Funnel-Pfad /cad-agent. Baut selbst
// nichts, sondern leitet zu den Sitzungen weiter. Jede Claude-Sitzung bekommt einen
// eigenen Monitor auf 8831–8839, der Hub reicht sie unter p/<port>/ durch.
const HUB = args.includes('--hub');
const HUB_PORT = 8830;
const MON_PORT0 = parseInt(argVal('--monitor-port') || String(HUB_PORT + 1), 10);
const SESS_MIN = HUB_PORT + 1, SESS_MAX = HUB_PORT + 9;
const BAUEND = new Set(['execute', 'batch', 'open', 'new_scene', 'undo', 'redo']);
const history = [];                 // {n, zeit, quelle, tool, args, ok, ms, ergebnis, bild}
const sseClients = new Set();
let monPort = null, histN = 0;
const startedAt = new Date();
const LOG_FILE = path.join(OUT_DIR, 'protokoll-' + startedAt.toLocaleString('sv-SE').replace(/[: ]/g, '-') + '.jsonl');

function sse(ev, data) {
  const msg = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}
// Ergebnis kürzen: Bilder/Base64 nicht in den Verlauf
function summarize(result) {
  const out = { isError: !!result.isError, texte: [] };
  for (const c of result.content || []) {
    if (c.type === 'image') { out.hatBild = true; continue; }
    let t = c.text || '';
    try { const j = JSON.parse(t); if (j?.result?.json) j.result.json = '[Szene, ' + j.result.json.length + ' Zeichen]'; t = JSON.stringify(j, null, 1); } catch (_) {}
    out.texte.push(t.length > 20000 ? t.slice(0, 20000) + ' …' : t);
  }
  return out;
}
async function record(quelle, tool, args, result, ms) {
  const e = { n: ++histN, zeit: new Date().toISOString(), quelle, tool, args, ok: !result.isError, ms, ergebnis: summarize(result) };
  if (BAUEND.has(tool) && page && !page.isClosed()) {
    try {
      const r = await execute('view.screenshot', { width: 640, height: 400 });
      if (r.ok) e.bild = r.result.png;
    } catch (_) {}
  }
  history.push(e); if (history.length > 500) history.shift();
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); const { bild, ...ohneBild } = e; fs.appendFileSync(LOG_FILE, JSON.stringify(ohneBild) + '\n'); } catch (_) {}
  sse('schritt', e);
}

// ── Zugang von außen: PIN + signiertes Cookie ─────────────────────────────
const CONF_DIR = path.join(os.homedir(), '.config', 'v3d-cad-mcp');
const PUBLIC_ORIGIN = process.env.V3D_MONITOR_ORIGIN || 'https://v3da.tailf05fe9.ts.net';
let PIN = null, SECRET = null, cryptoMod = null;
function confFile(name, make) {
  const f = path.join(CONF_DIR, name);
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (_) {}
  fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 });
  const v = make();
  try { fs.writeFileSync(f, v + '\n', { mode: 0o600, flag: 'wx' }); return v; }
  catch (_) { return fs.readFileSync(f, 'utf8').trim(); }     // gleichzeitig angelegt
}
const isForwarded = req => Object.keys(req.headers).some(k => /^x-forwarded-|^tailscale-/i.test(k));
const sign = v => cryptoMod.createHmac('sha256', SECRET).update(v).digest();
function hasSession(req) {
  const m = /(?:^|;\s*)v3dagent=(\d+)\.([0-9a-f]{64})/.exec(req.headers.cookie || '');
  if (!m || +m[1] < Date.now()) return false;
  const want = sign(m[1]), got = Buffer.from(m[2], 'hex');
  return got.length === want.length && cryptoMod.timingSafeEqual(got, want);
}
const fehlversuche = new Map();         // IP → Zeitpunkte der Fehlversuche
function login(req, res, raw) {
  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const now = Date.now(), list = (fehlversuche.get(ip) || []).filter(t => now - t < 15 * 60e3);
  const send = (code, html, cookie) => {
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) });
    res.end(html);
  };
  if (list.length >= 5) return send(429, LOGIN_HTML('Zu viele Fehlversuche — bitte 15 Minuten warten.'));
  const a = sign('pin:' + (new URLSearchParams(raw).get('pin') || '').trim()), b = sign('pin:' + PIN);
  if (!cryptoMod.timingSafeEqual(a, b)) {
    list.push(now); fehlversuche.set(ip, list);
    return send(403, LOGIN_HTML('Falsche PIN.'));
  }
  fehlversuche.delete(ip);
  const exp = String(now + 30 * 24 * 3600e3);
  // Ohne Path-Attribut: gilt für den Funnel-Pfad, unter dem der Browser die Seite sieht
  send(200, '<!DOCTYPE html><meta http-equiv="refresh" content="0;url=./">',
       `v3dagent=${exp}.${sign(exp).toString('hex')}; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 24 * 3600}`);
}
const LOGIN_HTML = msg => `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>V3D Agent-Monitor</title><script>if(!location.pathname.endsWith('/'))location.replace(location.pathname+'/'+location.search)</script>
<style>body{margin:0;font:16px system-ui,sans-serif;background:#0f1720;color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh}
form{background:#16212d;border:1px solid #243444;border-radius:12px;padding:26px;display:flex;flex-direction:column;gap:12px;width:280px}
h1{font-size:18px;margin:0}h1 span{color:#3b9cff}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #243444;background:#1d2b3a;color:#e6edf3}
input{letter-spacing:6px;text-align:center;font-size:22px}button{background:#3b9cff;border-color:#3b9cff;color:#fff;font-weight:600}.m{color:#ff8080;font-size:14px}</style></head>
<body><form method="post" action="login"><h1><span>V3D</span> Agent-Monitor</h1>
<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="PIN" autofocus>
${msg ? `<div class="m">${msg}</div>` : ''}<button>Öffnen</button></form></body></html>`;

// Alle laufenden Monitore (einer je Claude-Sitzung) auf 8830–8839
async function sitzungen() {
  const out = [];
  await Promise.all(Array.from({ length: SESS_MAX - SESS_MIN + 1 }, (_, i) => SESS_MIN + i).map(async port => {
    if (port === monPort) { out.push({ port, selbst: true, pid: process.pid, start: startedAt, schritte: histN }); return; }
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(800) });
      const i = await r.json(); if (i && i.pid) out.push({ port, pid: i.pid, start: i.start, schritte: i.schritte });
    } catch (_) {}
  }));
  return out.sort((a, b) => a.port - b.port);
}

async function startMonitor() {
  cryptoMod = await import('crypto');
  PIN = confFile('pin', () => String(cryptoMod.randomInt(0, 1e6)).padStart(6, '0'));
  SECRET = confFile('secret', () => cryptoMod.randomBytes(32).toString('hex'));
  const http = await import('http');
  const html = () => fs.readFileSync(new URL('./monitor.html', import.meta.url), 'utf8');
  const body = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); }); req.on('end', () => r(b)); });
  const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };
  const srv = http.createServer(async (req, res) => {
    // Fremde Origins (andere Webseiten im Browser) abweisen
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) && origin !== PUBLIC_ORIGIN) { res.writeHead(403); return res.end(); }
    const u = new URL(req.url, 'http://x');
    // Von außen (Funnel) nur mit PIN-Cookie. Hinter dem Funnel ist remote_addr
    // IMMER 127.0.0.1 — „von außen" erkennt man an den Funnel-Kopfzeilen.
    if (isForwarded(req)) {
      if (u.pathname === '/login' && req.method === 'POST') return login(req, res, await body(req));
      if (!hasSession(req)) {
        if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/p/')) return json(res, 401, { error: 'PIN nötig' });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(LOGIN_HTML(''));
      }
    }
    // Andere gleichzeitige Claude-Sitzungen (Ports 8830–8839) über diesen Monitor erreichbar
    const pm = /^\/p\/(\d+)(\/.*)?$/.exec(u.pathname);
    if (pm) {
      const port = +pm[1];
      if (port < SESS_MIN || port > SESS_MAX || port === monPort) { res.writeHead(404); return res.end(); }
      if (!pm[2]) { res.writeHead(302, { location: port + '/' }); return res.end(); }
      const h = { ...req.headers }; delete h.host; delete h.cookie; delete h.origin;
      for (const k of Object.keys(h)) if (/^x-forwarded|^tailscale/i.test(k)) delete h[k];
      const pr = http.request({ host: '127.0.0.1', port, path: pm[2] + u.search, method: req.method, headers: h }, r2 => {
        res.writeHead(r2.statusCode, r2.headers); r2.pipe(res);
        // Bricht die Sitzung ab (Prozess beendet), endet pipe() nicht von selbst → Live-Verbindung hinge
        r2.on('close', () => { if (!res.writableEnded) res.end(); });
      });
      pr.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Sitzung nicht mehr da'); });
      req.pipe(pr); res.on('close', () => pr.destroy());
      return;
    }
    try {
      if (u.pathname === '/api/sitzungen') return json(res, 200, await sitzungen());
      if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(html()); }
      if (u.pathname === '/api/info') return json(res, 200, { pid: process.pid, start: startedAt, protokoll: HUB ? null : LOG_FILE, hub: HUB, appBereit: !!(page && !page.isClosed()), schritte: histN });
      // Der Hub hat keine eigene App: nur Seite, Info, Sitzungsliste und Werkzeugliste
      if (HUB && !['/', '/api/werkzeuge'].includes(u.pathname)) { res.writeHead(404); return res.end(); }
      if (u.pathname === '/api/verlauf') return json(res, 200, history);
      if (u.pathname === '/api/werkzeuge') return json(res, 200, TOOLS.map(({ run, ...t }) => t));
      if (u.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': hallo\n\n'); sseClients.add(res);
        const ka = setInterval(() => res.write(': ka\n\n'), 25000);
        req.on('close', () => { clearInterval(ka); sseClients.delete(res); });
        return;
      }
      if (u.pathname === '/api/befehle') return json(res, 200, await call(f => window.v3dApi.commands(f), ''));
      if (u.pathname === '/api/szene') return json(res, 200, await execute('scene.inspect', { measure: true }));
      if (u.pathname === '/api/bild') {
        const r = await execute('view.screenshot', { view: u.searchParams.get('view') || 'iso', width: 960, height: 600 });
        return json(res, r.ok ? 200 : 500, r);
      }
      if (u.pathname === '/api/download') {
        const fmt = u.searchParams.get('format') || 'stl';
        const r = fmt === 'json' ? await execute('scene.save') : await execute('file.export', { format: fmt });
        if (!r.ok) return json(res, 500, r);
        const buf = fmt === 'json' ? Buffer.from(r.result.json) : Buffer.from(r.result.base64, 'base64');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="v3d-agent.${fmt === 'json' ? 'v3d.json' : fmt}"` });
        return res.end(buf);
      }
      if (u.pathname === '/api/ausfuehren' && req.method === 'POST') {
        // Werkzeug von Hand ausführen (gleicher Weg wie Claude, landet im Verlauf als „Hand")
        const { tool: name, args = {} } = JSON.parse(await body(req) || '{}');
        const tool = TOOLS.find(t => t.name === name);
        if (!tool) return json(res, 400, { error: 'Unbekanntes Werkzeug ' + name });
        const bad = checkArgs(tool, args); if (bad) return json(res, 400, { error: bad });
        const t0 = Date.now(); let result;
        try { result = await tool.run(args); } catch (e) { result = { content: [{ type: 'text', text: 'Fehler: ' + e.message }], isError: true }; }
        await record('Hand', name, args, result, Date.now() - t0);
        return json(res, 200, summarize(result));
      }
      res.writeHead(404); res.end();
    } catch (e) { json(res, 500, { error: e.message }); }
  });
  const [von, bis] = HUB ? [HUB_PORT, HUB_PORT] : [MON_PORT0, SESS_MAX];
  for (let p = von; p <= bis; p++) {
    const okk = await new Promise(r => { srv.once('error', () => r(false)); srv.listen(p, '127.0.0.1', () => r(true)); });
    if (okk) { monPort = p; log(`${HUB ? 'Hub' : 'Monitor'}: http://127.0.0.1:${p}/`); return; }
  }
  log('Monitor: kein freier Port ' + von + '–' + bis);
  if (HUB) process.exit(1);
}
const monReady = args.includes('--no-monitor') ? Promise.resolve() : startMonitor().catch(e => log('Monitor-Fehler:', e.message));
const PUBLIC_LINK = PUBLIC_ORIGIN + '/cad-agent/';

// ── JSON-RPC ──────────────────────────────────────────────────────────────
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg || {};
  const isNote = id === undefined || id === null;
  try {
    switch (method) {
      case 'initialize': {
        const v = params && PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
        return { jsonrpc: '2.0', id, result: { protocolVersion: v,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: 'v3d-cad', version: '0.3.0' },
          instructions: INSTRUCTIONS + (await monReady, monPort
            ? `\n- Der Nutzer kann live mitverfolgen, was du baust: Agent-Monitor ${PUBLIC_LINK} (von überall, mit PIN) bzw. http://127.0.0.1:${monPort}/ auf dem Server — nenne ihm den Link, wenn du mit dem Bauen beginnst.` : '') } };
      }
      case 'notifications/initialized': case 'notifications/cancelled': return null;
      case 'ping': return { jsonrpc: '2.0', id, result: {} };
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: [{ uri: 'v3d-cad://anleitung', name: 'Anleitung V3D CAD', mimeType: 'text/markdown',
          description: 'Vorgehen, Koordinaten, Skizzen-Ebenen, Runden-Grenzen, Rezepte' }] } };
      case 'resources/read':
        if (params?.uri !== 'v3d-cad://anleitung') return rpcErr(id, -32002, 'Ressource unbekannt: ' + params?.uri);
        return { jsonrpc: '2.0', id, result: { contents: [{ uri: params.uri, mimeType: 'text/markdown', text: ANLEITUNG() }] } };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ run, ...t }) => t) } };
      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === params?.name);
        if (!tool) return rpcErr(id, -32602, `Unbekanntes Werkzeug: ${params?.name}`);
        const a = params.arguments || {};
        const bad = checkArgs(tool, a);
        if (bad) return rpcErr(id, -32602, bad);
        const t0 = Date.now();
        let result;
        try { result = await tool.run(a); }
        catch (e) { result = { content: [{ type: 'text', text: 'Fehler: ' + e.message }], isError: true }; }
        record('Claude', tool.name, a, result, Date.now() - t0);
        return { jsonrpc: '2.0', id, result };
      }
      default:
        return isNote ? null : rpcErr(id, -32601, `Methode unbekannt: ${method}`);
    }
  } catch (e) { return isNote ? null : rpcErr(id, -32603, e.message); }
}

// Im Hub-Modus kein MCP über stdio — nur der Webdienst
const rl = HUB ? null : createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
rl?.on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { send(rpcErr(null, -32700, 'Parse error')); return; }
  // Der Reihe nach abarbeiten (die App ist ohnehin seriell)
  chain = chain.then(async () => {
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.slice(0, 1000).map(handle))).filter(Boolean);
      if (out.length) send(out);
    } else { const r = await handle(msg); if (r) send(r); }
  });
});

async function shutdown() {
  try { await browser?.close(); } catch (_) {}
  try { devSrv?.kill(); } catch (_) {}
  process.exit(0);
}
rl?.on('close', () => chain.then(shutdown));
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
