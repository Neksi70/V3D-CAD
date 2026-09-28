// Quader minus Zylinder → Lochrand DIREKT anfassen (ohne „Kanten bearbeiten"):
// Hover leuchtet, Ziehen nach rechts = Rundung, nach links = Fase.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8862;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const vol = `g => { const p = g.attributes.position, ix = g.index; let v = 0; const n = ix ? ix.count : p.count;
  for (let t = 0; t < n; t += 3) { const a = ix?ix.getX(t):t, b = ix?ix.getX(t+1):t+1, c = ix?ix.getX(t+2):t+2;
    v += (p.getX(a)*(p.getY(b)*p.getZ(c)-p.getY(c)*p.getZ(b)) - p.getX(b)*(p.getY(a)*p.getZ(c)-p.getY(c)*p.getZ(a)) + p.getX(c)*(p.getY(a)*p.getZ(b)-p.getY(b)*p.getZ(a)))/6; } return v*1000; }`;
async function lauf(dx) {
  await pg.evaluate(async () => {
    hideStarter(); _newCreate(false);
    addShape('box'); const box = objects[objects.length - 1];
    addShape('cylinder'); const cyl = objects[objects.length - 1];
    box.scale.set(5, 0.5, 2); box.position.set(0, 0.5, 0);
    cyl.scale.set(0.4, 1, 0.4); cyl.position.set(-3.5, 0.5, 0); cyl.userData.isHole = true;
    selectObjs([box, cyl]); subtractHoles();
    for (let i = 0; i < 300 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 300));
    selectObjs([objects[0]]); fitToObjects([objects[0]]);
  });
  await pg.waitForTimeout(600);
  // sichtbarer Punkt auf dem oberen Lochrand (zur Kamera hin)
  const pt = await pg.evaluate(() => {
    const o = objects[0]; const rim = _dedRims(o).find(r => r.axisW[1] > 0);
    const c = new THREE.Vector3(...rim.cW), d = camera.position.clone().sub(c); d.y = 0; d.normalize();
    const w = c.clone().addScaledVector(d, rim.rW).project(camera);
    const r = vpEl.getBoundingClientRect();
    return { x: r.left + (w.x + 1) / 2 * r.width, y: r.top + (1 - w.y) / 2 * r.height };
  });
  await pg.mouse.move(pt.x - 30, pt.y - 30); await pg.mouse.move(pt.x, pt.y);
  await pg.waitForTimeout(200);
  const hover = await pg.evaluate(() => !!(_ded.hl && _ded.hl.visible) && _ded.hl.geometry.attributes.position.count);
  const v0 = await pg.evaluate(`(${vol})(objects[0].geometry)`);
  const o0 = await pg.evaluate(() => objects[0].uuid);
  await pg.mouse.down(); await pg.mouse.move(pt.x + dx / 2, pt.y); await pg.mouse.move(pt.x + dx, pt.y); await pg.mouse.up();
  for (let i = 0; i < 60; i++) { if (await pg.evaluate(u => objects[0].uuid !== u, o0)) break; await pg.waitForTimeout(250); }
  await pg.waitForTimeout(300);
  const r = await pg.evaluate(`({ n: objects.length, neu: objects[0].uuid !== ${JSON.stringify(o0)}, v1: (${vol})(objects[0].geometry), sel: selectedObjs.length, edgeMode: _edgeMode, pos: objects[0].position.toArray() })`);
  return { dx, hover, v0: +v0.toFixed(1), ...r, v1: +r.v1.toFixed(1) };
}
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  const a = await lauf(+40), c = await lauf(-40);
  console.log(JSON.stringify(a)); console.log(JSON.stringify(c));
  const ok = a.hover > 2 && a.neu && a.v1 < a.v0 && c.hover > 2 && c.neu && c.v1 < c.v0 && a.n === 1 && c.n === 1;
  console.log(ok ? 'OK ✓' : 'FEHLER ✗');
} finally { console.log('errs', errs.slice(0, 3)); await b.close(); srv.kill(); }
