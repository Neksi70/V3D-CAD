// Regressionstest 🔍 Maße abgreifen (_mab*) + 📐 Messen Fläche-zu-Fläche (_measureParallel).
// Testteil (STL-Import): Block 60×40×20, Nut 8 breit × 5 tief quer (in X), 2× Durchgangsbohrung Ø5,
// Sackloch Ø6,5 × 10 tief, Zapfen Ø8 × 6 hoch oben drauf.
// Start: python3 volme3d_server.py 8877 --dev  →  node tests/masse_abgreifen_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8877/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _mabOpen === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); localStorage.setItem('v3d_umsteiger_hinweis', '1'); document.getElementById('umsteiger-hinweis')?.remove(); });

const r = await pg.evaluate(async () => {
  const w = await _mfInit(), M = w.Manifold;
  let k = M.cube([60, 40, 20]);
  k = M.difference(k, M.cube([8, 42, 6]).translate([26, -1, 15]));          // Nut x 26..34, 5 tief (z 15..20)
  for (const x of [8, 52]) k = M.difference(k, M.cylinder(22, 2.5, 2.5, 48).translate([x, 20, -1]));   // Ø5 durch
  k = M.difference(k, M.cylinder(11, 3.25, 3.25, 48).translate([45, 10, 10]));   // Ø6,5 × 10 Sackloch von oben
  k = M.union(k, M.cylinder(6, 4, 4, 48).translate([15, 30, 20]));              // Zapfen Ø8 × 6
  _newCreate(false);
  _addImportedStl(_mfToStlBuf(k), 'testteil.stl', false);
  selectObjs([objects[0]]);
  _mabOpen();
  const E = _mab.erg;
  const zeilen = [...document.querySelectorAll('#mab-modal .mab-sek, #mab-modal .mab-z')].map(e => e.textContent.trim());
  // erste Gruppe jeder Art anklicken
  const gi = _mab.gruppen.findIndex(g => g.el[0].typ === 'zyl'); _mabZeig(gi);
  const hl = _mab.hl ? _mab.hl.children.length : 0;
  return { aussen: E.aussen, zeilen, hl, nPaare: E.paare.length, nZyl: E.zyl.length };
});
console.log('       Liste:\n         ' + r.zeilen.join('\n         '));
const hat = (re) => r.zeilen.some(z => re.test(z));
ok('Außenmaße 60 × 40 × 26', /60,0 × 40,0 × 26,0 mm/.test(r.zeilen.join(' ')), r.aussen);
ok('2× Ø 5 Bohrung, 20 mm tief', hat(/^2× Ø 5,0 mm\s*Bohrung · 20,0 mm/), r.zeilen.filter(z => /Ø 5/.test(z)));
ok('Ø 6,5 Bohrung 10 mm tief (Sackloch)', hat(/^Ø 6,5 mm\s*Bohrung · 10,0 mm/));
ok('Ø 8 Zapfen 6 mm', hat(/^Ø 8,0 mm\s*Zapfen.*6,0 mm/));
ok('Nut 8 mm in X', hat(/^8,0 mm\s*Nut \/ Innenmaß in X/));
ok('Bodenstärke unter der Nut 15 mm in Z', hat(/^15,0 mm\s*Wand- \/ Bodenstärke in Z/));
ok('Bodenstärke unter dem Sackloch 10 mm in Z', hat(/^10,0 mm\s*Wand- \/ Bodenstärke in Z/));
ok('keine Scheinmaße aus Bohrungs-/Zapfenfacetten (schräg)', !hat(/schräg/), r.zeilen.filter(z => /schräg/.test(z)));
ok('Hervorheben zeichnet etwas', r.hl > 0, r.hl);

// Messen Fläche-zu-Fläche: Punkte auf den beiden Nutwänden (schräg versetzt)
const m = await pg.evaluate(() => {
  const o = objects[0]; o.updateMatrixWorld(true);
  const bb = getMeshBox(o);   // Teil wurde beim Import zentriert → Nutwände bei x = bb.min.x + 2,6 / 3,4 cm
  const xa = bb.min.x + 2.6, xb = bb.min.x + 3.4;
  const hit = (x, y, z, dx) => { raycaster.set(new THREE.Vector3(x - dx * 1, y, z), new THREE.Vector3(dx, 0, 0)); return raycaster.intersectObject(o, true).find(h => h.face && h.object.isMesh); };
  // in der Nut stehend nach links bzw. rechts auf die Wände schießen
  const mitteX = (xa + xb) / 2, y = bb.min.y + 1.8;
  const hA = hit(mitteX + 1, y, bb.min.z + 1.0, -1), hB = hit(mitteX - 1, y + 0.1, bb.min.z + 3.0, 1);
  measureTool();
  const setze = h => { const nW = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize(); return [h.point.clone(), nW]; };
  [_measureA, _measureAN] = setze(hA); [_measureB, _measureBN] = setze(hB); _measureDraw();
  const t1 = document.getElementById('measure-label').textContent;
  // nicht parallel: Punkt auf Nutwand + Punkt auf Oberseite
  _measureBN = new THREE.Vector3(0, 1, 0); _measureB = new THREE.Vector3(bb.min.x + 1, bb.max.y - 0.6, bb.min.z + 1); _measureDraw();
  const t2 = document.getElementById('measure-label').textContent;
  _measureExit();
  return { t1, t2, ax: hA.point.x - bb.min.x, bx: hB.point.x - bb.min.x };
});
ok('Messen: Nutwände → „↔ 8,0 mm Flächenabstand“ (schräg geklickt)', /^↔ 8,0 mm Flächenabstand \(Punkte/.test(m.t1), m);
ok('Messen sonst: Abstand mit X/Y/Z-Anteilen', /mm · X .* · Y .* · Z /.test(m.t2), m.t2);
await pg.evaluate(() => fitToObjects(objects)); await pg.mouse.move(600, 500); await pg.mouse.move(610, 505); await pg.waitForTimeout(300);
await pg.evaluate(() => { selectObjs([objects[0]]); _mabOpen(); const i = _mab.gruppen.findIndex(g => g.el[0].typ === 'paar' && g.el[0].p.art === 'nut'); _mabZeig(i); });
await pg.mouse.move(600, 520); await pg.waitForTimeout(300);
await pg.screenshot({ path: '/tmp/masse_abgreifen.png' });
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
