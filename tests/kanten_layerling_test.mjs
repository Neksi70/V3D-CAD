// Kanten-Werkzeug: Fase mit Winkel, Obere Kanten, glatte Ketten, Kanten-Liste
// (Ideen aus dem layerling-Abgleich 14.10.2026).
// Start: node tests/kanten_layerling_test.mjs  (startet eigenen --dev-Server)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8941;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK  ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function', { timeout: 60000 });
  await pg.evaluate(() => hideStarter());
  await pg.mouse.click(700, 450);
  await pg.evaluate(() => {
    window._vol = o => {   // signiertes Volumen in Szene-Einheiten³ (Welt)
      o.updateMatrixWorld(true);
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      const p = g.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let v = 0;
      for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(p, i + 1).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(p, i + 2).applyMatrix4(o.matrixWorld);
        v += a.dot(b.clone().cross(c)) / 6;
      }
      return v;
    };
    window._findEdge = (o, pred) => (o.userData._dynamicEdges || []).findIndex(ed => {
      const [a, b] = _edgeWorldPts(o, ed); return pred(a, b);
    });
  });

  console.log('\n=== 1. Obere Kanten am Quader ===');
  const r1 = await pg.evaluate(async () => {
    _newCreate(false); addShape('box'); await _loadOCCT();
    const o = objects[0]; selectObjs([o]); enterEdgeMode(true);
    _edgeSelectTop();
    const bb = getMeshBox(o);
    return { n: _edgeSel.size, ok: [..._edgeSel].every(i => { const [a, b] = _edgeWorldPts(o, o.userData._dynamicEdges[i]); return a.y > bb.max.y - 1e-3 && b.y > bb.max.y - 1e-3; }),
             size: bb.getSize(new THREE.Vector3()).toArray(), panel: !!document.querySelector('[onclick="_edgeSelectTop()"]') };
  });
  ok('4 obere Kanten gewählt, alle oben', r1.n === 4 && r1.ok, r1);
  ok('Knopf „Obere Kanten" im Panel', r1.panel);

  console.log('\n=== 2. Fase 2 mm mit 30° ===');
  const r2 = await pg.evaluate(async () => {
    const o = _edgeObj; const bb = getMeshBox(o);
    const v0 = _vol(o);
    const L = bb.max.x - bb.min.x;
    const i = _findEdge(o, (a, b) => a.y > bb.max.y - 1e-3 && b.y > bb.max.y - 1e-3 && Math.abs(a.z - bb.min.z) < 1e-3 && Math.abs(b.z - bb.min.z) < 1e-3);
    _edgeSel.clear(); _edgeSel.add(i);
    _edgeSetChamferAngle(30);
    await _applyEdgeHandleValue(-0.2);
    if (_edgeMode) exitEdgeMode();
    const r = objects[objects.length - 1];
    const ops = r.userData._occtParams.ops;
    const b2 = getMeshBox(r);
    // Vorderfläche (z = min): höchster Punkt muss um 0,2·tan30 = 0,1155 tiefer liegen
    const p = r.geometry.attributes.position; let frontTop = -1e9;
    for (let k = 0; k < p.count; k++) if (Math.abs(p.getZ(k) - b2.min.z) < 1e-4) frontTop = Math.max(frontTop, p.getY(k));
    return { v0, v1: _vol(r), L, ops: ops.map(x => ({ t: x.type, d: x.dist, ang: x.ang, grp: !!x.grp })), drop: b2.max.y - frontTop };
  });
  const want2 = 0.5 * 0.2 * 0.2 * Math.tan(30 * Math.PI / 180) * r2.L;
  ok('Op trägt Winkel 30° + Gruppe', r2.ops.length === 1 && r2.ops[0].ang === 30 && r2.ops[0].grp, r2.ops);
  ok('Schenkel an der Vorderfläche = 1,15 mm', Math.abs(r2.drop - 0.11547) < 0.003, r2.drop);
  ok('Volumen = Keil 0,5·d·d·tan30·L', Math.abs((r2.v0 - r2.v1) - want2) < 0.002, { weg: r2.v0 - r2.v1, want2 });

  console.log('\n=== 3. Zweite Bearbeitung + Kanten-Liste ===');
  const r3 = await pg.evaluate(async () => {
    let o = objects[objects.length - 1]; selectObjs([o]); enterEdgeMode(true);
    const bb = getMeshBox(o);
    // hintere untere Kante (berührt die Fase nicht)
    const i = _findEdge(o, (a, b) => a.y < bb.min.y + 1e-3 && b.y < bb.min.y + 1e-3 && Math.abs(a.z - bb.max.z) < 1e-3 && Math.abs(b.z - bb.max.z) < 1e-3);
    _edgeSel.clear(); _edgeSel.add(i);
    await _applyEdgeHandleValue(0.3);
    if (_edgeMode) exitEdgeMode();
    o = objects[objects.length - 1]; selectObjs([o]); enterEdgeMode(true);
    _fpCurType = null; updateFP();
    const gs = _edgeFeatGroups(o);
    const rows = [...document.querySelectorAll('.fp-efeat')].map(e => e.textContent);
    return { gs: gs.map(g => _edgeFeatLabel(g)), rows, v: _vol(o) };
  });
  ok('Liste: Fase + Rundung', r3.gs.length === 2 && /Fase 2,0 mm \/ 30°/.test(r3.gs[0]) && /Rundung 3,0 mm/.test(r3.gs[1]), r3.gs);
  ok('Liste im Panel sichtbar', r3.rows.length === 2, r3.rows);

  console.log('\n=== 4. Fase ändern auf 3 mm / 45° ===');
  const r4 = await pg.evaluate(async () => {
    const o = _edgeObj;
    const g = _edgeFeatGroups(o).find(x => x.type === 'chamfer');
    _edgeFeatEditStart(g.key);
    document.getElementById('fp-efeat-mm').value = '3';
    document.getElementById('fp-efeat-ang').value = '45';
    await _edgeFeatEditApply();
    const r = objects[objects.length - 1];
    return { gs: _edgeFeatGroups(r).map(x => _edgeFeatLabel(x)), v: _vol(r), edge: _edgeMode && _edgeObj === r };
  });
  const L = r2.L, rr = 0.3;
  const filletLoss = (1 - Math.PI / 4) * rr * rr * L;
  ok('Liste nach Ändern', /Fase 3,0 mm · 1 Kante/.test(r4.gs[0]) && !/°/.test(r4.gs[0]), r4.gs);
  ok('Volumen nach Ändern (45°-Fase 3 mm + Rundung)', Math.abs((r2.v0 - r4.v) - (0.5 * 0.09 * L + filletLoss)) < 0.01, { weg: r2.v0 - r4.v, want: 0.5 * 0.09 * L + filletLoss });
  ok('bleibt im Kanten-Modus', r4.edge);

  console.log('\n=== 5. Fase zurücknehmen, Rundung bleibt ===');
  const r5 = await pg.evaluate(async () => {
    const o = _edgeObj;
    const g = _edgeFeatGroups(o).find(x => x.type === 'chamfer');
    const u0 = undoStack.length;
    await _edgeFeatRemove(g.key);
    const r = objects[objects.length - 1];
    return { gs: _edgeFeatGroups(r).map(x => _edgeFeatLabel(x)), v: _vol(r), undo: undoStack.length > u0 || undoStack.length >= 50, n: objects.length };
  });
  ok('nur noch Rundung', r5.gs.length === 1 && /Rundung/.test(r5.gs[0]), r5.gs);
  ok('Volumen = nur Rundung', Math.abs((r2.v0 - r5.v) - filletLoss) < 0.01, { weg: r2.v0 - r5.v, filletLoss });
  ok('Undo-Stand gesichert, 1 Objekt', r5.undo && r5.n === 1, r5);

  console.log('\n=== 6. Glatte Kette (Kreis aus 32 Stücken + Quadrat) ===');
  const r6 = await pg.evaluate(() => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), new THREE.MeshBasicMaterial());
    const E = [];
    for (let i = 0; i < 32; i++) {
      const a0 = i / 32 * Math.PI * 2, a1 = (i + 1) / 32 * Math.PI * 2;
      E.push({ worldA: [Math.cos(a0), 0.5, Math.sin(a0)], worldB: [Math.cos(a1), 0.5, Math.sin(a1)] });
    }
    const sq = [[3, 3], [5, 3], [5, 5], [3, 5]];
    for (let i = 0; i < 4; i++) { const p = sq[i], q = sq[(i + 1) % 4]; E.push({ worldA: [p[0], 0.5, p[1]], worldB: [q[0], 0.5, q[1]] }); }
    // gerade Linie aus 3 Stücken, in der Mitte zweigt eine Kante ab (T)
    E.push({ worldA: [-5, 0.5, 0], worldB: [-4, 0.5, 0] }, { worldA: [-4, 0.5, 0], worldB: [-3, 0.5, 0] }, { worldA: [-3, 0.5, 0], worldB: [-2, 0.5, 0] }, { worldA: [-4, 0.5, 0], worldB: [-4, 0.5, 1] });
    o.userData = { _dynamicEdges: E, _dynEdgesWorld: true };
    const prev = _edgeTangentChain;
    _edgeTangentChain = true;
    const circ = _edgeChainOf(o, 5).length, sqr = _edgeChainOf(o, 33).length, tee = _edgeChainOf(o, 36).length, tee2 = _edgeChainOf(o, 38).length;
    _edgeTangentChain = false;
    const off = _edgeChainOf(o, 5).length;
    _edgeTangentChain = prev;
    return { circ, sqr, tee, tee2, off };
  });
  ok('Kreis: ein Klick = 32 Stücke', r6.circ === 32, r6);
  ok('Quadrat-Ecken (90°) stoppen die Kette', r6.sqr === 1, r6);
  ok("Abzweig (3 Kanten) stoppt die Kette", r6.tee === 1 && r6.tee2 === 2, r6);
  ok('Schalter aus = nur die Kante', r6.off === 1, r6);

  ok('keine Seitenfehler', errs.length === 0, errs);
} catch (e) {
  console.log('ABBRUCH', e); fails++;
} finally {
  await b.close(); srv.kill();
}
console.log(fails ? `\n${fails} FEHLER` : '\nalles OK');
process.exit(fails ? 1 : 0);
