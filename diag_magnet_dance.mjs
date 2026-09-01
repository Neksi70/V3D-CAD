// Regressionstest Andock-Magnet:
//  A) quer stehendes Rohr darf beim Ziehen NICHT herumgerissen werden ("Tanzen")
//  B) fast passendes Rohr soll weiterhin koaxial in die Bohrung einrasten
//  C) Magnet-Aus legt den Fang komplett still
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3000);

const rect = await page.evaluate(() => { const r = vpEl.getBoundingClientRect(); return { x: r.left, y: r.top }; });

async function scenario(tiltX) {
  const st = await page.evaluate((tiltX) => {
    const m = document.getElementById('start-modal'); if (m) m.classList.remove('show');
    while (objects.length) { const o = objects.pop(); scene.remove(o); }
    addShape('tube');
    const A = objects[objects.length - 1];
    A.position.set(0, A.position.y, 0);
    addShape('tube');
    const B = objects[objects.length - 1];
    B.rotation.set(tiltX, 0, 0);
    B.position.set(3.2, 1.0, 0);
    [A, B].forEach(o => o.updateMatrixWorld(true));
    selectObjs([B]); setMode('move'); setSnapGrid(0); setMagnet(true);
    fitToObjects([A, B]); sph.r *= 1.1; sph.phi = 1.05; sph2cam();
    renderer.render(scene, camera);
    const c = new THREE.Box3().setFromObject(B).getCenter(new THREE.Vector3());
    const a = new THREE.Box3().setFromObject(A).getCenter(new THREE.Vector3());
    return { from: _worldToScreen(c.x, c.y, c.z), to: _worldToScreen(a.x, a.y, a.z) };
  }, tiltX);

  const fx = st.from.x + rect.x, fy = st.from.y + rect.y;
  const tx = st.to.x + rect.x,  ty = st.to.y + rect.y;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  const ups = [], kinds = [];
  const N = 40;
  for (let i = 1; i <= N; i++) {
    await page.mouse.move(fx + (tx - fx) * i / N, fy + (ty - fy) * i / N);
    const r = await page.evaluate(() => {
      const B = selectedObjs[0];
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(B.quaternion).normalize();
      return { up: [up.x, up.y, up.z], t: _centerSnapTarget ? _centerSnapTarget.kind : null };
    });
    ups.push(r.up); kinds.push(r.t);
  }
  await page.mouse.up();
  const end = await page.evaluate(() => {
    const B = selectedObjs[0], A = objects[0];
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(B.quaternion).normalize();
    const bc = new THREE.Box3().setFromObject(B).getCenter(new THREE.Vector3());
    const ac = new THREE.Box3().setFromObject(A).getCenter(new THREE.Vector3());
    return { up: [up.x, up.y, up.z], offXZ: Math.hypot(bc.x - ac.x, bc.z - ac.z) * 10 };
  });
  let maxStep = 0;
  for (let i = 1; i < ups.length; i++) {
    const a = ups[i - 1], b = ups[i];
    const d = Math.min(1, Math.max(-1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2]));
    maxStep = Math.max(maxStep, Math.acos(d) * 180 / Math.PI);
  }
  const hits = kinds.filter(Boolean);
  return { maxStep, hits: hits.length, arten: [...new Set(hits)].join(',') || '-', end };
}

const A = await scenario(Math.PI / 2);            // 90° quer
console.log('A) quer  : Sprung/Schritt max', A.maxStep.toFixed(2) + '°',
            '| Fang', A.hits + '/40 (' + A.arten + ')',
            '| End-Achse', A.end.up.map(v => v.toFixed(2)).join(','));
const B = await scenario(0.17);                   // ~10° daneben
console.log('B) fast  : Sprung/Schritt max', B.maxStep.toFixed(2) + '°',
            '| Fang', B.hits + '/40 (' + B.arten + ')',
            '| End-Achse', B.end.up.map(v => v.toFixed(2)).join(','),
            '| Achs-Abstand', B.end.offXZ.toFixed(2) + 'mm');

const off = await page.evaluate(() => {
  setMagnet(false);
  const r = _centerSnapDetect(selectedObjs[0]);
  const flagOff = _magnetOn;
  setMagnet(true);
  return { detected: r === null, flagOff, flagOn: _magnetOn };
});
console.log('C) Magnet AUS -> kein Fang:', off.detected, '| Schalter:', off.flagOff, '->', off.flagOn);

const okA = A.maxStep < 5 && A.hits > 0 && Math.abs(A.end.up[2]) > 0.98;      // Achse unveraendert quer
const okB = B.hits > 0 && B.end.up[1] > 0.995 && B.end.offXZ < 0.5;           // koaxial eingerastet
const okC = off.detected && off.flagOff === false && off.flagOn === true;
console.log('=>', (okA && okB && okC) ? 'OK ✓' : `FEHLGESCHLAGEN ✗ (A:${okA} B:${okB} C:${okC})`);
await browser.close();
process.exit((okA && okB && okC) ? 0 : 1);
