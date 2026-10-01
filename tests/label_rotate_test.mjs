// 🏷️ Drehen-Knöpfe: Text dreht in der Fläche um seine Mitte (Quader) bzw. wird
// auf der Rundung neu gebogen (Zylinder); danach lässt er sich anbringen.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
const PORT = 8943;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', null, { timeout: 60000 });
await pg.waitForTimeout(1500);
await pg.evaluate(() => hideStarter());
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const lage = () => pg.evaluate(() => { const m = objects.find(o => o.userData.textEdit); m.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(m), s = bb.getSize(new THREE.Vector3()), c = _svgCenterWorld(m);
  return { s: s.toArray().map(x => +(x*10).toFixed(1)), c: c.toArray().map(x => +(x*10).toFixed(1)),
           rot: +(((m.userData._svgWrap || {}).rotRad || 0) * 180 / Math.PI).toFixed(0), wrap: !!m.userData._svgWrap }; });
for (const shape of ['box', 'cylinder']) {
  await pg.evaluate(shape => { _newCreate(false); addShape(shape); objects[0].userData.name = 'K'; window.__p = objects[0].position.clone();
    orbitTarget.set(0, 1, 0); sph.theta = 0.5; sph.phi = 1.2; sph.r = 9; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]); addTextShape(); }, shape);
  await pg.fill('#text3d-input', 'AB');
  await pg.evaluate(() => { const s = document.getElementById('text3d-size'); s.value = 5; s.dispatchEvent(new Event('input')); });
  await pg.click('#text3d-ok');
  await pg.waitForFunction(() => !!_lblPick, null, { timeout: 30000 });
  await pg.evaluate(() => { const k = objects.find(o => o.userData.name === 'K'); k.position.copy(window.__p); k.updateMatrixWorld(true); });
  const pt = await pg.evaluate(() => { const p = new THREE.Vector3(0.1, 1, 1).project(camera); const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; });
  await pg.mouse.move(pt.x - 4, pt.y); await pg.mouse.click(pt.x, pt.y); await pg.waitForTimeout(300);
  const v = await lage();
  await pg.click('#lbl-pop button:has-text("90°")'); await pg.waitForTimeout(200);
  const n = await lage();
  const mitte = Math.hypot(n.c[0] - v.c[0], n.c[1] - v.c[1], n.c[2] - v.c[2]);
  // vorher breit (X) und flach (Y), nachher schmal und hoch
  ok(`${shape}: 90° stellt den Text senkrecht, Mitte bleibt`, v.s[0] > v.s[1] * 1.5 && n.s[1] > n.s[0] * 1.5 && mitte < (shape === 'box' ? 0.05 : 0.6), { v, n });
  await pg.click('#lbl-pop button:has-text("↺ 15°")'); await pg.click('#lbl-pop button:has-text("↻ 15°")'); await pg.waitForTimeout(200);
  const z = await lage();
  ok(`${shape}: ↺ 15° und ↻ 15° heben sich auf`, Math.abs(z.s[0] - n.s[0]) < 0.15 && Math.abs(z.s[1] - n.s[1]) < 0.15, { n: n.s, z: z.s });
  const vol = () => pg.evaluate(() => { const o = objects[0]; o.updateMatrixWorld(true); const p = o.geometry.attributes.position, ix = o.geometry.index?.array, k = ix ? ix.length : p.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let s = 0;
    for (let t = 0; t < k; t += 3) { a.fromBufferAttribute(p, ix ? ix[t] : t).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, ix ? ix[t+1] : t+1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, ix ? ix[t+2] : t+2).applyMatrix4(o.matrixWorld); s += a.dot(b.clone().cross(c)) / 6; }
    return Math.round(Math.abs(s) * 1000); });
  const v0 = await vol();
  await pg.click('#lbl-tief'); await pg.fill('#lbl-mm', '0,8'); await pg.click('#lbl-pop .btn.pri');
  await pg.waitForFunction(() => objects.length === 1 && !objects[0].userData.textEdit, null, { timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(300);
  const n1 = await pg.evaluate(() => objects.length), d = (await vol()) - v0;
  ok(`${shape}: gedrehter Text lässt sich vertieft anbringen (0,8 mm tief)`, n1 === 1 && d < -15 && d > -25, { n1, d });
  await pg.evaluate(() => { undo(); undo(); undo(); undo(); });
}
ok('keine Seitenfehler', errs.length === 0, errs);
console.log(fails.length ? 'FEHLER: ' + fails.join(' | ') : 'ALLES OK');
await b.close(); srv.kill();
process.exitCode = fails.length ? 1 : 0;
