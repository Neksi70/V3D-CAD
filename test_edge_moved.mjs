// Kante bearbeiten an einem OCCT-Ergebnis, das danach verschoben/skaliert wurde
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8855;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => console.log('ERR', e.message));
let fails = 0;
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  await pg.evaluate(() => hideStarter());
  await pg.mouse.click(700, 450);
  for (const [label, mv] of [['unverschoben', { p: [0,0,0], s: 1 }], ['verschoben x+1.5 y+0.5', { p: [1.5,0.5,0], s: 1 }], ['skaliert 1.5', { p: [0,0,0], s: 1.5 }]]) {
    await pg.evaluate(async (mv) => {
      const isE = (ax,ay,az,bx,by,bz) => e => { const A=e.worldA,B=e.worldB, near=(p,x,y,z)=>Math.abs(p[0]-x)+Math.abs(p[1]-y)+Math.abs(p[2]-z)<0.01;
        return (near(A,ax,ay,az)&&near(B,bx,by,bz))||(near(A,bx,by,bz)&&near(B,ax,ay,az)); };
      await _loadOCCT(); _newCreate(false); addShape('box');
      const o = objects[0]; selectObjs([o]); enterEdgeMode(true);
      _edgeSel.clear(); _edgeSel.add(o.userData._dynamicEdges.findIndex(isE(1,2,-1, 1,2,1))); await _applyEdgeHandleValue(0.6);
      if (_edgeMode) exitEdgeMode();
      const r = objects[0]; r.position.set(...mv.p); r.scale.setScalar(mv.s); r.updateMatrixWorld(true);
      selectObjs([r]);
    }, mv);
    await pg.waitForTimeout(300);
    // senkrechte Kante vorn links (Welt, vor dem Verschieben x=-1,z=1) → nach Transform
    const p = await pg.evaluate((mv) => { const r = vpEl.getBoundingClientRect();
      const w = new THREE.Vector3(-1, 1.0, 1).multiplyScalar(mv.s).add(new THREE.Vector3(...mv.p));
      const c = w.clone().project(camera);
      return { x: r.left + (c.x+1)/2*r.width, y: r.top + (1-c.y)/2*r.height, w: w.toArray() }; }, mv);
    await pg.mouse.move(p.x, p.y); await pg.waitForTimeout(100); await pg.mouse.down();
    for (let i = 1; i <= 10; i++) { await pg.mouse.move(p.x + 3*i, p.y); await pg.waitForTimeout(40); }
    await pg.waitForTimeout(600);
    const st = await pg.evaluate(() => ({ sel: [..._edgeSel], lbl: document.getElementById('edge-bevel-label').textContent,
      lineMatches: (() => { if (!_edgeLines || !_edgeSel.size) return null; const i = [..._edgeSel][0]; const pos = _edgeLines.geometry.attributes.position;
        const a = new THREE.Vector3().fromBufferAttribute(pos, i*2).applyMatrix4(_edgeLines.matrixWorld);
        const d = _edgeObj.userData._dynamicEdges[i]; return a.distanceTo(new THREE.Vector3(...d.worldA)) < 0.01; })() }));
    await pg.mouse.up(); await pg.waitForTimeout(1200);
    const after = await pg.evaluate(() => { const o = objects[0]; const bb = getMeshBox(o);
      return { ops: (o.userData._occtParams?.ops || []).map(x => x.type + x.dist.toFixed(2)), min: bb.min.toArray().map(v=>+v.toFixed(2)), max: bb.max.toArray().map(v=>+v.toFixed(2)) }; });
    const ok = after.ops.length === 2 && !/zu groß/.test(st.lbl);
    if (!ok) fails++;
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label, JSON.stringify(st), '→', JSON.stringify(after));
  }
} finally { console.log('fails', fails); await b.close(); srv.kill(); }
