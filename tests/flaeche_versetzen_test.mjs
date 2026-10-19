// Fläche versetzen (Push/Pull exakt) + Extrudieren-Endbedingungen + Schnittmenge (v1.18.193)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8862;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _skxApply === 'function' && typeof objects !== 'undefined', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._T = { box: o => { const bb = getMeshBox(o); return { min: bb.min.toArray().map(x => +(x * 10).toFixed(2)), max: bb.max.toArray().map(x => +(x * 10).toFixed(2)) }; } }; });
  // Welt-Punkt → Bildschirm, echter Klick
  const clickW = async (x, y, z, shift) => {
    const s = await p.evaluate(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).project(camera), r = vpEl.getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; }, [x, y, z]);
    await p.mouse.move(s.x - 20, s.y + 20); await p.mouse.move(s.x, s.y, { steps: 6 });
    if (shift) await p.keyboard.down('Shift');
    await p.mouse.click(s.x, s.y);
    if (shift) await p.keyboard.up('Shift');
    await p.waitForTimeout(250);
  };
  const neu = async () => p.evaluate(() => { if (_sk.active) exitSketchMode(); if (_skx.open) _skxClose(true); _newCreate(false); setView('iso'); });

  // 1) Box 30×20×30, Deckfläche +5 mm nach außen
  await neu();
  await p.evaluate(() => { addShape('box'); const o = objects[0]; o.scale.set(1.5, 1, 1.5); o.updateMatrixWorld(true); deselect(); });
  await p.evaluate(() => enterPushPull());
  await clickW(0.3, 2, 0.2);
  let st = await p.evaluate(() => ({ sk: _sk.active, open: _skx.open, ents: _sk.ents.length, op: _skx.res && _skx.res.op }));
  ok(st.sk && st.open && st.ents === 4, `Deckfläche → Skizze mit 4 Linien + Extrudieren-Fenster (${JSON.stringify(st)})`);
  await p.evaluate(async () => { _skxSet('d', '5'); await _skxApply(); });
  await p.waitForTimeout(800);
  st = await p.evaluate(() => ({ n: objects.length, box: _T.box(objects[0]), feat: objects[0].userData.feat && objects[0].userData.feat.list.map(f => f.op).join(',') }));
  ok(st.n === 1 && Math.abs(st.box.max[1] - 25) < 0.05, `+5 mm angefügt: Höhe ${st.box.max[1]} (Verlauf: ${st.feat})`);

  // 2) Dieselbe Deckfläche −8 mm hinein → Höhe 17
  await p.evaluate(() => enterPushPull());
  await clickW(0.3, 2.5, 0.2);
  await p.evaluate(async () => { _skxSet('d', '-8'); await _skxApply(); });
  await p.waitForTimeout(1500);
  st = await p.evaluate(() => ({ n: objects.length, box: _T.box(objects[0]), feat: objects[0].userData.feat && objects[0].userData.feat.list.map(f => f.op).join(',') }));
  ok(st.n === 1 && Math.abs(st.box.max[1] - 17) < 0.05, `−8 mm hinein: Höhe ${st.box.max[1]} (Verlauf: ${st.feat})`);

  // 3) Kegelstumpf (schräge Wand): Deckfläche +6 — früher unmöglich (Eckpunkte schieben)
  await neu();
  await p.evaluate(() => { addShape('cylinder'); const o = objects[0]; o.updateMatrixWorld(true); deselect(); });
  const cyl = await p.evaluate(() => _T.box(objects[0]));
  await p.evaluate(() => enterPushPull());
  await clickW(0.1, cyl.max[1] / 10, 0.1);
  await p.evaluate(async () => { _skxSet('d', '6'); await _skxApply(); });
  await p.waitForTimeout(1500);
  st = await p.evaluate(() => ({ n: objects.length, box: _T.box(objects[0]) }));
  ok(st.n === 1 && Math.abs(st.box.max[1] - (cyl.max[1] + 6)) < 0.1, `Zylinder-Deckfläche +6: ${cyl.max[1]} → ${st.box.max[1]}`);

  // 4) Bis nächste: Box unten, Box darüber schwebend → Deckfläche bis zur Unterseite der oberen
  await neu();
  await p.evaluate(() => { addShape('box'); addShape('box'); const a = objects[0], c = objects[1];
    a.position.set(0, 1, 0); c.position.set(0, 4.5, 0); a.updateMatrixWorld(true); c.updateMatrixWorld(true); deselect(); });
  await p.evaluate(() => enterPushPull());
  await clickW(0.35, 2, 0.6);
  st = await p.evaluate(async () => { _skxSet('d', '1'); _skxSet('end', 'next'); const [a, b] = _skxRange(); const op = _skx.res.op; _skxSet('op', 'new'); await _skxApply(); return { len: (b - a) * 10, op }; });
  await p.waitForTimeout(800);
  ok(Math.abs(st.len - 15) < 0.05, `Bis nächste Fläche: ${st.len.toFixed(2)} mm (Lücke 20→35)`);
  st = await p.evaluate(() => ({ n: objects.length, boxes: objects.map(o => _T.box(o)) }));
  ok(st.n === 3 && st.boxes.some(bx => Math.abs(bx.min[1] - 20) < 0.05 && Math.abs(bx.max[1] - 35) < 0.05), 'Neuer Körper füllt die Lücke 20–35 mm');

  // 5) Durch alles + Bis Fläche-Abstand
  await neu();
  await p.evaluate(() => { addShape('box'); objects[0].updateMatrixWorld(true); deselect(); });
  await p.evaluate(() => { if (_sk.active) exitSketchMode(); enterSketchMode(); _sk.ents.push({ type: 'circle', c: { u: 0, v: 0 }, r: 0.4 }); _skRender(); _skExtrude(); _skxSet('end', 'dist'); _skxSet('d', '5'); _skxSet('op', 'isect'); });
  st = await p.evaluate(async () => { const r = _skx.res; await _skxApply(); return r.op; });
  await p.waitForTimeout(1500);
  st = await p.evaluate(() => ({ n: objects.length, box: _T.box(objects[0]), lab: objects[0].userData.feat ? _featLabel(objects[0].userData.feat.list.at(-1), 0) : '' }));
  ok(st.n === 1 && Math.abs(st.box.max[0] - 4) < 0.1 && Math.abs(st.box.max[1] - 5) < 0.05, `Schnittmenge: Zylinder Ø8×5 übrig ${JSON.stringify(st.box)} · ${st.lab}`);
  const rb = await p.evaluate(async () => { const o = objects[0], H = _featClone(o.userData.feat); const g = await _featRebuild(H); g.computeBoundingBox(); return g.boundingBox.max.toArray().map(x => +(x * 10).toFixed(2)); });
  ok(Math.abs(rb[1] - 5) < 0.05 && Math.abs(rb[0] - 4) < 0.1, `Verlauf rechnet Schnittmenge nach: ${rb}`);

  // 6) Bis Fläche: Skizze auf der Bauplatte, Ende = Oberseite einer Box daneben (angeklickt)
  await neu();
  await p.evaluate(() => { addShape('box'); const o = objects[0]; o.position.set(3, 1.5, 0); o.scale.set(1, 1.5, 1); o.updateMatrixWorld(true); deselect(); });
  await p.evaluate(() => { enterSketchMode(); _sk.ents.push({ type: 'circle', c: { u: -2, v: 0 }, r: 0.5 }); _skRender(); _skExtrude(); _skxSet('op', 'new'); _skxSet('d', '5'); _skxSet('end', 'face'); });
  await clickW(3.2, 3, 0.2);
  st = await p.evaluate(() => { const [a, b] = _skxRange(); return { len: (b - a) * 10, fd: _skx.p.faceD }; });
  ok(Math.abs(st.len - 30) < 0.05, `Bis Fläche (Oberseite der 30 mm hohen Box angeklickt): ${st.len.toFixed(2)} mm`);
  await p.evaluate(async () => { await _skxApply(); });

  // 7) Extrudieren mit Fase oben 2 mm: 20×20×10 → 4000 − ∫₀² (20−2x)² dx = 3850,67 mm³; Verlauf rechnet gleich nach
  const r7 = await p.evaluate(async () => { if (_sk.active) exitSketchMode(); _newCreate(false); enterSketchMode();
    [[-1,-1,1,-1],[1,-1,1,1],[1,1,-1,1],[-1,1,-1,-1]].forEach(([a,b,c,d]) => _sk.ents.push({ type: 'line', a: { u: a, v: b }, b: { u: c, v: d } })); _skRender();
    _skExtrude(); _skxSet('end', 'dist'); _skxSet('dir', 'one'); _skxSet('op', 'new'); _skxSet('d', '10'); _skxSet('bevT', 'cha'); _skxSet('bevTmm', '2'); await _skxApply();
    const o = objects[0], vol = g => { const gg = g.index ? g.toNonIndexed() : g, P = gg.attributes.position; let v = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let i = 0; i < P.count; i += 3) { A.fromBufferAttribute(P, i); B.fromBufferAttribute(P, i+1); C.fromBufferAttribute(P, i+2); v += A.dot(B.clone().cross(C)); } return Math.abs(v / 6) * 1000; };
    o.updateMatrixWorld(true); const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    const H = o.userData.feat; const g2 = await _featRebuild(H);
    return { v: vol(g), v2: vol(g2), bev: H.list[0].bev }; });
  ok(Math.abs(r7.v - 3850.67) < 2 && Math.abs(r7.v2 - 3850.67) < 2 && r7.bev && r7.bev.top && !r7.bev.top.fil, `Fase oben 2 mm: ${r7.v.toFixed(2)} / Verlauf ${r7.v2.toFixed(2)} mm³ (soll 3850,67)`);

  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
