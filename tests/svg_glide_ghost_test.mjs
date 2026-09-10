// Josy 10.9.26 (4. Meldung): "kann ihn gar nicht mehr frei verschieben, nur noch
// mit dem Pfeil — ich kriege ihn nicht mehr auf meine Figur."
// Verdacht: das Gleiten startet auf einer nur noch GEMERKTEN Flaeche (_snapNormal
// ueberlebt, der Koerper ist aber weg/weit weg) und haelt das Motiv dort fest.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10,10 H90 V90 H10 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

await pg.evaluate((svg) => {
  addShape('tube'); const t = objects[objects.length - 1]; t.scale.set(3, 3, 3); t.userData.name = 'Figur';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 25, name: 'Motiv' });
  t.position.set(8, 3, 0); m.position.set(-9, 0.15, 12);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 3, 0); sph.theta = 0; sph.phi = 1.15; sph.r = 50; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
async function drag(from, to, steps = 14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return h.style.display === 'block' ? h.textContent : '(kein Hinweis)'; });
  await pg.mouse.up(); await pg.waitForTimeout(150);
  return hint;
}
const ctrW = () => pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.shapeType === 'svg')).toArray());
const zustand = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  return { wrap: !!m.userData._svgWrap, snapN: !!m.userData._snapNormal, snapSolid: !!m.userData._snapSolid,
           c: _svgCenterWorld(m).toArray().map(v => +v.toFixed(2)) };
});

// So sieht ein Motiv aus, das schon einmal an einer Wand hing bzw. bei dem der
// Gravur-Weg die Normale abgeleitet hat (_autoSnapSvgToSolid setzt genau das):
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  m.userData._snapNormal = new THREE.Vector3(0, 0, 1);
  m.userData._snapSurfaceLocal = new THREE.Vector3(0, 0, 0);
  m.updateMatrixWorld(true);
});
console.log('Ausgangslage:', JSON.stringify(await zustand()));

// jetzt mit der Maus auf die Figur ziehen
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
const h = await drag(await scr(await ctrW()), await scr([8, 3, 3]));
const z = await zustand();
console.log('auf die Figur gezogen:', h, JSON.stringify(z));
ok('Motiv kommt auf der Figur an', z.wrap || (z.snapSolid && Math.abs(z.c[0] - 8) < 2), z);
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
