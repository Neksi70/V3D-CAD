// Regressionstest für den Ring-Radierer (🧽 Radierer → ◎ Ring).
//
// Szene von oben: Platte 100×4×100 mm (grobe Box, 12 Dreiecke) + Zylinder in
// der Mitte als eigenes Objekt. Mit echten Maus-Events: Innen-Ø 30 mm, auf die
// Mitte drücken, auf 40 mm Radius aufziehen, loslassen. Geprüft wird:
//   1. Zylinder (liegt im Innenkreis) bleibt unverändert
//   2. auf der Platte liegt kein Dreieck mehr im Ring (Schwerpunkte der
//      zerschnittenen Stücke), innen und außen bleibt Fläche stehen
//   3. Oberseite verliert ziemlich genau π·(40² − 15²) mm² (Kreis zerschnitten,
//      nicht nur ganze Dreiecke weg)
//   4. ein Strg+Z stellt die Platte wieder her; Esc bricht einen Ring ab
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

// Szene aufbauen, Bildschirmpunkte der Mitte und von (40 mm, 0) liefern
const setup = () => pg.evaluate(() => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0; deselect();
  addShape('box');
  const plate = objects[objects.length - 1];
  const bb0 = new THREE.Box3().setFromObject(plate), s0 = bb0.getSize(new THREE.Vector3());
  plate.scale.set(10 / s0.x, 0.4 / s0.y, 10 / s0.z);
  plate.position.set(0, 0, 0); plate.updateMatrixWorld(true);
  const pb = new THREE.Box3().setFromObject(plate);
  plate.position.y -= pb.max.y; plate.updateMatrixWorld(true);        // Oberseite auf y=0
  addShape('cylinder');
  const cyl = objects[objects.length - 1];
  const cb = new THREE.Box3().setFromObject(cyl), cs = cb.getSize(new THREE.Vector3());
  cyl.scale.multiplyScalar(2 / Math.max(cs.x, cs.z));                   // Ø 20 mm
  cyl.updateMatrixWorld(true);
  const cb2 = new THREE.Box3().setFromObject(cyl);
  cyl.position.x -= (cb2.min.x + cb2.max.x) / 2; cyl.position.z -= (cb2.min.z + cb2.max.z) / 2;
  cyl.position.y -= cb2.min.y; cyl.updateMatrixWorld(true);
  plate.position.x = 0; plate.position.z = 0; plate.updateMatrixWorld(true);   // addShape rückt Neues/Altes auseinander
  deselect(); updateTree();
  orbitTarget.set(0, 0, 0); setView('top');
  camera.updateMatrixWorld(true);
  const rect = vpEl.getBoundingClientRect();
  const scr = (x, y, z) => { const p = new THREE.Vector3(x, y, z).project(camera);
    return { x: (p.x*0.5+0.5)*rect.width + rect.left, y: (-p.y*0.5+0.5)*rect.height + rect.top }; };
  // Maße gelten in der Tiefe des Treffpunkts (Zylinder-Oberseite)
  const top = new THREE.Box3().setFromObject(cyl).max.y;
  return { c: scr(0, top, 0), e: scr(4, top, 0), cylTris: cyl.geometry.index ? cyl.geometry.index.count/3 : cyl.geometry.attributes.position.count/3 };
});

