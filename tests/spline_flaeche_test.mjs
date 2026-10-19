// Spline auf der Fläche (v1.18.213)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8883;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof enterSplineOnSurface === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._vo = o => { o.updateMatrixWorld(true); const g = o.geometry.clone().toNonIndexed(); g.applyMatrix4(o.matrixWorld); const P = g.attributes.position; let v = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 3) { A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i+1); C.fromBufferAttribute(P, i+2); v += A.dot(B.clone().cross(C)); } return Math.abs(v / 6) * 1000; };
    window._shoot = (o, from, to) => { raycaster.set(from, to.clone().sub(from).normalize()); return raycaster.intersectObject(o, false)[0]; }; });
  // Kugel R 10 mm bei (0,2,0): Ring um den Äquator, 8 Punkte, geschlossen; V-Nut 1,5 × 0,8
  let r = await p.evaluate(async () => { _newCreate(false); addShape('sphere'); const k = objects[0]; k.position.set(0, 2, 0); k.updateMatrixWorld(true);
    const C = new THREE.Vector3(0, 2, 0), v0 = _vo(k); enterSplineOnSurface();
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, d = new THREE.Vector3(Math.cos(a), 0.15 * Math.sin(2 * a), Math.sin(a)); _ssfAdd(_shoot(k, C.clone().addScaledVector(d, 5), C)); }
    _ssfAdd(_shoot(k, C.clone().addScaledVector(new THREE.Vector3(1, 0, 0), 5), C));   // Startpunkt → geschlossen
    const S = _ssfSample(), dev = Math.max(...S.P.map(q => Math.abs(q.distanceTo(C) - 1)));
    const closed = _ssf.closed, nS = S.P.length;
    Object.assign(_ssf.p, { mode: 'cut', prof: 'v', w: 1.5, d: 0.8 }); await _ssfApply();
    return { closed, nS, dev, v0, v1: _vo(objects[0]), n: objects.length }; });
  const soll = 0.5 * 1.5 * 0.8 * 2 * Math.PI * 10;   // Querschnitt × Umfang ≈ 37,7 mm³ (Welle macht es etwas länger)
  ok(r.closed && r.dev < 0.003, `Kurve geschlossen, ${r.nS} Punkte, liegt auf der Kugel (max. Abweichung ${(r.dev * 10).toFixed(3)} mm)`);
  ok(r.n === 1 && r.v0 - r.v1 > soll * 0.85 && r.v0 - r.v1 < soll * 1.4, `V-Nut rund um die Kugel: −${(r.v0 - r.v1).toFixed(1)} mm³ (≈ ${soll.toFixed(1)} + Wellenlänge)`);
  // Box: offener Steg quer über die Oberseite und die Seitenkante hinunter (folgt der Normalen)
  r = await p.evaluate(async () => { _newCreate(false); addShape('box'); const o = objects[0]; o.position.set(0, 1, 0); o.updateMatrixWorld(true); const v0 = _vo(o); enterSplineOnSurface();
    for (const [x, z] of [[-0.6, -0.5], [0, 0], [0.6, 0.4]]) _ssfAdd(_shoot(o, new THREE.Vector3(x, 5, z), new THREE.Vector3(x, 0, z)));
    Object.assign(_ssf.p, { mode: 'join', prof: 'q', w: 1, d: 1 }); await _ssfApply(); const bb = getMeshBox(objects[0]);
    return { v0, v1: _vo(objects[0]), top: bb.max.y * 10 }; });
  ok(r.v1 > r.v0 + 10 && Math.abs(r.top - 21) < 0.05, `Steg auf der Oberseite: +${(r.v1 - r.v0).toFixed(1)} mm³, Oberkante ${r.top.toFixed(2)} mm`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
