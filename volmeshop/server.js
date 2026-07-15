#!/usr/bin/env node
// VolmeShop — Bestellportal für Wunschteile aus dem 3D-Drucker.
// Kunden konfigurieren ein Produkt (Live-3D-Vorschau), das STL wird im
// Browser erzeugt und hängt fertig an der Bestellung.
// Funnel-Pfad /bestellen (Port 8776). Keine npm-Abhängigkeiten.
// Admin: /bestellen/admin?key=<adminKey aus config.json>
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { /* neu anlegen */ }
  const def = {
    port: 8776,
    basePath: '/bestellen',
    publicUrl: 'https://v3da.tailf05fe9.ts.net/bestellen',
    brand: 'Volme 3D',
    phone: '+49 1512 0164288',
    adminKey: crypto.randomBytes(16).toString('base64url'),
    maxUploadMb: 25,
    // V3D Slicer (orca-wasm) — "Im Slicer öffnen" im Admin; tailnet-only Proxy
    slicerUrl: 'https://v3da.tailf05fe9.ts.net:10000/app/',
    colors: [
      { name: 'Schwarz', hex: '#1a1a1a' },
      { name: 'Weiß', hex: '#f5f5f5' },
      { name: 'Orange', hex: '#F97316' },
      { name: 'Rot', hex: '#dc2626' },
      { name: 'Blau', hex: '#2563eb' },
      { name: 'Grün', hex: '#16a34a' },
      { name: 'Gelb', hex: '#eab308' },
      { name: 'Lila', hex: '#7c3aed' },
      { name: 'Pink', hex: '#ec4899' },
      { name: 'Grau', hex: '#6b7280' },
    ],
  };
  let changed = false;
  for (const k of Object.keys(def)) if (!(k in cfg)) { cfg[k] = def[k]; changed = true; }
  if (changed) fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}

const CFG = loadConfig();
const PORT = Number(process.argv[2] || CFG.port);
const BASE = (CFG.basePath || '').replace(/\/$/, '');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const MAX_BODY = CFG.maxUploadMb * 1024 * 1024 * 1.4; // Base64-Overhead

for (const d of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });

// --- Bestellungen (JSON-Datei, atomar) -------------------------------------
let orders = [];
try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch (e) { orders = []; }
function saveOrders() {
  const tmp = ORDERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 1));
  fs.renameSync(tmp, ORDERS_FILE);
}

const STATUS = ['neu', 'in Arbeit', 'fertig', 'abgeholt', 'abgelehnt'];
const PRODUCTS = {
  anhaenger: 'Schlüsselanhänger',
  ausstecher: 'Keksausstecher',
  wunsch: 'Freier Wunsch',
};

