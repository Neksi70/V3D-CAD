// Josy 14.9.26 (Kugelschale): "Er macht es immer noch. Entweder wenn man's nach oben
// schiebt oder nach unten schiebt." Beim Gleiten hielt _svgGlideEscaped die obere
// Kugelhaelfte fuer einen Deckel (|n·Achse| > 0,7) und brach das Gleiten ab; danach
// freier Zug + chaotisches Neu-Heften (gemessen: R 49,7 statt 30 mm, 78 % abstehend
// bis 10,8 mm). Und das Loslassen mass immer mit der alten senkrechten Achse nach.
// Jetzt: kugelige Koerper brechen nicht aus, beim Loslassen waehlt _svgWrapNachwickeln
// die Achse neu (oben/unten quer) und wickelt bei Achswechsel neu, aufrecht.
// Echter Mauszug: Motiv auf die Kugel, dann 4x hoch und 5x runter.
import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="47" y="15" width="6" height="80" transform="rotate(12 50 50)"/><rect x="20" y="5" width="60" height="10"/><rect x="25" y="45" width="30" height="5" transform="rotate(-35 40 47)"/></svg>`;
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
await pg.evaluate((svg) => {
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 25, name: 'Zweig' });
  addShape('sphericalshell'); const k = objects.find(o => o !== m); k.userData.name = 'Kugel';
  k.scale.set(5, 5, 5); k.position.set(0, 5, 0); k.updateMatrixWorld(true);
  m.position.set(-9, 0.15, 9); m.updateMatrixWorld(true);
  window._M = () => objects.find(o => o.userData.shapeType === 'svg'); window._K = () => objects.find(o => o.userData.name === 'Kugel');
  orbitTarget.set(0, 5, 0); sph.theta = 0.0; sph.phi = 1.35; sph.r = 34; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
async function drag(from, to, steps = 14) {
  const hints = new Set(); let sel = null;
  await pg.mouse.move(from.x, from.y); await pg.mouse.down(); await pg.waitForTimeout(30);
  sel = await pg.evaluate(() => ({ sel: selectedObjs.map(o => o.userData.name), glide: typeof _svgGlide !== 'undefined' && _svgGlide ? _svgGlide.kind : null }));
  for (let i = 1; i <= steps; i++) {
    await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(25);
    hints.add(await pg.evaluate(() => { const g = document.getElementById('svg-glide-hint'); const h = document.getElementById('text-snap-hint'); return (g && g.style.display !== 'none' ? g.textContent.slice(0, 22) : '') + '|' + (h && h.style.display === 'block' ? h.textContent.slice(0, 22) : ''); }));
  }
  const glideEnde = await pg.evaluate(() => typeof _svgGlide !== 'undefined' && _svgGlide ? _svgGlide.kind : null);
  await pg.mouse.up(); await pg.waitForTimeout(250);
  return { sel, glideVorLoslassen: glideEnde, hints: [...hints].slice(0, 4) };
}
const zustand = (tag) => pg.evaluate(async (tag) => {
  const m = _M(), k = _K(); m.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(k); const C = bb.getCenter(new THREE.Vector3()); const Rk = (bb.max.x - bb.min.x) / 2;
  const w = m.userData._svgWrap;
  const pos = m.geometry.attributes.position, idx = m.geometry.index; const nTri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), cen = new THREE.Vector3();
  let n = 0, sunk = 0, frei = 0, dMin = Infinity, dMax = -Infinity;
  for (let t = 0; t < nTri; t++) {
    const i0 = idx ? idx.getX(3*t) : 3*t, i1 = idx ? idx.getX(3*t+1) : 3*t+1, i2 = idx ? idx.getX(3*t+2) : 3*t+2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld); q.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
    nrm.subVectors(q, a).cross(c.clone().sub(a)).normalize(); cen.addVectors(a, q).add(c).multiplyScalar(1/3);
    const rad = cen.clone().sub(C); const d = (rad.length() - Rk) * 10; rad.normalize();
    if (Math.abs(nrm.dot(rad)) < 0.8) continue;
    if (d < -1.0) continue;
    n++; dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); if (d < -0.05) sunk++; if (d > 0.6) frei++;
  }
  const mc = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
  const lat = Math.asin(Math.max(-1, Math.min(1, (mc.y - C.y) / Rk))) * 180 / Math.PI;
  selectObjs([]);
  renderer.render(scene, camera); await new Promise(r => requestAnimationFrame(r)); renderer.render(scene, camera);
  return { tag, gewickelt: !!w,  achse: w ? w.axis.map(v => +v.toFixed(2)) : null, R: w ? +(w.R * 10).toFixed(1) : null, rotGrad: w ? +((w.rotRad || 0) * 180 / Math.PI).toFixed(1) : null, rot0Grad: w ? +((w.rot0 || 0) * 180 / Math.PI).toFixed(1) : null,
           kugelPos: k.position.toArray().map(v => +v.toFixed(2)), breiteGrad: +lat.toFixed(1), aussenFlaechen: n, versunken: +(sunk / Math.max(1, n)).toFixed(3), abstehend: +(frei / Math.max(1, n)).toFixed(3), dMin: +dMin.toFixed(2), dMax: +dMax.toFixed(2),
  };
}, tag);
const save = (r, name) => { console.log(JSON.stringify(r)); };
const C = await pg.evaluate(() => { const bb = new THREE.Box3().setFromObject(_K()); return [bb.getCenter(new THREE.Vector3()).toArray(), (bb.max.x - bb.min.x) / 2]; });
const mCenter = await pg.evaluate(() => _svgCenterWorld(_M()).toArray());
console.log('drag1', JSON.stringify(await drag(await scr(mCenter), await scr([C[0][0], C[0][1], C[0][2] + C[1]]))));
save(await zustand('aequator'), '0_aequator');
const griff = () => pg.evaluate(() => {
  const m = _M(); m.updateMatrixWorld(true);
  const c = _svgCenterWorld(m).project(camera); const r = renderer.domElement.getBoundingClientRect();
  const bx = Math.round(r.left + (c.x * 0.5 + 0.5) * r.width), by = Math.round(r.top + (-c.y * 0.5 + 0.5) * r.height);
  const top = (x, y) => { const h = pickObjects({ clientX: x, clientY: y }); if (!h.length) return null; let p = h[0].object; while (p && !objects.includes(p)) p = p.parent; return p; };
  for (let rad = 0; rad <= 70; rad++) for (let ox = -rad; ox <= rad; ox++) for (const oy of [-rad, rad]) for (const [x, y] of [[bx + ox, by + oy], [bx + oy, by + ox]]) {
    if ([[0,0],[1,0],[-1,0],[0,1],[0,-1]].every(([dx, dy]) => top(x + dx, y + dy) === m)) return { x, y };
  }
  return null;
});
const schritte = [['hoch1', -40], ['hoch2', -40], ['hoch3', -40], ['hoch4', -40], ['runter1', 55], ['runter2', 55], ['runter3', 55], ['runter4', 55], ['runter5', 55]];
for (const [name, dy] of schritte) {
  await pg.evaluate(() => selectObjs([]));
  const g = await griff(); if (!g) { console.log(name, 'KEIN GRIFF'); continue; }
  const d = await drag(g, { x: g.x, y: g.y + dy });
  const z = await zustand(name); z.drag = d; save(z, name);
  ok(`${name}: Gleiten bleibt bis zum Loslassen aktiv (kein Ausbruch als 'Deckel')`, d.glideVorLoslassen === 'wrap', d);
  ok(`${name}: Motiv bleibt gewickelt und liegt an (Breite ${z.breiteGrad}°)`, z.gewickelt && z.abstehend === 0 && z.dMax < 0.6 && z.versunken < 0.2 && z.dMin > -0.3, z);
  if (Math.abs(z.breiteGrad) > 40) ok(`${name}: oberhalb 40° trägt die Querachse`, z.gewickelt && Math.abs(z.achse[1]) < 0.3, z.achse);
}
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
console.log('errs', errs);
await b.close();
process.exit(fails.length ? 1 : 0);
