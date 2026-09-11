// Josy 11.9.26: "ich drehe ihn, wo ich ihn hin haben will — wenn ich ihn dann
// rausziehe, dreht er sich wieder und die Form veraendert sich auch."
// Prueft: gewickeltes Motiv drehen, dann verschieben → Drehung UND Anlage an der Wand.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
// schmaler, breiter Balken: waagerecht = flach, gedreht = hoch
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
  addShape('tube'); const t = objects[objects.length - 1]; t.scale.set(3, 6, 3); t.userData.name = 'Stamm';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 25, name: 'Motiv' });
  t.position.set(0, 6, 0); m.position.set(0, 0.15, 14);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 5, 0); sph.theta = 0; sph.phi = 1.2; sph.r = 46; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
async function drag(from, to, steps = 14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return h.style.display === 'block' ? h.textContent : '(kein Hinweis)'; });
  await pg.mouse.up(); await pg.waitForTimeout(160);
  return hint;
}
const ctrW = () => pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.shapeType === 'svg')).toArray());
const griff = (minD = 0) => pg.evaluate((minD) => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const c = _svgCenterWorld(m).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  const bx = r.left + (c.x * 0.5 + 0.5) * r.width, by = r.top + (-c.y * 0.5 + 0.5) * r.height;
  // Mindestabstand zum Zentrum: genau in der Mitte anzufassen macht den Drehwinkel beliebig
  for (let d = minD; d <= 60; d += 3) for (const [ox, oy] of [[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,-d],[d,-d],[-d,d],[d*0.5,d],[d,d*0.5],[-d*0.5,-d],[-d,-d*0.5]]) {
    const hits = pickObjects({ clientX: bx + ox, clientY: by + oy });
    if (!hits.length) continue;
    let p = hits[0].object; while (p && !objects.includes(p)) p = p.parent;
    if (p === m) return { x: bx + ox, y: by + oy, cx: bx, cy: by };
  }
  return null;
}, minD);
// Kippung gegen die Stammachse + wie gut das Motiv an der Wand liegt
const lage = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const t = objects.find(o => o.userData.name === 'Stamm');
  m.updateMatrixWorld(true);
  // Drehung an der Ausdehnung ablesen: der Balken ist quer 90 und hoch 15 —
  // gedreht wächst seine Ausdehnung ENTLANG der Stammachse.
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  const c = _svgCenterWorld(m);
  const achse = new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3(c.x - t.position.x, 0, c.z - t.position.z).normalize();
  const rechts = new THREE.Vector3().crossVectors(achse, e1);   // Betrachter-rechts
  let rMin = Infinity, rMax = -Infinity, hMin = Infinity, hMax = -Infinity;
  let obersterRechts = 0, obersterH = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const r = Math.hypot(v.x - t.position.x, v.z - t.position.z);
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    const d = v.clone().sub(c);
    const h = d.dot(achse);
    if (h < hMin) hMin = h; if (h > hMax) hMax = h;
    if (h > obersterH) { obersterH = h; obersterRechts = d.dot(rechts); }
  }
  const kipp = +((hMax - hMin) * 10).toFixed(1);          // Höhe des Motivs in mm
  const obenNach = +obersterRechts.toFixed(2);            // >0: oberes Ende rechts
  // Wand liegt bei 30 mm (Rohr Ø60): aussen soll 0,2 mm ueberstehen, innen ~3 mm tief
  return { hoeheMM: kipp, obenNach, rotGrad: +((m.userData._svgWrap?.rotRad || 0) * 180 / Math.PI).toFixed(1),
           kipp, wrap: !!m.userData._svgWrap,
           ueberstandMM: +((rMax - 3) * 10).toFixed(2), tiefeMM: +((3 - rMin) * 10).toFixed(2),
           y: +m.position.y.toFixed(2) };
});

await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
await drag(await scr(await ctrW()), await scr([0, 6, 3]));
const l0 = await lage();
console.log('1. gewickelt:', JSON.stringify(l0));
ok('gewickelt und liegt an', l0.wrap && Math.abs(l0.ueberstandMM - 0.2) < 0.5, l0);

// 2) im Dreh-Modus schraeg stellen
const g1 = (await griff(0));
await pg.evaluate(() => setMode('rotate')); await pg.waitForTimeout(150);
ok('gewickeltes Motiv ist greifbar', !!g1, g1);
// exakt 30° im Uhrzeigersinn ziehen: erst auf Radius 60 px heraus (setzt den
// Bezugswinkel), dann im Bogen wandern
const h1 = await (async () => {
  await pg.mouse.move(g1.x, g1.y); await pg.mouse.down();
  await pg.mouse.move(g1.cx + 60, g1.cy); await pg.waitForTimeout(30);
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * 30 * Math.PI / 180;
    await pg.mouse.move(g1.cx + Math.cos(a) * 60, g1.cy + Math.sin(a) * 60);
    await pg.waitForTimeout(20);
  }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return h.style.display === 'block' ? h.textContent : '(kein Hinweis)'; });
  await pg.mouse.up(); await pg.waitForTimeout(200);
  return hint;
})();
const l1 = await lage();
console.log('2. gedreht:', h1, JSON.stringify(l1));
ok('Motiv steht jetzt schräg (Höhe wächst)', l1.hoeheMM > l0.hoeheMM * 2, { vorherMM: l0.hoeheMM, nachherMM: l1.hoeheMM, rotGrad: l1.rotGrad });
ok('dreht in die gezogene Richtung (im Uhrzeigersinn → oberes Ende nach links)',
   l1.obenNach < 0, { obenNach: l1.obenNach, rotGrad: l1.rotGrad });
ok('liegt nach dem Drehen weiter an der Wand', Math.abs(l1.ueberstandMM - 0.2) < 0.8, l1);

// 3) jetzt verschieben (Josys "rausziehen")
await pg.evaluate(() => setMode('move')); await pg.waitForTimeout(150);
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const g2 = (await griff(0)) || (await scr(await ctrW()));
const h2 = await drag(g2, { x: g2.x - 60, y: g2.y - 70 });
const l2 = await lage();
console.log('3. verschoben:', h2, JSON.stringify(l2));
ok('Drehung bleibt beim Verschieben stehen', Math.abs(l2.hoeheMM - l1.hoeheMM) < 3, { vorher: l1.hoeheMM, nachher: l2.hoeheMM });
ok('Form bleibt korrekt an der Wand', l2.wrap && Math.abs(l2.ueberstandMM - 0.2) < 0.8, l2);
ok('hat sich wirklich bewegt', Math.abs(l2.y - l1.y) > 0.2, { vorher: l1.y, nachher: l2.y });
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
