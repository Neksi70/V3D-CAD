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
    // Lokale KI (Ollama auf 11434) — Finanzdaten bleiben auf der Maschine
    kiModel: 'llama3.1:8b',
    // Öffentliche Basis für Beleg-Links (Funnel-Pfad /beleg)
    publicBase: 'https://v3da.tailf05fe9.ts.net/beleg',
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
  firma: { name: 'Volme 3D', inhaber: '', strasse: '', plz: '', ort: '', email: '', telefon: '+49 1512 0164288', web: '', slogan: '3D-Druck · Konstruktion · Kurse' },
  briefkopf: 'band', // 'band' | 'linie' | 'seite'
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
  kalkulation: {
    materialien: [
      { name: 'PLA', preisKg: 25 },
      { name: 'PETG', preisKg: 30 },
      { name: 'ABS/ASA', preisKg: 32 },
      { name: 'TPU', preisKg: 40 },
      { name: 'PA-CF', preisKg: 80 },
    ],
    maschineProStd: 2.5,  // Abschreibung+Strom+Wartung je Druckstunde
    arbeitProStd: 45,     // Vor-/Nachbereitung, Slicing, Entgraten
    margeProzent: 30,
    mindestpreis: 5,
  },
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
const courses = store('courses', []); // Kurse mit Teilnehmerliste (Akademie)
const expenses = store('expenses', []); // Eingangsbelege/Ausgaben

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
const MIME = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

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
    if (p.typ === 'text') continue; // freie Textposition ohne Betrag
    const zeile = (Number(p.menge) || 0) * (Number(p.preis) || 0) * (1 - (Number(p.rabatt) || 0) / 100);
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

// --- GiroCode-SVG (EPC069-12 Version 002) -----------------------------------
function giroSvg(doc) {
  const s = settings.data;
  const iban = String(s.bank.iban || '').replace(/\s/g, '');
  if (!iban) return null;
  const epc = ['BCD', '002', '1', 'SCT', String(s.bank.bic || '').replace(/\s/g, ''),
    String(s.firma.name || '').slice(0, 70), iban,
    'EUR' + calcTotals(doc).brutto.toFixed(2), '', '',
    ('Rechnung ' + (doc.nummer || '')).trim().slice(0, 140), ''].join('\n');
  const py = require('child_process').spawnSync('python3', ['-c',
    'import segno,io,sys\nqr=segno.make_qr(sys.stdin.read(),error="m")\nb=io.BytesIO()\nqr.save(b,kind="svg",scale=3,xmldecl=False,border=2)\nsys.stdout.write(b.getvalue().decode())'],
    { input: epc, encoding: 'utf8', timeout: 10000 });
  return (py.status === 0 && py.stdout) ? py.stdout : null;
}

