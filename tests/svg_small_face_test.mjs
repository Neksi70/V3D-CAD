// Motiv groesser als die Flaeche: es muss sich trotzdem frei positionieren lassen
import { chromium } from 'playwright';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,5 H95 V95 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
// kleiner Quader (30 mm), grosses Motiv (40 mm) — passt NICHT drauf
await pg.evaluate((svg) => {
  addShape('box'); const box = objects[objects.length-1]; box.scale.set(1.5,1.5,1.5); box.userData.name='Klein';
  const m = _importSvgConfirm({ svgText: svg, mode:'extrude', depthMM:3, targetMM:40, name:'Motiv' });
  box.position.set(0,1.5,0); m.position.set(0,0.15,10);
  objects.forEach(o=>o.updateMatrixWorld(true));
  orbitTarget.set(0,1.5,0); sph.theta=0; sph.phi=1.2; sph.r=26; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x*0.5+0.5)*r.width, y: r.top + (-p.y*0.5+0.5)*r.height }; }, v);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left+r.width*0.5, y: r.top+r.height*0.95 }; });
const ctrW = () => pg.evaluate(() => _svgCenterWorld(objects.find(o=>o.userData.shapeType==='svg')).toArray());
async function drag(from, to, steps=14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i=1;i<=steps;i++){ await pg.mouse.move(from.x+(to.x-from.x)*i/steps, from.y+(to.y-from.y)*i/steps); await pg.waitForTimeout(18); }
  await pg.mouse.up(); await pg.waitForTimeout(150);
}
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
await drag(await scr(await ctrW()), await scr([0,1.5,1.5]));
const c0 = await ctrW();
console.log('geheftet bei', c0.map(v=>+v.toFixed(2)));
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
await drag(await scr(c0), await scr([-0.8, 2.4, 1.5]));
const c1 = await ctrW();
console.log('nach dem Schieben', c1.map(v=>+v.toFixed(2)));
const bewegt = Math.hypot(c1[0]-c0[0], c1[1]-c0[1]);
console.log(bewegt > 0.3 ? '✅ laesst sich trotz zu kleiner Flaeche positionieren (' + bewegt.toFixed(2) + ')'
                         : '❌ klebt fest (' + bewegt.toFixed(2) + ')');
console.log('errs', errs);
await b.close();
