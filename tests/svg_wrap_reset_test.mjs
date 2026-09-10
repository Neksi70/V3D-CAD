// Josy 10.9.26 (3. Meldung): Motiv einmal gewickelt, wieder heruntergenommen —
// es bleibt gebogen. Legt man es erneut auf, hat es die Rundung vom ersten Mal
// und "steht ab".
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

// duennes Rohr (Ø60) und ein DICKES (Ø120) — die Rundung unterscheidet sich klar
await pg.evaluate((svg) => {
  addShape('tube'); const t1 = objects[objects.length - 1]; t1.scale.set(3, 3, 3); t1.userData.name = 'RohrDuenn';
  addShape('tube'); const t2 = objects[objects.length - 1]; t2.scale.set(6, 3, 6); t2.userData.name = 'RohrDick';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 25, name: 'Motiv' });
  t1.position.set(-9, 3, 0); t2.position.set(10, 3, 0); m.position.set(0, 0.15, 14);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 3, 0); sph.theta = 0; sph.phi = 1.15; sph.r = 52; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
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
// Wie krumm ist das Motiv? Pfeilhoehe der Aussenflaeche ueber die Breite (in mm).
// 0 = flach; je enger die Rundung, desto groesser.
const kruemmung = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  m.updateMatrixWorld(true);
  const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  return { spanX: +((bb.max.x - bb.min.x) * Math.abs(m.scale.x) * 10).toFixed(1),
           gewickelt: !!m.userData._svgWrap,
           R: m.userData._svgWrap ? +(m.userData._svgWrap.R * 10).toFixed(1) : null };
});
// Sitzt das Motiv sauber auf dem Rohr? groesster Abstand der Aussenflaeche zur Wand (mm)
const sitz = (rohr) => pg.evaluate((rohrName) => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const t = objects.find(o => o.userData.name === rohrName);
  m.updateMatrixWorld(true); t.updateMatrixWorld(true);
  const bbT = new THREE.Box3().setFromObject(t);
  const R = (bbT.max.x - bbT.min.x) / 2;                       // Aussenradius
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  let max = -Infinity, min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const d = Math.hypot(v.x - t.position.x, v.z - t.position.z) - R;
    if (d > max) max = d; if (d < min) min = d;
  }
  return { ueberstandMM: +(max * 10).toFixed(2), tiefsteMM: +(min * 10).toFixed(2) };
}, rohr);

// 1) auf das DÜNNE Rohr wickeln
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
let h = await drag(await scr(await ctrW()), await scr([-9, 3, 3]));
console.log('1. auf dünnes Rohr:', h, JSON.stringify(await kruemmung()), JSON.stringify(await sitz('RohrDuenn')));
ok('auf dem dünnen Rohr gewickelt', (await kruemmung()).gewickelt);

// 2) wieder herunternehmen — ins Leere ziehen
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
h = await drag(await scr(await ctrW()), { x: cr.x, y: cr.y - 210 });
const k2 = await kruemmung();
console.log('2. heruntergenommen:', h, JSON.stringify(k2));
ok('liegt wieder flach vor (nicht mehr gebogen)', !k2.gewickelt, k2);

// 3) erneut auflegen — jetzt auf das DICKE Rohr
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
h = await drag(await scr(await ctrW()), await scr([10, 3, 6]));
const k3 = await kruemmung(); const s3 = await sitz('RohrDick');
console.log('3. auf dickes Rohr:', h, JSON.stringify(k3), JSON.stringify(s3));
ok('nimmt die Rundung des NEUEN Körpers an', k3.gewickelt && k3.R > 45, k3);
ok('liegt an, statt abzustehen (Überstand ≈ 0,2 mm)', Math.abs(s3.ueberstandMM - 0.2) < 0.8, s3);
// 4+5) Josys Fall: herunternehmen und auf DENSELBEN Körper zurücklegen
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
h = await drag(await scr(await ctrW()), { x: cr.x, y: cr.y - 230 });
const k4 = await kruemmung();
console.log('4. wieder herunter:', h, JSON.stringify(k4));
ok('vom dicken Rohr heruntergenommen → flach', !k4.gewickelt, k4);

await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
h = await drag(await scr(await ctrW()), await scr([10, 3, 6]));
const k5 = await kruemmung(); const s5 = await sitz('RohrDick');
console.log('5. zurück auf dasselbe Rohr:', h, JSON.stringify(k5), JSON.stringify(s5));
ok('nimmt die Rundung erneut an', k5.gewickelt && k5.R > 45, k5);
ok('liegt wieder an (kein Abstehen)', Math.abs(s5.ueberstandMM - 0.2) < 0.8, s5);

console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
