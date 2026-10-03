// Ralf 3.10.2026: Scheibe + Mutter minus Gewindeloch (App-Körper, KEIN Import,
// ~10k Dreiecke) hing an OCCT bis zur 600-s-Notbremse — Balken bei 93 %.
// Nachgestellt mit M12 (22k Dreiecke): OCCT 133 s. Muss über Manifold laufen,
// darf den Server nicht anfragen und muss ein echtes Loch liefern.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8847;
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
const vol = `o => { let v = 0; o.updateMatrixWorld(true); o.traverse(ch => { if (!ch.isMesh || ch.userData.isEdgeLines) return;
  const g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry, p = g.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i).applyMatrix4(ch.matrixWorld);
    b.fromBufferAttribute(p, i+1).applyMatrix4(ch.matrixWorld); c.fromBufferAttribute(p, i+2).applyMatrix4(ch.matrixWorld);
    v += a.dot(b.clone().cross(c)) / 6; } }); return Math.abs(v); }`;
const info = await page.evaluate(vol => {
  window._vol = eval(vol);
  hideStarter?.();
  addShape('cylinder'); const disk = objects[objects.length-1];
  disk.scale.set(4, 0.6, 4); disk.updateMatrixWorld(true);
  Object.assign(_screwP, { type:'mutter', size:'M12' }); _createScrew();
  const nut = objects[objects.length-1]; nut.position.set(0, 0.6, 0); nut.updateMatrixWorld(true);
  Object.assign(_screwP, { type:'loch', size:'M12', holeKind:'gewinde', holeDepth:20 }); _createScrew();
  const hole = objects[objects.length-1]; hole.position.set(0, -0.3, 0); hole.updateMatrixWorld(true);
  selectedObjs.length = 0; selectedObjs.push(disk, nut, hole);
  return { vDisk: _vol(disk), vNut: _vol(nut) };
}, vol);
const t0 = Date.now();
await page.evaluate(() => subtractHoles());
await page.waitForFunction(() => objects.length === 1, null, { timeout: 30000 }).catch(() => {});
const ms = Date.now() - t0;
const r = await page.evaluate(() => {
  const o = objects[0]; const bb = new THREE.Box3().setFromObject(o);
  // Achse der Bohrung muss frei sein: Strahl von oben trifft im Kern (r 0,4 mm) nichts
  const rc = new THREE.Raycaster(new THREE.Vector3(0.04, 10, 0), new THREE.Vector3(0, -1, 0));
  return { n: objects.length, v: _vol(o), hits: rc.intersectObject(o, true).filter(h => h.object.isMesh && !h.object.userData.isEdgeLines).length,
           bb: [bb.min.y, bb.max.y].map(x => +x.toFixed(2)) };
});
console.log(JSON.stringify({ ...info, ...r }), 'in', ms, 'ms');
console.log(logs.filter(l => /subtract|REQ|Manifold/i.test(l)).join('\n'));
const ok = r.n === 1 && ms < 15000 && r.hits === 0 && r.v > 0 && r.v < info.vDisk + info.vNut
        && !logs.some(l => l.startsWith('REQ')) && logs.some(l => /Manifold-Schnellweg:/.test(l));
console.log(ok ? 'OK' : 'FEHLER');
await browser.close(); srv.kill();
process.exit(ok ? 0 : 1);
