// Mesh → CAD: 2,5D-Teile aus Netz in Skizzen-Schritte zurückführen (v1.18.195)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8865;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof meshToCad === 'function' && typeof objects !== 'undefined', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    // Prüfteil per Manifold (mm, Z oben) → Netz-Objekt wie ein STL-Import
    window._mk = async (kind, rot) => {
      const w = await _mfInit(), M = w.Manifold, keep = x => x;
      let m;
      if (kind === 'halter') {
        m = M.cube([40, 30, 5], false);
        for (const [x, y] of [[6, 6], [34, 6], [6, 24], [34, 24]]) m = m.subtract(M.cylinder(12, 3, 3, 64, false).translate([x, y, -1]));
        // Langloch 12×5 mittig: zwei Halbkreise + Rechteck
        const sl = M.cube([7, 5, 12], false).translate([16.5, 12.5, -1]).add(M.cylinder(12, 2.5, 2.5, 64, false).translate([16.5, 15, -1])).add(M.cylinder(12, 2.5, 2.5, 64, false).translate([23.5, 15, -1]));
        m = m.subtract(sl);
        m = m.add(M.cylinder(10, 5, 5, 64, false).translate([20, 15, 5]).subtract(M.cylinder(12, 2, 2, 48, false).translate([20, 15, 4])));
      } else if (kind === 'quer') {
        m = M.cube([40, 30, 5], false);
        m = m.add(M.cylinder(10, 5, 5, 64, false).translate([20, 15, 5]));
        // Ø3 quer durch den Zapfen (entlang X, z = 10), Ø2 längs durch die Platte (entlang Y, z = 2,5)
        m = m.subtract(M.cylinder(40, 1.5, 1.5, 48, false).rotate([0, 90, 0]).translate([0, 15, 10]));
        m = m.subtract(M.cylinder(40, 1, 1, 48, false).rotate([-90, 0, 0]).translate([12, -5, 2.5]));
      } else if (kind === 'zapfen') {
        m = M.cube([30, 20, 10], false);
        m = m.add(M.cylinder(12, 4, 4, 64, false).rotate([0, 90, 0]).translate([28, 10, 5]));    // Ø8, ragt 10 mm seitlich heraus
        m = m.subtract(M.cylinder(50, 1.5, 1.5, 48, false).rotate([0, 90, 0]).translate([20, 10, 5]));   // Ø3 durch den Zapfen
        m = m.add(M.cylinder(8, 3, 3, 64, false).rotate([-90, 0, 0]).translate([10, 18, 5]));             // zweiter Zapfen Ø6 nach +Y
      } else if (kind === 'kugel') m = M.sphere(10, 48);
      if (kind === 'rund') {   // 40×30, senkrechte Kanten R4, Bohrung Ø8, oben Fase 1 × 2 (nicht 45°), 10 hoch
        const out = [], c = [[3.6, 2.6, 0], [0.4, 2.6, 90], [0.4, 0.4, 180], [3.6, 0.4, 270]];
        for (const [cx, cv, a0] of c.map(([x, y, a]) => [x, y, a])) for (let i = 0; i <= 16; i++) { const a = (a0 + i / 16 * 90) * Math.PI / 180; out.push({ u: cx + 0.4 * Math.cos(a), v: cv + 0.4 * Math.sin(a) }); }
        const hole = []; for (let i = 0; i < 64; i++) { const a = -i / 64 * Math.PI * 2; hole.push({ u: 2 + 0.4 * Math.cos(a), v: 1.5 + 0.4 * Math.sin(a) }); }
        const g = _skGeoBev([{ outer: out, holes: [hole] }], 10, { top: { fil: false, mm: 1, mm2: 2 }, bot: null }).toNonIndexed();
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x888888, side: THREE.DoubleSide }));
        mesh.userData = { id: idCtr++, type: 'custom', shapeType: 'custom', name: 'Import rund', color: '#888888' };
        objects.push(mesh); scene.add(mesh); selectObjs([mesh]); updateTree(); return mesh.userData.id;
      }
      if (kind === 'fase') {   // Platte 40×30×10, Bohrung Ø8, oben R2, unten Fase 1 — als Netz wie ein STL
        const R = [[0,0],[4,0],[4,3],[0,3]].map(([u, v]) => ({ u, v })), hole = []; for (let i = 0; i < 64; i++) { const a = -i / 64 * Math.PI * 2; hole.push({ u: 2 + 0.4 * Math.cos(a), v: 1.5 + 0.4 * Math.sin(a) }); }
        const g = _skGeoBev([{ outer: R, holes: [hole] }], 10, { top: { fil: true, mm: 2 }, bot: { fil: false, mm: 1 } }).toNonIndexed();
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x888888, side: THREE.DoubleSide }));
        mesh.userData = { id: idCtr++, type: 'custom', shapeType: 'custom', name: 'Import fase', color: '#888888' };
        objects.push(mesh); scene.add(mesh); selectObjs([mesh]); updateTree(); return mesh.userData.id;
      }
      let geo = _mfToGeo(m).toNonIndexed(); geo.rotateX(-Math.PI / 2); geo.scale(0.1, 0.1, 0.1);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x888888, side: THREE.DoubleSide }));
      if (rot) { mesh.rotation.set(rot[0], rot[1], rot[2]); mesh.updateMatrixWorld(true); }
      mesh.userData = { id: idCtr++, type: 'custom', shapeType: 'custom', name: 'Import ' + kind, color: '#888888' };
      objects.push(mesh); scene.add(mesh); selectObjs([mesh]); updateTree();
      return mesh.userData.id;
    };
    window._vol = o => { o.updateMatrixWorld(true); const g = o.geometry.clone().toNonIndexed(); g.applyMatrix4(o.matrixWorld); const P = g.attributes.position; let v = 0;
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 3) { A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i+1); C.fromBufferAttribute(P, i+2); v += A.dot(B.clone().cross(C)); } return Math.abs(v / 6) * 1000; };
  });
  const run = async (kind, rot) => p.evaluate(async ([kind, rot]) => {
    _newCreate(false); await _mk(kind, rot);
    const src = objects[0], v0 = _vol(src);
    await meshToCad(); await new Promise(r => setTimeout(r, 300));
    const res = objects.find(o => o !== src);
    const panel = document.getElementById('m2c-panel'); const txt = panel ? panel.innerText : '';
    if (!res) return { ok: false, txt };
    const H = res.userData.feat;
    return { ok: true, v0, v1: _vol(res), steps: H.list.length, ops: H.list.map(f => f.op).join(','), ents: H.list.map(f => f.ents.map(e => e.type[0]).join('')),
      hidden: src.visible === false, txt, bb0: (() => { const b = getMeshBox(src); return b.getSize(new THREE.Vector3()).toArray().map(x => +(x * 10).toFixed(2)); })(),
      bb1: (() => { const b = getMeshBox(res); return b.getSize(new THREE.Vector3()).toArray().map(x => +(x * 10).toFixed(2)); })() };
  }, [kind, rot]);

  let r = await run('halter');
  ok(r.ok, 'Halter zurückgeführt');
  if (r.ok) {
    const dv = Math.abs(r.v1 - r.v0) / r.v0 * 100;
    ok(r.steps === 2 && r.ops === 'new,join', `2 Skizzen-Schritte: Platte + Zapfen (${r.steps}: ${r.ops})`);
    const c0 = (r.ents[0].match(/c/g) || []).length, a0 = (r.ents[0].match(/a/g) || []).length, l0 = (r.ents[0].match(/l/g) || []).length;
    ok(c0 === 4 && a0 === 2 && l0 === 6, `Platte: 4 Kreise (Bohrungen), Langloch 2 Bögen, 4+2 Linien (${r.ents[0]})`);
    ok(r.ents[1] === 'cc', `Zapfen: Kreis + Bohrung (${r.ents[1]})`);
    ok(dv < 0.5, `Volumen ${r.v0.toFixed(1)} → ${r.v1.toFixed(1)} mm³ (${dv.toFixed(3)} %)`);
    ok(JSON.stringify(r.bb0) === JSON.stringify(r.bb1), `Maße gleich ${r.bb1}`);
    ok(r.hidden, 'Original ausgeblendet');
  }
  // gedreht (Achse schräg)
  r = await run('halter', [0.5, 0.3, 0.2]);
  ok(r.ok && r.steps === 2 && Math.abs(r.v1 - r.v0) / r.v0 < 0.005, `schräg gedreht: ${r.ok ? r.steps + ' Schritte, ' + (Math.abs(r.v1 - r.v0) / r.v0 * 100).toFixed(3) + ' %' : r.txt}`);
  // Querbohrungen
  r = await run('quer');
  if (r.ok) {
    const dv = Math.abs(r.v1 - r.v0) / r.v0 * 100;
    ok(r.ops === 'new,join,cut,cut', `Querbohrungen: Platte + Zapfen + 2× Abziehen (${r.ops})`);
    ok(dv < 0.5, `Volumen mit Querbohrungen ${r.v0.toFixed(1)} → ${r.v1.toFixed(1)} mm³ (${dv.toFixed(3)} %)`);
    ok(/2 Querbohrungen/.test(r.txt), 'Bericht nennt 2 Querbohrungen');
  } else ok(false, 'Querbohrungen: ' + r.txt);
  // Fasen/Rundungen als Kantenoperation
  r = await run('fase');
  if (r.ok) {
    const dv = Math.abs(r.v1 - r.v0) / r.v0 * 100;
    const bev = await p.evaluate(() => { const o = objects.find(x => x.visible !== false); return o.userData.feat.list[0].bev; });
    ok(r.steps === 1 && bev && bev.top && bev.top.fil && Math.abs(bev.top.mm - 2) < 0.15 && bev.bot && !bev.bot.fil && Math.abs(bev.bot.mm - 1) < 0.1, `Rundung oben + Fase unten erkannt: ${JSON.stringify(bev)}`);
    ok(dv < 0.5, `Volumen mit Kanten ${r.v0.toFixed(1)} → ${r.v1.toFixed(1)} mm³ (${dv.toFixed(3)} %)`);
  } else ok(false, 'Fase: ' + r.txt);
  // Fase 1 × 2 (nicht 45°) + Rundungen an senkrechten Kanten als Eckenrundung
  r = await run('rund');
  if (r.ok) {
    const dv = Math.abs(r.v1 - r.v0) / r.v0 * 100;
    const f = await p.evaluate(() => { const o = objects.find(x => x.visible !== false); const s = o.userData.feat.list[0];
      return { bev: s.bev, cons: s.cons.map(c => c.t).sort().join(','), arcs: s.ents.filter(e => e.type === 'arc').map(e => +(e.r * 10).toFixed(2)) }; });
    ok(f.bev && f.bev.top && !f.bev.top.fil && Math.abs(f.bev.top.mm - 1) < 0.1 && Math.abs((f.bev.top.mm2 || 0) - 2) < 0.15, `Fase 1 × 2 erkannt: ${JSON.stringify(f.bev.top)}`);
    ok(f.arcs.length === 4 && f.arcs.every(x => Math.abs(x - 4) < 0.05) && (f.cons.match(/tan/g) || []).length === 8 && (f.cons.match(/eq/g) || []).length === 3 && /rad/.test(f.cons) && /dia/.test(f.cons),
       `4 Eckenrundungen R4: tangential, 1× R-Maß + 3× gleich, Bohrung bemaßt (${f.cons})`);
    ok(dv < 0.5, `Volumen ${r.v0.toFixed(1)} → ${r.v1.toFixed(1)} mm³ (${dv.toFixed(3)} %)`);
    const e2 = await p.evaluate(async () => { const o = objects.find(x => x.visible !== false); _featEditSketch(o.userData.id, 0);
      const c = _sk.cons.find(x => x.t === 'rad'); _skcDimEdit(_skcDimSpec(c.refs.map(r => ({ id: r.id, p: null }))), c); document.getElementById('sk-cdim-v').value = '6'; _skcDimCommit();
      const arcs = _sk.ents.filter(e => e.type === 'arc').map(e => +(e.r * 10).toFixed(2));
      let mu = Infinity, Mu = -Infinity, mv = Infinity, Mv = -Infinity; for (const e of _sk.ents) for (const q of _skTess(e).pts) { mu = Math.min(mu, q.u); Mu = Math.max(Mu, q.u); mv = Math.min(mv, q.v); Mv = Math.max(Mv, q.v); }
      _skExtrude(); await _skxApply(); await new Promise(r => setTimeout(r, 300));
      const o2 = objects.find(x => x.visible !== false), bb = getMeshBox(o2).getSize(new THREE.Vector3());
      return { arcs, w: +((Mu - mu) * 10).toFixed(2), h: +((Mv - mv) * 10).toFixed(2), bb: [bb.x, bb.y, bb.z].map(x => +(x * 10).toFixed(2)), bev: o2.userData.feat.list[0].bev }; });
    ok(e2.arcs.every(x => Math.abs(x - 6) < 0.01) && Math.abs(e2.w - 40) < 0.05 && Math.abs(e2.h - 30) < 0.05, `R-Maß 4 → 6: alle Ecken folgen, Kontur bleibt 40×30 (${JSON.stringify(e2.arcs)}, ${e2.w}×${e2.h})`);
    ok(e2.bev && e2.bev.top && e2.bev.top.mm2, `Neu gerechnet, Fase bleibt erhalten, Teil ${e2.bb}`);
  } else ok(false, 'Rund: ' + r.txt);
  // Seitlicher Zapfen mit Bohrung
  r = await run('zapfen');
  if (r.ok) {
    const dv = Math.abs(r.v1 - r.v0) / r.v0 * 100;
    ok(/join/.test(r.ops) && /Seitliche Zapfen/.test(r.txt), `Zapfen in zwei Richtungen: seitlicher Zapfen als Anfügen erkannt (${r.ops})`);
    ok(dv < 0.5 && r.bb0.every((x, i) => Math.abs(x - r.bb1[i]) < 0.05), `Volumen ${r.v0.toFixed(1)} → ${r.v1.toFixed(1)} mm³ (${dv.toFixed(3)} %), Maße ${r.bb1}`);
  } else ok(false, 'Zapfen: ' + r.txt);
  // Kugel → Hinweis
  r = await run('kugel');
  ok(!r.ok && /kein technisches 2,5D-Teil/.test(r.txt), 'Kugel abgelehnt mit Hinweis');
  // Skizze aus dem Verlauf öffnen + Bohrung bemaßen → neu rechnen
  r = await p.evaluate(async () => {
    _newCreate(false); await _mk('halter'); await meshToCad(); await new Promise(r => setTimeout(r, 300));
    const o = objects.find(x => x.visible !== false);
    _featEditSketch(o.userData.id, 0);
    const c = _sk.ents.find(e => e.type === 'circle'); c.r = 0.4;   // Ø6 → Ø8
    _skExtrude(); await _skxApply(); await new Promise(r => setTimeout(r, 300));
    const o2 = objects.find(x => x.visible !== false);
    return { v: _vol(o2), steps: o2.userData.feat.list.length };
  });
  ok(r.steps === 2 && r.v > 0, `Skizze geöffnet, Bohrung Ø6→Ø8, Teil neu gerechnet (${r.v.toFixed(1)} mm³)`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
