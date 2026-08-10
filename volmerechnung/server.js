#!/usr/bin/env node
// VolmeRechnung — Angebote & Rechnungen für Volme 3D.
// Single-HTML-App (rechnung.html) + JSON-Datenhaltung, keine npm-Abhängigkeiten.
// Bewusst NICHT im Funnel: Zugriff nur LAN/Tailnet (Port 8782).
// Login: adminKey aus config.json (wird beim ersten Start erzeugt).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');
const DATA_DIR = path.join(ROOT, 'data');

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { /* neu anlegen */ }
  const def = {
    port: 8782,
    adminKey: crypto.randomBytes(16).toString('base64url'),
  };
  let changed = false;
  for (const k of Object.keys(def)) if (!(k in cfg)) { cfg[k] = def[k]; changed = true; }
  if (changed) fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}
const CFG = loadConfig();
const PORT = Number(process.argv[2] || CFG.port);
fs.mkdirSync(DATA_DIR, { recursive: true });

// --- JSON-Stores (atomar schreiben) ----------------------------------------
function store(name, fallback) {
  const file = path.join(DATA_DIR, name + '.json');
  let data = fallback;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* leer */ }
  return {
    get data() { return data; },
    set data(v) { data = v; this.save(); },
    save() {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}

const SETTINGS_DEF = {
  firma: { name: 'Volme 3D', inhaber: '', strasse: '', plz: '', ort: '', email: '', telefon: '+49 1512 0164288', web: '' },
  bank: { iban: '', bic: '', institut: '' },
  steuer: { modus: 'klein', steuernummer: '', ustId: '' }, // 'klein' = §19 UStG, 'regel' = mit USt
  zahlungszielTage: 14,
  angebotGueltigTage: 30,
  texte: {
    angebotOben: 'vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:',
    angebotUnten: 'Wir freuen uns auf Ihren Auftrag.',
    rechnungOben: 'wir bedanken uns für Ihren Auftrag und stellen Ihnen folgende Leistungen in Rechnung:',
    rechnungUnten: 'Vielen Dank für Ihr Vertrauen.',
    mahnung: 'auf unsere unten genannte Rechnung konnten wir bislang keinen Zahlungseingang feststellen. Wir bitten Sie, den offenen Betrag innerhalb von 7 Tagen zu überweisen. Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.',
  },
  nummern: { jahr: new Date().getFullYear(), rechnung: 1, angebot: 1, kunde: 1 },
};

const settings = store('settings', SETTINGS_DEF);
// fehlende Felder (neue Versionen) nachziehen
(function mergeDef(dst, src) {
  let changed = false;
  (function walk(d, s) {
    for (const k of Object.keys(s)) {
      if (!(k in d)) { d[k] = s[k]; changed = true; }
      else if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && d[k] && typeof d[k] === 'object') walk(d[k], s[k]);
    }
  })(dst, src);
  if (changed) settings.save();
})(settings.data, SETTINGS_DEF);

const customers = store('customers', []);
const items = store('items', []);
const docs = store('docs', []); // Angebote + Rechnungen gemeinsam, Feld "art": 'angebot'|'rechnung'

// --- Nummernkreise: RE-2026-0001 / AN-2026-0001, jahresweise, lückenlos ----
function nextNumber(art) {
  const n = settings.data.nummern;
  const jahr = new Date().getFullYear();
  if (jahr !== n.jahr) { n.jahr = jahr; n.rechnung = 1; n.angebot = 1; }
  const key = art === 'rechnung' ? 'rechnung' : 'angebot';
  const prefix = art === 'rechnung' ? 'RE' : 'AN';
  const num = `${prefix}-${jahr}-${String(n[key]).padStart(4, '0')}`;
  n[key]++;
  settings.save();
  return num;
}

