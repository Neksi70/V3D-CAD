// Druckcheck „Womit druckst du?“: alle Hersteller aus der Druckerliste (nicht nur Bambu), Wahl bleibt gemerkt (Volker 11.11.).
// Start: python3 volme3d_server.py 8887 --dev  →  node tests/druckcheck_drucker_test.mjs
import { chromium } from 'playwright';
const URL0 = process.env.DC_URL || 'http://127.0.0.1:8887/druckcheck.html';
const DATEI = new globalThis.URL('./fixtures/' + (process.env.DC_STL || 'dome_ceiling.stl'), import.meta.url).pathname;
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL0); await pg.setInputFiles('#file', DATEI);
await pg.waitForSelector('#baseBox:not([hidden])', { timeout: 20000 });
const her = await pg.$$eval('#bHer option', o => o.map(x => x.textContent));
ok('Hersteller: Bambu, Anycubic, Elegoo, Prusa, Creality …', ['Bambu Lab', 'Anycubic', 'Elegoo', 'Prusa', 'Creality', 'Snapmaker'].every(h => her.includes(h)), her);
await pg.selectOption('#bHer', 'Anycubic');
const mods = await pg.$$eval('#bPrn option', o => o.map(x => x.textContent));
ok('Anycubic-Modelle mit Bauraum', mods.some(m => /Kobra/.test(m)) && mods.every(m => /\(\d+×\d+×\d+\)$/.test(m)), mods.slice(0, 5));
const kobra = await pg.$eval('#bPrn', s => { const o = [...s.options].find(x => /Kobra 3/.test(x.textContent)) || s.options[1]; s.value = o.value; s.dispatchEvent(new Event('change')); return o.textContent; });
await pg.reload(); await pg.setInputFiles('#file', DATEI); await pg.waitForSelector('#baseBox:not([hidden])');
const nach = await pg.evaluate(() => [document.getElementById('bHer').value, document.getElementById('bPrn').selectedOptions[0].textContent]);
ok('Wahl nach Neuladen gemerkt', nach[0] === 'Anycubic' && nach[1] === kobra, nach);
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await pg.screenshot({ path: '/tmp/dc_drucker.png' });
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
