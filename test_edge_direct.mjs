import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8848;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
// Bildschirmpunkt der Mitte einer sichtbaren Kantenlinie (vordere senkrechte/obere Kante)
const edgePt = () => pg.evaluate(() => {
  const o = objects[objects.length-1];
  const el = o.children.find(c => c.userData.isEdgeLines); const pos = el.geometry.attributes.position;
  const r = vpEl.getBoundingClientRect(); const out = [];
  for (let i = 0; i < pos.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(el.matrixWorld);
    const c = new THREE.Vector3().fromBufferAttribute(pos,i+1).applyMatrix4(el.matrixWorld);
    const m = a.clone().lerp(c, 0.5); const cam = m.clone().project(camera);
    out.push({ x: r.left + (cam.x+1)/2*r.width, y: r.top + (1-cam.y)/2*r.height, z: cam.z, wy: m.y });
  }
  // nimm den Punkt, der via _dedPick sichtbar ist
  for (const p of out) { const pk = _dedPick({clientX:p.x, clientY:p.y, pointerType:'mouse'}); if (pk) return p; }
  return null;
});
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  await pg.evaluate(() => hideStarter());
  await pg.mouse.click(700, 450);
  for (const shape of ['box', 'cylinder']) {
    await pg.evaluate(async (s) => { _newCreate(false); addShape(s); await _loadOCCT(); selectObjs([objects[objects.length-1]]); }, shape);
    await pg.waitForTimeout(300);
    const p = await edgePt();
    console.log(shape, 'edge point', JSON.stringify(p));
    // Hover
    await pg.mouse.move(p.x + 40, p.y + 40); await pg.mouse.move(p.x, p.y); await pg.waitForTimeout(150);
    console.log('  hover', await pg.evaluate(() => ({ hl: !!(_ded.hl && _ded.hl.visible), cur: canvas.style.cursor })));
    // Klick ohne Ziehen
    await pg.mouse.down(); await pg.mouse.up(); await pg.waitForTimeout(200);
    console.log('  click', await pg.evaluate(() => ({ edgeMode: _edgeMode, sel: [..._edgeSel], handle: document.getElementById('edge-bevel-handle').style.display })));
    await pg.evaluate(() => { exitEdgeMode(); selectObjs([objects[objects.length-1]]); });
    // Drücken + Ziehen nach links
    await pg.mouse.move(p.x, p.y); await pg.mouse.down();
    for (let i = 1; i <= 10; i++) { await pg.mouse.move(p.x - i*2, p.y); await pg.waitForTimeout(30); }
    await pg.waitForTimeout(300);
    console.log('  drag', await pg.evaluate(() => ({ prev: _ebPrev && _ebPrev.kind, lbl: document.getElementById('edge-bevel-label').textContent })));
    await pg.screenshot({ path: '/tmp/claude-1000/-home-v3da/8ef21cf7-b51e-42e7-9863-7e8789f7c022/scratchpad/direct_' + shape + '.png' });
    const pos0 = await pg.evaluate(() => objects[objects.length-1].position.toArray());
    await pg.mouse.up(); await pg.waitForTimeout(800);
    console.log('  after', await pg.evaluate((pos0) => { const o = objects[objects.length-1]; const g=o.geometry;
      return { n: objects.length, tris: (g.index?g.index.count:g.attributes.position.count)/3, occt: o.userData._occtParams?.ops?.map(x=>x.type+':'+x.dist.toFixed(2)), cap: o.userData.capBevel, posSame: JSON.stringify(o.position.toArray())===JSON.stringify(pos0) }; }, pos0));
  }
  // Gegenprobe: Ziehen auf der Fläche verschiebt weiter
  await pg.evaluate(() => { _newCreate(false); addShape('box'); selectObjs([objects[0]]); });
  const c = await pg.evaluate(() => { const o=objects[0]; const m=o.position.clone().project(camera); const r=vpEl.getBoundingClientRect(); return {x:r.left+(m.x+1)/2*r.width, y:r.top+(1-m.y)/2*r.height, p:o.position.toArray()}; });
  await pg.mouse.move(c.x, c.y); await pg.mouse.down(); await pg.mouse.move(c.x+60, c.y, {steps:6}); await pg.mouse.up();
  console.log('face-drag moved:', await pg.evaluate((p0) => JSON.stringify(objects[0].position.toArray()) !== JSON.stringify(p0), c.p), 'edgeMode', await pg.evaluate(() => _edgeMode));
} finally { console.log('errors', errs); await b.close(); srv.kill(); }
