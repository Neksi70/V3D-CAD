// End-to-End: gewickeltes SVG aus einer Windlicht-Wand gravieren.
// Kernfrage: bleibt die Gravurtiefe über die ganze Motivbreite gleich?
// (Tangential aufgeklebt wird sie zu den Rändern hin flacher — genau das Problem.)
//
// Start: npm run dev  (Port 8766) + occt-server.js auf 3001
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
if (process.env.V3D_DEBUG) pg.on('console', m => console.log('  [browser]', m.type(), m.text().slice(0, 300)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

// Breites Motiv (60 mm) auf Ø60 — hier fällt tangentiales Aufkleben krachend durch
const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
  <path d="M2,5 H98 V35 H2 Z"/>
</svg>`;

const prep = await pg.evaluate((svg) => {
  addShape('tube');
  const cyl = objects[objects.length - 1];
  cyl.scale.set(3, 3, 3);                 // Ø 60 mm Windlicht
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 5, targetMM: 60, name: 'Motiv' });
  m.userData.isHole = true;
  cyl.position.set(0, 2, 0); cyl.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(cyl);
  const hit = new THREE.Vector3(bb.max.x, (bb.min.y + bb.max.y) / 2, 0);
  const probe = _svgWrapProbe(cyl, hit);
  _svgWrapApply(m, probe, hit);
  // Dialog überspringen: Gravur 1,2 mm
  window._engraveDepthDialog = () => Promise.resolve({ depth: 1.2, wantInlay: false, through: false });
  selectObjs([cyl, m]);
  subtractHoles();
  return { R: probe.R * 10, yMid: (bb.min.y + bb.max.y) / 2, n0: objects.length };
}, TEST_SVG);

await pg.waitForFunction(() => objects.length === 1 && !objects[0].userData.isHole, { timeout: 180000 })
  .catch(() => {});

const res = await pg.evaluate((p) => {
  const o = objects[0];
  if (!o || objects.length !== 1) return { n: objects.length };
  o.updateMatrixWorld(true);
  // Strahlen von außen nach innen: welchen Radius trifft die erste Fläche?
  const probeAt = (bogenMM, hMM) => {
    const th = (bogenMM / p.R);                       // Bogenlänge → Winkel
    const dir = new THREE.Vector3(-Math.cos(th), 0, -Math.sin(th));
    const start = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)).multiplyScalar(p.R / 10 * 2)
      .setY(p.yMid + hMM / 10);
    const rc = new THREE.Raycaster(start, dir, 0, 100);
    const hits = rc.intersectObject(o, true).filter(h => h.object.isMesh);
    if (!hits.length) return null;
    const q = hits[0].point;
    return +(Math.hypot(q.x, q.z) * 10).toFixed(3);   // Radius des ersten Treffers in mm
  };
  return {
    n: objects.length,
    mitte:  probeAt(0, 0),
    links:  probeAt(-25, 0),
    rechts: probeAt(25, 0),
    oben:   probeAt(0, 6),       // noch im Motiv (Rechteck ist ~18 mm hoch)
    randOben: probeAt(-25, 6),
    daneben: probeAt(0, 11)      // knapp über dem Motiv → Wand muss stehen
  };
}, prep);

ok('Schnitt lieferte genau einen Körper', res.n === 1, res);
const soll = prep.R - 1.2;
for (const [wo, r] of [['Mitte', res.mitte], ['linker Rand', res.links], ['rechter Rand', res.rechts],
                       ['oben Mitte', res.oben], ['oben am Rand', res.randOben]]) {
  ok(`Gravurtiefe 1,2 mm — ${wo}`, r != null && Math.abs(r - soll) < 0.25,
     { gemessen: r, soll: +soll.toFixed(3), tiefe: r != null ? +(prep.R - r).toFixed(2) : null });
}
ok('neben dem Motiv steht die Wand unberührt',
   res.daneben != null && Math.abs(res.daneben - prep.R) < 0.25,
   { gemessen: res.daneben, soll: prep.R });
// ── Durchbruch: dasselbe Motiv, aber komplett durch die Wand ─────────────
const durch = await pg.evaluate((p) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M40,10 H60 V30 H40 Z"/></svg>`;
  const koerper = objects[0];
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 5, targetMM: 30, name: 'Fenster' });
  m.userData.isHole = true;
  koerper.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(koerper);   // der Import rückt Objekte zurecht
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  window._durchMitte = { cx, cz, yMid: (bb.min.y + bb.max.y) / 2 };
  const hit = new THREE.Vector3(cx, window._durchMitte.yMid, bb.max.z);   // andere Seite als die Gravur
  _svgWrapApply(m, _svgWrapProbe(koerper, hit), hit);
  window._engraveDepthDialog = () => Promise.resolve({ depth: 0, wantInlay: false, through: true });
  selectObjs([koerper, m]);
  subtractHoles();
  return true;
}, prep);

await pg.waitForFunction(() => objects.length === 1 && !objects[0].userData.isHole, { timeout: 180000 })
  .catch(() => {});

const durchRes = await pg.evaluate((p) => {
  const o = objects[0];
  if (!o || objects.length !== 1) return { n: objects.length };
  o.updateMatrixWorld(true);
  // Strahl von außen (+Z) nach innen: bei einem Loch trifft er erst die Rückwand
  const c = window._durchMitte;
  const schuss = (dz) => {
    const start = new THREE.Vector3(c.cx, c.yMid + dz / 10, c.cz + p.R / 10 * 2);
    const rc = new THREE.Raycaster(start, new THREE.Vector3(0, 0, -1), 0, 100);
    const h = rc.intersectObject(o, true).filter(x => x.object.isMesh);
    return h.length ? +((h[0].point.z - c.cz) * 10).toFixed(2) : null;   // >0 = Vorderwand
  };
  // Das Fenster wird auf 30 mm normiert (Motiv-Bounding-Box, nicht viewBox) → ±15 mm
  return { n: objects.length, imFenster: schuss(0), daneben: schuss(20) };
}, prep);

ok('Durchbruch: Strahl geht durch die Vorderwand hindurch',
   durchRes.imFenster != null && durchRes.imFenster < 0,
   { ersterTreffer: durchRes.imFenster, wand: prep.R });
ok('Durchbruch: über dem Fenster steht die Wand',
   durchRes.daneben != null && Math.abs(durchRes.daneben - prep.R) < 0.3,
   { ersterTreffer: durchRes.daneben, wand: prep.R });

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER: ${fails.join(', ')}` : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
