// Extrudieren-Dialog + Skizze auf Fläche: neu / anfügen / abziehen, Richtungen, Undo, Bauplatte unverändert
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8969;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _skxApply === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._T = {
      wait: async (pred, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 150)); if (pred()) return true; } return false; },
      box: o => { const bb = getMeshBox(o); return { min: bb.min.toArray().map(x => +(x*10).toFixed(2)), max: bb.max.toArray().map(x => +(x*10).toFixed(2)) }; },
      vol: o => { o.updateMatrixWorld(true); const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); const P = g.attributes.position, I = g.index ? g.index.array : null, n = I ? I.length : P.count; let v = 0; const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
        for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(P, I ? I[i] : i); b2.fromBufferAttribute(P, I ? I[i+1] : i+1); c.fromBufferAttribute(P, I ? I[i+2] : i+2); v += a.dot(b2.clone().cross(c)) / 6; } return v * 1000; },
      rect: (u0, v0, u1, v1) => { const r = [[u0,v0],[u1,v0],[u1,v1],[u0,v1],[u0,v0]]; for (let i = 0; i < 4; i++) _sk.ents.push({ type:'line', a:{u:r[i][0],v:r[i][1]}, b:{u:r[i+1][0],v:r[i+1][1]} }); _skRender(); },
      circle: (u, v, r) => { _sk.ents.push({ type:'circle', c:{u, v}, r }); _skRender(); },
    };
  });
  // 1) Bauplatte: Rechteck 20×10, 10 mm → neuer Körper wie bisher
  const r1 = await p.evaluate(async () => {
    _newCreate(false); resetWorkplane();
    enterSketchMode(); _T.rect(-1, -0.5, 1, 0.5);
    _skExtrude();
    const info = document.getElementById('skx-info').innerText, prev = !!_skx.prev;
    _skxSet('d', '10'); await _skxApply();
    return { info, prev, n: objects.length, box: _T.box(objects[0]), sk: _sk.active, panel: !!document.getElementById('skx-panel') };
  });
  ok(r1.prev && /neuen Körper/.test(r1.info), 'Bauplatte: Vorschau + „neuer Körper" (' + r1.info + ')');
  ok(r1.n === 1 && JSON.stringify(r1.box) === JSON.stringify({ min: [-10, 0, -5], max: [10, 10, 5] }), 'Bauplatte: 20×10×10 auf dem Boden ' + JSON.stringify(r1.box));
  ok(!r1.sk && !r1.panel, 'Skizze und Fenster danach zu');
  // 2) Box 30×20×30 (Oberseite y=20 mm), Skizze auf Oberseite (Arbeitsebene), Kreis Ø10 ↑ 8 mm → Anfügen
  const r2 = await p.evaluate(async () => {
    _newCreate(false); resetWorkplane();
    addShape('box'); const bx = objects[0]; bx.scale.set(1.5, 1.0, 1.5); bx.position.set(0, 0, 0); bx.updateMatrixWorld(true);
    bx.position.y -= getMeshBox(bx).min.y; bx.updateMatrixWorld(true);
    const top = getMeshBox(bx).max.y;
    workplaneNormal.set(0, 1, 0); workplanePoint.set(0, top, 0);
    enterSketchMode(); const onFace = _sk.onFace; _T.circle(0, 0, 0.5);
    _skExtrude(); _skxSet('d', '8');
    const info = document.getElementById('skx-info').innerText, op = _skx.res.op;
    const v0 = _T.vol(bx);
    await _skxApply();
    await _T.wait(() => objects.length === 1 && objects[0] !== bx);
    const o = objects[0];
    const und = undoStack.length;
    return { onFace, info, op, n: objects.length, box: _T.box(o), dv: _T.vol(o) - v0, und };
  });
  ok(r2.onFace && r2.op === 'join' && /angefügt/.test(r2.info), 'Fläche: Automatisch = Anfügen (' + r2.info + ')');
  ok(r2.n === 1 && Math.abs(r2.box.max[1] - 28) < 0.05, 'angefügt: ein Körper, Höhe 20+8 = ' + r2.box.max[1]);
  ok(Math.abs(r2.dv - Math.PI * 25 * 8) < 40, 'Volumen +' + r2.dv.toFixed(0) + ' mm³ (Zylinder Ø10×8 ≈ 628)');
  // Rückgängig: genau EIN Schritt zurück → Box allein, ohne Zylinder daneben
  const r3 = await p.evaluate(async () => { undo(); await new Promise(r => setTimeout(r, 300)); return { n: objects.length, box: _T.box(objects[0]) }; });
  ok(r3.n === 1 && Math.abs(r3.box.max[1] - 20) < 0.05, 'Rückgängig nach Anfügen: Box allein (' + r3.n + ' Objekt, Höhe ' + r3.box.max[1] + ')');
  // 4) Gleiche Fläche, Rechteck 10×10, Abstand −6 → Automatisch = Abziehen (Tasche)
  const r4 = await p.evaluate(async () => {
    const bx = objects[0], top = getMeshBox(bx).max.y;
    workplaneNormal.set(0, 1, 0); workplanePoint.set(0, top, 0);
    enterSketchMode(); _T.rect(-0.5, -0.5, 0.5, 0.5);
    _skExtrude(); _skxSet('d', '-6');
    const info = document.getElementById('skx-info').innerText, op = _skx.res.op;
    const v0 = _T.vol(bx);
    await _skxApply();
    await _T.wait(() => objects.length === 1 && objects[0] !== bx && !objects[0].userData.isHole);
    const o = objects[0];
    return { info, op, n: objects.length, holes: objects.filter(x => x.userData.isHole).length, dv: v0 - _T.vol(o), box: _T.box(o) };
  });
  ok(r4.op === 'cut' && /abgezogen/.test(r4.info), 'Fläche, −6 mm: Automatisch = Abziehen (' + r4.info + ')');
  ok(r4.n === 1 && r4.holes === 0 && Math.abs(r4.dv - 600) < 5, 'Tasche 10×10×6 abgezogen: −' + r4.dv.toFixed(0) + ' mm³, Außenmaß bleibt ' + JSON.stringify(r4.box));
  // 5) Seitenfläche (Normale +Z), symmetrisch 10 mm, Operation „Neuer Körper" erzwungen
  const r5 = await p.evaluate(async () => {
    _newCreate(false); resetWorkplane();
    workplaneNormal.set(0, 0, 1); workplanePoint.set(0, 1, 3);
    enterSketchMode(); _T.circle(0, 0, 0.4);
    _skExtrude(); _skxSet('dir', 'sym'); _skxSet('d', '10'); _skxSet('op', 'new');
    await _skxApply();
    resetWorkplane();
    return { n: objects.length, box: _T.box(objects[0]) };
  });
  ok(r5.n === 1 && Math.abs(r5.box.min[2] - 25) < 0.05 && Math.abs(r5.box.max[2] - 35) < 0.05 && Math.abs((r5.box.max[1] + r5.box.min[1]) / 2 - 10) < 0.05,
     'senkrechte Ebene, symmetrisch: z 25…35 mm, Mitte auf Höhe 10 ' + JSON.stringify(r5.box));
  // 6) Zwei Seiten 6 / 2 auf der Bauplatte
  const r6 = await p.evaluate(async () => {
    _newCreate(false); resetWorkplane();
    enterSketchMode(); _T.rect(0, 0, 1, 1);
    _skExtrude(); _skxSet('dir', 'two'); _skxSet('d', '6'); _skxSet('d2', '2'); await _skxApply();
    return _T.box(objects[0]);
  });
  ok(Math.abs(r6.min[1] + 2) < 0.05 && Math.abs(r6.max[1] - 6) < 0.05, 'zwei Seiten: y −2…6 mm ' + JSON.stringify(r6));
  // 7) Esc schließt erst das Fenster, Skizze bleibt (Fortschrittsbalken vom Abziehen erst ausblenden lassen)
  await p.waitForTimeout(800);
  const r7 = await p.evaluate(() => { _newCreate(false); enterSketchMode(); _T.rect(0,0,1,1); _skExtrude(); return true; });
  await p.keyboard.press('Escape');
  const r7b = await p.evaluate(() => ({ panel: !!document.getElementById('skx-panel'), sk: _sk.active, ents: _sk.ents.length }));
  ok(!r7b.panel && r7b.sk && r7b.ents === 4, 'Esc: Fenster zu, Skizze bleibt mit 4 Linien ' + JSON.stringify(r7b));
  await p.evaluate(() => exitSketchMode());
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
