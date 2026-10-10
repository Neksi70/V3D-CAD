import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8854;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: process.cwd() });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => console.log('ERR', e.message));
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  await pg.evaluate(() => hideStarter());
  await pg.mouse.click(700, 450);
  await pg.evaluate(async () => {
    const isE = (ax,ay,az,bx,by,bz) => e => { const A=e.worldA,B=e.worldB, near=(p,x,y,z)=>Math.abs(p[0]-x)+Math.abs(p[1]-y)+Math.abs(p[2]-z)<0.01;
      return (near(A,ax,ay,az)&&near(B,bx,by,bz))||(near(A,bx,by,bz)&&near(B,ax,ay,az)); };
    const apply = async (pred, val) => { const o = objects[objects.length-1]; selectObjs([o]); enterEdgeMode(true);
      _edgeSel.clear(); _edgeSel.add(o.userData._dynamicEdges.findIndex(pred)); await _applyEdgeHandleValue(val); if (_edgeMode) exitEdgeMode(); };
    await _loadOCCT(); _newCreate(false); addShape('box');
    await apply(isE(1,2,-1, 1,2,1), -0.7); await apply(isE(-1,2,-1, -1,2,1), 0.8);
    // Seit 11.10. (Ralf) greifen Kanten nur im Modus „⬡ Kanten bearbeiten"
    selectObjs([objects[0]]); enterEdgeMode(true);
  });
  await pg.waitForTimeout(300);
  // Bildschirmpunkt auf der senkrechten Kante x=1,z=1 bei y=0.6
  const p = await pg.evaluate(() => { const r = vpEl.getBoundingClientRect(); const c = new THREE.Vector3(1,0.6,1).project(camera);
    return { x: r.left + (c.x+1)/2*r.width, y: r.top + (1-c.y)/2*r.height }; });
  for (const dx of [20, 50, 90, 150]) {
    await pg.mouse.move(p.x, p.y); await pg.waitForTimeout(100); await pg.mouse.down();
    for (let i = 1; i <= 10; i++) { await pg.mouse.move(p.x + dx*i/10, p.y); await pg.waitForTimeout(40); }
    await pg.waitForTimeout(700);
    const st = await pg.evaluate(() => ({ lastOk: _ebPrev && _ebPrev.lastOk, drag: _edgeBevelDragging, sel: [..._edgeSel], prev: _ebPrev && { kind: _ebPrev.kind, fail: _ebPrev.fail, mesh: !!(_ebPrev.mesh && _ebPrev.mesh.visible), done: _ebPrev.done }, lbl: document.getElementById('edge-bevel-label').textContent }));
    await pg.mouse.up(); await pg.waitForTimeout(1200);
    const after = await pg.evaluate(() => (objects[objects.length-1].userData._occtParams?.ops || []).map(x => x.type + x.dist.toFixed(2)));
    console.log('dx', dx, JSON.stringify(st), '→', JSON.stringify(after));
    await pg.evaluate(() => { undo(); }); await pg.waitForTimeout(500);
    await pg.evaluate(() => { if (_edgeMode) exitEdgeMode(); selectObjs([objects[objects.length-1]]); enterEdgeMode(true); });
    await pg.waitForTimeout(200);
  }
} finally { await b.close(); srv.kill(); }
