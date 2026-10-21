// 🪄 Scan → CAD direkt in V3D CAD (v1.18.237): Knopf → Datei → Dienst v3dscan/cad_dienst.py (über
// /api/scan2cad) → Bauplan → Körper. Braucht den Dienst auf 127.0.0.1:3014 und den Dev-Server.
// Testdaten: verrauschte, zufällig gedrehte CAD-Netze (tests/fixtures/scan2cad/*_scan.stl).
// Start: npm run dev (8766) bzw. V3D_URL setzen.
import { readFileSync } from 'fs';
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const DIR = '/home/v3da/tests/fixtures/scan2cad/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function' && window.v3dApi, null, { timeout: 60000 });
await pg.evaluate(() => { hideStarter(); _newCreate(false); });
let fehler = 0;
const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
const fertig = () => pg.waitForFunction(() => getComputedStyle(document.getElementById('s2c-zu')).display !== 'none', null, { timeout: 400000 });
const zustand = () => pg.evaluate(() => objects.map(o => ({ id: o.userData.id, name: o.userData.name, sichtbar: o.visible !== false })));

// A) nichts gewählt: Knopf in der Import-Leiste → Datei wählen → läuft von selbst
const knopf = pg.locator('button.btn', { hasText: '🪄 Scan→CAD' });
ok('Knopf in der Import-Leiste', await knopf.count() === 1);
const [fc] = await Promise.all([pg.waitForEvent('filechooser'), knopf.click()]);
await fc.setFiles(DIR + 'winkel_scan.stl');
await pg.waitForSelector('#s2c-modal.show', { timeout: 60000 });
await pg.waitForTimeout(2500);
const unterwegs = await pg.evaluate(() => document.getElementById('s2c-stat').textContent);
ok('Fortschritt sichtbar', /hochgeladen|Wartet|Rechnet/.test(unterwegs), unterwegs);
await fertig();
await pg.screenshot({ path: '/home/v3da/tests/scan2cad_dialog.png' });
let erg = await pg.evaluate(() => document.getElementById('s2c-erg').textContent);
ok('Winkel: Prisma, sehr gut', /Prisma/.test(erg) && /sehr gut/.test(erg), erg);
let z = await zustand();
const cad = z.find(o => /\(CAD\)$/.test(o.name || ''));
ok('Scan ausgeblendet + CAD-Körper sichtbar', z.length === 2 && cad && cad.sichtbar && z.some(o => !o.sichtbar), z);
let m = await pg.evaluate(id => window.v3dApi.execute('measure', { id }), cad && cad.id);
const vol = m.ok && m.result.bodies[0].volume_mm3;
// ±1,5 %: die Querbohrungen (2 × 141 mm³) erkennt die Automatik in diesem groben Testnetz nicht
// (Splitter-Dreiecke, verrauschte Normalen) – an dichten Scans schon (v3dscan/tests/test_automatik.py)
ok('Winkel: Volumen ±1,5 % zum CAD-Soll 25 717 mm³', Math.abs(vol - 25717) / 25717 < 0.015, vol);
const lage = await pg.evaluate(ids => Promise.all(ids.map(id => window.v3dApi.execute('measure', { id }))), [z[0].id, cad.id]);
const mitte = r => r.result.total.bbox.min.map((v, i) => (v + r.result.total.bbox.max[i]) / 2);
const [ms, mc] = lage.map(mitte);
ok('CAD-Körper steht an der Stelle des Scans, auf der Platte', Math.hypot(ms[0] - mc[0], ms[1] - mc[1]) < 5 && Math.abs(lage[1].result.total.bbox.min[2]) < 0.01, { ms, mc });
await pg.click('#s2c-zu');
await pg.evaluate(() => window.v3dApi.execute('edit.undo', {}));
z = await zustand();
ok('ein Rückgängig: CAD weg, Scan wieder sichtbar', z.length === 1 && z[0].sichtbar, z);

// B) Scan gewählt → direkt umwandeln (Drehteil)
await pg.evaluate(() => _newCreate(false));
await pg.evaluate(async (b64) => {
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  await _importMeshFile(buf, 'welle_scan.stl', false);
  selectObjs([objects[objects.length - 1]]);
  _scan2cad();
}, readFileSync(DIR + 'drehteil_scan.stl').toString('base64'));
await fertig();
erg = await pg.evaluate(() => document.getElementById('s2c-erg').textContent);
ok('Welle (gewählt): Drehteil, sehr gut', /Drehteil/.test(erg) && /sehr gut/.test(erg), erg);
z = await zustand();
const cad2 = z.find(o => /\(CAD\)$/.test(o.name || ''));
m = await pg.evaluate(id => window.v3dApi.execute('measure', { id }), cad2 && cad2.id);
const vol2 = m.ok && m.result.bodies[0].volume_mm3;
ok('Welle: Volumen ±1 % zum CAD-Soll 16 262 mm³', Math.abs(vol2 - 16262) / 16262 < 0.01, vol2);
await pg.click('#s2c-zu');

// C) Abbrechen während der Rechnung: kein neuer Körper, Dialog zu
await pg.evaluate(() => { _newCreate(false); });
await pg.evaluate(async (b64) => {
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  await _importMeshFile(buf, 'w.stl', false);
  selectObjs([objects[objects.length - 1]]); _scan2cad();
}, readFileSync(DIR + 'winkel_scan.stl').toString('base64'));
await pg.waitForTimeout(3000);
await pg.click('#s2c-ab');
await pg.waitForTimeout(500);
ok('Abbrechen schließt den Dialog', await pg.evaluate(() => !document.getElementById('s2c-modal').classList.contains('show')));
await pg.waitForTimeout(4000);
ok('nach Abbrechen kein CAD-Körper', (await zustand()).length === 1);
ok('Menüpunkt + Suche vorhanden', await pg.evaluate(() => [...document.querySelectorAll('.sli-item')].some(e => /Scan → CAD/.test(e.textContent)) && CMDK.some(c => /Scan → CAD/.test(c.t))));
ok('keine Seitenfehler', !errs.length, errs.slice(0, 3));
console.log(fehler ? `\n${fehler} FEHLER` : '\nALLES OK');
await b.close();
process.exit(fehler ? 1 : 0);
