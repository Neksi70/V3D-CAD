import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8847;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  await pg.evaluate(() => hideStarter());
  await pg.mouse.click(700, 450);
  for (const shape of ['box', 'cylinder']) {
    await pg.evaluate(async (shape) => { _newCreate(false); addShape(shape); await _loadOCCT(); }, shape);
    await pg.evaluate(() => { selectObjs([objects[objects.length-1]]); enterEdgeMode(true); _edgeSelectAll(); if (_edgeSel.size>1){ const f=[..._edgeSel][0]; _edgeSel.clear(); _edgeSel.add(f);} });
    await pg.waitForTimeout(300);
    const hb = await pg.locator('#edge-bevel-handle').boundingBox();
    const cx = hb.x + hb.width/2, cy = hb.y + hb.height/2;
    for (const dir of [1, -1]) {
      await pg.mouse.move(cx, cy); await pg.mouse.down();
      for (let i = 1; i <= 10; i++) { await pg.mouse.move(cx + dir*i*3, cy); await pg.waitForTimeout(40); }
      await pg.waitForTimeout(400);
      const st = await pg.evaluate(() => ({
        kind: _ebPrev && _ebPrev.kind, fail: _ebPrev && _ebPrev.fail,
        prevTris: _ebPrev && _ebPrev.mesh ? _ebPrev.mesh.geometry.index.count/3 : null,
        objTris: (g => (g.index ? g.index.count : g.attributes.position.count)/3)(objects[objects.length-1].geometry),
        label: document.getElementById('edge-bevel-label').textContent }));
      console.log(shape, dir, JSON.stringify(st));
      await pg.screenshot({ path: '/tmp/claude-1000/-home-v3da/8ef21cf7-b51e-42e7-9863-7e8789f7c022/scratchpad/prev_' + shape + '_' + (dir>0?'r':'l') + '.png' });
      await pg.mouse.up();
      await pg.waitForTimeout(800);
      const after = await pg.evaluate(() => ({ n: objects.length, prev: !!_ebPrev, previewInScene: scene.children.some(c => c.userData && c.userData._ebPreview),
        tris: (g => (g.index ? g.index.count : g.attributes.position.count)/3)(objects[objects.length-1].geometry) }));
      console.log('  after apply', JSON.stringify(after));
      await pg.evaluate(() => { undo(); });
      await pg.waitForTimeout(300);
      await pg.evaluate(() => { selectObjs([objects[objects.length-1]]); enterEdgeMode(true); _edgeSelectAll(); if (_edgeSel.size>1){ const f=[..._edgeSel][0]; _edgeSel.clear(); _edgeSel.add(f);} });
      await pg.waitForTimeout(300);
    }
  }
} finally { console.log('errors', errs); await b.close(); srv.kill(); }
