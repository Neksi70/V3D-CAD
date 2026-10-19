// Fläche löschen und heilen: Bohrung, Zapfen, Rundung außen/innen, Fase (v1.18.212)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8882;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof enterHealFace === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._vo = o => { o.updateMatrixWorld(true); const g = o.geometry.clone().toNonIndexed(); g.applyMatrix4(o.matrixWorld); const P = g.attributes.position; let v = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 3) { A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i+1); C.fromBufferAttribute(P, i+2); v += A.dot(B.clone().cross(C)); } return Math.abs(v / 6) * 1000; };
    // Teil bauen (Manifold, mm, Z oben), als Netz-Objekt einsetzen; dann per Strahl die Fläche anklicken und heilen
    window._case = async (kind, ray) => {
      const w = await _mfInit(), M = w.Manifold, appMf = g => _mfUnionObjs(w, [new THREE.Mesh(g)]);
      let m;
      const box = M.cube([30, 20, 10], false);
      if (kind === 'bohrung') m = box.subtract(M.cylinder(14, 3, 3, 96, false).translate([15, 10, -2]));
      if (kind === 'zapfen') m = box.add(M.cylinder(5, 4, 4, 96, false).translate([15, 10, 10]));
      if (kind === 'rundA') m = box.subtract(M.cube([4, 4, 12], false).translate([26, 16, -1])).add(M.cylinder(10, 4, 4, 96, false).translate([26, 16, 0]));
      if (kind === 'rundI') { m = M.cube([30, 20, 5], false).add(M.cube([30, 5, 20], false).translate([0, 15, 0]));
        m = m.add(M.cube([30, 3, 3], false).translate([0, 12, 5]).subtract(M.cylinder(32, 3, 3, 96, false).rotate([0, 90, 0]).translate([-1, 12, 8]))); }
      if (kind === 'fase') m = box.subtract(appMf(_healPrism([new THREE.Vector3(3.0, 0, -1.6), new THREE.Vector3(3.0, 0, -2.0), new THREE.Vector3(2.6, 0, -2.0), new THREE.Vector3(3.2, 0, -2.2), new THREE.Vector3(3.2, 0, -1.4)].slice(0, 3).map((v, i) => i === 0 ? new THREE.Vector3(3.0, 0, -1.6) : i === 1 ? new THREE.Vector3(3.0, 0, -2.0) : new THREE.Vector3(2.6, 0, -2.0)), new THREE.Vector3(0, 1, 0), -0.1, 1.2)));
      const geo = _mfToGeo(m).toNonIndexed(); geo.rotateX(-Math.PI / 2); geo.scale(0.1, 0.1, 0.1);
      _newCreate(false);
      const o = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9ca3af, side: THREE.DoubleSide })); o.userData = { id: idCtr++, type: 'custom', shapeType: 'custom', name: 'Teil ' + kind, color: '#9ca3af' };
      objects.push(o); scene.add(o); _updateObjEdgeLines(o); o.updateMatrixWorld(true);
      const v0 = _vo(o);
      enterHealFace();
      raycaster.set(new THREE.Vector3(...ray[0]), new THREE.Vector3(...ray[1]).normalize());
      const hit = raycaster.intersectObject(o, false)[0]; if (!hit) return { err: 'kein Treffer' };
      const info = _healPick(hit); if (!info || info.err) return { err: info ? info.err : 'nichts erkannt', v0 };
      const text = info.text; await _healApply(); await new Promise(r => setTimeout(r, 200));
      return { kind: info.kind, text, v0, v1: _vo(objects[0]), n: objects.length };
    }; });
  const cases = [
    ['bohrung', [[1.5, 0.5, -1.0], [1, 0, 0]], 6000, 'bohrung'],
    ['zapfen', [[5, 1.25, -1.0], [-1, 0, 0]], 6000, 'zapfen'],
    ['rundA', [[4.0, 0.5, -3.0], [-1, 0, 1]], 6000, 'rundungAussen'],
    ['rundI', [[1.5, 0.8, -1.2], [0, -1, -1]], 5250, 'rundungInnen'],
    ['fase', [[4.0, 0.5, -3.0], [-1, 0, 1]], 6000, 'faseAussen'],
  ];
  for (const [kind, ray, soll, erwart] of cases) {
    const r = await p.evaluate(([k, ray]) => _case(k, ray), [kind, ray]);
    ok(!r.err && r.kind === erwart && r.n === 1 && Math.abs(r.v1 - soll) / soll < 0.003, `${kind}: ${r.err || r.text} — ${r.v0 ? r.v0.toFixed(1) : '?'} → ${r.v1 ? r.v1.toFixed(1) : '?'} mm³ (soll ${soll})`);
  }
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
