// Regressionstest: geheftetes SVG auf der Fläche verschieben ("Gleiten").
// Deckt ab: freies Positionieren in der Fläche, Randstopp, Mitten-Magnet,
// Zentrier-Knopf, Gleiten auf der Rundung (Winkel + Höhe).
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10,10 H90 V90 H10 Z M20,65 V85 H45 V65 Z"/></svg>`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter(); document.getElementById('auth-overlay')?.classList.add('hidden'); });

const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
async function drag(from, to, steps = 12) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return (h.style.display === 'block' ? h.textContent : '(kein Hinweis)'); });
  await pg.mouse.up(); await pg.waitForTimeout(80); return hint;
}
// Szene: Quader (60mm) vorne, Rohr rechts, SVG davor
await pg.evaluate((svg) => {
  addShape('box'); const box = objects[objects.length - 1]; box.scale.set(3, 3, 3); box.position.set(-8, 3, 0); box.userData.name = 'Quader';
  addShape('tube'); const tube = objects[objects.length - 1]; tube.scale.set(3, 3, 3); tube.position.set(8, 3, 0); tube.userData.name = 'Rohr';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 20, name: 'Motiv' });
  box.position.set(-8, 3, 0); tube.position.set(8, 3, 0); m.position.set(-8, 0.15, 12);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 3, 0); sph.theta = 0.0; sph.phi = 1.15; sph.r = 45; sph2cam(); camera.updateMatrixWorld(true);
  selectObjs([]);
}, TEST_SVG);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
const state = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const box = objects.find(o => o.userData.name === 'Quader');
  const bb = new THREE.Box3().setFromObject(box);
  const c = _svgCenterWorld(m);
  return { c: c.toArray().map(v => +v.toFixed(2)), wrap: !!m.userData._svgWrap, snapped: !!m.userData._snapNormal,
           dzFront: +(c.z - bb.max.z).toFixed(3),                       // Abstand zur Wand (soll konstant bleiben)
           offX: +(c.x - box.position.x).toFixed(2), offY: +(c.y - box.position.y).toFixed(2),
           inFace: c.x > bb.min.x && c.x < bb.max.x && c.y > bb.min.y && c.y < bb.max.y,
           btn: document.getElementById('ctx-svgcenter')?.style.display !== 'none' };
});
const line = (n, h, s) => console.log(n.padEnd(30), String(h).padEnd(26), JSON.stringify(s));
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('   ✗ ' + msg); } };

// 1) Heften: landet mittig auf der Vorderwand
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
let s = await state();
let h = await drag(await scr(s.c), await scr([-8, 3, 3]));
s = await state(); line('1. heften (zentriert)', h, s);
check(s.snapped && Math.abs(s.offX) < 0.05 && Math.abs(s.offY) < 0.05, 'nicht mittig geheftet');
const dz0 = s.dzFront;

// 2) in der Fläche verschieben — nach links oben
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
h = await drag(await scr(s.c), await scr([-9.6, 4.4, 3]));
s = await state(); line('2. in der Fläche schieben', h, s);
check(s.offX < -1.0 && s.offY > 0.9, 'ist nicht in der Fläche mitgewandert');
check(Math.abs(s.dzFront - dz0) < 0.01, 'hat den Wandabstand verändert');
check(s.inFace, 'aus der Fläche gerutscht');
// der für den Gravur-Cut gespeicherte Oberflächenpunkt muss mitgewandert sein
const sp = await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const box = objects.find(o => o.userData.name === 'Quader');
  const bb = new THREE.Box3().setFromObject(box);
  const w = m.localToWorld(m.userData._snapSurfaceLocal.clone());
  const c = _svgCenterWorld(m);
  return { dz: +(w.z - bb.max.z).toFixed(3), dxy: +Math.hypot(w.x - c.x, w.y - c.y).toFixed(3) };
});
console.log('   Oberflächenpunkt fürs Gravieren:', JSON.stringify(sp));
check(Math.abs(sp.dz) < 0.01 && sp.dxy < 0.01, 'Gravur-Ankerpunkt sitzt nicht mehr unter dem Motiv');

