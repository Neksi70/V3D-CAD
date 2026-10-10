// Ziehen (P) wie bei JumpStart: Kreis auf Zylinder-Oberseite → nach unten = Sackloch,
// D = Durchgangsloch, nach oben = anfügen; danach Gewinde an der Bohrung
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8973;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _skPullCommit === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._T = {
      wait: async (pred, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 150)); if (pred()) return true; } return false; },
      vol: o => { o.updateMatrixWorld(true); const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); const P = g.attributes.position, I = g.index ? g.index.array : null, n = I ? I.length : P.count; let v = 0; const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
        for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(P, I ? I[i] : i); b2.fromBufferAttribute(P, I ? I[i+1] : i+1); c.fromBufferAttribute(P, I ? I[i+2] : i+2); v += a.dot(b2.clone().cross(c)) / 6; } return v * 1000; },
      // Zylinder Ø20×20 auf dem Boden, Skizze auf der Oberseite, Kreis Ø6 → Ziehen starten
      setup: () => {
        _newCreate(false); resetWorkplane(); addShape('cylinder');
        const o = objects[0], s = getMeshBox(o).getSize(new THREE.Vector3());
        o.scale.multiply(new THREE.Vector3(2 / s.x, 2 / s.y, 2 / s.z)); o.updateMatrixWorld(true);
        o.position.set(0, 0, 0); o.updateMatrixWorld(true); o.position.y -= getMeshBox(o).min.y; o.updateMatrixWorld(true);
        workplaneNormal.set(0, 1, 0); workplanePoint.set(0, getMeshBox(o).max.y, 0);
        enterSketchMode(); _sk.ents.push({ type:'circle', c:{u:0, v:0}, r:0.3 }); _skRender();
        _skPullStart({ u:0, v:0 });
        return o;
      },
    };
  });
  // 1) Sackloch 8 mm
  const r1 = await p.evaluate(async () => {
    const o = _T.setup(), v0 = _T.vol(o);
    _skPullSetHeight(-0.8); await new Promise(r => setTimeout(r, 200)); _skPullSetHeight(-0.8);
    const op = _skPull.op, lbl = _skPull.label.textContent;
    await _skPullCommit();
    await _T.wait(() => objects.length === 1 && objects[0] !== o && !objects[0].userData.isHole);
    await new Promise(r => setTimeout(r, 700));
    const n = objects[0];
    return { op, lbl, n: objects.length, dv: v0 - _T.vol(n), bottomClosed: _thfInside(n, new THREE.Vector3(0, 0.5, 0)), topOpen: !_thfInside(n, new THREE.Vector3(0, 1.9, 0)) };
  });
  ok(r1.op === 'cut' && /Loch/.test(r1.lbl), 'nach unten ziehen = Loch (Anzeige „' + r1.lbl + '")');
  ok(r1.n === 1 && Math.abs(r1.dv - Math.PI * 9 * 8) < 15, `Sackloch Ø6×8: −${r1.dv.toFixed(0)} mm³ (Soll ${(Math.PI*72).toFixed(0)})`);
  ok(r1.bottomClosed && r1.topOpen, 'Sackloch: oben offen, unten zu');
  // 2) Gewinde in dieses Loch (Ø6 → M8 nach Kerndurchmesser 6,8? nächstliegend)
  const r2 = await p.evaluate(async () => {
    const o = objects[0];
    const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(1, 0, 0));
    const hit = rc.intersectObject(o, false)[0];
    const cyl = _thfDetect(o, hit);
    _thfStart(); _thf.obj = o; _thf.cyl = cyl; _thf.picking = false; _thfSuggest(); _thfPanel();
    const size = _thf.p.size; await _thfApply();
    await _T.wait(() => objects.length === 1 && objects[0] !== o);
    await new Promise(r => setTimeout(r, 700));
    return { inner: cyl && cyl.inner, lo: cyl && cyl.closedLo, size, n: objects.length };
  });
  ok(r2.inner && r2.lo && r2.n === 1, `Gewinde ins gezogene Sackloch: erkannt als ${r2.size} innen, Boden zu`);
  // 3) Durchgangsloch per D
  const r3 = await p.evaluate(async () => {
    const o = _T.setup(), v0 = _T.vol(o);
    _skPullSetHeight(-0.1);
    _skPullKey(new KeyboardEvent('keydown', { key:'d' }));
    const h = _skPull.h, lbl = _skPull.label.textContent;
    await _skPullCommit();
    await _T.wait(() => objects.length === 1 && objects[0] !== o && !objects[0].userData.isHole);
    await new Promise(r => setTimeout(r, 700));
    const n = objects[0];
    return { h, lbl, dv: v0 - _T.vol(n), through: !_thfInside(n, new THREE.Vector3(0, 0.05, 0)) && !_thfInside(n, new THREE.Vector3(0, 1.95, 0)) };
  });
  ok(/durch alles/.test(r3.lbl) && r3.h < -2, 'D = durch alles (' + r3.lbl + ')');
  ok(r3.through && Math.abs(r3.dv - Math.PI * 9 * 20) < 25, `Durchgangsloch Ø6×20: −${r3.dv.toFixed(0)} mm³ (Soll ${(Math.PI*180).toFixed(0)})`);
  // 4) Nach oben ziehen = anfügen (ein Körper, 5 mm höher)
  const r4 = await p.evaluate(async () => {
    const o = _T.setup();
    _skPullSetHeight(0.5); await new Promise(r => setTimeout(r, 200)); _skPullSetHeight(0.5);
    const op = _skPull.op;
    await _skPullCommit();
    await _T.wait(() => objects.length === 1 && objects[0] !== o);
    await new Promise(r => setTimeout(r, 700));
    return { op, n: objects.length, top: getMeshBox(objects[0]).max.y * 10 };
  });
  ok(r4.op === 'join' && r4.n === 1 && Math.abs(r4.top - 25) < 0.05, `nach oben = anfügen, Höhe ${r4.top.toFixed(2)} mm`);
  // 5) Ohne Körper (Bauplatte) bleibt Ziehen = neuer Körper
  const r5 = await p.evaluate(async () => {
    _newCreate(false); resetWorkplane(); enterSketchMode(); _sk.ents.push({ type:'circle', c:{u:0, v:0}, r:0.5 }); _skRender();
    _skPullStart({ u:0, v:0 }); _skPullSetHeight(1.2); await new Promise(r => setTimeout(r, 200)); _skPullSetHeight(1.2);
    const op = _skPull.op; await _skPullCommit();
    return { op, n: objects.length, h: getMeshBox(objects[0]).max.y * 10, sk: _sk.active };
  });
  ok(r5.op === 'new' && r5.n === 1 && Math.abs(r5.h - 12) < 0.05 && !r5.sk, 'Bauplatte: Ziehen = neuer Körper 12 mm wie bisher');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