// --- Beleg als PDF (Headless-Chrome druckt die Beleg-Seite) ------------------
// Für den Mail-Versand: dieselbe HTML wie /beleg/<token>, aber als echte Datei.
function belegPdf(doc) {
  const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser']
    .find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('Kein Chrome/Chromium auf dem Server gefunden');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrpdf-'));
  try {
    const htmlFile = path.join(dir, 'beleg.html');
    const pdfFile = path.join(dir, 'beleg.pdf');
    fs.writeFileSync(htmlFile, belegHtml(doc));
    // Eigenes user-data-dir: sonst verweigert Chrome den Start, wenn irgendwo
    // schon eine Instanz mit dem Standard-Profil läuft.
    const r = require('child_process').spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
      '--user-data-dir=' + path.join(dir, 'profil'),
      '--print-to-pdf=' + pdfFile, 'file://' + htmlFile,
    ], { timeout: 30000 });
    if (!fs.existsSync(pdfFile)) {
      throw new Error('Chrome lieferte keine PDF' +
        (r.stderr ? ' (' + String(r.stderr).slice(-200).trim() + ')' : ''));
    }
    return fs.readFileSync(pdfFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- Übergabe an V3D Mail -----------------------------------------------------
// Entwurf (Empfänger/Betreff/Text + PDF) liegt kurz unter einem Einmal-Token;
// die Mail-App holt ihn über /rechnung/api/uebergabe/<token> ab. So klappt der
// Versand-Knopf von jeder Adresse aus (:8782 direkt ODER Funnel /rechnung).
const uebergaben = new Map(); // token -> { t, draft }
const UEBERGABE_TTL = 10 * 60000;

// --- Öffentliche Beleg-Seite (/beleg/<token>) --------------------------------
// Kunde öffnet den Link -> Zugriff wird protokolliert = Lesebestätigung.
const hesc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eurS = (v) => (Number(v) || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

function belegHtml(doc) {
  const s = settings.data;
  const t = calcTotals(doc);
  const klein = s.steuer.modus === 'klein';
  const re = doc.art === 'rechnung';
  const k = doc.kunde || {};
  const ziel = new Date(doc.datum); ziel.setDate(ziel.getDate() + (Number(doc.zahlungszielTage) || (re ? s.zahlungszielTage : s.angebotGueltigTage) || 14));
  const zielStr = ziel.toLocaleDateString('de-DE');
  const giro = re && !['bezahlt', 'storniert'].includes(doc.status) ? giroSvg(doc) : null;
  let nr = 0;
  const zeilen = (doc.positionen || []).map((p) => {
    if (p.typ === 'text') return `<tr class="txt"><td></td><td colspan="4">${p.name ? `<b>${hesc(p.name)}</b> ` : ''}${hesc(p.beschreibung || '')}</td></tr>`;
    nr++;
    return `<tr><td>${nr}</td><td><b>${hesc(p.name)}</b>${p.beschreibung ? `<div class="be">${hesc(p.beschreibung)}</div>` : ''}${p.rabatt ? `<div class="be">abzgl. ${p.rabatt} % Rabatt</div>` : ''}</td>
      <td class="n">${Number(p.menge) || 0} ${hesc(p.einheit || '')}</td><td class="n">${eurS(p.preis)}</td>
      <td class="n">${eurS((p.menge || 0) * (p.preis || 0) * (1 - (p.rabatt || 0) / 100))}</td></tr>`;
  }).join('');
  const ustZeilen = klein ? '' : Object.entries(t.ust).map(([sz, v]) => `<div><span>zzgl. ${sz} % USt</span><b>${eurS(v)}</b></div>`).join('');
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${re ? 'Rechnung' : 'Angebot'} ${hesc(doc.nummer)} — ${hesc(s.firma.name)}</title>
<meta name="robots" content="noindex,nofollow">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f5f9;color:#1c2030;padding:14px}
.wrap{max-width:720px;margin:0 auto}
.band{display:flex;align-items:center;gap:14px;background:linear-gradient(100deg,#EA6000,#F97316 55%,#FB923C);border-radius:14px 14px 0 0;padding:16px 20px;color:#fff}
.band img{width:74px;background:#fff;border-radius:8px;padding:5px}
.band b{font-size:19px;display:block}
.band span{font-size:12.5px;opacity:.92}
.card{background:#fff;border:1px solid #e3e6ef;border-top:0;border-radius:0 0 14px 14px;padding:20px}
h1{font-size:20px;margin:6px 0 2px}h1 em{color:#EA6000;font-style:normal}
.meta{color:#5b6172;font-size:13.5px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;margin:10px 0}
th{background:#F97316;color:#fff;font-size:12.5px;text-align:left;padding:7px 8px}
td{padding:8px;border-bottom:1px solid #eceef4;vertical-align:top;font-size:14px}
.n{text-align:right;white-space:nowrap}th.n{text-align:right}
.be{font-size:12.5px;color:#666;white-space:pre-wrap}
.txt td{color:#555;font-size:13px}
.sums{margin-left:auto;max-width:300px}
.sums div{display:flex;justify-content:space-between;padding:2px 0;font-size:14.5px}
.sums .end{border-top:2px solid #1c2030;font-weight:700;font-size:17px;margin-top:4px;padding-top:6px;color:#EA6000}
.hin{font-size:13px;color:#555;margin:12px 0;padding:10px 12px;background:#fff8f2;border:1px solid #ffe4cc;border-radius:10px}
.giro{display:flex;gap:14px;align-items:center;margin:12px 0;padding:12px;background:#fafbfd;border:1px solid #e3e6ef;border-radius:10px}
.giro svg{flex-shrink:0}
.fuss{font-size:12px;color:#777;margin-top:16px;border-top:1px solid #e3e6ef;padding-top:10px;display:flex;flex-wrap:wrap;gap:6px 26px}
.tbl{overflow-x:auto;margin:10px 0}
.tbl table{margin:0;min-width:430px}
@media (max-width:480px){td,th{font-size:12.5px;padding:6px 5px}.be{font-size:11.5px}}
.btn{display:inline-block;background:#F97316;color:#fff;border:0;border-radius:9px;padding:10px 16px;font-weight:600;font-size:14.5px;cursor:pointer;margin-top:10px}
@media print{body{background:#fff;padding:0}.btn{display:none}.card,.band{border-radius:0}}
</style></head><body><div class="wrap">
<div class="band"><img src="data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, 'logo.svg')).toString('base64')}" alt="">
<div><b>${hesc(s.firma.name)}</b><span>${hesc(s.firma.slogan || '')}</span></div></div>
<div class="card">
<h1>${re ? 'Rechnung' : 'Angebot'} <em>${hesc(doc.nummer)}</em>${doc.status === 'storniert' ? ' — STORNIERT' : ''}</h1>
<div class="meta">für ${hesc(k.firma || k.name || '')} · Datum: ${new Date(doc.datum).toLocaleDateString('de-DE')} · ${re ? 'zahlbar bis' : 'gültig bis'}: <b>${zielStr}</b></div>
<div class="tbl"><table><tr><th style="width:30px">Pos.</th><th>Leistung</th><th class="n">Menge</th><th class="n">Einzelpreis</th><th class="n">Gesamt</th></tr>${zeilen}</table></div>
<div class="sums">
<div><span>Nettobetrag</span><b>${eurS(t.netto)}</b></div>
${t.rabatt ? `<div><span>Rabatt (${doc.rabattProzent} %)</span><b>−${eurS(t.rabatt)}</b></div>` : ''}
${ustZeilen}
<div class="end"><span>${re ? 'Rechnungsbetrag' : 'Gesamtbetrag'}</span><span>${eurS(t.brutto)}</span></div>
</div>
${klein ? '<div class="hin">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</div>' : ''}
${re && !['bezahlt', 'storniert'].includes(doc.status) ? `<div class="hin">Bitte überweisen Sie den Betrag bis zum <b>${zielStr}</b> unter Angabe der Rechnungsnummer${s.bank.iban ? ` auf:<br><b>IBAN ${hesc(s.bank.iban)}</b>${s.bank.bic ? ' · BIC ' + hesc(s.bank.bic) : ''} (${hesc(s.firma.name)})` : '.'}</div>` : ''}
${giro ? `<div class="giro">${giro}<div><b>Mit Banking-App zahlen:</b><br>GiroCode scannen — Empfänger, Betrag und Verwendungszweck sind schon ausgefüllt.</div></div>` : ''}
${doc.status === 'bezahlt' ? '<div class="hin">✅ Diese Rechnung ist bereits bezahlt — vielen Dank!</div>' : ''}
<button class="btn" onclick="window.print()">🖨️ Drucken / als PDF speichern</button>
<div class="fuss">
<span><b>${hesc(s.firma.name)}</b>${s.firma.inhaber ? ' · ' + hesc(s.firma.inhaber) : ''}</span>
<span>${hesc([s.firma.strasse, (s.firma.plz + ' ' + s.firma.ort).trim()].filter(Boolean).join(', '))}</span>
<span>${hesc(s.firma.telefon || '')}</span><span>${hesc(s.firma.email || '')}</span>
${s.steuer.steuernummer ? `<span>St-Nr. ${hesc(s.steuer.steuernummer)}</span>` : ''}
${s.steuer.ustId ? `<span>USt-IdNr. ${hesc(s.steuer.ustId)}</span>` : ''}
</div>
</div></div></body></html>`;
}

// --- XRechnung (EN 16931 / UBL 2.1) -----------------------------------------
const xesc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const geld = (n) => (Math.round(n * 100) / 100).toFixed(2);

function xrechnungXml(doc) {
  const s = settings.data;
  const t = calcTotals(doc);
  const klein = s.steuer.modus === 'klein';
  const k = doc.kunde || {};
  const ziel = new Date(doc.datum); ziel.setDate(ziel.getDate() + (Number(doc.zahlungszielTage) || s.zahlungszielTage || 14));
  const einheit = (e) => (/std/i.test(e) ? 'HUR' : /pauschal/i.test(e) ? 'C62' : 'C62'); // UN/ECE Rec 20
  const posLines = (doc.positionen || []).filter((p) => p.typ !== 'text');
  const catId = klein ? 'E' : 'S';

  // USt-Aufschlüsselung
  const taxSubtotals = Object.entries(t.ust).map(([satz, betrag]) => {
    const basis = klein ? t.nettoNachRabatt
      : posLines.filter((p) => (Number(p.ust) || 0) === Number(satz))
          .reduce((a, p) => a + (p.menge || 0) * (p.preis || 0) * (1 - (p.rabatt || 0) / 100), 0)
          * (t.netto ? t.nettoNachRabatt / t.netto : 1);
    return `<cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${geld(basis)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${geld(betrag)}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>${catId}</cbc:ID><cbc:Percent>${Number(satz).toFixed(2)}</cbc:Percent>
        ${klein ? '<cbc:TaxExemptionReason>Kleinunternehmerregelung §19 UStG — keine Umsatzsteuer</cbc:TaxExemptionReason>' : ''}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>`;
  }).join('\n');

  const lines = posLines.map((p, i) => {
    const netto = (p.menge || 0) * (p.preis || 0) * (1 - (p.rabatt || 0) / 100);
    const stkPreis = (p.preis || 0) * (1 - (p.rabatt || 0) / 100);
    return `<cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${einheit(p.einheit)}">${Number(p.menge) || 0}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${geld(netto)}</cbc:LineExtensionAmount>
    <cac:Item>
      ${p.beschreibung ? `<cbc:Description>${xesc(p.beschreibung)}</cbc:Description>` : ''}
      <cbc:Name>${xesc(p.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>${catId}</cbc:ID><cbc:Percent>${(klein ? 0 : Number(p.ust) || 0).toFixed(2)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${geld(stkPreis)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
  }).join('\n');

  const rabattXml = t.rabatt > 0 ? `<cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Rabatt</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="EUR">${geld(t.rabatt)}</cbc:Amount>
    <cac:TaxCategory><cbc:ID>${catId}</cbc:ID><cbc:Percent>${klein ? '0.00' : '19.00'}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
  </cac:AllowanceCharge>` : '';

  const ustSumme = t.brutto - t.nettoNachRabatt;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
<cbc:ID>${xesc(doc.nummer)}</cbc:ID>
<cbc:IssueDate>${doc.datum}</cbc:IssueDate>
<cbc:DueDate>${ziel.toISOString().slice(0, 10)}</cbc:DueDate>
<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
<cbc:BuyerReference>${xesc(doc.leitwegId || k.nr || doc.nummer)}</cbc:BuyerReference>
<cac:AccountingSupplierParty><cac:Party>
  <cac:PostalAddress><cbc:StreetName>${xesc(s.firma.strasse)}</cbc:StreetName><cbc:CityName>${xesc(s.firma.ort)}</cbc:CityName><cbc:PostalZone>${xesc(s.firma.plz)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
  ${s.steuer.ustId ? `<cac:PartyTaxScheme><cbc:CompanyID>${xesc(s.steuer.ustId)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
  ${s.steuer.steuernummer ? `<cac:PartyTaxScheme><cbc:CompanyID>${xesc(s.steuer.steuernummer)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
  <cac:PartyLegalEntity><cbc:RegistrationName>${xesc(s.firma.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  <cac:Contact><cbc:Name>${xesc(s.firma.inhaber || s.firma.name)}</cbc:Name><cbc:Telephone>${xesc(s.firma.telefon)}</cbc:Telephone><cbc:ElectronicMail>${xesc(s.firma.email)}</cbc:ElectronicMail></cac:Contact>
</cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party>
  <cac:PostalAddress><cbc:StreetName>${xesc(k.strasse)}</cbc:StreetName><cbc:CityName>${xesc(k.ort)}</cbc:CityName><cbc:PostalZone>${xesc(k.plz)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
  <cac:PartyLegalEntity><cbc:RegistrationName>${xesc(k.firma || k.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
</cac:Party></cac:AccountingCustomerParty>
<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
  <cac:PayeeFinancialAccount><cbc:ID>${xesc(String(s.bank.iban || '').replace(/\s/g, ''))}</cbc:ID><cbc:Name>${xesc(s.firma.name)}</cbc:Name></cac:PayeeFinancialAccount>
</cac:PaymentMeans>
<cac:PaymentTerms><cbc:Note>Zahlbar bis ${ziel.toISOString().slice(0, 10)} ohne Abzug.</cbc:Note></cac:PaymentTerms>
${rabattXml}
<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${geld(ustSumme)}</cbc:TaxAmount>
${taxSubtotals}
</cac:TaxTotal>
<cac:LegalMonetaryTotal>
  <cbc:LineExtensionAmount currencyID="EUR">${geld(t.netto)}</cbc:LineExtensionAmount>
  <cbc:TaxExclusiveAmount currencyID="EUR">${geld(t.nettoNachRabatt)}</cbc:TaxExclusiveAmount>
  <cbc:TaxInclusiveAmount currencyID="EUR">${geld(t.brutto)}</cbc:TaxInclusiveAmount>
  ${t.rabatt > 0 ? `<cbc:AllowanceTotalAmount currencyID="EUR">${geld(t.rabatt)}</cbc:AllowanceTotalAmount>` : ''}
  <cbc:PayableAmount currencyID="EUR">${geld(t.brutto)}</cbc:PayableAmount>
</cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}

// --- Lokale KI via Ollama ---------------------------------------------------
function ollama(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: CFG.kiModel, stream: false, format: 'json',
      options: { temperature: 0.2, num_ctx: 4096 }, prompt,
    });
    const rq = http.request({ host: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (rs) => {
      let b = '';
      rs.on('data', (c) => b += c);
      rs.on('end', () => {
        try { resolve(JSON.parse(JSON.parse(b).response)); }
        catch (e) { reject(new Error('KI-Antwort war kein gültiges JSON')); }
      });
    });
    rq.setTimeout(180000, () => rq.destroy(new Error('KI-Timeout (3 min)')));
    rq.on('error', (e) => reject(new Error('Lokale KI (Ollama) nicht erreichbar: ' + e.message)));
    rq.end(body);
  });
}

// Kunden-Namen aus KI-Antwort einem angelegten Kunden zuordnen (unscharf)
function matchKunde(name) {
  if (!name) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/\b(herr|frau|firma|fa\.?|gmbh|ug|kg|ohg)\b/g, '').replace(/[^a-zä-ü0-9 ]/g, '').trim();
  const n = norm(name);
  if (!n) return null;
  return customers.data.find((k) => {
    const kf = norm(k.firma), kn = norm(k.name);
    return (kf && (kf.includes(n) || n.includes(kf))) || (kn && (kn.includes(n) || n.includes(kn)));
  }) || null;
}

// Brute-Force-Bremse: nach 10 Fehlversuchen 15 Minuten Sperre (je IP)
const authFails = new Map(); // ip -> { n, until }
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() || '?';
}
function keyOk(key) {
  const a = Buffer.from(String(key)), b = Buffer.from(CFG.adminKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function api(req, res, url) {
  // Einmal-Abholung durch V3D Mail — bewusst OHNE Key: das Token ist
  // unerratbar (24 Zufallsbytes), verfällt nach 10 min und stirbt beim Abruf.
  const mU = url.pathname.match(/^\/api\/uebergabe\/([A-Za-z0-9_-]{20,64})$/);
  if (mU && req.method === 'GET') {
    const u = uebergaben.get(mU[1]);
    uebergaben.delete(mU[1]);
    if (!u || Date.now() - u.t > UEBERGABE_TTL) {
      return send(res, 404, { error: 'Übergabe abgelaufen — bitte in VolmeRechnung erneut auf „Mit V3D Mail senden" klicken' });
    }
    return send(res, 200, u.draft);
  }

  // Auth: alle API-Aufrufe brauchen den Key
  const ip = clientIp(req);
  const fail = authFails.get(ip);
  if (fail && fail.until > Date.now()) {
    return send(res, 429, { error: 'Zu viele Fehlversuche — bitte 15 Minuten warten' });
  }
  const key = req.headers['x-key'] || url.searchParams.get('key') || '';
  if (!keyOk(key)) {
    const f = authFails.get(ip) || { n: 0, until: 0, last: 0 };
    f.n = (Date.now() - f.last < 30 * 60000) ? f.n + 1 : 1; // Zähler verfällt nach 30 min Ruhe
    f.last = Date.now();
    if (f.n >= 10) { f.until = Date.now() + 15 * 60000; f.n = 0; }
    authFails.set(ip, f);
    if (authFails.size > 5000) authFails.clear(); // Speicher-Backstop
    return send(res, 401, { error: 'Ungültiger Schlüssel' });
  }
  authFails.delete(ip);

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

  // GiroCode (EPC-QR): Kunde scannt, Banking-App ist vorausgefüllt
  if (col === 'girocode' && docId && m === 'GET') {
    const doc = docs.data.find((d) => d.id === docId);
    if (!doc) return send(res, 404, { error: 'Beleg nicht gefunden' });
    const svg = giroSvg(doc);
    if (!svg) return send(res, 400, { error: 'GiroCode nicht möglich (IBAN fehlt oder QR-Fehler)' });
    return send(res, 200, svg, 'image/svg+xml');
  }

  if (col === 'ki' && m === 'POST') {
    // /api/ki/entwurf — formlose Auftragsbeschreibung -> Beleg-Entwurf
    if (docId === 'entwurf') {
      const { text, art } = await readBody(req);
      if (!text || !String(text).trim()) return send(res, 400, { error: 'Bitte den Auftrag kurz beschreiben' });
      const kundenListe = customers.data.map((k) => k.firma || k.name).filter(Boolean).join('; ') || '(noch keine)';
      const preisliste = items.data.map((a) => `${a.name}: ${a.preis} €/${a.einheit || 'Stk.'}`).join('; ') || '(keine)';
      const belegArt = art === 'rechnung' ? 'eine Rechnung' : 'ein Angebot';
      const prompt = `Du bist Büro-Assistent eines deutschen 3D-Druck- und CAD-Dienstleisters ("Volme 3D") und wandelst eine formlose Auftragsbeschreibung in ${belegArt} um.
Antworte NUR mit JSON nach exakt diesem Schema:
{"kunde": string|null, "positionen": [{"name": string, "beschreibung": string, "menge": number, "einheit": string, "preis": number, "ust": number}]}
Regeln:
- "preis" ist der NETTO-Einzelpreis in Euro. Deutsche Preise haben oft ein Dezimal-KOMMA: "5,90" bedeutet 5.90. Übernimm jeden im Text genannten Preis zur passenden Position. Erfinde niemals Preise: steht kein Preis im Text und auch nicht in der Preisliste, setze 0.
- Steht eine Leistung in der Preisliste, übernimm deren Preis und Einheit, falls im Text nichts anderes steht.
- "ust" ist 19, außer im Text steht etwas anderes.
- "beschreibung": genau 1 kurzer, professioneller deutscher Satz zur Leistung (keine Preise darin).
- "einheit" z. B. "Stk.", "Std.", "pauschal".
- "kunde": der im Text genannte Kunde, sonst null.
Bekannte Kunden: ${kundenListe}
Preisliste: ${preisliste}
Auftragsbeschreibung: ${String(text).slice(0, 2000)}`;
      const j = await ollama(prompt).catch((e) => { send(res, 502, { error: e.message }); return null; });
      if (!j) return;
      const roh = Array.isArray(j.positionen) ? j.positionen : [];
      const positionen = roh.slice(0, 30).map((p) => {
        const pos = {
          name: String(p.name || '').slice(0, 200),
          beschreibung: String(p.beschreibung || '').slice(0, 500),
          menge: Number(p.menge) || 1,
          einheit: String(p.einheit || 'Stk.').slice(0, 20),
          preis: Number(p.preis) || 0,
          ust: Number.isFinite(Number(p.ust)) ? Number(p.ust) : 19,
        };
        // Preis 0, aber Artikel bekannt? Dann Preisliste ziehen.
        if (!pos.preis) {
          const a = items.data.find((x) => x.name.toLowerCase() === pos.name.toLowerCase());
          if (a) { pos.preis = a.preis; pos.einheit = a.einheit || pos.einheit; pos.ust = a.ust ?? pos.ust; }
        }
        return pos;
      }).filter((p) => p.name);
      const kunde = matchKunde(j.kunde);
      return send(res, 200, {
        positionen,
        kundeId: kunde ? kunde.id : null,
        kunde: kunde ? kunde : null,
        kundeVorschlag: !kunde && j.kunde ? String(j.kunde).slice(0, 100) : null,
      });
    }
    // /api/ki/texte — Positionsbeschreibungen professionell ausformulieren
    if (docId === 'texte') {
      const { positionen } = await readBody(req);
      if (!Array.isArray(positionen) || !positionen.length) return send(res, 400, { error: 'Keine Positionen' });
      const liste = positionen.map((p, i) => `${i + 1}. ${p.name}${p.beschreibung ? ' — bisher: ' + p.beschreibung : ''}`).join('\n');
      const prompt = `Du bist Büro-Assistent eines deutschen 3D-Druck- und CAD-Dienstleisters. Formuliere für jede Rechnungsposition eine kurze, professionelle Beschreibung (genau 1 Satz, deutsch, ohne Preise, ohne Anrede).
Antworte NUR mit JSON: {"beschreibungen": [string, ...]} — exakt ${positionen.length} Einträge, gleiche Reihenfolge wie die Liste.
Positionen:\n${liste.slice(0, 2000)}`;
      const j = await ollama(prompt).catch((e) => { send(res, 502, { error: e.message }); return null; });
      if (!j) return;
      const b = Array.isArray(j.beschreibungen) ? j.beschreibungen.map((s) => String(s).slice(0, 500)) : [];
      return send(res, 200, { beschreibungen: b });
    }
    return send(res, 404, { error: 'unbekannte KI-Funktion' });
  }

  // Kurs abrechnen: je Teilnehmer ein Rechnungsentwurf
  if (col === 'courses' && docId && action === 'rechnungen' && m === 'POST') {
    const kurs = courses.data.find((c) => c.id === docId);
    if (!kurs) return send(res, 404, { error: 'Kurs nicht gefunden' });
    const teilnehmer = (kurs.teilnehmer || []).filter((t) => t.kundeId);
    if (!teilnehmer.length) return send(res, 400, { error: 'Keine Teilnehmer mit zugeordnetem Kunden' });
    const neu = [];
    for (const t of teilnehmer) {
      const kunde = customers.data.find((k) => k.id === t.kundeId);
      if (!kunde) continue;
      neu.push({
        id: id(), created: now(), art: 'rechnung', status: 'entwurf', nummer: null,
        festgeschrieben: false, mahnstufe: 0, kundeId: kunde.id, kunde: JSON.parse(JSON.stringify(kunde)),
        datum: now().slice(0, 10), rabattProzent: 0,
        positionen: [{
          name: kurs.name, menge: 1, einheit: 'pauschal', preis: Number(kurs.preis) || 0, ust: 19,
          beschreibung: [kurs.beschreibung, kurs.datum ? 'Termin: ' + kurs.datum : ''].filter(Boolean).join(' — '),
        }],
        quelleKurs: kurs.name,
      });
    }
    docs.data.push(...neu); docs.save();
    kurs.abgerechnetAm = now().slice(0, 10); courses.save();
    return send(res, 200, { anzahl: neu.length });
  }

  if (col === 'customers' || col === 'items' || col === 'courses' || col === 'expenses') {
    const st = { customers, items, courses, expenses }[col];
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

    if (m === 'GET' && action === 'pdf') {
      if (!doc.festgeschrieben) return send(res, 400, { error: 'Erst festschreiben — dann gibt es den Beleg als PDF' });
      try {
        const pdf = belegPdf(doc);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${String(doc.nummer || doc.id).replace(/[^\w.-]/g, '_')}.pdf"`,
          'Cache-Control': 'no-store',
        });
        return res.end(pdf);
      } catch (e) {
        return send(res, 500, { error: 'PDF-Erzeugung fehlgeschlagen: ' + e.message });
      }
    }
    if (m === 'POST' && action === 'uebergabe') {
      if (!doc.festgeschrieben) return send(res, 400, { error: 'Erst festschreiben — dann kann der Beleg verschickt werden' });
      const body = await readBody(req).catch(() => ({}));
      let pdf;
      try { pdf = belegPdf(doc); }
      catch (e) { return send(res, 500, { error: 'PDF-Erzeugung fehlgeschlagen: ' + e.message }); }
      for (const [k, v] of uebergaben) if (Date.now() - v.t > UEBERGABE_TTL) uebergaben.delete(k);
      const token = crypto.randomBytes(24).toString('base64url');
      const name = `${doc.art === 'rechnung' ? 'Rechnung' : 'Angebot'}_${String(doc.nummer || doc.id).replace(/[^\w-]/g, '_')}.pdf`;
      uebergaben.set(token, { t: Date.now(), draft: {
        to: String(body.to || ''), subject: String(body.subject || ''), text: String(body.text || ''),
        attachments: [{ name, type: 'application/pdf', data: pdf.toString('base64'), size: pdf.length }],
      } });
      // Mail-App hängt am selben Funnel wie die Beleg-Links (publicBase)
      const mailBase = String(CFG.publicBase).replace(/\/beleg\/?$/, '/mail/');
      return send(res, 200, { url: mailBase + '?uebergabe=' + token });
    }
    if (m === 'GET' && action === 'xrechnung') {
      if (doc.art !== 'rechnung' || !doc.festgeschrieben) return send(res, 400, { error: 'Nur festgeschriebene Rechnungen können als XRechnung exportiert werden' });
      res.writeHead(200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${doc.nummer}-xrechnung.xml"`,
        'Cache-Control': 'no-store',
      });
      return res.end(xrechnungXml(doc));
    }
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
          // Überarbeitetes Angebot behält seine Nummer — sonst Loch im Nummernkreis
          // und der Kunde hätte zwei Nummern für dasselbe Angebot.
          if (!doc.nummer) doc.nummer = nextNumber(doc.art);
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
        case 'reopen': { // Angebot zur Überarbeitung wieder öffnen (Rechnungen bleiben GoBD-fest)
          if (doc.art !== 'angebot') return send(res, 400, { error: 'Rechnungen bleiben unveränderlich (GoBD) — bitte stornieren oder duplizieren' });
          if (!doc.festgeschrieben) break;
          if (doc.status === 'storniert') return send(res, 400, { error: 'Stornierte Angebote können nicht überarbeitet werden' });
          doc.fassung = (doc.fassung || 1) + 1;
          (doc.historie = doc.historie || []).push({
            am: now(), was: 'überarbeitet', fassung: doc.fassung - 1,
            brutto: (doc.totals || calcTotals(doc)).brutto,
          });
          doc.festgeschrieben = false;
          doc.status = 'entwurf';
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
        case 'duplicate': { // Kopie als neuer Entwurf (auch von festgeschriebenen)
          const kopie = {
            id: id(), created: now(), art: doc.art, status: 'entwurf', nummer: null,
            festgeschrieben: false, mahnstufe: 0, kundeId: doc.kundeId, kunde: doc.kunde,
            positionen: JSON.parse(JSON.stringify(doc.positionen || [])),
            rabattProzent: doc.rabattProzent || 0, zahlungszielTage: doc.zahlungszielTage,
            leitwegId: doc.leitwegId, datum: now().slice(0, 10),
          };
          docs.data.push(kopie); docs.save();
          return send(res, 200, kopie);
        }
        case 'share': { // Versand-Link erzeugen (Lesebestätigung über Zugriffs-Log)
          if (!doc.festgeschrieben) return send(res, 400, { error: 'Erst festschreiben, dann versenden' });
          if (!doc.shareToken) doc.shareToken = crypto.randomBytes(16).toString('base64url');
          docs.save();
          return send(res, 200, { url: CFG.publicBase.replace(/\/$/, '') + '/' + doc.shareToken, zugriffe: doc.zugriffe || [] });
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

const BASE = '/rechnung'; // öffentlicher Funnel-Pfad; direkt auf :8782 läuft alles weiter unter /

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Funnel-Pfad /rechnung auf die Wurzel abbilden ("/rechnung" -> "/rechnung/" für relative Pfade)
  if (url.pathname === BASE) {
    res.writeHead(301, { Location: BASE + '/' });
    return res.end();
  }
  if (url.pathname.startsWith(BASE + '/')) url.pathname = url.pathname.slice(BASE.length) || '/';
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    // Öffentliche Beleg-Ansicht: /beleg/<token> — einziger Zugang ohne Key.
    // Jeder Aufruf wird protokolliert (= Lesebestätigung), außer mit ?v=1 (eigene Vorschau).
    const mBeleg = url.pathname.match(/^\/beleg\/([A-Za-z0-9_-]{16,64})\/?$/);
    if (mBeleg) {
      const doc = docs.data.find((d) => d.shareToken === mBeleg[1] && d.festgeschrieben);
      if (!doc) return send(res, 404, 'Dieser Link ist ungültig oder abgelaufen.', 'text/plain; charset=utf-8');
      if (url.searchParams.get('v') !== '1') {
        doc.zugriffe = doc.zugriffe || [];
        doc.zugriffe.push({
          t: now(),
          ua: String(req.headers['user-agent'] || '').slice(0, 140),
          ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').slice(0, 45),
        });
        if (doc.zugriffe.length > 100) doc.zugriffe = doc.zugriffe.slice(-100);
        docs.save();
      }
      return send(res, 200, belegHtml(doc), 'text/html; charset=utf-8');
    }
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
