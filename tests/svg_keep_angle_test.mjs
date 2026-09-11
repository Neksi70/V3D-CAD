// Josy 11.9.26: "ich drehe sie gerade — und wenn ich sie dann verschieben will,
// legt sie sich wieder hin / fällt wieder um."
// Prueft, ob die in der Flaeche gesetzte Drehung erhalten bleibt, auch wenn das
// Motiv zwischendurch geloest und neu aufgesetzt wird.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,42 H95 V58 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

await pg.evaluate((svg) => {
  addShape('box'); const box = objects[objects.length - 1]; box.scale.set(4, 4, 2); box.userData.name = 'Quader';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'Motiv' });
  box.position.set(0, 4, 0); m.position.set(0, 0.15, 14);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 4, 0); sph.theta = 0; sph.phi = 1.25; sph.r = 44; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
const griff = (minD = 0) => pg.evaluate((minD) => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const c = _svgCenterWorld(m).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  const bx = r.left + (c.x * 0.5 + 0.5) * r.width, by = r.top + (-c.y * 0.5 + 0.5) * r.height;
  for (let d = minD; d <= 60; d += 3) for (const [ox, oy] of [[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,-d],[d,-d],[-d,d]]) {
    const hits = pickObjects({ clientX: bx + ox, clientY: by + oy });
    if (!hits.length) continue;
    let p = hits[0].object; while (p && !objects.includes(p)) p = p.parent;
    if (p === m) return { x: bx + ox, y: by + oy, cx: bx, cy: by };
  }
  return null;
}, minD);
async function drag(from, to, steps = 14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return h.style.display === 'block' ? h.textContent : '(kein Hinweis)'; });
  await pg.mouse.up(); await pg.waitForTimeout(160);
  return hint;
}
const ctrW = () => pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.shapeType === 'svg')).toArray());
// Winkel des Motivs IN der Wandebene (0 = waagerechter Balken) + Anlage
const lage = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const box = objects.find(o => o.userData.name === 'Quader');
  m.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(box);
  const c = _svgCenterWorld(m);
  const oben = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quaternion).normalize();  // Motiv-oben
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion).normalize();
  return { winkel: +(Math.atan2(oben.x, oben.y) * 180 / Math.PI).toFixed(1),
           dzWand: +(c.z - bb.max.z).toFixed(2), nZ: +n.z.toFixed(2),
           x: +c.x.toFixed(2), y: +c.y.toFixed(2) };
});

await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
await drag(await scr(await ctrW()), await scr([0, 4, 2]));
const l0 = await lage();
console.log('1. geheftet:', JSON.stringify(l0));
ok('liegt auf der Wand', Math.abs(l0.dzWand) < 0.02 && Math.abs(l0.nZ - 1) < 0.02, l0);

// 2) im Dreh-Modus 30° drehen
const g1 = await griff(0);
await pg.evaluate(() => setMode('rotate')); await pg.waitForTimeout(150);
await pg.mouse.move(g1.x, g1.y); await pg.mouse.down();
await pg.mouse.move(g1.cx + 70, g1.cy); await pg.waitForTimeout(30);
for (let i = 1; i <= 10; i++) { const a = (i / 10) * 30 * Math.PI / 180;
  await pg.mouse.move(g1.cx + Math.cos(a) * 70, g1.cy + Math.sin(a) * 70); await pg.waitForTimeout(20); }
await pg.mouse.up(); await pg.waitForTimeout(200);
const l1 = await lage();
console.log('2. gedreht:', JSON.stringify(l1));
ok('Motiv ist jetzt schräg (≈30°)', Math.abs(Math.abs(l1.winkel - l0.winkel) - 30) < 8, { vorher: l0.winkel, nachher: l1.winkel });

// 3) verschieben (Gleiten)
await pg.evaluate(() => setMode('move')); await pg.waitForTimeout(150);
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const g2 = await griff(0);
await drag(g2, { x: g2.x - 50, y: g2.y - 40 });
const l2 = await lage();
console.log('3. verschoben:', JSON.stringify(l2));
ok('Drehung bleibt beim Verschieben', Math.abs(l2.winkel - l1.winkel) < 3, { vorher: l1.winkel, nachher: l2.winkel });

// 4) weit wegziehen (löst sich) und wieder auf die Wand legen
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const g3 = await griff(0);
await drag(g3, await scr([9, 9, 2]), 16);
const lOff = await lage();
console.log('4. abgenommen:', JSON.stringify(lOff));
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
await drag(await scr(await ctrW()), await scr([0, 4, 2]));
const l4 = await lage();
console.log('5. wieder aufgelegt:', JSON.stringify(l4));
ok('liegt wieder sauber auf der Wand', Math.abs(l4.dzWand) < 0.02, l4);
ok('Drehung ist auch nach dem Wiederauflegen da', Math.abs(l4.winkel - l1.winkel) < 5, { vorher: l1.winkel, nachher: l4.winkel });
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
