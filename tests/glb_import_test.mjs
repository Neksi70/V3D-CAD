// Regressionstest GLB-Import mit Farben (_glb*, Idee Printooly „GLB → 3MF“).
//   1. Duck.glb (Textur) → ein Import-Objekt, Maße ~60 mm (normiertes Modell)
//   2. 3 Filamentfarben: Vertexfarben je Dreieck flach, genau 3 verschiedene, Grundfarbe = gelb
//   3. _mmuPaint/_mmuBase/_mmuSlots gesetzt, überlebt objectToData
//   4. 3MF-Export schreibt paint_color für Filament 2 und 3
//   5. echter Weg: Datei-Dialog (#fimport) → Farbfenster → Importieren
//   6. einfarbig (n=1) → keine Bemalung
// Start: python3 volme3d_server.py 8873 --dev  →  V3D_URL=http://127.0.0.1:8873/volme3d.html node tests/glb_import_test.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const APP = process.env.V3D_URL || 'http://127.0.0.1:8873/volme3d.html';
const DUCK = new globalThis.URL('./fixtures/Duck.glb', import.meta.url).pathname;
const fails = [];
const ok = (name, cond, extra) => { console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); if (!cond) fails.push(name); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function' && typeof _importGLB === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });

const b64 = readFileSync(DUCK).toString('base64');
const r = await pg.evaluate(async (b64) => {
  _newCreate(false);
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const okImp = await _importGLB(u8.buffer, 'Duck.glb', { n: 3 });
  const m = objects[objects.length - 1];
  m.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(m), sz = bb.getSize(new THREE.Vector3());
  const col = m.geometry.attributes.color, n = m.geometry.attributes.position.count;
  let flach = true; const farben = new Set();
  for (let t = 0; t < n; t += 3) {
    const k = [0,1,2].map(j => col.getX(t+j).toFixed(4) + ',' + col.getY(t+j).toFixed(4) + ',' + col.getZ(t+j).toFixed(4));
    if (k[0] !== k[1] || k[0] !== k[2]) flach = false;
    farben.add(k[0]);
  }
  const d = objectToData(m);
  let rb = _build3mfBlob([m], { schicht: false }); if (rb && rb.then) rb = await rb; const blob = rb.blob;
  const zip = fflate.unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const modelName = Object.keys(zip).find(k => /3D\/.*\.model$/i.test(k) && /paint_color/.test(new TextDecoder().decode(zip[k])))
                 || Object.keys(zip).find(k => /\.model$/i.test(k));
  const xml = new TextDecoder().decode(zip[modelName]);
  const pc = {}; for (const mm of xml.matchAll(/paint_color="([0-9A-F]+)"/g)) pc[mm[1]] = (pc[mm[1]] || 0) + 1;
  return { okImp, anzahl: objects.length, sizeMm: [sz.x, sz.y, sz.z].map(v => +(v * 10).toFixed(1)), flach, farben: [...farben], tris: n / 3,
    ud: { paint: m.userData._mmuPaint, base: m.userData._mmuBase, slots: m.userData._mmuSlots, type: m.userData.type, name: m.userData.name },
    dPaint: d._mmuPaint, dSlots: d._mmuSlots, pc, vc: m.material.vertexColors };
}, b64);
ok('Import gelingt, ein Objekt', r.okImp && r.anzahl === 1, r.anzahl);
ok('Maße ~60 mm (größte Kante)', Math.abs(Math.max(...r.sizeMm) - 60) < 0.5, r.sizeMm);
ok('Name ohne Endung', r.ud.name === 'Duck', r.ud.name);
ok('Farben flach je Dreieck', r.flach);
ok('genau 3 Filamentfarben', r.farben.length === 3, r.farben);
const hx = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16));
const [br, bg, bb] = hx(r.ud.base || '#000000');
ok('Grundfarbe gelb (größte Fläche)', br > 180 && bg > 150 && bb < 120, r.ud.base);
ok('Mehrfarb-Daten gesetzt', r.ud.paint === 1 && r.ud.slots.length === 2 && r.vc, r.ud);
ok('objectToData behält Bemalung', r.dPaint === 1 && r.dSlots.length === 2);
ok('3MF: paint_color für Filament 2 und 3', (r.pc['8'] || 0) > 0 && (r.pc['0C'] || 0) > 0, r.pc);

// echter Weg über den Datei-Dialog
await pg.evaluate(() => _newCreate(false));
await pg.setInputFiles('#fimport', DUCK);
await pg.waitForSelector('#glb-modal.show', { timeout: 15000 });
const sw = await pg.$$eval('#glb-swatches > span', s => s.length);
ok('Fenster zeigt Vorschau (Standard 4 Farben)', sw === 4, sw);
await pg.selectOption('#glb-n', '2');
const sw2 = await pg.$$eval('#glb-swatches > span', s => s.length);
ok('Auswahl 2 → 2 Farbfelder', sw2 === 2, sw2);
await pg.click('#glb-ok');
await pg.waitForFunction(() => objects.length === 1, { timeout: 15000 });
// Größendialog des Imports schließen, falls offen
await pg.keyboard.press('Escape').catch(() => {});
const r2 = await pg.evaluate(() => { const m = objects[0]; return { slots: (m.userData._mmuSlots || []).length, paint: m.userData._mmuPaint }; });
ok('Datei-Dialog-Weg: 2 Farben importiert', r2.paint === 1 && r2.slots === 1, r2);

// einfarbig
const r3 = await pg.evaluate(async (b64) => {
  _newCreate(false);
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  await _importGLB(u8.buffer, 'Duck.glb', { n: 1 });
  const m = objects[0]; return { paint: !!m.userData._mmuPaint, col: !!m.geometry.attributes.color };
}, b64);
ok('n=1 → keine Bemalung', !r3.paint && !r3.col, r3);

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await pg.evaluate(async (b64) => { _newCreate(false); const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); await _importGLB(u8.buffer, 'Duck.glb', { n: 3 }); fitToObjects(objects); }, b64);
await pg.mouse.click(1300, 120);
await pg.waitForTimeout(500);
await pg.screenshot({ path: '/tmp/glb_import.png' });
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