// 3) Randstopp: weit über die Kante hinausziehen
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
h = await drag(await scr(s.c), await scr([-30, 20, 3]), 18);
s = await state(); line('3. über die Kante ziehen', h, s);
check(s.inFace, 'über die Flächenkante hinausgewandert');
check(Math.abs(s.dzFront - dz0) < 0.01, 'Wandabstand verändert');

// 4) Zentrier-Knopf
check(s.btn, 'Zentrier-Knopf nicht sichtbar');
await pg.evaluate(() => svgCenterOnFace());
s = await state(); line('4. Zentrier-Knopf', '⊕', s);
check(Math.abs(s.offX) < 0.05 && Math.abs(s.offY) < 0.05, 'nicht zentriert');

// 5) Mitten-Magnet: aus der Mitte heraus und knapp zurück
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
await drag(await scr(s.c), await scr([-9.5, 3, 3]));
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);   // abwählen: sonst greift der Maß-Anfasser
s = await state();
h = await drag(await scr(s.c), await scr([-8.06, 3.04, 3]));
s = await state(); line('5. Mitten-Magnet', h, s);
check(Math.abs(s.offX) < 0.01 && Math.abs(s.offY) < 0.01, 'Mitte nicht eingerastet');

// 6) Rundung: wickeln, dann drehen + höher schieben
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
h = await drag(await scr(s.c), await scr([8, 3, 3]));
s = await state(); line('6. auf das Rohr wickeln', h, s);
check(s.wrap, 'nicht gewickelt');
const w0 = await pg.evaluate(() => { const m = objects.find(o => o.userData.shapeType === 'svg');
  return { y: +m.position.y.toFixed(3), q: m.quaternion.toArray().map(v => +v.toFixed(3)) }; });
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
h = await drag(await scr(s.c), await scr([6.5, 5.0, 2.2]));
const w1 = await pg.evaluate(() => { const m = objects.find(o => o.userData.shapeType === 'svg');
  const tube = objects.find(o => o.userData.name === 'Rohr'); const bb = new THREE.Box3().setFromObject(tube);
  const c = _svgCenterWorld(m);
  return { y: +m.position.y.toFixed(3), q: m.quaternion.toArray().map(v => +v.toFixed(3)), wrap: !!m.userData._svgWrap,
           r: +Math.hypot(c.x - tube.position.x, c.z - tube.position.z).toFixed(2),
           inH: c.y > bb.min.y && c.y < bb.max.y }; });
line('7. auf der Rundung gleiten', h, w1);
check(w1.wrap, 'Wicklung verloren');
check(Math.abs(w1.y - w0.y) > 0.15, 'Höhe hat sich nicht geändert');
check(JSON.stringify(w1.q) !== JSON.stringify(w0.q), 'Winkel hat sich nicht geändert');
check(w1.inH, 'über das Rohr-Ende hinausgewandert');
check(Math.abs(w1.r - 2.69) < 0.35, 'liegt nicht mehr an der Wand an (r=' + w1.r + ')');

// 8) Zentrieren auf der Rundung
await pg.evaluate(() => svgCenterOnFace());
const w2 = await pg.evaluate(() => { const m = objects.find(o => o.userData.shapeType === 'svg');
  const tube = objects.find(o => o.userData.name === 'Rohr'); const bb = new THREE.Box3().setFromObject(tube);
  return { y: +m.position.y.toFixed(2), mid: +((bb.min.y + bb.max.y) / 2).toFixed(2) }; });
line('8. Zentrieren auf Rundung', '⊕', w2);
check(Math.abs(w2.y - w2.mid) < 0.05, 'nicht auf halber Höhe');

console.log('errs', errs);
console.log(fail === 0 && errs.length === 0 ? '✅ ALLE PRÜFUNGEN OK' : `❌ ${fail} Prüfung(en) fehlgeschlagen`);
await b.close();
process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
