// Regressionstest (Josy 6.10.): SVG-Bohrung auf der flachen Seite eines Quaders
// mit den Gizmo-Pfeilen verschieben. Gemeldet: „springt immer dahin, wo er
// hinspringen will, bleibt nicht da, wo ich ihn haben möchte".
// Start: python3 volme3d_server.py 8857 --dev   (oder V3D_URL setzen)
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8857/volme3d.html';
// Teddy-ähnliches Motiv aus mehreren Teilen (Kopf, Ohren, Bauch, Arme, Beine)
const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 90">
<circle cx="30" cy="22" r="14"/><circle cx="16" cy="9" r="6"/><circle cx="44" cy="9" r="6"/>
<ellipse cx="30" cy="55" rx="17" ry="20"/><ellipse cx="9" cy="48" rx="6" ry="10"/><ellipse cx="51" cy="48" rx="6" ry="10"/>
<ellipse cx="20" cy="80" rx="8" ry="8"/><ellipse cx="40" cy="80" rx="8" ry="8"/></svg>`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter(); document.getElementById('auth-overlay')?.classList.add('hidden'); });

const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
async function drag(from, to, steps = 14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  await pg.mouse.up(); await pg.waitForTimeout(120);
}
// Pfeilspitze (Welt) der Gizmo-Achse
const tip = (axis, f = 0.8) => pg.evaluate(([axis, f]) => {
  _mgUpdate(); const g = _mg.group; const v = _mgAxisVec(axis);
  return g.position.clone().addScaledVector(v, f * g.scale.x).toArray();
}, [axis, f]);

await pg.evaluate((svg) => {
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 5.8, targetMM: 24, name: 'Teddy' });
  m.userData.isHole = true; m.userData.name = 'Teddy';
  addShape('box'); const box = objects[objects.length - 1]; box.scale.set(2, 2.75, 2); box.userData.name = 'Quader';
}, TEST_SVG);
await pg.waitForTimeout(600);   // der Import/addShape rückt Körper verzögert beiseite
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const box = objects.find(o => o.userData.name === 'Quader');
  box.position.set(0, 2.75, 0); m.updateMatrixWorld(true);
  m.position.add(new THREE.Vector3(5, 0, 6).sub(_svgCenterWorld(m)).setY(0));
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 2.5, 0); sph.theta = 0.45; sph.phi = 1.2; sph.r = 18; sph2cam(); camera.updateMatrixWorld(true);
  selectObjs([]);
});
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.97 }; });
const state = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const box = objects.find(o => o.userData.name === 'Quader');
  const bb = new THREE.Box3().setFromObject(box);
  const c = _svgCenterWorld(m);
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);
  return { c: c.toArray().map(v => +v.toFixed(3)), n: n.toArray().map(v => +v.toFixed(2)),
           dz: +(c.z - bb.max.z).toFixed(3), snapped: !!m.userData._snapNormal };
});
let fail = 0;
const check = (ok, msg) => { console.log((ok ? '   ✓ ' : '   ✗ ') + msg); if (!ok) fail++; };

// 1) frei auf die Vorderseite ziehen → heften (mittig)
await pg.evaluate(() => selectObjs([])); await pg.waitForTimeout(120);
let s = await state(); console.log('0. Start', JSON.stringify(s));
if (process.env.SHOT) await pg.screenshot({ path: '/tmp/josy_bp/t0.png' });
await drag(await scr(s.c), await scr([0, 2.75, 2]));
s = await state(); console.log('1. geheftet', JSON.stringify(s));
check(s.snapped && Math.abs(s.c[0]) < 0.05 && Math.abs(s.c[1] - 2.75) < 0.05, 'mittig auf der Vorderseite');
const dz0 = s.dz;

// Gizmo-Pfeil ziehen: Motiv auswählen, Pfeilspitze greifen, um dW (Welt) verschieben
async function gizmo(axis, dW, label, f = 0.8) {
  await pg.evaluate(() => { selectObjs([objects.find(o => o.userData.shapeType === 'svg')]); });
  await pg.waitForTimeout(80);
  const t = await tip(axis, f);
  const t2 = t.slice(); t2[{ x: 0, y: 1, z: 2 }[axis]] += dW;
  const before = await state();
  await drag(await scr(t), await scr(t2), 16);
  const after = await state();
  const k = { x: 0, y: 1, z: 2 }[axis];
  const moved = after.c[k] - before.c[k];
  console.log(label, JSON.stringify(after), 'Δ=' + moved.toFixed(3), 'soll≈' + dW);
  return { before, after, moved };
}

// 2) Pfeil Y nach oben (+0,6 = 6 mm): Spitze landet über der Oberkante
let r = await gizmo('y', 0.6, '2. Y hoch');
check(Math.abs(r.moved - 0.6) < 0.08, 'Y-Pfeil: Motiv bleibt da, wo losgelassen');
check(Math.abs(r.after.dz - dz0) < 0.01 && Math.abs(r.after.n[2] - 1) < 0.01, 'Y-Pfeil: bleibt auf der Vorderseite');

// 3) Pfeil X nach links (−0,5)
r = await gizmo('x', -0.5, '3. X links');
check(Math.abs(r.moved + 0.5) < 0.08, 'X-Pfeil: Motiv bleibt da, wo losgelassen');
check(Math.abs(r.after.dz - dz0) < 0.01, 'X-Pfeil: bleibt auf der Vorderseite');

// 4) Pfeil Y nach unten (−1,0)
r = await gizmo('y', -1.0, '4. Y runter');
check(Math.abs(r.moved + 1.0) < 0.08, 'Y-Pfeil runter: bleibt da, wo losgelassen');
check(Math.abs(r.after.dz - dz0) < 0.01, 'Y-Pfeil runter: bleibt auf der Vorderseite');

// 5) Josys Szene: ein zweites Motiv sitzt schon links auf der Fläche. Mit dem
//    X-Pfeil nach links ziehen — der Zeiger endet über dem anderen Motiv.
await pg.evaluate(() => { svgCenterOnFace(); });
await pg.evaluate((svg) => {
  const m2 = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 5.8, targetMM: 24, name: 'Teddy2' });
  m2.userData.isHole = true; m2.userData.name = 'Teddy2';
}, TEST_SVG);
await pg.waitForTimeout(600);
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.name === 'Teddy');
  const m2 = objects.find(o => o.userData.name === 'Teddy2');
  const box = objects.find(o => o.userData.name === 'Quader');
  box.position.set(0, 2.75, 0);
  m2.position.copy(m.position); m2.quaternion.copy(m.quaternion); m2.position.x -= 1.15;
  Object.assign(m2.userData, { _snapNormal: m.userData._snapNormal.clone(), _snapSolid: box, _snapFaceD: m.userData._snapFaceD,
                               _snapSurfaceLocal: m.userData._snapSurfaceLocal.clone() });
  objects.forEach(o => o.updateMatrixWorld(true));
});
const sel1 = () => pg.evaluate(() => { selectObjs([objects.find(o => o.userData.name === 'Teddy')]); });
const st1 = () => pg.evaluate(() => { const m = objects.find(o => o.userData.name === 'Teddy');
  const box = objects.find(o => o.userData.name === 'Quader'); const bb = new THREE.Box3().setFromObject(box);
  const c = _svgCenterWorld(m); const n = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);
  return { c: c.toArray().map(v => +v.toFixed(3)), n: n.toArray().map(v => +v.toFixed(2)), dz: +(c.z - bb.max.z).toFixed(3) }; });
await sel1(); await pg.waitForTimeout(80);
let a = await st1();
// Spitze des X-Pfeils greifen und so weit ziehen, dass der Zeiger über Teddy2 endet
const t5 = await tip('x', 0.8);
const ziel5 = await pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.name === 'Teddy2')).toArray());
const p5a = await scr(t5), p5b = await scr(ziel5);
await drag(p5a, { x: p5b.x, y: p5a.y }, 16);
let z = await st1(); console.log('5. X links auf Teddy2', JSON.stringify(a), '→', JSON.stringify(z));
check(Math.abs(z.dz - dz0) < 0.01 && Math.abs(z.n[2] - 1) < 0.01, 'über dem anderen Motiv losgelassen: bleibt auf der Vorderseite');
check(z.c[0] < a.c[0] - 0.3 && Math.abs(z.c[1] - a.c[1]) < 0.02, 'über dem anderen Motiv losgelassen: nur nach links gewandert (x ' + a.c[0] + ' → ' + z.c[0] + ')');

// 6) Y-Pfeil so weit hoch, dass der Zeiger über der Deckfläche endet
await pg.evaluate(() => { const m = objects.find(o => o.userData.name === 'Teddy'); selectObjs([m]); svgCenterOnFace(); });
await pg.waitForTimeout(80);
a = await st1();
const t6 = await tip('y', 0.8);
const p6a = await scr(t6), p6b = await scr([0, 5.5, 0]);   // Mitte der Deckfläche
await drag(p6a, { x: p6a.x, y: p6b.y }, 16);
z = await st1(); console.log('6. Y hoch bis über die Deckfläche', JSON.stringify(a), '→', JSON.stringify(z));
check(Math.abs(z.dz - dz0) < 0.01 && Math.abs(z.n[2] - 1) < 0.01, 'Zeiger über der Deckfläche: bleibt auf der Vorderseite');
check(z.c[1] > a.c[1] + 0.3, 'Zeiger über der Deckfläche: ist nach oben gewandert');

// 7) Loses Motiv (liegt vor dem Quader auf der Platte) mit dem Y-Pfeil hochziehen,
//    bis der Zeiger auf der Vorderseite steht: heftet dort an, wo es hingeschoben wurde — nicht
//    in die Flächenmitte — und ragt nicht über die Kante.
await pg.evaluate(() => {
  const m2 = objects.find(o => o.userData.name === 'Teddy2'); 
  const i = objects.indexOf(m2); scene.remove(m2); objects.splice(i, 1);
  const m = objects.find(o => o.userData.name === 'Teddy');
  _svgLegeFlachHin(m);
  m.updateMatrixWorld(true);
  m.position.add(new THREE.Vector3(1.0, 0, 3.2).sub(_svgCenterWorld(m)).setY(0));
  m.updateMatrixWorld(true);
  selectObjs([m]);
}).catch(async e => { console.log('Aufbau 7:', e.message); });
await pg.waitForTimeout(100);
a = await st1();
const t7 = await tip('y', 0.8);
const p7a = await scr(t7), p7b = await scr([1.0, 3.0, 2.0]);
await drag(p7a, { x: p7a.x, y: p7b.y }, 16);
z = await st1(); console.log('7. loses Motiv per Y-Pfeil an die Wand', JSON.stringify(a), '→', JSON.stringify(z));
const half7 = await pg.evaluate(() => _svgGlideHalfExtent(objects.find(o => o.userData.name === 'Teddy')));
check(Math.abs(z.dz - dz0) < 0.01 && Math.abs(z.n[2] - 1) < 0.01, 'per Pfeil angeschoben: auf der Vorderseite geheftet');
check(Math.abs(z.c[0] - 1.0) < 0.05, 'per Pfeil angeschoben: bleibt seitlich, wo es war (x ' + z.c[0] + ', nicht Flächenmitte 0)');
check(z.c[1] - half7.v > -0.01 && z.c[1] + half7.v < 5.51, 'per Pfeil angeschoben: liegt ganz auf der Fläche (y ' + z.c[1] + ' ± ' + half7.v.toFixed(2) + ')');

console.log('errs', errs);
console.log(fail === 0 && errs.length === 0 ? '✅ ALLE PRÜFUNGEN OK' : `❌ ${fail} Prüfung(en) fehlgeschlagen`);
await b.close();
process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
