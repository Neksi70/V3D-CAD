// Gewinde an Fläche: Bohrung Ø10 → M12 innen, Zylinder Ø12 → M12 außen; Schnitt wasserdicht,
// Material weg, Spiel wirkt, Sackloch-Boden bleibt zu, Rückgängig ohne Hilfsobjekt
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8967;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _thfStart === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} });
  // Hilfen im Browser
  await p.evaluate(() => {
    window._T = {
      waitOne: async (pred, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 200)); if (pred()) return true; } return false; },
      stats: o => {
        o.updateMatrixWorld(true);
        const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
        for (const n in g.attributes) if (n !== 'position') g.deleteAttribute(n);
        const m = THREE.BufferGeometryUtils.mergeVertices(g, 1e-4);
        const P = m.attributes.position, I = m.index.array, E = new Map(); let vol = 0;
        const v = i => new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i));
        for (let i = 0; i < I.length; i += 3) {
          const a = I[i], b = I[i+1], c = I[i+2]; if (a === b || b === c || a === c) continue;
          vol += v(a).dot(v(b).cross(v(c))) / 6;
          for (const [x, y] of [[a,b],[b,c],[c,a]]) { const k = x < y ? x+'_'+y : y+'_'+x; E.set(k, (E.get(k)||0)+1); }
        }
        let bad = 0; for (const n of E.values()) if (n !== 2) bad++;
        return { bad, vol: vol * 1000 };   // mm³
      },
      // Klick auf Weltpunkt simulieren → Hit über echten Raycast
      hitAt: (o, from, to) => { const rc = new THREE.Raycaster(); rc.set(from, to.clone().sub(from).normalize()); return rc.intersectObject(o, false)[0]; },
    };
  });
  // ── 1) Klotz 30×30×20 mit Durchgangsbohrung Ø10 ──
  const r1 = await p.evaluate(async () => {
    _newCreate(false);
    addShape('box'); const bx = objects[0]; bx.scale.set(1.5, 1.0, 1.5); bx.updateMatrixWorld(true); dropToGround && 0;
    const bb = getMeshBox(bx); bx.position.y -= bb.min.y; bx.updateMatrixWorld(true);
    shapeMode = 'hole'; addShape('cylinder'); shapeMode = 'solid';
    const h = objects[1]; h.scale.set(0.5, 2, 0.5); h.position.set(bx.position.x, 1, bx.position.z); h.updateMatrixWorld(true);
    selectObjs([bx, h]); subtractHoles();
    await _T.waitOne(() => objects.length === 1 && !objects[0].userData.isHole);
    const o = objects[0]; const before = _T.stats(o);
    const c = getMeshBox(o).getCenter(new THREE.Vector3());
    const hit = _T.hitAt(o, new THREE.Vector3(c.x, c.y, c.z), new THREE.Vector3(c.x + 1, c.y, c.z));   // von der Achse zur Wand
    const cyl = _thfDetect(o, hit);
    return { before, cyl: cyl && { r: cyl.r * 10, inner: cyl.inner, len: (cyl.tmax - cyl.tmin) * 10, lo: cyl.closedLo, hi: cyl.closedHi, ax: cyl.ax.toArray().map(x => +x.toFixed(3)) } };
  });
  ok(r1.cyl && Math.abs(r1.cyl.r - 5) < 0.15 && r1.cyl.inner, `Bohrung erkannt: r=${r1.cyl && r1.cyl.r.toFixed(2)} innen=${r1.cyl && r1.cyl.inner} Achse ${r1.cyl && r1.cyl.ax}`);
  ok(r1.cyl && Math.abs(r1.cyl.len - 20) < 0.3 && !r1.cyl.lo && !r1.cyl.hi, `Länge ${r1.cyl && r1.cyl.len.toFixed(1)} mm, beide Enden offen`);
  // Vorschlag + Schnitt mit Spiel 0,25
  const r2 = await p.evaluate(async () => {
    const o = objects[0], c = getMeshBox(o).getCenter(new THREE.Vector3());
    _thfStart();
    const hit = _T.hitAt(o, c.clone(), c.clone().add(new THREE.Vector3(1, 0, 0)));
    _thf.obj = o; _thf.cyl = _thfDetect(o, hit); _thf.picking = false; _thfSuggest(); _thfPanel(); _thfPreview();
    const sug = { size: _thf.p.size, pitch: _thf.p.pitch, info: document.querySelector('#thf-panel').innerText.slice(0, 120) };
    _thfSet('clr', 0.25);
    const v0 = _T.stats(o).vol;
    await _thfApply();
    await _T.waitOne(() => objects.length === 1 && objects[0] !== o);
    const n = objects[0], s = _T.stats(n);
    return { sug, v0, s, n: objects.length, holes: objects.filter(x => x.userData.isHole).length, panel: !!document.getElementById('thf-panel') };
  });
  ok(r2.sug.size === 'M12' && r2.sug.pitch === 1.75, `Vorschlag ${r2.sug.size}×${r2.sug.pitch} — „${r2.sug.info.replace(/\n/g, ' ')}"`);
  ok(r2.n === 1 && r2.holes === 0 && !r2.panel, 'nach dem Schnitt: 1 Körper, kein Werkzeug übrig, Fenster zu');
  ok(r2.s.bad === 0 && r2.s.vol > 0, `Ergebnis wasserdicht (offene Kanten ${r2.s.bad})`);
  // Volumen-Erwartung: Material zwischen Ø10 und Gewinde M12+0,25 entfernt, grob 20 mm × π/4·(12,25²−10²)·~0,5
  const removed = r2.v0 - r2.s.vol;
  ok(removed > 300 && removed < 1200, `entferntes Volumen plausibel: ${removed.toFixed(0)} mm³`);
  // Rückgängig → Körper mit glatter Bohrung, kein Werkzeug
  const r3 = await p.evaluate(async () => { undo(); await new Promise(r => setTimeout(r, 300)); return { n: objects.length, holes: objects.filter(x => x.userData.isHole).length, vol: _T.stats(objects[0]).vol }; });
  ok(r3.n === 1 && r3.holes === 0 && Math.abs(r3.vol - r2.v0) < 1, `Rückgängig: glatte Bohrung zurück, kein Hilfsobjekt (Vol ${r3.vol.toFixed(0)} vs ${r2.v0.toFixed(0)})`);

  // ── 2) Zylinder Ø12 × 25 frei stehend → Außengewinde M12 ──
  const r4 = await p.evaluate(async () => {
    _newCreate(false); addShape('cylinder');
    const o = objects[0]; const bb0 = getMeshBox(o).getSize(new THREE.Vector3());
    o.scale.multiply(new THREE.Vector3(1.2 / bb0.x, 2.5 / bb0.y, 1.2 / bb0.z)); o.updateMatrixWorld(true);
    o.position.y -= getMeshBox(o).min.y; o.updateMatrixWorld(true);
    const c = getMeshBox(o).getCenter(new THREE.Vector3());
    const hit = _T.hitAt(o, c.clone().add(new THREE.Vector3(3, 0, 0)), c.clone());
    _thfStart(); _thf.obj = o; _thf.cyl = _thfDetect(o, hit); _thf.picking = false; _thfSuggest(); _thfPanel();
    const cyl = _thf.cyl, sug = _thf.p.size;
    _thfSet('clr', 0.2);
    const v0 = _T.stats(o).vol;
    await _thfApply();
    await _T.waitOne(() => objects.length === 1 && objects[0] !== o);
    const n = objects[0], s = _T.stats(n);
    // maximaler Radius des Ergebnisses: ≤ (12−0,2)/2
    n.updateMatrixWorld(true); const P = n.geometry.attributes.position, v = new THREE.Vector3(); let rmax = 0, rmin = 1e9;
    const cc = getMeshBox(n).getCenter(new THREE.Vector3());
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(n.matrixWorld); const yy = v.y; if (yy < getMeshBox(n).min.y + 0.4 || yy > getMeshBox(n).max.y - 0.4) continue; const r = Math.hypot(v.x - cc.x, v.z - cc.z) * 10; rmax = Math.max(rmax, r); rmin = Math.min(rmin, r); }
    return { inner: cyl.inner, r: cyl.r * 10, sug, s, rmax, rmin, v0, n: objects.length };
  });
  ok(!r4.inner && Math.abs(r4.r - 6) < 0.15 && r4.sug === 'M12', `Zylinder erkannt: außen, r=${r4.r.toFixed(2)}, Vorschlag ${r4.sug}`);
  ok(r4.n === 1 && r4.s.bad === 0, `Außengewinde wasserdicht (offene Kanten ${r4.s.bad})`);
  ok(r4.rmax <= 5.9 + 0.05 && r4.rmin < 5.0, `Gewinde-Radien: außen max ${r4.rmax.toFixed(2)} (≤ 5,9 wg. Spiel 0,2), Kern ${r4.rmin.toFixed(2)}`);

  // ── 3) Sackloch: Boden muss zu bleiben ──
  const r5 = await p.evaluate(async () => {
    _newCreate(false);
    addShape('box'); const bx = objects[0]; bx.scale.set(1.5, 1.0, 1.5); bx.updateMatrixWorld(true);
    bx.position.y -= getMeshBox(bx).min.y; bx.updateMatrixWorld(true);   // 30×20×30, Oberkante y=2
    shapeMode = 'hole'; addShape('cylinder'); shapeMode = 'solid';
    const h = objects[1]; h.scale.set(0.4, 0.6, 0.4); h.position.set(bx.position.x, 2.0, bx.position.z); h.updateMatrixWorld(true);  // Ø8, 12 tief → Boden bei y=0.8
    selectObjs([bx, h]); subtractHoles();
    await _T.waitOne(() => objects.length === 1 && !objects[0].userData.isHole);
    const o = objects[0];
    const hit = _T.hitAt(o, new THREE.Vector3(bx.position.x, 1.4, bx.position.z), new THREE.Vector3(bx.position.x + 1, 1.4, bx.position.z));
    _thfStart(); _thf.obj = o; _thf.cyl = _thfDetect(o, hit); _thf.picking = false; _thfSuggest(); _thfPanel();
    const cyl = _thf.cyl, sug = _thf.p.size;
    await _thfApply();
    await _T.waitOne(() => objects.length === 1 && objects[0] !== o);
    const n = objects[0];
    // Boden noch zu? Strahl von unten durch die Achse darf erst bei y≥0.75 aus dem Material kommen
    const insideBelow = _thfInside(n, new THREE.Vector3(bx.position.x, 0.6, bx.position.z));
    return { lo: cyl.closedLo, hi: cyl.closedHi, sug, inner: cyl.inner, bad: _T.stats(n).bad, insideBelow };
  });
  ok(r5.inner && r5.lo && !r5.hi, `Sackloch: Boden geschlossen erkannt (lo=${r5.lo}, hi=${r5.hi}), Vorschlag ${r5.sug}`);
  ok(r5.insideBelow && r5.bad === 0, 'Sackloch nach dem Gewinde: Boden weiter zu, wasserdicht');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 2).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
