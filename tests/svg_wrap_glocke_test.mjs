// Josy 3.10.26: großes Leo-Muster um eine oben eingerollte Glocke gewickelt —
// unten sitzt es, auf der Schulter „lässt er zwei Ringe aus, wo er nichts rau
// setzt“ (Motiv verschwindet in der Wand, nur eine Reihe dazwischen schaut raus).
// Prüfkörper wie ein Import (Geometrie Z-up, Kippen nur am Mesh), HOHL mit 2 mm Wand.
// Prüft je 5-mm-Höhenband: die Außenseite des Motivs liegt außerhalb der Wand
// (sichtbar) und steht nicht mehr als 0,6 mm ab.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
// Rosettenfeld 240×90 (Ringe Ø6, Raster 8 mm, versetzt)
let paths = '';
for (let j = 0; j < 11; j++) for (let i = 0; i < 30; i++) {
  const x = 4 + i * 8 + (j & 1) * 4, y = 5 + j * 8;
  if (x > 236) continue;
  paths += `<path fill-rule="evenodd" d="M${x-3},${y} a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 Z M${x-1.8},${y} a1.8,1.8 0 1,1 3.6,0 a1.8,1.8 0 1,1 -3.6,0 Z"/>`;
}
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 90">${paths}</svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const lauf = (hf) => pg.evaluate(async ([svgText, hf]) => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  // Glocke in mm: Zylinder R40 bis 55, dann Viertel-Ellipse bis Öffnung R22 bei 90
  const rOut = y => y <= 55 ? 40 : 22 + 18 * Math.sqrt(Math.max(0, 1 - ((y - 55) / 35) ** 2));
  const prof = [];
  prof.push(new THREE.Vector2(0.001, 0));
  for (let y = 0; y <= 55; y += 2.5) prof.push(new THREE.Vector2(4.0, y / 10));
  for (let k = 1; k <= 40; k++) { const t = k / 40 * Math.PI / 2; prof.push(new THREE.Vector2((22 + 18 * Math.cos(t)) / 10, (55 + 35 * Math.sin(t)) / 10)); }
  // Innenwand: Normal-Offset 2 mm, rückwärts
  const inn = [];
  for (let k = 40; k >= 1; k--) { const t = k / 40 * Math.PI / 2; inn.push(new THREE.Vector2((22 + 16 * Math.cos(t)) / 10, (55 + 33 * Math.sin(t)) / 10)); }
  for (let y = 55; y >= 2; y -= 2.5) inn.push(new THREE.Vector2(3.8, Math.max(y, 2) / 10));
  inn.push(new THREE.Vector2(0.001, 0.2));
  // Lathe: Außen nach oben, Innen zurück → geschlossene Schale mit Boden
  const pts = [...prof, ...inn];
  let geo = new THREE.LatheGeometry(pts, 160);
  geo = THREE.BufferGeometryUtils ? THREE.BufferGeometryUtils.mergeVertices(geo) : geo;
  geo.rotateX(Math.PI / 2);                     // Geometrie Z-up wie aus der Datei
  const glocke = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
  glocke.rotation.x = -Math.PI / 2;             // Kippen nur am Mesh
  glocke.userData = { id: idCtr++, name: 'Glocke', type: 'custom', shapeType: 'custom' };
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 2, targetMM: 240, name: 'Leo' });
  scene.add(glocke); objects.push(glocke);
  glocke.position.set(0, 0, 0); glocke.updateMatrixWorld(true);
  const yHit = 9 * hf, hit = new THREE.Vector3(rOut(yHit * 10) / 10, yHit, 0);
  // Auswahl Wickeln/Schmiegen wie beim Ziehen: Normale am Treffer
  const p = _svgWrapProbe(glocke, hit);
  if (!p) return { gewickelt: false };
  _svgWrapApply(m, p, hit);
  m.updateMatrixWorld(true);
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  const band = {};
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const ymm = v.y * 10;
    if (ymm < 1 || ymm > 89) continue;
    // senkrechter Abstand zur Außenwand ≈ radial × cos(Neigung)
    const r = Math.hypot(v.x, v.z) * 10, ro = rOut(ymm);
    const k = ymm <= 55 ? 0 : (rOut(ymm + 0.2) - rOut(ymm - 0.2)) / 0.4;
    const dd = (r - ro) / Math.sqrt(1 + k * k);
    const key = Math.floor(ymm / 5) * 5;
    band[key] = band[key] || [1e9, -1e9];
    band[key][0] = Math.min(band[key][0], dd); band[key][1] = Math.max(band[key][1], dd);
  }
  const bb = new THREE.Box3().setFromObject(m);
  return { gewickelt: true, schmieg: !!m.userData._svgSchmieg, band: Object.fromEntries(Object.entries(band).map(([k, [a, c]]) => [k, [+a.toFixed(2), +c.toFixed(2)]])), yMin: +(bb.min.y * 10).toFixed(1), yMax: +(bb.max.y * 10).toFixed(1) };
}, [SVG, hf]);
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
for (const hf of [0.3, 0.5]) {
  const r = await lauf(hf);
  if (!r.gewickelt) { ok(`bei ${hf * 100} % gewickelt`, false, r); continue; }
  console.log(`  Motiv ${r.yMin}…${r.yMax} mm`);
  for (const [k, [lo, hi]] of Object.entries(r.band))
    ok(`bei ${hf * 100} %: Band ${k}–${+k + 5} mm sichtbar und anliegend`, hi > 0.05 && hi < 0.6, [lo, hi]);
}
ok('keine JS-Fehler', errs.length === 0, errs);
await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER`); process.exit(1); }
console.log('\nAlles grün.');
