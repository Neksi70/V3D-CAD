// Loft entlang Pfad (v1.18.201)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8874;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _lfPathRows === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._st = g => { const gg = g.index ? g.toNonIndexed() : g, P = gg.attributes.position, q = 1e-4, key = i => Math.round(P.getX(i)/q)+','+Math.round(P.getY(i)/q)+','+Math.round(P.getZ(i)/q);
      const E = new Map(); let v = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let t = 0; t < P.count; t += 3) { for (const [i, j] of [[t,t+1],[t+1,t+2],[t+2,t]]) { const a = key(i), b2 = key(j), k = a < b2 ? a+'|'+b2 : b2+'|'+a; E.set(k, (E.get(k)||0)+1); }
        A.fromBufferAttribute(P, t); B.fromBufferAttribute(P, t+1); C.fromBufferAttribute(P, t+2); v += A.dot(B.clone().cross(C)); }
      let open = 0; for (const n of E.values()) if (n !== 2) open++; return { open, vol: Math.abs(v / 6) }; };
    window._sqY = (c, h) => [[-h,-h],[h,-h],[h,h],[-h,h]].map(([x, z]) => new THREE.Vector3(c.x + x, c.y, c.z + z));
    window._sqX = (c, h) => [[-h,-h],[h,-h],[h,h],[-h,h]].map(([y, z]) => new THREE.Vector3(c.x, c.y + y, c.z + z)); });
  let r = await p.evaluate(() => { const R = [_sqY(new THREE.Vector3(0,0,0), 0.5), _sqY(new THREE.Vector3(0,4,0), 0.5)];
    const a = _st(_buildLoft3DGeo(R, 64, false)), b = _st(_buildLoft3DGeo(R, 64, false, [new THREE.Vector3(0,0,0), new THREE.Vector3(0,4,0)])); return { a, b }; });
  ok(r.b.open === 0 && Math.abs(r.b.vol - 4) < 0.01 && Math.abs(r.a.vol - r.b.vol) < 0.01, `gerader Pfad = gewöhnlicher Loft (${r.a.vol.toFixed(3)} / ${r.b.vol.toFixed(3)})`);
  // Viertelkreis R=5: Start (0,0,0) Richtung +Y, Ende (5,5,0) Richtung +X; Quadrat 1×1 → Volumen = 1 · π/2 · 5
  r = await p.evaluate(() => { const path = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI / 2; path.push(new THREE.Vector3(5 - 5 * Math.cos(a), 5 * Math.sin(a), 0)); }
    const R = [_sqY(new THREE.Vector3(0,0,0), 0.5), _sqX(new THREE.Vector3(5,5,0), 0.5)];
    const g = _buildLoft3DGeo(R, 64, false, path); g.computeBoundingBox(); return { st: _st(g), max: g.boundingBox.max.toArray().map(x => +x.toFixed(2)) }; });
  ok(r.st.open === 0 && Math.abs(r.st.vol - Math.PI * 2.5) / (Math.PI * 2.5) < 0.01, `Viertelkreis-Pfad: wasserdicht, ${r.st.vol.toFixed(3)} (soll ${(Math.PI*2.5).toFixed(3)}), Box ${r.max}`);
  // Übergang Quadrat → kleineres Quadrat entlang des Bogens (Volumen zwischen beiden)
  r = await p.evaluate(() => { const path = []; for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI / 2; path.push(new THREE.Vector3(5 - 5 * Math.cos(a), 5 * Math.sin(a), 0)); }
    return _st(_buildLoft3DGeo([_sqY(new THREE.Vector3(0,0,0), 0.5), _sqX(new THREE.Vector3(5,5,0), 0.25)], 64, false, path)); });
  ok(r.open === 0 && r.vol < Math.PI * 2.5 && r.vol > Math.PI * 2.5 * 0.25, `Übergang groß→klein entlang Bogen: ${r.vol.toFixed(3)}`);
  // Bedienweg: zwei Boxen übereinander, Pfad = senkrechte Kante einer dritten Box
  await p.evaluate(() => { _newCreate(false); addShape('box'); addShape('box'); addShape('box');
    const [a, c, d] = objects; a.position.set(0, 1, 0); c.position.set(0, 7, 0); d.position.set(4, 4, 0); d.scale.set(0.2, 4, 0.2); objects.forEach(o => { o.updateMatrixWorld(true); _updateObjEdgeLines(o); }); deselect(); setView('front'); enterLoftMode();
    raycaster.set(new THREE.Vector3(0, 50, 0.3), new THREE.Vector3(0, -1, 0)); _lfPickFace(raycaster.intersectObject(a)[0]);
    raycaster.set(new THREE.Vector3(0.3, -50, 0.2), new THREE.Vector3(0, 1, 0)); _lfPickFace(raycaster.intersectObject(c)[0]);
    _lfPathPick(); });
  const s = await p.evaluate(() => { const v = new THREE.Vector3(4.2, 4.5, 0.2).project(camera), r = vpEl.getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
  await p.mouse.move(s.x - 20, s.y + 20); await p.mouse.move(s.x, s.y, { steps: 6 }); await p.mouse.click(s.x, s.y); await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ picks: _lf.picks.length, path: _lf.path ? _lf.path.length : 0, st: document.getElementById('lf-status').textContent }));
  ok(r.picks === 2 && r.path >= 2, `2 Profile + Pfad gewählt (${r.st})`);
  r = await p.evaluate(() => { _lfApply(); const o = objects[objects.length - 1]; return { name: o.userData.name, path: !!o.userData._l3Path, n: objects.length }; });
  ok(r.n === 4 && r.path, `Loft erzeugt, Pfad gespeichert (${JSON.stringify(r)})`);
  r = await p.evaluate(() => { const o = objects[objects.length - 1]; const d = objectToData(o); const o2 = buildObjectFromData(d); return !!o2.userData._l3Path; });
  ok(r, 'Pfad übersteht Speichern/Laden');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
