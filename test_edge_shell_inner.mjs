// Ausgehöhlter Quader: Innenkante runden darf die Außenkante NICHT mitrunden (Volker 2.11.26)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8963;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage();
let fail = 0;
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  const res = await pg.evaluate(async () => {
    const oc = await _loadOCCT();
    const vol = geo => { const p = geo.attributes.position, ix = geo.index; let v = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let t = 0; t < ix.count; t += 3) { A.fromBufferAttribute(p, ix.getX(t)); B.fromBufferAttribute(p, ix.getX(t+1)); C.fromBufferAttribute(p, ix.getX(t+2)); v += A.dot(B.cross(C)) / 6; } return Math.abs(v); };
    const hasPt = (geo, x, y, z) => { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)-x) < 1e-4 && Math.abs(p.getY(i)-y) < 1e-4 && Math.abs(p.getZ(i)-z) < 1e-4) return true; return false; };
    const s = 2, t = 0.3, r = 0.5, dim = { sx: s, sy: s, sz: s };
    const shell = { type: 'shell', thickness: t, faces: [{ p: [s, 2*s, s] }], dim };
    const run = ops => { const base = _buildOCCTBaseShape(oc, 'box', s, s, s, null, 0, false, null);
      const R = _replayOCCTOps(oc, base, ops, s, s, s); if (!R.opOk) return { ok: false };
      const g = _occtShapeToThreeGeo(oc, R.shape, { x: 0, y: 0, z: 0 });
      return { ok: true, vol: vol(g), outerSharp: hasPt(g, 2*s, s, 2*s) || hasPt(g, 2*s, 2*s, 2*s), ns: R.ops.filter(o => o.type !== 'shell').map(o => o.ns), n: R.ops.length }; };
    const out = {};
    out.nurSchale = run([shell]);
    // 1) Innenkante (senkrecht, hinten rechts innen) NACH dem Aushöhlen runden
    out.innen = run(_mergeOCCTOps([JSON.parse(JSON.stringify(shell))], [{ idx: -1, type: 'fillet', dist: r, wa: [2*s-t, t, 2*s-t], wb: [2*s-t, 2*s, 2*s-t] }], dim));
    // 2) Außenkante nach dem Aushöhlen: wie bisher (gleichmäßige Wand)
    out.aussen = run(_mergeOCCTOps([JSON.parse(JSON.stringify(shell))], [{ idx: -1, type: 'fillet', dist: r, wa: [2*s, 0, 2*s], wb: [2*s, 2*s, 2*s] }], dim));
    // 3) Alt-Stand ohne ns: unverändert vor dem Aushöhlen
    out.alt = run([JSON.parse(JSON.stringify(shell)), { idx: -1, type: 'fillet', dist: r, wa: [2*s, 0, 2*s], wb: [2*s, 2*s, 2*s], dim }]);
    // 4) Innenkante + danach noch einmal neu rechnen (ns gespeichert)
    const ops4 = _mergeOCCTOps([JSON.parse(JSON.stringify(shell))], [{ idx: -1, type: 'fillet', dist: r, wa: [2*s-t, t, 2*s-t], wb: [2*s-t, 2*s, 2*s-t] }], dim);
    const base = _buildOCCTBaseShape(oc, 'box', s, s, s, null, 0, false, null);
    const live = _replayOCCTOps(oc, base, ops4, s, s, s).ops;
    out.wieder = run(JSON.parse(JSON.stringify(live)));
    // 5) Innen-Oberkante (Öffnungsrand innen, oben vorn)
    out.randInnen = run(_mergeOCCTOps([JSON.parse(JSON.stringify(shell))], [{ idx: -1, type: 'fillet', dist: 0.1, wa: [t, 2*s, 2*s-t], wb: [2*s-t, 2*s, 2*s-t] }], dim));
    out.erwartInnen = 64 - (4-2*t)*(4-t)*(4-2*t) + (r*r - Math.PI*r*r/4) * (4 - t);
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  const chk = (c, m) => { console.log((c ? 'OK   ' : 'FEHL ') + m); if (!c) fail++; };
  chk(res.innen.ok && res.innen.outerSharp, 'Innenkante gerundet → Außenecke bleibt scharf');
  chk(res.innen.ok && Math.abs(res.innen.vol - res.erwartInnen) < 0.02, 'Volumen innen gerundet ≈ ' + res.erwartInnen.toFixed(3) + ' (ist ' + (res.innen.vol||0).toFixed(3) + ')');
  chk(res.innen.ns && res.innen.ns[0] === true, 'Innenkante als „nach dem Aushöhlen" eingeordnet');
  chk(res.aussen.ok && !res.aussen.outerSharp && res.aussen.ns[0] === false, 'Außenkante: wie bisher vor dem Aushöhlen');
  chk(res.alt.ok && Math.abs(res.alt.vol - res.aussen.vol) < 1e-6, 'Alt-Stand ohne ns unverändert');
  chk(res.wieder.ok && Math.abs(res.wieder.vol - res.innen.vol) < 1e-6, 'Neu rechnen mit gespeichertem ns stabil');
  chk(res.randInnen.ok && res.randInnen.outerSharp && res.randInnen.vol > res.nurSchale.vol - 0.01 && res.randInnen.vol < res.nurSchale.vol, 'Innen-Öffnungsrand rundbar, außen scharf');
} finally { await b.close(); srv.kill(); }
console.log(fail ? 'FEHLER: ' + fail : 'ALLES OK'); process.exit(fail ? 1 : 0);