// --- Statik -----------------------------------------------------------------
const STATIC = {
  '/logo.svg': ['logo.svg', 'image/svg+xml'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/fonts.js': ['fonts.js', 'application/javascript; charset=utf-8'],
  '/lib/three.min.js': ['lib/three.min.js', 'application/javascript; charset=utf-8'],
};

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
function sendJson(res, code, obj) { send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8'); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function readBody(req, res, cb) {
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_BODY) { sendJson(res, 413, { error: 'Datei zu groß (max. ' + CFG.maxUploadMb + ' MB)' }); req.destroy(); return; }
  const chunks = [];
  let got = 0;
  req.on('data', c => {
    got += c.length;
    if (got > MAX_BODY) { sendJson(res, 413, { error: 'Zu groß' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => cb(Buffer.concat(chunks)));
  req.on('error', () => {});
}

// --- Bestellung annehmen ------------------------------------------------------
const SAFE_EXT = new Set(['.stl', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.pdf', '.3mf', '.step', '.stp']);

function handleOrder(req, res) {
  readBody(req, res, buf => {
    let o;
    try { o = JSON.parse(buf.toString('utf8')); } catch (e) { return sendJson(res, 400, { error: 'Ungültige Anfrage' }); }
    const product = String(o.product || '');
    if (!PRODUCTS[product]) return sendJson(res, 400, { error: 'Unbekanntes Produkt' });
    const name = String(o.name || '').trim().slice(0, 120);
    const email = String(o.email || '').trim().slice(0, 200);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: 'Bitte Name und gültige E-Mail angeben' });
    }
    const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
    const files = [];
    const list = Array.isArray(o.files) ? o.files.slice(0, 4) : [];
    for (const f of list) {
      const fname = String(f.name || 'datei').replace(/[^\w.\-äöüÄÖÜß ]/g, '_').slice(0, 80);
      const ext = path.extname(fname).toLowerCase();
      if (!SAFE_EXT.has(ext)) return sendJson(res, 400, { error: 'Dateityp nicht erlaubt: ' + ext });
      let data;
      try { data = Buffer.from(String(f.dataB64 || ''), 'base64'); } catch (e) { data = Buffer.alloc(0); }
      if (!data.length) continue;
      if (data.length > CFG.maxUploadMb * 1024 * 1024) return sendJson(res, 413, { error: 'Datei zu groß' });
      const dir = path.join(UPLOAD_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fname), data);
      files.push({ name: fname, size: data.length });
    }
    const order = {
      id,
      ts: new Date().toISOString(),
      product,
      config: (o.config && typeof o.config === 'object') ? o.config : {},
      name,
      email,
      note: String(o.note || '').slice(0, 2000),
      consent: !!o.consent,
      files,
      status: 'neu',
    };
    orders.push(order);
    saveOrders();
    console.log('[order]', id, product, name, files.map(f => f.name).join(','));
    sendJson(res, 200, { ok: true, id });
  });
}

// --- Admin --------------------------------------------------------------------
function isAdmin(q) {
  const key = q.get('key') || '';
  return key.length > 0 && crypto.timingSafeEqual(
    Buffer.from(key.padEnd(64).slice(0, 64)),
    Buffer.from(CFG.adminKey.padEnd(64).slice(0, 64)));
}

function cfgSummary(o) {
  const c = o.config || {};
  const parts = [];
  if (c.text) parts.push('„' + esc(c.text) + '“');
  if (c.font) parts.push('Schrift: ' + esc(c.font));
  if (c.size) parts.push('Größe: ' + esc(c.size));
  if (c.baseColor) parts.push('Grund: ' + esc(c.baseColor));
  if (c.textColor) parts.push('Text: ' + esc(c.textColor));
  if (c.widthMm) parts.push('≈ ' + esc(c.widthMm) + ' mm breit');
  if (c.desc) parts.push(esc(c.desc));
  return parts.join(' · ');
}

const SLICEABLE = new Set(['.stl', '.3mf', '.step', '.stp', '.obj', '.svg']);

function adminPage(q) {
  const rawKey = q.get('key') || '';
  const key = esc(rawKey);
  const rows = orders.slice().reverse().map(o => {
    const files = o.files.map(f => {
      let row = `<a href="${BASE}/file?key=${key}&amp;id=${esc(o.id)}&amp;f=${encodeURIComponent(f.name)}">${esc(f.name)}</a> <span class="dim">(${Math.round(f.size / 1024)} kB)</span>`;
      if (CFG.slicerUrl && SLICEABLE.has(path.extname(f.name).toLowerCase())) {
        const abs = `${CFG.publicUrl}/file?key=${encodeURIComponent(rawKey)}&id=${encodeURIComponent(o.id)}&f=${encodeURIComponent(f.name)}`;
        const href = `${CFG.slicerUrl}?load=${encodeURIComponent(abs)}&name=${encodeURIComponent(f.name)}`;
        row += ` <a class="slice" href="${esc(href)}" target="_blank" title="Im V3D Slicer öffnen und drucken">🖨 Slicen</a>`;
      }
      return row;
    }).join('<br>');
    const btns = STATUS.map(s =>
      `<button class="st ${o.status === s ? 'on' : ''}" onclick="setStatus('${esc(o.id)}','${s}')">${s}</button>`).join('');
    return `<tr class="s-${esc(o.status).replace(/ /g, '_')}">
      <td><b>${esc(PRODUCTS[o.product] || o.product)}</b><br><span class="dim">${esc(o.id)}<br>${esc(o.ts.slice(0, 16).replace('T', ' '))}</span></td>
      <td>${cfgSummary(o)}${o.note ? '<br><i>' + esc(o.note) + '</i>' : ''}</td>
      <td>${esc(o.name)}<br><a href="mailto:${esc(o.email)}">${esc(o.email)}</a>${o.consent ? '<br><span class="ok">✓ Werbe-OK</span>' : ''}</td>
      <td>${files || '<span class="dim">—</span>'}</td>
      <td class="stc">${btns}</td>
    </tr>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>VolmeShop – Bestellungen</title>
<link rel="icon" href="${BASE}/favicon.svg">
<style>
body{font-family:system-ui,sans-serif;background:#f4f5f9;margin:0;color:#1c2030}
header{background:#F97316;padding:10px 18px;display:flex;align-items:center;gap:14px}
header img{height:34px}header h1{color:#fff;font-size:18px;margin:0}
main{padding:18px;max-width:1200px;margin:0 auto}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
td{padding:10px 12px;border-bottom:1px solid #e3e6ef;vertical-align:top;font-size:14px}
.dim{color:#8a90a3;font-size:12px}.ok{color:#16a34a;font-weight:600;font-size:12px}
.st{border:1px solid #d5d9e4;background:#fff;border-radius:6px;padding:3px 8px;margin:1px;cursor:pointer;font-size:12px}
.st.on{background:#F97316;color:#fff;border-color:#EA6000}
.slice{display:inline-block;background:#1c2030;color:#fff!important;border-radius:6px;padding:2px 8px;font-size:12px;text-decoration:none;margin-left:6px}
.stc{white-space:nowrap;max-width:140px}
tr.s-fertig td,tr.s-abgeholt td{opacity:.55}
tr.s-abgelehnt td{opacity:.4;text-decoration:line-through}
</style></head><body>
<header><img src="${BASE}/logo.svg" alt=""><h1>Bestellungen (${orders.length})</h1></header>
<main><table>${rows || '<tr><td>Noch keine Bestellungen.</td></tr>'}</table></main>
<script>
async function setStatus(id,status){
  await fetch('${BASE}/api/status',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key:'${key}',id,status})});
  location.reload();
}
</script></body></html>`;
}

// --- Router ---------------------------------------------------------------------
let SHOP_HTML = '';
function shopPage() {
  // Bei jedem Request frisch lesen? Nein – einmal cachen, Neustart lädt neu.
  if (!SHOP_HTML) {
    const raw = fs.readFileSync(path.join(ROOT, 'shop.html'), 'utf8');
    const inject = JSON.stringify({ basePath: BASE, brand: CFG.brand, phone: CFG.phone, colors: CFG.colors });
    SHOP_HTML = raw.replace('"__SHOP_CFG__"', inject);
  }
  return SHOP_HTML;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = u.pathname;
  if (BASE && (p === BASE || p.startsWith(BASE + '/'))) p = p.slice(BASE.length) || '/';
  if (p === '' || p === '/') {
    if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(); }
    return send(res, 200, shopPage());
  }
  if (STATIC[p]) {
    try {
      const [file, type] = STATIC[p];
      const data = fs.readFileSync(path.join(ROOT, file));
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'public, max-age=3600' });
      return res.end(data);
    } catch (e) { return send(res, 404, 'nicht gefunden', 'text/plain'); }
  }
  if (p === '/api/order' && req.method === 'POST') return handleOrder(req, res);
  if (p === '/admin') {
    if (!isAdmin(u.searchParams)) return send(res, 403, 'Kein Zugriff', 'text/plain; charset=utf-8');
    return send(res, 200, adminPage(u.searchParams));
  }
  if (p === '/api/status' && req.method === 'POST') {
    return readBody(req, res, buf => {
      let b; try { b = JSON.parse(buf.toString('utf8')); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
      if (!isAdmin(new Map([['key', String(b.key || '')]]))) return sendJson(res, 403, { error: 'Kein Zugriff' });
      const o = orders.find(x => x.id === b.id);
      if (!o || !STATUS.includes(b.status)) return sendJson(res, 400, { error: 'unbekannt' });
      o.status = b.status;
      saveOrders();
      sendJson(res, 200, { ok: true });
    });
  }
  if (p === '/file') {
    if (!isAdmin(u.searchParams)) return send(res, 403, 'Kein Zugriff', 'text/plain; charset=utf-8');
    const id = String(u.searchParams.get('id') || '').replace(/[^\w-]/g, '');
    const f = path.basename(String(u.searchParams.get('f') || ''));
    const full = path.join(UPLOAD_DIR, id, f);
    try {
      const data = fs.readFileSync(full);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length,
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(f) + '"',
        // Der Slicer (anderer Origin, crossOriginIsolated) holt STLs per fetch —
        // ohne CORS+CORP blockt dessen COEP. Zugriff bleibt Key-geschützt.
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      return res.end(data);
    } catch (e) { return send(res, 404, 'nicht gefunden', 'text/plain'); }
  }
  send(res, 404, 'nicht gefunden', 'text/plain; charset=utf-8');
});

// isAdmin akzeptiert URLSearchParams ODER Map (beide haben .get)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`VolmeShop auf http://127.0.0.1:${PORT}${BASE}  (Admin-Key: ${CFG.adminKey})`);
});
