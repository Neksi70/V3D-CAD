// Drehrichtung beim Verschieben auf der Rundung: zieht man nach rechts, muss das
// Motiv auf dem Bildschirm nach RECHTS wandern (nicht gegenlaeufig).
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10,10 H90 V90 H10 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
await pg.evaluate((svg) => {
  addShape('tube'); const t = objects[objects.length - 1]; t.scale.set(3, 3, 3); t.position.set(0, 3, 0); t.userData.name = 'Rohr';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 25, name: 'Motiv' });
  t.position.set(0, 3, 0); m.position.set(0, 0.15, 12);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 3, 0); sph.theta = 0; sph.phi = 1.3; sph.r = 40; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const ctrScreen = () => pg.evaluate(() => { const m = objects.find(o => o.userData.shapeType === 'svg');
  const p = _svgCenterWorld(m).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: +(r.left + (p.x * 0.5 + 0.5) * r.width).toFixed(1), y: +(r.top + (-p.y * 0.5 + 0.5) * r.height).toFixed(1) }; });
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
async function drag(from, to, steps = 14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  await pg.mouse.up(); await pg.waitForTimeout(100);
}
// wickeln
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
const c0w = await pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.shapeType === 'svg')).toArray());
await drag(await scr(c0w), await scr([0, 3, 3]));
console.log('gewickelt:', await pg.evaluate(() => !!objects.find(o => o.userData.shapeType === 'svg').userData._svgWrap));
// jetzt: Maus 120 px nach rechts
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const vor = await ctrScreen();
await pg.mouse.move(vor.x, vor.y); await pg.mouse.down();
for (let i = 1; i <= 14; i++) { await pg.mouse.move(vor.x + i * 8, vor.y); await pg.waitForTimeout(20); }
const waehrend = await ctrScreen();
await pg.mouse.up(); await pg.waitForTimeout(100);
const nach = await ctrScreen();
console.log('Maus: +112 px nach rechts');
console.log('Motiv-Mitte auf dem Schirm  vorher', vor, ' während', waehrend, ' danach', nach);
const dx = waehrend.x - vor.x;
console.log(dx > 20 ? '✅ folgt der Maus nach rechts (dx=' + dx.toFixed(0) + ')'
          : (dx < -20 ? '❌ GEGENLÄUFIG (dx=' + dx.toFixed(0) + ')' : '⚠ kaum Bewegung (dx=' + dx.toFixed(0) + ')'));
console.log('errs', errs);
await b.close();
