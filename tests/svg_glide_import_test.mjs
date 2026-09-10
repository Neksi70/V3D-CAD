// Reproduktion Josy (10.9.26): Motiv laesst sich auf HOCHGELADENEN STLs nicht
// auf der Flaeche verschieben, auf eigenen Koerpern schon.
// Baut Import-Meshes so, wie sie aus einer STL kommen (Geometrie in mm, scale 0.1).
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10,10 H90 V90 H10 Z"/></svg>`;
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
  const glide = [];
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20);
    glide.push(await pg.evaluate(() => !!_svgGlide)); }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return (h.style.display === 'block' ? h.textContent : '(kein Hinweis)'); });
  await pg.mouse.up(); await pg.waitForTimeout(80);
  return { hint, glideAnteil: glide.filter(Boolean).length + '/' + glide.length };
}
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('   ✗ ' + msg); } else console.log('   ✓ ' + msg); };

// Szene: importierter Quader (60mm), importierter konischer Becher, SVG davor
await pg.evaluate((svg) => {
  const box = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 60), new THREE.MeshStandardMaterial({ color: 0x88a }));
  box.scale.set(0.1, 0.1, 0.1); box.position.set(-8, 3, 0);
  box.userData = { id: idCtr++, name: 'ImportQuader', type: 'import', shapeType: 'import', color: '#8888aa' };
  scene.add(box); objects.push(box);
  // Becher: unten Ø40, oben Ø70, 80 hoch — genau Josys Fall
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(35, 20, 80, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a8 }));
  cup.scale.set(0.1, 0.1, 0.1); cup.position.set(8, 4, 0);
  cup.userData = { id: idCtr++, name: 'ImportBecher', type: 'import', shapeType: 'import', color: '#88aa88' };
  scene.add(cup); objects.push(cup);
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 20, name: 'Motiv' });
  m.position.set(-8, 0.15, 12);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 3, 0); sph.theta = 0.0; sph.phi = 1.15; sph.r = 45; sph2cam(); camera.updateMatrixWorld(true);
  selectObjs([]);
}, SVG);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
const st = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const c = _svgCenterWorld(m);
  return { c: c.toArray().map(v => +v.toFixed(2)), wrap: !!m.userData._svgWrap, snapped: !!m.userData._snapNormal,
           y: +m.position.y.toFixed(2), q: m.quaternion.toArray().map(v => +v.toFixed(3)) };
});

// A) Import-Quader: heften, dann in der Flaeche schieben
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
let s = await st();
let r = await drag(await scr(s.c), await scr([-8, 3, 3]));
s = await st(); console.log('A1 heften        ', r.hint, r.glideAnteil, JSON.stringify(s));
check(s.snapped, 'auf den Import-Quader geheftet');
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const a0 = (await st()).c;
r = await drag(await scr(a0), await scr([-9.6, 4.4, 3]));
s = await st(); console.log('A2 verschieben   ', r.hint, r.glideAnteil, JSON.stringify(s));
check(Math.abs(s.c[0] - a0[0]) > 1.0 && Math.abs(s.c[1] - a0[1]) > 0.9, 'auf dem Import-Quader verschiebbar');
check(Math.abs(s.c[2] - a0[2]) < 0.02, 'bleibt auf der Wand (z unveraendert)');

// B) Import-Becher (konisch): wickeln, dann drehen + in der Hoehe schieben
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
s = await st();
r = await drag(await scr(s.c), await scr([8, 4, 3]));
s = await st(); console.log('B1 wickeln       ', r.hint, r.glideAnteil, JSON.stringify(s));
check(s.wrap, 'auf den Import-Becher gewickelt');
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const b0 = await st();
r = await drag(await scr(b0.c), await scr([6.6, 5.8, 2.2]));
const b1 = await st(); console.log('B2 gleiten       ', r.hint, r.glideAnteil, JSON.stringify(b1));
check(b1.wrap, 'bleibt gewickelt');
check(Math.abs(b1.y - b0.y) > 0.15, 'Hoehe auf dem Becher veraenderbar');
check(JSON.stringify(b1.q) !== JSON.stringify(b0.q), 'Winkel auf dem Becher veraenderbar');

console.log('errs', errs);
console.log(fail === 0 && errs.length === 0 ? '✅ OK' : `❌ ${fail} Prüfung(en) fehlgeschlagen`);
await b.close();
process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
