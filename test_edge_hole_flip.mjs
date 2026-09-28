// Lochrand: Seite A anfasen, Körper UMDREHEN (180° um X), Seite B anfasen.
// Beide Fasen müssen gleich viel Material nehmen und am Loch sitzen
// (Volker 28.9.: nach dem Umdrehen entstand eine Sichel am Plattenrand).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8863;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('console', m => { if (/rim|manifold/i.test(m.text())) console.log('[c]', m.text().slice(0, 200)); });
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  console.log(await pg.evaluate(async (FLIP) => {
    const vol = g => { const p = g.attributes.position, ix = g.index; let v = 0; const n = ix ? ix.count : p.count;
      for (let t = 0; t < n; t += 3) { const a = ix?ix.getX(t):t, b = ix?ix.getX(t+1):t+1, c = ix?ix.getX(t+2):t+2;
        v += (p.getX(a)*(p.getY(b)*p.getZ(c)-p.getY(c)*p.getZ(b)) - p.getX(b)*(p.getY(a)*p.getZ(c)-p.getY(c)*p.getZ(a)) + p.getX(c)*(p.getY(a)*p.getZ(b)-p.getY(b)*p.getZ(a)))/6; } return v*1000; };
    const out = [];
    hideStarter(); _newCreate(false);
    addShape('box'); const box = objects[objects.length - 1];
    addShape('cylinder'); const cyl = objects[objects.length - 1];
    box.scale.set(5, 0.5, 2); box.position.set(0, 0.5, 0);
    cyl.scale.set(0.4, 1, 0.4); cyl.position.set(-3.5, 0.5, 0); cyl.userData.isHole = true;
    selectObjs([box, cyl]); subtractHoles();
    for (let i = 0; i < 300 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 300));
    const bevelTop = async (val) => {
      const o = objects[0]; selectObjs([o]); enterEdgeMode(true);
      const dyn = o.userData._dynamicEdges;
      const bb = getMeshBox(o);
      const idx = dyn.map((d, i) => [d, i]).filter(([d]) => d.rim && d.rim.axisW[1] > 0.9 && Math.abs(d.rim.cW[1] - bb.max.y) < 0.01)
        .sort((a, b) => a[0].rim.rW - b[0].rim.rW)[0];
      if (!idx) return 'kein oberer Rand; Ränder: ' + JSON.stringify(dyn.filter(d => d.rim).map(d => [d.rim.cW.map(v=>+v.toFixed(2)), d.rim.axisW.map(v=>+v.toFixed(2)), +d.rim.rW.toFixed(3)]));
      const rim = idx[0].rim;
      _edgeSel.clear(); _edgeSel.add(idx[1]);
      const v0 = vol(o.geometry);
      await _applyEdgeHandleValue(val);
      const o2 = objects[0]; const v1 = vol(o2.geometry);
      o2.updateMatrixWorld(true);
      const bb2 = new THREE.Box3().setFromObject(o2);
      if (_edgeMode) exitEdgeMode();
      return { rimC: rim.cW.map(v => +v.toFixed(3)), rimAx: rim.axisW.map(v => +v.toFixed(2)), rimR: +(rim.rW*10).toFixed(2), rimRloc: +rim.r.toFixed(3),
               dV: +(v0 - v1).toFixed(1), bbMin: bb2.min.toArray().map(v=>+v.toFixed(2)), bbMax: bb2.max.toArray().map(v=>+v.toFixed(2)),
               pos: o2.position.toArray().map(v=>+v.toFixed(2)), rot: o2.rotation.toArray().slice(0,3).map(v=>+(+v).toFixed(2)) };
    };
    out.push(['A', await bevelTop(-0.2)]);
    // Umdrehen
    const o = objects[0];
    o.rotation.x += Math.PI;
    if (FLIP === 'move') { o.rotation.y += 0.6; o.position.x += 2.3; o.position.z -= 1.1; }
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o); o.position.y -= bb.min.y; o.updateMatrixWorld(true);
    out.push(['B', await bevelTop(-0.2)]);
    const ok = out[0][1].dV > 10 && Math.abs(out[0][1].dV - out[1][1].dV) < 2;
    return JSON.stringify(out, null, 0) + '\n' + (ok ? 'OK ✓' : 'FEHLER ✗');
  }, process.argv[2] || 'move'));
} finally { console.log('errs', errs.slice(0, 3)); await b.close(); srv.kill(); }
