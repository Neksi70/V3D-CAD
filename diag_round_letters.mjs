// Sichtprüfung Ralfs Fall: ineinandergesteckte Buchstaben, einzeln vs. am Stück.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const PORT = 8781;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1200,height:700} });
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,160)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

const shot = async name => {
  const url = await page.evaluate(() => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); });
  writeFileSync(`/tmp/letters-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
};

// „Buchstaben": drei überlappende Klötze + dünner Anstrich, wie bei einem Topper
const build = async () => page.evaluate(async () => {
  for (const o of objects.slice()) scene.remove(o);
  objects.length = 0;
  const gs = [];
  for (const x of [-0.6, 0, 0.6]) { const g = new THREE.BoxGeometry(0.8,0.8,0.4).toNonIndexed(); g.translate(x,0.4,0); gs.push(g); }
  const thin = new THREE.BoxGeometry(0.9,0.06,0.3).toNonIndexed(); thin.translate(1.2,0.4,0); gs.push(thin);
  let n=0; gs.forEach(g=>n+=g.attributes.position.count/3);
  const buf = new ArrayBuffer(84+n*50), dv = new DataView(buf); dv.setUint32(80,n,true);
  let t=0;
  for (const g of gs){ const p=g.attributes.position.array;
    for (let i=0;i<p.length/9;i++,t++){ const o3=84+t*50;
      for (let k=0;k<3;k++){ dv.setFloat32(o3+12+k*12,   p[i*9+k*3]*10,   true);
                             dv.setFloat32(o3+12+k*12+4, p[i*9+k*3+1]*10, true);
                             dv.setFloat32(o3+12+k*12+8, p[i*9+k*3+2]*10, true); } } }
  _addImportedGeo(parseSTL(buf), 'buchstaben.stl', false, buf, false);
  await new Promise(r=>setTimeout(r,400));
  deselect();
  camera.position.set(2.2, 2.6, 3.4); camera.lookAt(0, 0.4, 0);
  renderer.render(scene, camera);
});
const round = async perPart => page.evaluate(async pp => {
  const o = objects[objects.length-1];
  selectObjs([o]); _openRoundModal();
  document.getElementById('round-r').value = 0.4;
  const cb = document.getElementById('round-parts');   // gibt es nicht mehr: immer teileweise
  if (cb) cb.checked = pp;
  await _roundApply();
  await new Promise(r=>setTimeout(r,400));
  deselect();
  camera.position.set(2.2, 2.6, 3.4); camera.lookAt(0, 0.4, 0);
  renderer.render(scene, camera);
}, perPart);

await build(); await page.waitForTimeout(400); await shot('vorher');
await round(true);  await page.waitForTimeout(400); await shot('einzeln');
await build(); await page.waitForTimeout(400);
await round(false); await page.waitForTimeout(400); await shot('amstueck');
await browser.close(); srv.kill();
