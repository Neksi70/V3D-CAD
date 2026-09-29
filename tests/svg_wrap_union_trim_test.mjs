// Josy 29.9.26: eigenes Muster um einen Becher gewickelt, "Vereinen" geklickt —
// oben standen die Fransen über den Rand. Beim Vereinen wird der Überstand
// jetzt an Ober-/Unterkante des Körpers abgeschnitten.
// Prüft: Ergebnis ragt nicht über den Becher hinaus, Motiv ist trotzdem drin
// (Ergebnis dicker als der nackte Becher), Motiv innerhalb bleibt unangetastet.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10,0 H30 V100 H10 Z"/><path d="M45,0 H55 V100 H45 Z"/><path d="M70,0 H90 V100 H70 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const lauf = (hitY, erhaben, hoch) => pg.evaluate(async ([svgText, hitY, erhaben, hoch]) => {
  objects.slice().forEach(o => { scene.remove(o); }); objects.length = 0;
  // geschlossener konischer Becher, 100 mm hoch, Boden auf y=0
  const geo = new THREE.CylinderGeometry(35, 20, 100, 96, 1, false);
  const becher = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3ac }));
  becher.scale.set(0.1, 0.1, 0.1); becher.position.set(0, 5, 0);
  becher.userData = { id: idCtr++, name: 'Becher', type: 'import', shapeType: 'import' };
  scene.add(becher); objects.push(becher); becher.updateMatrixWorld(true);

  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 2, targetMM: hoch || 40, name: 'Muster' });
  m.userData.isHole = false;
  if (erhaben) m.userData.svgDepth = -2;
  becher.position.set(0, 5, 0); becher.updateMatrixWorld(true);   // Import kann umsortieren
  const r = (20 + 15 * (hitY / 10)) / 10;
  const hit = new THREE.Vector3(r, hitY, 0);
  const p = _svgWrapProbe(becher, hit);
  if (!p) return { gewickelt: false };
  _svgWrapApply(m, p, hit);
  if (erhaben) _svgWrapReshape(m, -2);
  m.updateMatrixWorld(true);
  const mb = new THREE.Box3().setFromObject(m);
  const vol = o => { const w = _mfWasm; return _mfFromSoup(w, _moldCollectTris(o)).volume(); };
  await _mfInit();
  const vBecher = vol(becher);

  const msgs = []; const _n = window.notify; window.notify = (t, ...a) => { msgs.push(String(t)); return _n(t, ...a); };
  selectObjs([becher, m]);
  await unionSelected();
  window.notify = _n;
  const res = objects.find(o => o.userData.name && o.userData.name.startsWith('Verschmolzen'));
  if (!res) return { gewickelt: true, vereint: false, motivMaxY: mb.max.y, msgs, tris: _countTris([m]) };
  res.updateMatrixWorld(true);
  const rb = new THREE.Box3().setFromObject(res);
  let vRes = null;
  try { vRes = vol(res); } catch (e) { vRes = 'kaputt: ' + e.message; }
  return { gewickelt: true, vereint: true, motivMaxY: mb.max.y, motivMinY: mb.min.y,
           resMaxY: rb.max.y, resMinY: rb.min.y, vBecher, vRes, msgs };
}, [SVG, hitY, erhaben, hoch]);

// 1) Motiv (130 mm) höher als der Becher (100 mm) → steht oben und unten über
let r = await lauf(5, false, 130);
console.log('oben   ', JSON.stringify(r));
ok('oben: Motiv stand vor dem Vereinen über', r.gewickelt && r.motivMaxY > 10.5, r.motivMaxY);
ok('oben: Ergebnis endet am Becherrand', r.vereint && r.resMaxY <= 10.005, r.resMaxY);
ok('oben: Motiv ist im Ergebnis (mehr Volumen)', r.vereint && typeof r.vRes === 'number' && r.vRes > r.vBecher + 50, { vB: r.vBecher, vR: r.vRes });

// 2) unten über den Boden hinaus
r = await lauf(3, false, 110);
console.log('unten  ', JSON.stringify(r));
ok('unten: Motiv stand vor dem Vereinen unter dem Boden', r.gewickelt && r.motivMinY < -0.5, r.motivMinY);
ok('unten: Ergebnis steht auf dem Boden', r.vereint && r.resMinY >= -0.005, r.resMinY);

// 3) erhaben, oben überstehend
r = await lauf(5, true, 130);
console.log('erhaben', JSON.stringify(r));
ok('erhaben: Ergebnis endet am Becherrand', r.vereint && r.resMaxY <= 10.005, r.resMaxY);
ok('erhaben: Relief ist drauf', r.vereint && typeof r.vRes === 'number' && r.vRes > r.vBecher + 50, { vB: r.vBecher, vR: r.vRes });

// 4) ganz innerhalb: nichts wird abgeschnitten (Höhe bleibt, Motiv drin)
r = await lauf(5, false);
console.log('mitte  ', JSON.stringify(r));
ok('mitte: Motiv lag innerhalb', r.gewickelt && r.motivMaxY < 10 && r.motivMinY > 0, [r.motivMinY, r.motivMaxY]);
ok('mitte: vereint und Motiv drin', r.vereint && typeof r.vRes === 'number' && r.vRes > r.vBecher + 50, { vB: r.vBecher, vR: r.vRes });

console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
