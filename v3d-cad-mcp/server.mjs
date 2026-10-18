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
- Zum Schluss ein kleiner screenshot (z. B. 480×320) zur Sichtkontrolle.`;

const TOOLS = [
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
                       grid: { type: 'boolean' }, path: { type: 'string', description: 'zusätzlich als Datei speichern' } }),
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
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'v3d-cad', version: '0.1.0' }, instructions: INSTRUCTIONS } };
      }
      case 'notifications/initialized': case 'notifications/cancelled': return null;
      case 'ping': return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ run, ...t }) => t) } };
      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === params?.name);
        if (!tool) return rpcErr(id, -32602, `Unbekanntes Werkzeug: ${params?.name}`);
        const a = params.arguments || {};
        const bad = checkArgs(tool, a);
        if (bad) return rpcErr(id, -32602, bad);
        try { return { jsonrpc: '2.0', id, result: await tool.run(a) }; }
        catch (e) { return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Fehler: ' + e.message }], isError: true } }; }
      }
      default:
        return isNote ? null : rpcErr(id, -32601, `Methode unbekannt: ${method}`);
    }
  } catch (e) { return isNote ? null : rpcErr(id, -32603, e.message); }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();
rl.on('line', line => {
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
rl.on('close', () => chain.then(shutdown));
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