const measure = () => pg.evaluate(() => {
  const plate = objects[0], cyl = objects[1];
  const g = plate.geometry, p = g.attributes.position, idx = g.index;
  const n = idx ? idx.count : p.count;
  const V = (i) => new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(plate.matrixWorld);
  let topArea = 0, inRing = 0, inner = 0, outer = 0, tris = 0;
  for (let t = 0; t < n; t += 3) {
    const a = V(t), b2 = V(t+1), c = V(t+2);
    const cr = new THREE.Vector3().subVectors(b2, a).cross(new THREE.Vector3().subVectors(c, a));
    const area = cr.length() / 2 * 100;                                   // mm²
    if (area < 1e-6) continue;
    tris++;
    const cen = a.clone().add(b2).add(c).multiplyScalar(1/3);
    const r = Math.hypot(cen.x, cen.z) * 10;                              // mm (Draufsicht ~ Achse y)
    if (cr.y > 0 && Math.abs(cen.y) < 0.01) {
      topArea += area;
      if (r > 16 && r < 39) inRing++;   // Achse leicht schräg (setView top) → ~0,8 mm Versatz auf Plattenhöhe
      if (r < 15) inner += area; if (r > 40) outer += area;
    }
  }
  // offene Kanten, die NICHT auf einem der beiden Kreise liegen = T-Stöße/Fugen
  const Q = 1e4, key = v => Math.round(v.x*Q)+','+Math.round(v.y*Q)+','+Math.round(v.z*Q);
  const em = new Map(), mids = new Map();
  for (let t = 0; t < n; t += 3) { const vs = [V(t), V(t+1), V(t+2)];
    for (let k = 0; k < 3; k++) { const a = vs[k], b3 = vs[(k+1)%3], ka = key(a), kb = key(b3); if (ka === kb) continue;
      const e = ka < kb ? ka+'|'+kb : kb+'|'+ka; em.set(e, (em.get(e)||0)+1); mids.set(e, a.clone().add(b3).multiplyScalar(0.5)); } }
  let fugen = 0, offen = 0;
  for (const [e, c] of em) if (c === 1) { offen++; const m = mids.get(e);
    if (Math.abs(m.y) > 0.39 && Math.abs(m.y) < 0.41) continue;          // Unterseite: schräge Achse, Kreise leicht versetzt
    const r = Math.hypot(m.x, m.z) * 10; if (Math.abs(r - 15) > 1.2 && Math.abs(r - 40) > 1.2) fugen++; }
  return { fugen, offen, tris, topArea, inRing, inner, outer, cylTris: cyl && (cyl.geometry.index ? cyl.geometry.index.count/3 : cyl.geometry.attributes.position.count/3),
           cylType: cyl && cyl.userData.shapeType };
});

let S = await setup();
const before = await measure();
ok('Ausgangslage: Oberseite 100×100 mm', Math.abs(before.topArea - 10000) < 1, before.topArea);

// Radierer öffnen, Ring-Modus + Innen-Ø per Panel
await pg.evaluate(() => openEraserTool());
await pg.click('#eraser-mode-ring');
await pg.fill('#eraser-inner-num', '30');
ok('Panel: Ring-Modus aktiv, Innen-Ø 30', await pg.evaluate(() => _eraser.mode === 'ring' && _eraser.innerMm === 30 &&
  getComputedStyle(document.getElementById('eraser-sec-ring')).display !== 'none'));

// Esc bricht ab
await pg.mouse.move(S.c.x, S.c.y);
await pg.mouse.down();
await pg.mouse.move(S.e.x, S.e.y, { steps: 5 });
await pg.keyboard.press('Escape');
await pg.mouse.up();
const afterEsc = await measure();
ok('Esc: nichts gelöscht', afterEsc.tris === before.tris && Math.abs(afterEsc.topArea - 10000) < 1, afterEsc);

// Ring aufziehen
await pg.mouse.move(S.c.x, S.c.y);
await pg.mouse.down();
await pg.mouse.move(S.e.x, S.e.y, { steps: 8 });
const lbl = await pg.evaluate(() => _eraser.ringLbl.textContent);
ok('Beschriftung zeigt außen Ø ~80 mm', /außen Ø 7[89]\.\d|außen Ø 8[01]\.\d/.test(lbl), lbl);
await pg.mouse.up();
const after = await measure();
const expect = 10000 - Math.PI * (40*40 - 15*15);
ok('Zylinder im Innenkreis unverändert', after.cylTris === S.cylTris && after.cylType === before.cylType, after);
ok('kein Plattenstück mehr im Ring', after.inRing === 0, after.inRing);
ok('keine Schnittfugen (offene Kanten nur an den Kreisen)', after.fugen === 0, { fugen: after.fugen, offen: after.offen });
ok('innen und außen bleibt Fläche', after.inner > 600 && after.outer > 4000, { inner: after.inner, outer: after.outer });
ok('Oberseite ≈ 10000 − π(40²−15²) mm²', Math.abs(after.topArea - expect) < expect * 0.02, { ist: after.topArea, soll: expect });

await pg.evaluate(() => _eraserClose());
await pg.keyboard.press('Control+z');
await pg.waitForTimeout(300);
const undone = await measure();
ok('Strg+Z stellt Platte wieder her', Math.abs(undone.topArea - 10000) < 1, undone.topArea);

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors);
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
