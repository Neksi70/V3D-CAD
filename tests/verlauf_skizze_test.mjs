// Verlauf: Skizzen + Gewinde nachträglich ändern, Teil rechnet sich neu (inkl. späterer Schritte)
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8980;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.text().startsWith('DBG')) console.log(m.text()); });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _featEditSketch === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    window._T = {
      wait: async (pred, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await new Promise(r => setTimeout(r, 150)); if (pred()) return true; } return false; },
      vol: o => { o.updateMatrixWorld(true); const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); const P = g.attributes.position, I = g.index ? g.index.array : null, n = I ? I.length : P.count; let v = 0; const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3();
        for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(P, I ? I[i] : i); b2.fromBufferAttribute(P, I ? I[i+1] : i+1); c.fromBufferAttribute(P, I ? I[i+2] : i+2); v += a.dot(b2.clone().cross(c)) / 6; } return v * 1000; },
      box: o => { const bb = getMeshBox(o); return { min: bb.min.toArray().map(x => +(x * 10).toFixed(2)), max: bb.max.toArray().map(x => +(x * 10).toFixed(2)) }; },
      holeR: o => { // Lochradius in Höhe 16 mm (oberer Bereich, Achse x=xc, z=zc)
        const bb = getMeshBox(o), c = bb.getCenter(new THREE.Vector3());
        const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(c.x, 1.6, c.z), new THREE.Vector3(1, 0, 0)); const h = rc.intersectObject(o, false)[0];
        return h ? +(h.distance * 10).toFixed(2) : null; },
    };
  });
  // 1) Box + Loch Ø8 per Skizze
  const r1 = await p.evaluate(async () => {
    _newCreate(false); resetWorkplane(); addShape('box'); const bx = objects[0]; bx.scale.set(1.5, 1.0, 1.5); bx.position.set(0, 0, 0); bx.updateMatrixWorld(true);
    bx.position.y -= getMeshBox(bx).min.y; bx.updateMatrixWorld(true);
    workplaneNormal.set(0, 1, 0); workplanePoint.set(0, getMeshBox(bx).max.y, 0);
    enterSketchMode(); _sk.ents.push({ type: 'circle', c: { u: 0, v: 0 }, r: 0.4 }); _skRender();
    _skExtrude(); _skxSet('d', '-12'); await _skxApply();
    await _T.wait(() => objects.length === 1 && objects[0] !== bx && !objects[0].userData.isHole);
    resetWorkplane();
    const o = objects[0]; return { n: (o.userData.feat || { list: [] }).list.length, base: !!(o.userData.feat && o.userData.feat.base), intakt: _featIntakt(o), r: _T.holeR(o), rows: document.querySelectorAll('#tree .ti-feat').length };
  });
  ok(r1.n === 1 && r1.base && r1.intakt, 'Loch per Skizze: Verlauf mit Basis + 1 Schritt');
  ok(Math.abs(r1.r - 4) < 0.15, 'Lochradius 4 mm (' + r1.r + ')');
  ok(r1.rows === 1, 'Elemente-Liste zeigt den Schritt');
  // 2) Gewinde rein (Vorschlag)
  const r2 = await p.evaluate(async () => {
    const o = objects[0], c = getMeshBox(o).getCenter(new THREE.Vector3());
    const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(c.x, 1.5, c.z), new THREE.Vector3(1, 0, 0)); const hit = rc.intersectObject(o, false)[0];
    _thfStart(); _thf.obj = o; _thf.cyl = _thfDetect(o, hit); _thf.picking = false; _thfSuggest(); _thfPanel();
    const size = _thf.p.size; await _thfApply();
    await _T.wait(() => objects.length === 1 && objects[0] !== o); await new Promise(r => setTimeout(r, 700));
    const n = objects[0]; return { size, n: n.userData.feat.list.length, intakt: _featIntakt(n), labels: n.userData.feat.list.map(_featLabel), v: _T.vol(n) };
  });
  ok(r2.n === 2 && r2.intakt, 'Gewinde als Schritt 2 aufgezeichnet: ' + r2.labels.join(' | '));
  // 3) Teil verschieben, dann Skizze 1 von Ø8 auf Ø10 ändern
  const r3 = await p.evaluate(async () => {
    const o = objects[0]; o.position.x += 5; o.updateMatrixWorld(true);   // 50 mm zur Seite
    const box0 = _T.box(o), v0 = _T.vol(o);
    _featEditSketch(o.userData.id, 0);
    const edit = !!_sk.editFeat, ents = _sk.ents.length, onFace = _sk.onFace;
    _sk.ents[0].r = 0.5; _skRender();
    _skExtrude(); const info = document.getElementById('skx-info').innerText; await _skxApply();
    await new Promise(r => setTimeout(r, 900));
    const n = objects[0];
    return { edit, ents, onFace, info, same: n === o, n: objects.length, box0, box1: _T.box(n), v0, v1: _T.vol(n), r: _T.holeR(n), feats: n.userData.feat.list.length, intakt: _featIntakt(n), sk: _sk.active };
  });
  ok(r3.edit && r3.ents === 1 && r3.onFace, 'Skizze 1 öffnet wieder auf der Oberseite mit dem Kreis');
  ok(/neu berechnet/.test(r3.info), 'Fenster sagt, dass neu berechnet wird');
  ok(r3.same && r3.n === 1 && r3.feats === 2 && r3.intakt && !r3.sk, 'dasselbe Teil, 2 Schritte, intakt, Skizze zu');
  ok(Math.abs(r3.box1.min[0] - r3.box0.min[0]) < 0.05 && Math.abs(r3.box1.max[0] - r3.box0.max[0]) < 0.05, 'Lage bleibt nach dem Verschieben erhalten (x ' + r3.box1.min[0] + '…' + r3.box1.max[0] + ')');
  ok(r3.v1 < r3.v0 - 150 && r3.r > 4.6, `Loch jetzt größer: Volumen ${r3.v0.toFixed(0)} → ${r3.v1.toFixed(0)} mm³, Radius oben ${r3.r} mm`);
  // 4) Gewinde auf M12 ändern
  const r4 = await p.evaluate(async () => {
    const o = objects[0], v0 = _T.vol(o);
    _featEditThread(o.userData.id, 1);
    const title = document.getElementById('thf-panel').innerText.split('\n')[0];
    _thfSet('size', 'M12'); await _thfApply(); await new Promise(r => setTimeout(r, 900));
    const n = objects[0]; return { title, v0, v1: _T.vol(n), lbl: _featLabel(n.userData.feat.list[1], 1), intakt: _featIntakt(n) };
  });
  ok(/ändern/.test(r4.title) && /M12/.test(r4.lbl) && r4.v1 < r4.v0 - 30 && r4.intakt, `Gewinde auf M12: ${r4.lbl}, Volumen ${r4.v0.toFixed(0)} → ${r4.v1.toFixed(0)}`);
  // 5) Rückgängig → wieder M10-Stand
  const r5 = await p.evaluate(async () => { undo(); await new Promise(r => setTimeout(r, 400)); const n = objects[0]; return { lbl: _featLabel(n.userData.feat.list[1], 1), intakt: _featIntakt(n) }; });
  ok(!/M12/.test(r5.lbl) && r5.intakt, 'Rückgängig: wieder ' + r5.lbl + ', Verlauf intakt');
  // 6) Speichern/Laden
  const r6 = await p.evaluate(() => { const o = objects[0], d = JSON.parse(JSON.stringify(objectToData(o))), o2 = buildObjectFromData(d); return { n: o2.userData.feat.list.length, intakt: _featIntakt(o2) }; });
  ok(r6.n === 2 && r6.intakt, 'Speichern/Laden: Verlauf bleibt, intakt');
  // 7) fremde Änderung → Rückfrage
  const r7 = await p.evaluate(() => { const o = objects[0]; const g = o.geometry.clone(); g.scale(1.01, 1, 1); o.geometry = g;
    let asked = false; const oc = window.confirm; window.confirm = () => { asked = true; return false; };
    _featEditSketch(o.userData.id, 0); window.confirm = oc; return { asked, sk: _sk.active, intakt: _featIntakt(o) }; });
  ok(r7.asked && !r7.sk && !r7.intakt, 'nach fremder Änderung: Rückfrage, bei „Nein“ nichts geöffnet');
  // 8) Reiner Skizzen-Körper: Rechteck 20×10 ↑10 → Skizze auf 30×10 ändern
  const r8 = await p.evaluate(async () => {
    _newCreate(false); resetWorkplane(); enterSketchMode();
    const R = [[-1,-0.5],[1,-0.5],[1,0.5],[-1,0.5],[-1,-0.5]]; for (let i = 0; i < 4; i++) _sk.ents.push({ type:'line', a:{u:R[i][0],v:R[i][1]}, b:{u:R[i+1][0],v:R[i+1][1]} });
    _skRender(); _skExtrude(); _skxSet('d', '10'); await _skxApply();
    const o = objects[0], b0 = _T.box(o);
    _featEditSketch(o.userData.id, 0);
    _sk.ents.forEach(e => { if (e.a.u > 0) e.a.u = 1.5; if (e.b.u > 0) e.b.u = 1.5; }); _skRender();
    _skExtrude(); _skxSet('d', '15'); await _skxApply(); await new Promise(r => setTimeout(r, 600));
    return { b0, b1: _T.box(objects[0]), n: objects.length };
  });
  ok(r8.n === 1 && Math.abs(r8.b1.max[0] - 15) < 0.05 && Math.abs(r8.b1.max[1] - 15) < 0.05 && Math.abs(r8.b1.min[1]) < 0.05, `Skizzen-Körper geändert: ${JSON.stringify(r8.b0)} → ${JSON.stringify(r8.b1)}`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
