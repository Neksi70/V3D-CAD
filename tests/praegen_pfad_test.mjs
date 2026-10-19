// Prägen entlang Pfad: V-Nut, Rechteck-Steg, Ringnut (v1.18.198)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8870;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _embApply === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._vol = o => { o.updateMatrixWorld(true); const g = o.geometry.clone().toNonIndexed(); g.applyMatrix4(o.matrixWorld); const P = g.attributes.position; let v = 0;
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 3) { A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i+1); C.fromBufferAttribute(P, i+2); v += A.dot(B.clone().cross(C)); } return Math.abs(v / 6) * 1000; };
    window._run = async (ents, pp) => {
      if (_sk.active) exitSketchMode(); _newCreate(false); addShape('box'); objects[0].updateMatrixWorld(true); deselect();
      const v0 = _vol(objects[0]);
      enterSketchMode(); _skSetFrame(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2, 0)); _sk.ents = ents; _skRender();
      _embOpen(); Object.assign(_emb.p, pp); await _embApply();
      for (let i = 0; i < 40 && (objects.length !== 1 || objects[0].userData.isHole); i++) await new Promise(r => setTimeout(r, 150));
      await new Promise(r => setTimeout(r, 300));
      const bb = getMeshBox(objects[0]); return { n: objects.length, dv: _vol(objects[0]) - v0, maxY: +(bb.max.y * 10).toFixed(2) };
    }; });
  const line = [{ type: 'line', a: { u: -0.6, v: 0 }, b: { u: 0.6, v: 0 } }];
  let r = await p.evaluate(l => _run(l, { mode: 'cut', prof: 'v', w: 2, d: 1 }), line);
  ok(r.n === 1 && Math.abs(r.dv + 12) < 0.3, `V-Nut 12 mm lang, 2 breit, 1 tief: −${(-r.dv).toFixed(2)} mm³ (soll −12)`);
  r = await p.evaluate(l => _run(l, { mode: 'join', prof: 'q', w: 2, d: 1 }), line);
  ok(r.n === 1 && Math.abs(r.dv - 24) < 0.3 && Math.abs(r.maxY - 21) < 0.05, `Rechteck-Steg: +${r.dv.toFixed(2)} mm³ (soll +24), Oberkante ${r.maxY} mm`);
  r = await p.evaluate(() => _run([{ type: 'circle', c: { u: 0, v: 0 }, r: 0.6 }], { mode: 'cut', prof: 'r', w: 1.5, d: 1 }));
  const soll = Math.PI * 0.75 * 1 / 2 * 2 * Math.PI * 6;   // halbe Ellipse 0,75×1 mm um r 6 mm
  ok(r.n === 1 && Math.abs(-r.dv - soll) / soll < 0.04, `Ringnut rund: −${(-r.dv).toFixed(2)} mm³ (soll ≈ −${soll.toFixed(2)})`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
