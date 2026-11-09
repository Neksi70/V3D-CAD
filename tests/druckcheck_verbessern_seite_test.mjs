// Druckcheck-Seite: „Alles verbessern“ zeigt nachher ≥ vorher und nennt die Folge-Änderung (Volker 9.11.).
// Start: python3 volme3d_server.py 8887 --dev  →  node tests/druckcheck_verbessern_seite_test.mjs
import { chromium } from 'playwright';
const URL0 = process.env.DC_URL || 'http://127.0.0.1:8887/druckcheck.html';
const DATEI = new globalThis.URL('./fixtures/projekt_dach_feine_schichten.3mf', import.meta.url).pathname;
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL0); await pg.setInputFiles('#file', DATEI);
await pg.waitForSelector('#magic:not([hidden])', { timeout: 20000 });
await pg.click('#magic');
await pg.waitForSelector('#improve:not([hidden])');
const r = await pg.evaluate(() => ({ ringe: [...document.querySelectorAll('#improve .ring')].map(x => parseInt(x.textContent)), text: document.getElementById('improve').innerText }));
ok('nachher ≥ vorher (Ringe)', r.ringe.length === 2 && r.ringe[1] >= r.ringe[0], r.ringe);
ok('Folge-Änderung angezeigt', /Folge-Änderung/.test(r.text) && /Untere Schalenschichten|bottom/i.test(r.text), r.text.slice(0, 300));
await pg.screenshot({ path: '/tmp/dc_verbessern.png' });
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
