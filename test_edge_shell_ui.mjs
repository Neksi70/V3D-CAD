// UI-Weg: Quader → Gehäuse (oben offen) → Innenkante im Kanten-Modus fasen/runden → außen scharf?
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8966;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage();
pg.on('console', m => { if (/shell|Shell|efp|OCCT/.test(m.text())) console.log('[con]', m.text().slice(0, 200)); });
const kind = process.argv[2] || 'chamfer', wo = process.argv[3] || 'innen';
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function' && window.v3dApi);
  const r = await pg.evaluate(async ([kind, wo]) => {
    try { hideStarter(); } catch (e) {}
    const A = window.v3dApi;
    const c = await A.execute('shape.add', { type: 'box', size: [40, 40, 40] });
    const id = (c.created && c.created[0] && c.created[0].id) || (c.result && c.result.id) || c.id;
    const s = await A.execute('body.shell', { id, thickness: 3, open: 'top' });
    let o = objects[objects.length - 1];
    const before = JSON.stringify(o.userData._occtParams.ops);
    selectObjs([o]); enterEdgeMode && enterEdgeMode();
    await new Promise(r => setTimeout(r, 300));
    o = objects[objects.length - 1];
    const dyn = o.userData._dynamicEdges || [];
    // Innenkante senkrecht: x,z beide 3 mm innerhalb der Außen-Box, senkrecht
    const bb = getMeshBox(o);
    const isIn = e => Math.abs(e.worldA[0] - e.worldB[0]) < 1e-4 && Math.abs(e.worldA[2] - e.worldB[2]) < 1e-4 &&
      Math.abs(e.worldA[0] - (bb.max.x - (wo === 'innen' ? 0.3 : 0))) < 1e-3 && Math.abs(e.worldA[2] - (bb.max.z - (wo === 'innen' ? 0.3 : 0))) < 1e-3;
    const idx = dyn.findIndex(isIn);
    if (idx < 0) return { err: 'keine Innenkante', n: dyn.length, dyn: dyn.slice(0, 40).map(e => [e.worldA, e.worldB]), bb: [bb.min.toArray(), bb.max.toArray()], s };
    _edgeSel.clear ? _edgeSel.clear() : _edgeSel.splice(0);
    _edgeSel.add ? _edgeSel.add(idx) : _edgeSel.push(idx);
    await _applyEdgeHandleValue(kind === 'chamfer' ? -0.48 : 0.48);   // negativ = Fase (wie Zug nach links)
    await new Promise(r => setTimeout(r, 300));
    o = objects[objects.length - 1];
    const g = o.geometry, p = g.attributes.position; o.updateMatrixWorld(true);
    const v = new THREE.Vector3(); let sharp = false;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (Math.abs(v.x - bb.max.x) < 1e-3 && Math.abs(v.z - bb.max.z) < 1e-3 && v.y > bb.max.y - 1e-3) sharp = true; }
    return { idx, sharp, nDyn: dyn.length, vol: (() => { const ix = g.index; let V = 0; const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c2 = new THREE.Vector3();
      const at = (t, w) => w.fromBufferAttribute(p, ix ? ix.getX(t) : t).applyMatrix4(o.matrixWorld);
      const n = ix ? ix.count : p.count; for (let t = 0; t < n; t += 3) { at(t, a); at(t+1, b2); at(t+2, c2); V += a.dot(b2.cross(c2)) / 6; } return +(Math.abs(V) * 1000).toFixed(1); })(), ops: o.userData._occtParams.ops.map(x => ({ t: x.type, ns: x.ns, d: x.dist, wa: x.wa && x.wa.map(n => +n.toFixed(3)), wb: x.wb && x.wb.map(n => +n.toFixed(3)) })), before };
  }, [kind, wo]);
  console.log(JSON.stringify(r, null, 1));
  const want = wo === 'innen';   // innen bearbeitet → außen muss scharf bleiben; außen bearbeitet → außen rund/fasig
  const volOk = wo === 'innen' ? r.vol > 21228 + 30 : r.vol < 21228 - 30;
  console.log(kind, wo, 'Kanten', r.nDyn, 'Volumen', r.vol, 'ns', JSON.stringify((r.ops||[]).map(x => x.ns)));
  console.log((r.sharp === want && volOk) ? 'OK' : 'FEHL', want ? 'innen bearbeitet, außen scharf' : 'außen bearbeitet (wie bisher)');
  if (!(r.sharp === want && volOk)) process.exitCode = 1;
} finally { await b.close(); srv.kill(); }
