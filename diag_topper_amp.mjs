// Sichtprüfung der &-Varianten am Topper „Denise & Sebastian" (Great Vibes).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const PORT = 8762;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1200,height:700} });
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,160)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

for (const amp of ['font','plain','heart','und']) {
  await page.evaluate(async a => {
    for (const o of objects.slice()) scene.remove(o);
    objects.length = 0;
    _ttOpen();
    document.getElementById('tt-text').value = 'Denise & Sebastian';
    document.getElementById('tt-font').value = 'greatvibes_local';
    document.getElementById('tt-size').value = 30;
    document.getElementById('tt-pins').value = 0;
    document.getElementById('tt-round').value = 0.4;
    _ttSetAmp(a);
    _ttCreate();
    await new Promise(r => setTimeout(r, 2500));
    _ttClose();
    deselect();
    if (typeof fitToObjects === 'function') fitToObjects(objects);
    camera.position.set(0, 9, 4); camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }, amp);
  await page.waitForTimeout(700);
  const url = await page.evaluate(() => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); });
  writeFileSync(`/tmp/amp-${amp}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', amp);
}
await browser.close(); srv.kill();
