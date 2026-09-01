// Reproduktion: Pfeil ziehen, wenn die Achse fast zur Kamera zeigt.
// Erwartung (Fehler): winzige Mausbewegung schleudert das Teil weit weg.
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
await p.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await p.waitForTimeout(3000);
const rect = await p.evaluate(() => { const r = vpEl.getBoundingClientRect(); return { x: r.left, y: r.top }; });

for (const phi of [1.05, 0.35, 0.15]) {
  const st = await p.evaluate((phi) => {
    const m = document.getElementById('start-modal'); if (m) m.classList.remove('show');
    while (objects.length) { const o = objects.pop(); scene.remove(o); }
    addShape('box'); const B = objects[0]; B.position.set(0, B.position.y, 0);
    selectObjs([B]); setMode('select'); setSnapGrid(0);
    fitToObjects([B]); sph.r *= 2.2; sph.theta = 0.9; sph.phi = phi; sph2cam();
    // Winkel zwischen Y-Achse und Blickrichtung
    const cd = camera.getWorldDirection(new THREE.Vector3());
    return { winkel: +(Math.acos(Math.min(1, Math.abs(cd.y))) * 180 / Math.PI).toFixed(1) };
  }, phi);
  await p.waitForTimeout(300);
  const ap = await p.evaluate(() => {
    const g = _mg.group, d = _mgAxisVec('y').multiplyScalar(g.scale.x * 0.6);
    const w = g.position.clone().add(d);
    return _worldToScreen(w.x, w.y, w.z);
  });
  const x = ap.x + rect.x, y = ap.y + rect.y;
  await p.mouse.move(x, y);
  const griff = await p.evaluate(() => _mg.hover);
  await p.mouse.down();
  const y0 = await p.evaluate(() => objects[0].position.y * 10);
  await p.mouse.move(x, y - 10);          // NUR 10 Pixel
  const y1 = await p.evaluate(() => objects[0].position.y * 10);
  await p.mouse.up();
  console.log(`Blick-zu-Y-Achse ${String(st.winkel).padStart(5)}° | hover=${griff} | 10 px Maus → ${(y1 - y0).toFixed(1)} mm`);
}
await b.close();
