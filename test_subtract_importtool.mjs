// Box minus importiertes Netz (Werkzeug = Import, ~33k Dreiecke) muss über Manifold laufen,
// nicht an OCCT gehen (hing dort am Sewing, Balken stand bei 93 %).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8843;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('console', m => logs.push(m.text()));
page.on('request', r => { if (r.url().includes('/api/occt')) logs.push('REQ ' + r.url()); });
page.on('pageerror', e => console.log('ERR', String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.evaluate(() => {
  hideStarter?.();
  addShape('box'); const plate = objects[objects.length-1];
  plate.scale.set(25, 2, 22); selectedObjs.length=0; selectedObjs.push(plate); _dropSelectedToGround();
  const g = new THREE.TorusKnotGeometry(60, 15, 700, 24).toNonIndexed();   // mm, ~33.600 Dreiecke
  _addImportedGeo(g, 'teil.stl', false, null, false);
  const part = objects[objects.length-1];
  part.position.y = 2;   // halb in der Platte
  part.updateMatrixWorld(true);
  setObjMode?.(part, 'hole'); part.userData.isHole = true;
  selectedObjs.length = 0; selectedObjs.push(plate, part);
  window._T = { n0: objects.length, tris: _countTris([part]) };
});
const t0 = Date.now();
await page.evaluate(() => subtractHoles());
await page.waitForFunction(() => objects.length === 1, null, { timeout: 60000 }).catch(() => {});
const r = await page.evaluate(() => ({ n: objects.length, tris: _T.tris, resTris: _countTris(objects) }));
console.log(JSON.stringify(r), 'in', Date.now() - t0, 'ms');
console.log(logs.filter(l => /subtract|REQ|Manifold/i.test(l)).join('\n'));
const ok = r.n === 1 && !logs.some(l => l.startsWith('REQ')) && logs.some(l => /Manifold-Schnellweg:/.test(l));
console.log(ok ? 'OK' : 'FEHLER');
await browser.close(); srv.kill();
process.exit(ok ? 0 : 1);
