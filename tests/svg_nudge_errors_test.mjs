// Josy 11.9.26: "das ist, weil ich die Pfeiltasten benutzt habe — jetzt spinnt er,
// jetzt kann ich gar nichts mehr machen, auch nicht mehr versetzen."
// Sucht JS-Fehler auf den Versetzen-Wegen und prueft, ob das Motiv aufgesetzt bleibt.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,42 H95 V58 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
const konsole = []; pg.on('console', m => { if (m.type() === 'error') konsole.push(m.text().slice(0, 200)); });
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// Szene: Quader (flach heften) + Rohr (wickeln)
await pg.evaluate((svg) => {
  addShape('box'); const box = objects[objects.length - 1]; box.scale.set(4, 4, 2); box.userData.name = 'Quader';
  addShape('tube'); const t = objects[objects.length - 1]; t.scale.set(3, 4, 3); t.userData.name = 'Rohr';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'Motiv' });
  box.position.set(-9, 4, 0); t.position.set(9, 4, 0); m.position.set(0, 0.15, 14);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 4, 0); sph.theta = 0; sph.phi = 1.2; sph.r = 52; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
async function drag(from, to, steps = 14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(18); }
  await pg.mouse.up(); await pg.waitForTimeout(150);
}
const ctrW = () => pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.shapeType === 'svg')).toArray());
const stand = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const box = objects.find(o => o.userData.name === 'Quader');
  const t = objects.find(o => o.userData.name === 'Rohr');
  m.updateMatrixWorld(true);
  const c = _svgCenterWorld(m);
  const bb = new THREE.Box3().setFromObject(box);
  return { wrap: !!m.userData._svgWrap, dzWand: +(c.z - bb.max.z).toFixed(2),
           rRohr: +Math.hypot(c.x - t.position.x, c.z - t.position.z).toFixed(2),
           c: c.toArray().map(v => +v.toFixed(2)) };
});

// A) flach auf den Quader heften, dann mit "exakt versetzen" schieben
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
await drag(await scr(await ctrW()), await scr([-9, 4, 2]));
const a0 = await stand();
ok('auf den Quader geheftet', Math.abs(a0.dzWand) < 0.02, a0);
for (let i = 0; i < 4; i++) { await pg.evaluate(() => _nudgeMove('y', 1)); await pg.waitForTimeout(50); }
for (let i = 0; i < 3; i++) { await pg.evaluate(() => _nudgeMove('x', 1)); await pg.waitForTimeout(50); }
await pg.waitForTimeout(400);
const a1 = await stand();
console.log('A) nach ▲▲▲▲ ▶▶▶:', JSON.stringify(a1));
ok('keine JS-Fehler beim Versetzen (flach)', errs.length === 0, errs.slice(0, 3));
ok('klebt weiter an der Wand (steht nicht ab)', Math.abs(a1.dzWand) < 0.02, a1);

// B) auf das Rohr wickeln, dann versetzen
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
await drag(await scr(await ctrW()), await scr([9, 4, 3]));
const b0 = await stand();
ok('auf das Rohr gewickelt', b0.wrap, b0);
for (let i = 0; i < 5; i++) { await pg.evaluate(() => _nudgeMove('y', 1)); await pg.waitForTimeout(50); }
for (let i = 0; i < 3; i++) { await pg.evaluate(() => _nudgeMove('x', -1)); await pg.waitForTimeout(50); }
await pg.waitForTimeout(400);
const b1 = await stand();
console.log('B) nach dem Versetzen:', JSON.stringify(b1));
ok('keine JS-Fehler beim Versetzen (gewickelt)', errs.length === 0, errs.slice(0, 3));

// C) geht danach noch alles? Motiv mit der Maus verschieben
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const vor = await ctrW();
await drag(await scr(vor), { x: (await scr(vor)).x - 70, y: (await scr(vor)).y - 50 });
const c1 = await stand();
console.log('C) danach verschoben:', JSON.stringify(c1));
ok('lässt sich danach noch mit der Maus bewegen',
   Math.hypot(c1.c[0] - vor[0], c1.c[1] - vor[1], c1.c[2] - vor[2]) > 0.3, { vorher: vor, nachher: c1.c });
ok('keine JS-Fehler insgesamt', errs.length === 0 && konsole.length === 0, { pageerrors: errs.slice(0, 3), konsole: konsole.slice(0, 3) });
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
