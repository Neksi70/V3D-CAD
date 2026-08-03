// Sichtprüfung: Topper scharfkantig vs. gerundet, aus der Nähe.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8798;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

for (const [name, round, font, txt] of [
  ['sharp-gv', 0,   'greatvibes_local', 'Denise'],
  ['round-gv', 0.4, 'greatvibes_local', 'Denise'],
  ['sharp-hv', 0,   'helvetiker_bold',  'Mia'],
  ['round-hv', 0.4, 'helvetiker_bold',  'Mia'],
]) {
  await page.evaluate(async ([round, font, txt]) => {
    for (const o of objects.slice()) { scene.remove(o); }
    objects.length = 0;
    _ttOpen();
    document.getElementById('tt-text').value = txt;
    document.getElementById('tt-font').value = font;
    document.getElementById('tt-round').value = round;
    document.getElementById('tt-round2').checked = false;
    document.getElementById('tt-size').value = 30;
    document.getElementById('tt-pins').value = 0;
    _ttCreate();
    await new Promise(r => setTimeout(r, 2500));
    // dicht ran und schräg drauf, damit die Kante sichtbar wird
    camera.position.set(2, 4, 5); camera.lookAt(0, 0, 0);
    if (typeof fitToObjects === 'function') fitToObjects(objects);
    camera.position.multiplyScalar(0.42);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }, [round, font, txt]);
  await page.waitForTimeout(900);
  // Direkt aus dem WebGL-Canvas lesen — die Start-Auswahl liegt sonst davor
  const dataUrl = await page.evaluate(() => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`/tmp/tt-${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('shot', name);
}
await browser.close(); srv.kill();
