// Folgen: Profil entlang Modellkanten (3D-Sweep mit Gehrung, v1.18.194)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8864;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof enterFolgen === 'function' && typeof objects !== 'undefined', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._T = {
      stats(geo){ const pos = geo.attributes.position; const q = 1e-4, key = i => Math.round(pos.getX(i)/q)+','+Math.round(pos.getY(i)/q)+','+Math.round(pos.getZ(i)/q);
        const E = new Map(); let vol = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
        for (let t = 0; t < pos.count; t += 3) { for (const [i, j] of [[t,t+1],[t+1,t+2],[t+2,t]]) { const a = key(i), b = key(j), k = a < b ? a+'|'+b : b+'|'+a; E.set(k, (E.get(k)||0)+1); }
          A.fromBufferAttribute(pos, t); B.fromBufferAttribute(pos, t+1); C.fromBufferAttribute(pos, t+2); vol += A.dot(B.clone().cross(C)); }
        let open = 0; for (const n of E.values()) if (n !== 2) open++; return { open, vol: vol / 6 }; },
      sq(cx, cy, cz, h, n){ // Quadrat-Profil h×h in der Ebene ⟂ n (n = x oder z)
        const pts = n === 'x' ? [[0,-h,-h],[0,h,-h],[0,h,h],[0,-h,h]] : [[-h,-h,0],[h,-h,0],[h,h,0],[-h,h,0]];
        return { outer: pts.map(([x,y,z]) => new THREE.Vector3(cx+x, cy+y, cz+z)), holes: [], n: n === 'x' ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,0,1) }; } }; });

  // 1) gerader Pfad 20 mm, Profil 2×2 mm → 80 mm³
  let r = await p.evaluate(() => { const g = _flgGeo(_T.sq(0, 0, 0, 0.1, 'x'), [new THREE.Vector3(0,0,0), new THREE.Vector3(2,0,0)], false); return _T.stats(g); });
  ok(r.open === 0 && Math.abs(r.vol * 1000 - 80) < 0.01, `gerade: wasserdicht, ${(r.vol*1000).toFixed(3)} mm³ (soll 80)`);
  // 2) geschlossene Rechteckbahn 20×20 mm, Profil 2×2 mittig → Gehrung, Mittellinie 80 mm × 4 mm² = 320 mm³
  r = await p.evaluate(() => { const P = [[1,0,1],[-1,0,1],[-1,0,-1],[1,0,-1]].map(a => new THREE.Vector3(...a));
    const g = _flgGeo(_T.sq(0, 0, 1, 0.1, 'x'), P, true); return _T.stats(g); });
  ok(r.open === 0 && Math.abs(r.vol * 1000 - 320) < 0.05, `Rechteckbahn mit Gehrung: wasserdicht, ${(r.vol*1000).toFixed(3)} mm³ (soll 320)`);
  // 3) Profil mit Loch (Rohr) gerade: (4²−2²)·20 = 240 mm³
  r = await p.evaluate(() => { const pr = _T.sq(0, 0, 0, 0.2, 'x'); pr.holes = [_T.sq(0, 0, 0, 0.1, 'x').outer];
    const g = _flgGeo(pr, [new THREE.Vector3(0,0,0), new THREE.Vector3(2,0,0)], false); return _T.stats(g); });
  ok(r.open === 0 && Math.abs(r.vol * 1000 - 240) < 0.05, `Hohlprofil: wasserdicht, ${(r.vol*1000).toFixed(3)} mm³ (soll 240)`);

  // 4) Echter Klick: Zylinder Ø20×20, oberer Rand als Pfad (ein Klick = ganzer Kreis), Kreisprofil r 1,5 mm → Wulst angefügt
  await p.evaluate(() => { _newCreate(false); addShape('cylinder'); objects[0].updateMatrixWorld(true); deselect(); setView('iso'); });
  const bb0 = await p.evaluate(() => { const bb = getMeshBox(objects[0]); return [bb.min.toArray(), bb.max.toArray()]; });
  await p.evaluate(([bb]) => { const R = bb[1][0], top = bb[1][1], ro = 0.15, pts = [];
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; pts.push(new THREE.Vector3(R + ro * Math.cos(a), top + ro * Math.sin(a), 0)); }
    enterFolgen({ outer: pts, holes: [], n: new THREE.Vector3(0, 0, 1) }); }, [bb0]);
  const s = await p.evaluate(([bb]) => { const v = new THREE.Vector3(0, bb[1][1], bb[1][2]).project(camera), r = vpEl.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; }, [bb0]);
  await p.mouse.move(s.x - 20, s.y + 20); await p.mouse.move(s.x, s.y, { steps: 6 }); await p.mouse.click(s.x, s.y); await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ n: _flg.path ? _flg.path.length : 0, closed: _flg.closed, op: _flg.prev ? _flg.prev.material.color.getHexString() : '' }));
  ok(r.n > 20 && r.closed, `Ein Klick auf die obere Kreiskante → geschlossene Kette (${r.n} Punkte)`);
  await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
  r = await p.evaluate(() => { const bb = getMeshBox(objects[0]); return { n: objects.length, min: bb.min.toArray(), max: bb.max.toArray(), name: objects[0].userData.name }; });
  ok(r.n === 1 && Math.abs((r.max[0] - bb0[1][0]) * 10 - 1.5) < 0.15 && Math.abs((r.max[1] - bb0[1][1]) * 10 - 1.5) < 0.1,
     `Wulst angefügt: Ø ${((r.max[0]-r.min[0])*10).toFixed(2)} mm (soll 23), Höhe ${(r.max[1]*10).toFixed(2)} mm (soll 21,5)`);
  // 5) Abziehen = Nut
  await p.evaluate(() => { undo(); });
  await p.waitForTimeout(400);
  r = await p.evaluate(() => objects.length);
  ok(r === 1, 'Strg+Z: Zylinder wieder allein');
  r = await p.evaluate(() => { if (_sk.active) exitSketchMode(); enterSketchMode(); _sk.ents.push({ type: 'circle', c: { u: 0, v: 0 }, r: 0.2 }); _skRender(); _flgFromSketch();
    const o = { act: _flg.active, n: _flg.prof && _flg.prof.outer.length, sk: _sk.active }; _flgExit(); return o; });
  ok(r.act && r.n > 10 && !r.sk, `Skizze → „Folgen (Kanten)“: Profil übernommen (${r.n} Punkte), Skizze zu`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
