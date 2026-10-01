// Wabenmuster: Zylinder Ø90 × 3 mm — im Raster darf kein Loch fehlen.
import { chromium } from '@playwright/test';
const URL = process.env.PG_URL || 'http://127.0.0.1:8766/volme3d.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3500);
let fail = 0;
for (const [cell, wall, margin] of [[8,2.5,2],[10,2.5,2],[12,2.5,2],[10,3,2],[12,3,1],[9,2,2],[14,3,2]]) {
  const r = await page.evaluate(async ([cell, wall, margin]) => {
    hideStarter(); _newCreate(false);
    addShape('cylinder');
    const o = objects[objects.length - 1];
    const bb0 = new THREE.Box3().setFromObject(o), s0 = bb0.getSize(new THREE.Vector3());
    o.scale.multiply(new THREE.Vector3(9 / s0.x, 0.3 / s0.y, 9 / s0.z));
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    selectedObjs.length = 0; selectedObjs.push(o);
    let got = null;
    const orig = _doSubtractHoles;
    _doSubtractHoles = async (t, h) => { got = h[0]; };
    try { await _applyHexPattern(cell, wall, margin, 0); } finally { _doSubtractHoles = orig; }
    const p = got.geometry.attributes.position.array, n = 216, pts = [];
    for (let k = 0; k < p.length / n; k++) {
      let x = 0, z = 0; for (let v = 0; v < n; v += 3) { x += p[k*n+v]; z += p[k*n+v+2]; }
      pts.push([x / 72, z / 72]);
    }
    return { pts, cx: (bb.min.x + bb.max.x) / 2, cz: (bb.min.z + bb.max.z) / 2, size: [bb.max.x-bb.min.x, bb.max.y-bb.min.y] };
  }, [cell, wall, margin]);
  // Soll: alle Gitterzellen, deren Sechseck + Rand im Kreis R=45 mm liegt
  const SW = cell/10, R = SW/Math.sqrt(3), pitch = SW + wall/10, rowP = pitch*Math.sqrt(3)/2, m = margin/10;
  const want = [];
  for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) {
    const x = i*pitch + ((j&1) ? pitch/2 : 0), z = j*rowP;
    if (Math.hypot(x, z) + R + m < 4.5 - 0.02) want.push([x, z]);
  }
  const missing = want.filter(w => !r.pts.some(p => Math.hypot(p[0]-r.cx-w[0], p[1]-r.cz-w[1]) < 1e-3));
  console.log(`Zelle ${cell} Steg ${wall} Rand ${margin}: ${r.pts.length} Löcher, Soll ≥ ${want.length}, fehlend:`, JSON.stringify(missing.map(a => a.map(v => +(v*10).toFixed(2)))), 'Größe', r.size.map(v=>+(v*10).toFixed(2)));
  if (missing.length) fail++;
}
await browser.close();
console.log(fail ? `FEHLER: ${fail} Fälle mit fehlendem Loch` : 'OK');
process.exit(fail ? 1 : 0);
