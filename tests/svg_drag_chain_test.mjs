// Regressionstest: SVG per echtem Maus-Ziehen zwischen Rohr (wickeln) und Quader (heften) hin und her.
// Deckt ab: Kantenlinien-Halo stiehlt den Klick (pickObjects), gewickelte SVG wird beim Heften wieder flach.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
import { execFileSync } from 'node:child_process';
const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10,10 H90 V90 H10 Z M20,65 V85 H45 V65 Z"/></svg>`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
if (process.env.V3D_COOKIE) {   // gegen die dist auf 8765: Sitzungs-Cookie selbst ausstellen
  const sessCookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('smoke','smoke@lokal'))"], { cwd: '/home/v3da', encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sessCookie, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
}
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter(); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
async function drag(from, to) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= 12; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / 12, from.y + (to.y - from.y) * i / 12); await pg.waitForTimeout(25); }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return (h.style.display === 'block' ? h.textContent : '(kein Hinweis)'); });
  await pg.mouse.up(); await pg.waitForTimeout(80); return hint;
}
// Szene: Quader links, Rohr rechts, SVG vorne
await pg.evaluate((svg) => {
  addShape('box'); const box = objects[objects.length - 1]; box.scale.set(3, 3, 3); box.position.set(-8, 3, 0); box.userData.name = 'Quader';
  addShape('tube'); const tube = objects[objects.length - 1]; tube.scale.set(3, 3, 3); tube.position.set(8, 3, 0); tube.userData.name = 'Rohr';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'Motiv' });
  box.position.set(-8, 3, 0); tube.position.set(8, 3, 0); m.position.set(0, 0.15, 12);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 3, 0); sph.theta = 0.3; sph.phi = 0.9; sph.r = 45; sph2cam(); camera.updateMatrixWorld(true);
  selectObjs([]);
}, TEST_SVG);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(300);
const state = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const mb = new THREE.Box3().setFromObject(m); const c = mb.getCenter(new THREE.Vector3()); const sz = mb.getSize(new THREE.Vector3());
  const box = objects.find(o => o.userData.name === 'Quader'), tube = objects.find(o => o.userData.name === 'Rohr');
  const bbB = new THREE.Box3().setFromObject(box);
  // Abstand SVG-Mitte zur Quader-Vorderwand (z) und zur Rohr-Achse (x/z-Radius)
  return { svgCenter: c.toArray().map(v => +v.toFixed(2)), size: sz.toArray().map(v => +v.toFixed(2)), wrap: !!m.userData._svgWrap, snapN: !!m.userData._snapNormal,
    dzBoxFront: +(c.z - bbB.max.z).toFixed(2), rTube: +Math.hypot(c.x - tube.position.x, c.z - tube.position.z).toFixed(2), scale: m.scale.toArray().map(v => +v.toFixed(2)) };
});
const step = async (name, target) => {
  await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);   // abwählen: sonst startet der Zug auf einem Maß-Griff
  const s0 = await state();
  const hint = await drag(await scr(s0.svgCenter), await scr(target));
  const s1 = await state();
  console.log(name.padEnd(34), hint.padEnd(24), JSON.stringify(s1));
};
await step('1. SVG -> Rohr (wickeln)', [8, 3, 3]);
{
  const s0 = await state(); const pt = await scr(s0.svgCenter);
  const dbg = await pg.evaluate((pt) => {
    const hits = pickObjects({ clientX: pt.x, clientY: pt.y });
    const m = objects.find(o => o.userData.shapeType === 'svg');
    const tube = objects.find(o => o.userData.name === 'Rohr');
    return { thr: raycaster.params.Line.threshold, tubeKids: tube.children.map(c => c.type + ':' + (c.geometry.attributes.position.count)), ray: [raycaster.ray.origin.toArray().map(v=>+v.toFixed(1)), raycaster.ray.direction.toArray().map(v=>+v.toFixed(2))],
      sel: selectedObjs.map(o => o.userData.name), hits: hits.slice(0, 12).map(h => (h.object.userData.name || h.object.type) + (h.object.parent && h.object.parent.userData && h.object.parent.userData.name ? '<' + h.object.parent.userData.name : '') + '@' + h.distance.toFixed(2) + '=' + h.point.toArray().map(v=>+v.toFixed(1))),
      svgPos: m.position.toArray().map(v => +v.toFixed(2)), el: (document.elementFromPoint(pt.x, pt.y) || {}).id || (document.elementFromPoint(pt.x, pt.y) || {}).className };
  }, pt);
  console.log('   debug vor Schritt 2:', JSON.stringify(dbg));
}
await step('2. gewickelte SVG -> Quader', [-8, 3, 3]);
await step('3. SVG -> Rohr erneut', [8, 3, 3]);
await step('4. SVG -> Quader Oberseite', [-8, 6, 0]);
await step('5. SVG -> Rohr erneut', [8, 3, 3]);
console.log('errs', errs);
await b.close();