// --- HTTP ------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function send(res, code, body, type) {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let len = 0; const chunks = [];
    req.on('data', (c) => {
      len += c.length;
      if (len > 4 * 1024 * 1024) { reject(new Error('zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const id = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();

// Dokument-Summen serverseitig nachrechnen (Anzeige rechnet identisch im Client)
function calcTotals(doc) {
  let netto = 0; const ust = {};
  for (const p of doc.positionen || []) {
    const zeile = (Number(p.menge) || 0) * (Number(p.preis) || 0);
    netto += zeile;
    const satz = settings.data.steuer.modus === 'klein' ? 0 : (Number(p.ust) || 0);
    ust[satz] = (ust[satz] || 0) + zeile * satz / 100;
  }
  const rabatt = netto * (Number(doc.rabattProzent) || 0) / 100;
  const nettoNachRabatt = netto - rabatt;
  let ustSumme = 0;
  for (const satz of Object.keys(ust)) {
    ust[satz] = ust[satz] * (netto ? nettoNachRabatt / netto : 1);
    ustSumme += ust[satz];
  }
  return { netto, rabatt, nettoNachRabatt, ust, brutto: nettoNachRabatt + ustSumme };
}

async function api(req, res, url) {
  // Auth: alle API-Aufrufe brauchen den Key
  const key = req.headers['x-key'] || url.searchParams.get('key') || '';
  if (key !== CFG.adminKey) return send(res, 401, { error: 'Ungültiger Schlüssel' });

  const parts = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const [col, docId, action] = parts;
  const m = req.method;

  if (col === 'login') return send(res, 200, { ok: true });

  if (col === 'settings') {
    if (m === 'GET') return send(res, 200, settings.data);
    if (m === 'PUT') {
      const body = await readBody(req);
      // Nummernkreise nur über Belege fortschreiben, nicht frei editierbar zurücksetzen auf kleinere Werte
      const alt = settings.data.nummern;
      settings.data = Object.assign({}, settings.data, body, { nummern: alt });
      return send(res, 200, settings.data);
    }
  }

  if (col === 'customers' || col === 'items') {
    const st = col === 'customers' ? customers : items;
    if (m === 'GET') return send(res, 200, st.data);
    if (m === 'POST') {
      const body = await readBody(req);
      const rec = Object.assign({}, body, { id: id(), created: now() });
      if (col === 'customers') {
        rec.nr = 'KD-' + String(settings.data.nummern.kunde++).padStart(4, '0');
        settings.save();
      }
      st.data.push(rec); st.save();
      return send(res, 200, rec);
    }
    if (m === 'PUT' && docId) {
      const body = await readBody(req);
      const rec = st.data.find((r) => r.id === docId);
      if (!rec) return send(res, 404, { error: 'nicht gefunden' });
      Object.assign(rec, body, { id: rec.id }); st.save();
      return send(res, 200, rec);
    }
    if (m === 'DELETE' && docId) {
      const idx = st.data.findIndex((r) => r.id === docId);
      if (idx < 0) return send(res, 404, { error: 'nicht gefunden' });
      st.data.splice(idx, 1); st.save();
      return send(res, 200, { ok: true });
    }
  }

  if (col === 'docs') {
    if (m === 'GET' && !docId) return send(res, 200, docs.data);
    if (m === 'POST' && !docId) {
      const body = await readBody(req);
      const doc = Object.assign({}, body, {
        id: id(), created: now(), status: 'entwurf', nummer: null, festgeschrieben: false,
        mahnstufe: 0, art: body.art === 'rechnung' ? 'rechnung' : 'angebot',
      });
      docs.data.push(doc); docs.save();
      return send(res, 200, doc);
    }
    const doc = docs.data.find((d) => d.id === docId);
    if (!doc) return send(res, 404, { error: 'nicht gefunden' });

    if (m === 'PUT') {
      if (doc.festgeschrieben) return send(res, 409, { error: 'Beleg ist festgeschrieben und kann nicht mehr geändert werden' });
      const body = await readBody(req);
      Object.assign(doc, body, { id: doc.id, nummer: doc.nummer, festgeschrieben: doc.festgeschrieben, art: doc.art });
      docs.save();
      return send(res, 200, doc);
    }
    if (m === 'DELETE') {
      if (doc.festgeschrieben) return send(res, 409, { error: 'Festgeschriebene Belege werden storniert, nicht gelöscht' });
      docs.data.splice(docs.data.indexOf(doc), 1); docs.save();
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && action) {
      const body = await readBody(req).catch(() => ({}));
      switch (action) {
        case 'finalize': { // Nummer vergeben + festschreiben
          if (doc.festgeschrieben) break;
          doc.nummer = nextNumber(doc.art);
          doc.festgeschrieben = true;
          doc.datum = doc.datum || now().slice(0, 10);
          doc.status = doc.art === 'rechnung' ? 'offen' : 'offen';
          doc.totals = calcTotals(doc);
          break;
        }
        case 'status': { // bezahlt / angenommen / abgelehnt / offen
          const ok = ['offen', 'bezahlt', 'angenommen', 'abgelehnt'];
          if (ok.includes(body.status)) {
            doc.status = body.status;
            if (body.status === 'bezahlt') doc.bezahltAm = body.datum || now().slice(0, 10);
          }
          break;
        }
        case 'cancel': { // Storno: Beleg bleibt, Gegenbeleg entsteht nicht (einfaches Kennzeichen)
          doc.status = 'storniert';
          doc.storniertAm = now().slice(0, 10);
          break;
        }
        case 'convert': { // Angebot -> Rechnungsentwurf
          if (doc.art !== 'angebot') return send(res, 400, { error: 'nur für Angebote' });
          const re = {
            id: id(), created: now(), art: 'rechnung', status: 'entwurf', nummer: null,
            festgeschrieben: false, mahnstufe: 0, kundeId: doc.kundeId, kunde: doc.kunde,
            positionen: JSON.parse(JSON.stringify(doc.positionen || [])),
            rabattProzent: doc.rabattProzent || 0, quelleAngebot: doc.nummer || doc.id,
            datum: now().slice(0, 10),
          };
          docs.data.push(re);
          doc.status = 'angenommen';
          docs.save();
          return send(res, 200, re);
        }
        case 'remind': {
          doc.mahnstufe = (doc.mahnstufe || 0) + 1;
          doc.letzteMahnung = now().slice(0, 10);
          break;
        }
        default: return send(res, 400, { error: 'unbekannte Aktion' });
      }
      docs.save();
      return send(res, 200, doc);
    }
  }

  return send(res, 404, { error: 'unbekannter Endpunkt' });
}

// HTTPS mit Tailscale-Zertifikat: die ts.net-Domain erzwingt per HSTS HTTPS
// auf ALLEN Ports, reines HTTP liefert im Browser ERR_SSL_PROTOCOL_ERROR.
// Zertifikat erneuern: `tailscale cert v3da.tailf05fe9.ts.net` (im Home-Verzeichnis).
const CERT_FILE = '/home/v3da/v3da.tailf05fe9.ts.net.crt';
const KEY_FILE = '/home/v3da/v3da.tailf05fe9.ts.net.key';
let creds = null;
try {
  creds = { cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) };
} catch (e) {
  console.warn('Kein TLS-Zertifikat gefunden — starte unverschlüsselt (HTTP):', e.message);
}

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    // statisch
    let file = url.pathname === '/' ? '/rechnung.html' : url.pathname;
    file = path.normalize(file).replace(/^([.][.][/\\])+/, '');
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return send(res, 404, 'nicht gefunden', 'text/plain; charset=utf-8');
    }
    return send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: String(e.message || e) });
  }
};

const server = creds ? require('https').createServer(creds, handler) : http.createServer(handler);
server.listen(PORT, () => {
  console.log(`VolmeRechnung läuft auf ${creds ? 'https' : 'http'}://v3da.tailf05fe9.ts.net:${PORT}`);
  console.log(`Login-Schlüssel: ${CFG.adminKey}`);
});
