// Loft mit Führungslinien (v1.18.214)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8884;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _lfGuideRows === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._st = g => { const gg = g.index ? g.toNonIndexed() : g, P = gg.attributes.position, q = 1e-4, key = i => Math.round(P.getX(i)/q)+','+Math.round(P.getY(i)/q)+','+Math.round(P.getZ(i)/q);
      const E = new Map(); let v = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let t = 0; t < P.count; t += 3) { for (const [i, j] of [[t,t+1],[t+1,t+2],[t+2,t]]) { const a = key(i), b2 = key(j), k = a < b2 ? a+'|'+b2 : b2+'|'+a; E.set(k, (E.get(k)||0)+1); }
        A.fromBufferAttribute(P, t); B.fromBufferAttribute(P, t+1); C.fromBufferAttribute(P, t+2); v += A.dot(B.clone().cross(C)); }
      let open = 0; for (const n of E.values()) if (n !== 2) open++; return { open, vol: Math.abs(v / 6) }; };
    window._sq = (y, h) => [[-h,-h],[h,-h],[h,h],[-h,h]].map(([x, z]) => new THREE.Vector3(x, y, z));
    window._radAt = (g, y0) => { const P = g.attributes.position; let m = 0; for (let i = 0; i < P.count; i++) if (Math.abs(P.getY(i) - y0) < 0.15) m = Math.max(m, Math.hypot(P.getX(i), P.getZ(i))); return m; };
    window._ringOk = (g, ring) => ring.every(c => { const P = g.attributes.position; let d = Infinity; for (let i = 0; i < P.count; i++) d = Math.min(d, Math.hypot(P.getX(i) - c.x, P.getY(i) - c.y, P.getZ(i) - c.z)); return d < 1e-4; }); });
  let r = await p.evaluate(() => { const R = [_sq(0, 1), _sq(4, 1)];
    const g0 = _buildLoft3DGeo(R, 64, false), guide = [new THREE.Vector3(1, 0, 1), new THREE.Vector3(1.8, 2, 1.8), new THREE.Vector3(1, 4, 1)];
    const g1 = _buildLoft3DGeo(R, 64, false, null, [guide]);
    return { r0: _radAt(g0, 2), r1: _radAt(g1, 2), st: _st(g1), ends: _ringOk(g1, R[0]) && _ringOk(g1, R[1]), v0: _st(g0).vol }; });
  ok(r.st.open === 0 && Math.abs(r.r1 - Math.SQRT2 * 1.8) < 0.08 && r.r0 < 1.5 && r.ends && r.st.vol > r.v0, `Führung zieht die Ecke auf r ${r.r1.toFixed(2)} (soll ${(Math.SQRT2 * 1.8).toFixed(2)}, ohne ${r.r0.toFixed(2)}), Enden exakt, wasserdicht`);
  r = await p.evaluate(() => { const R = [_sq(0, 1), _sq(4, 1)];
    const g = _buildLoft3DGeo(R, 64, false, null, [[new THREE.Vector3(1, 0, 1), new THREE.Vector3(1.6, 2, 1.6), new THREE.Vector3(1, 4, 1)], [new THREE.Vector3(-1, 0, -1), new THREE.Vector3(-0.5, 2, -0.5), new THREE.Vector3(-1, 4, -1)]]);
    const P = g.attributes.position; let mx = 0, mn = 0; for (let i = 0; i < P.count; i++) if (Math.abs(P.getY(i) - 2) < 0.15) { mx = Math.max(mx, P.getX(i) + P.getZ(i)); mn = Math.min(mn, P.getX(i) + P.getZ(i)); }
    return { st: _st(g), mx, mn }; });
  ok(r.st.open === 0 && Math.abs(r.mx - 3.2) < 0.1 && Math.abs(r.mn + 1.0) < 0.1, `zwei Führungen: eine Ecke nach außen (${r.mx.toFixed(2)}), die gegenüber nach innen (${r.mn.toFixed(2)}), wasserdicht`);
  // Bedienweg + Verlauf + Speichern
  r = await p.evaluate(async () => { _newCreate(false); addShape('box'); addShape('box'); const [a, c] = objects; a.position.set(0, 1, 0); c.position.set(0, 7, 0);
    objects.forEach(o => o.updateMatrixWorld(true)); deselect(); enterLoftMode();
    raycaster.set(new THREE.Vector3(0, 50, 0.3), new THREE.Vector3(0, -1, 0)); _lfPickFace(raycaster.intersectObject(a)[0]);
    raycaster.set(new THREE.Vector3(0.3, -50, 0.2), new THREE.Vector3(0, 1, 0)); _lfPickFace(raycaster.intersectObject(c)[0]);
    _lfGuidePick(); _lf.guides.push([new THREE.Vector3(1, 2, 1), new THREE.Vector3(2, 4, 2), new THREE.Vector3(1, 6, 1)]); _lfStatus();
    const btn = document.getElementById('lf-guide').textContent;
    _lfApply(); const o = objects[objects.length - 1], f = o.userData.feat.list[0];
    const g2 = await _featRebuild(_featClone(o.userData.feat)); const d = objectToData(o), o2 = buildObjectFromData(d);
    return { btn, guides: f.guides && f.guides.length, lab: _featLabel(f, 0), same: Math.abs(_st(g2).vol - _st(o.geometry).vol) < 1e-3, saved: !!o2.userData._l3Guides }; });
  ok(r.guides === 1 && r.same && r.saved && /Führung/.test(r.lab), `Bedienweg: „${r.btn}“, ${r.lab}; Verlauf rechnet gleich nach, Führung übersteht Speichern`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
