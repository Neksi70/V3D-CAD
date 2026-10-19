// Konturmuster + Kugelmuster (v1.18.211)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8881;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof enterKonturmuster === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._vo = o => { o.updateMatrixWorld(true); const g = o.geometry.clone().toNonIndexed(); g.applyMatrix4(o.matrixWorld); const P = g.attributes.position; let v = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 3) { A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i+1); C.fromBufferAttribute(P, i+2); v += A.dot(B.clone().cross(C)); } return Math.abs(v / 6) * 1000; }; });
  const setup = () => p.evaluate(() => { _newCreate(false); addShape('cylinder'); addShape('box'); const [z, k] = objects;
    z.position.set(0, 1, 0); k.scale.set(0.1, 0.4, 0.3); k.position.set(1, 2, 0); k.rotation.y = 0.3; [z, k].forEach(o => o.updateMatrixWorld(true)); selectObjs([k]); setView('iso'); enterKonturmuster(); return getMeshBox(z).max.y; });
  const clickRim = async () => { const s = await p.evaluate(() => { const v = new THREE.Vector3(0, 2, 1).project(camera), r = vpEl.getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; });
    await p.mouse.move(s.x - 20, s.y + 20); await p.mouse.move(s.x, s.y, { steps: 6 }); await p.mouse.click(s.x, s.y); await p.waitForTimeout(300); };
  await setup(); await clickRim();
  let r = await p.evaluate(() => ({ path: _pm.path ? _pm.path.length : 0, closed: _pm.closed, target: _pm.target && _pm.target.userData.name, ghosts: _pm.grp.children.length }));
  ok(r.path > 20 && r.closed && r.target, `Kontur = obere Kreiskante (${r.path} Punkte, geschlossen), Ziel ${r.target}`);
  r = await p.evaluate(async () => { _pmSet('dist', 'count'); _pmSet('n', '12'); _pmSet('op', 'copy'); await _pmApply();
    const cs = objects.slice(1).map(o => { const c = getMeshBox(o).getCenter(new THREE.Vector3()); return { r: Math.hypot(c.x, c.z), a: Math.atan2(c.z, c.x) * 180 / Math.PI, ry: new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y * 180 / Math.PI }; });
    const angs = cs.map(c => ((c.a % 360) + 360) % 360).sort((x, y) => x - y), gaps = angs.map((a, i) => ((angs[(i + 1) % angs.length] - a) + 360) % 360);
    const turn = cs.map(c => (((-c.a - c.ry) % 360) + 540) % 360 - 180);
    return { n: objects.length, rs: cs.map(c => +c.r.toFixed(3)), gaps: gaps.map(g => +g.toFixed(2)), turnSpread: Math.max(...turn) - Math.min(...turn) }; });
  ok(r.n === 13 && r.rs.every(x => Math.abs(x - r.rs[0]) < 1e-3) && r.gaps.every(g => Math.abs(g - 30) < 0.05), `12 Kopien, gleicher Radius, Abstand 30° (${r.gaps.slice(0, 4).join(', ')} …)`);
  ok(r.turnSpread < 0.5, `mit der Kontur gedreht: Ausrichtung relativ zum Radius überall gleich (Streuung ${r.turnSpread.toFixed(2)}°)`);
  // gleich abziehen
  await setup(); await clickRim();
  const v0 = await p.evaluate(() => _vo(objects[0]));
  r = await p.evaluate(async () => { _pmSet('dist', 'count'); _pmSet('n', '12'); _pmSet('op', 'cut'); await _pmApply();
    for (let i = 0; i < 40 && (objects.length !== 1 || objects[0].userData.isHole); i++) await new Promise(r => setTimeout(r, 200));
    return { n: objects.length, v: _vo(objects[0]) }; });
  ok(r.n === 1 && r.v < v0 - 10, `12 Kerben aus dem Zylinder abgezogen (${v0.toFixed(0)} → ${r.v.toFixed(0)} mm³)`);
  // Auto mit Lücke
  await p.waitForTimeout(1500); await setup(); await clickRim();
  r = await p.evaluate(() => { _pmSet('dist', 'auto'); _pmSet('gap', '2'); const i = _pmMats(); _pmExit(); return { n: i.n, pitch: i.pitch * 10 }; });
  ok(r.n > 5 && r.n < 30, `Auto mit 2 mm Lücke: ${r.n} Stück, Teilung ${r.pitch.toFixed(2)} mm (gleichmäßig aufgefüllt)`);
  // Kugelmuster
  r = await p.evaluate(async () => { _newCreate(false); addShape('sphere'); addShape('box'); const [k, s] = objects; k.position.set(0, 3, 0); s.scale.set(0.15, 0.15, 0.15);
    const R = getMeshBox(k).getSize(new THREE.Vector3()).y / 2; s.position.set(0, 3 + R, 0); [k, s].forEach(o => o.updateMatrixWorld(true)); selectObjs([s]); enterKugelmuster();
    _pm.target = k; _pmSet('n', '20'); _pmSet('ang', '180'); _pmSet('op', 'copy'); await _pmApply();
    const K = getMeshBox(k).getCenter(new THREE.Vector3()); const ds = objects.slice(1).map(o => getMeshBox(o).getCenter(new THREE.Vector3()).distanceTo(K));
    const cs = objects.slice(1).map(o => getMeshBox(o).getCenter(new THREE.Vector3())); let mind = Infinity; for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) mind = Math.min(mind, cs[i].distanceTo(cs[j]));
    return { n: objects.length - 1, spread: Math.max(...ds) - Math.min(...ds), R, mind }; });
  ok(r.n === 20 && r.spread < 1e-3 && r.mind > r.R * 0.35, `Kugelmuster: 20 Stück, alle gleich weit von der Mitte (Streuung ${r.spread.toExponential(1)}), gut verteilt (min. Abstand ${(r.mind * 10).toFixed(1)} mm)`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
