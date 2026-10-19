// Interaktive Anleitungen: Schritte prüfen sich selbst, eigenes Projekt kommt zurück (v1.18.200)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8872;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const step = () => p.evaluate(() => _tut.i);
const wait = async (n) => { for (let k = 0; k < 20; k++) { if (await step() >= n) return true; await p.waitForTimeout(150); } return false; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _tutStart === 'function', { timeout: 60000 });
  // eigenes Projekt: zwei Boxen, eine verschoben
  const own = await p.evaluate(() => { hideStarter(); _newCreate(false); addShape('box'); addShape('cylinder'); objects[1].position.x = 4; objects[1].updateMatrixWorld(true);
    return { n: objects.length, ids: objects.map(o => o.userData.id).join(','), design: currentDesignId, undo: undoStack.length }; });
  await p.evaluate(() => { _tutMenu(); });
  ok(await p.evaluate(() => document.querySelectorAll('#tut-menu .btn.pri').length === 5), 'Menü zeigt 5 Anleitungen');
  await p.click('#tut-menu .btn.pri >> nth=0');
  let r = await p.evaluate(() => ({ on: _tut.on, n: objects.length, panel: !!document.getElementById('tut-panel') }));
  ok(r.on && r.n === 0 && r.panel, 'Becher gestartet: leeres Übungsprojekt, Anleitung sichtbar');
  // Schritte so ausführen, wie es der Nutzer täte
  await p.evaluate(() => enterSketchMode()); ok(await wait(1), 'Schritt 1 → Skizze erkannt');
  await p.evaluate(() => { _sk.ents.push({ type: 'circle', c: { u: 0, v: 0 }, r: 3 }); _skRender(); }); ok(await wait(2), 'Schritt 2 → Kreis erkannt');
  await p.evaluate(() => { _skSetTool('sel'); _skcIds(); _skcDimEdit(_skcDimSpec([{ id: _sk.ents[0].id, p: null }])); document.getElementById('sk-cdim-v').value = '70'; _skcDimCommit(); });
  ok(await wait(3), 'Schritt 3 → Ø70 erkannt');
  await p.evaluate(() => _skExtrude()); ok(await wait(4), 'Schritt 4 → Extrudieren offen');
  await p.evaluate(async () => { _skxSet('end', 'dist'); _skxSet('op', 'auto'); _skxSet('d', '90'); await _skxApply(); }); ok(await wait(5), 'Schritt 5 → Zylinder 70×90');
  await p.evaluate(() => { enterSketchMode(); _skSetFrame(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 9, 0)); _sk.onFace = true; }); ok(await wait(6), 'Schritt 6 → Skizze auf der Deckfläche');
  await p.evaluate(() => { _sk.ents.push({ type: 'circle', c: { u: 0, v: 0 }, r: 3 }); _skcIds(); _skSetTool('sel'); _skcDimEdit(_skcDimSpec([{ id: _sk.ents[0].id, p: null }])); document.getElementById('sk-cdim-v').value = '64'; _skcDimCommit(); });
  ok(await wait(7), 'Schritt 7 → Innenkreis Ø64');
  await p.evaluate(async () => { _skExtrude(); _skxSet('d', '-86'); await _skxApply(); });
  for (let k = 0; k < 30 && await step() < 8; k++) await p.waitForTimeout(300);
  ok(await step() === 8, 'Schritt 8 → Becher ausgehöhlt (Volumen geprüft)');
  r = await p.evaluate(() => document.getElementById('tut-panel').innerText);
  ok(/GESCHAFFT/.test(r), 'Abschluss-Anzeige');
  await p.evaluate(() => _tutEnd());
  r = await p.evaluate(() => ({ n: objects.length, ids: objects.map(o => o.userData.id).join(','), design: currentDesignId, undo: undoStack.length, inScene: objects.every(o => o.parent === scene) }));
  ok(r.n === own.n && r.ids === own.ids && r.design === own.design && r.undo === own.undo && r.inScene, `eigenes Projekt unverändert zurück (${JSON.stringify(r)})`);
  // Halter-Anleitung kurz durch
  await p.evaluate(() => _tutStart(1));
  await p.evaluate(() => { enterSketchMode(); const R = [[0,0,6,0],[6,0,6,3],[6,3,0,3],[0,3,0,0]]; R.forEach(([a,b,c,d], i) => { const ln = { type: 'line', a: { u: a, v: b }, b: { u: c, v: d } }; _sk.ents.push(ln); _skcAutoHV(ln, i % 2 ? 'V' : 'H'); }); _skcIds();
    _skcPush([{ t: 'len', refs: [{ id: _sk.ents[0].id, p: null }], val: 6 }, { t: 'len', refs: [{ id: _sk.ents[1].id, p: null }], val: 3 }]);
    _sk.ents.push({ type: 'circle', c: { u: 1, v: 1.5 }, r: 0.25 }); _skcIds(); _skcPush([{ t: 'dia', refs: [{ id: _sk.ents[4].id, p: null }], val: 0.5 }]);
    _skSetTool('sel'); _sk.sel = [{ id: _sk.ents[4].id, p: null }]; _skpOpen(); _skpSet('kind', 'lin'); _skpSet('n', '3'); _skpSet('d', '20'); _skpSet('ang', '0'); _skpApply(); });
  ok(await wait(6), 'Halter: Rechteck, Maße, Bohrung, Muster erkannt');
  await p.evaluate(async () => { _skExtrude(); _skxSet('end', 'dist'); _skxSet('op', 'auto'); _skxSet('d', '5'); await _skxApply(); });
  for (let k = 0; k < 20 && await step() < 7; k++) await p.waitForTimeout(200);
  ok(await step() === 7, 'Halter fertig: Platte 60×5×30 mit 3 Bohrungen');
  await p.evaluate(() => _tutEnd());
  r = await p.evaluate(() => objects.length);
  ok(r === own.n, 'wieder eigenes Projekt');

  // ── Schlüsselanhänger ──
  await p.evaluate(() => _tutStart(2));
  await p.evaluate(() => { enterSketchMode(); const R = [[0,0,5,0],[5,0,5,2.5],[5,2.5,0,2.5],[0,2.5,0,0]]; R.forEach(([a,b,c,d], i) => { const ln = { type: 'line', a: { u: a, v: b }, b: { u: c, v: d } }; _sk.ents.push(ln); _skcAutoHV(ln, i % 2 ? 'V' : 'H'); }); _skcIds();
    _skcPush([{ t: 'len', refs: [{ id: _sk.ents[0].id, p: null }], val: 5 }, { t: 'len', refs: [{ id: _sk.ents[1].id, p: null }], val: 2.5 }]); });
  ok(await wait(3), 'Anhänger: Rechteck 50×25 erkannt');
  r = await p.evaluate(() => { _skSetTool('filletc'); _sk.cornerMM.filletc = 5; for (const [u, v] of [[0,0],[5,0],[5,2.5],[0,2.5]]) _skCornerApply({ u, v });
    return { arcs: _sk.ents.filter(e => e.type === 'arc').length, lens: _sk.cons.filter(c => c.t === 'len').length, shapes: _skBuildShapes().length }; });
  ok(r.arcs === 4 && r.lens === 0 && r.shapes === 1, `Ecken gerundet: 4 Bögen, Längenmaße an gekürzten Kanten entfernt, Kontur geschlossen (${JSON.stringify(r)})`);
  ok(await wait(4), 'Anhänger: Ecken erkannt');
  await p.evaluate(() => { _sk.ents.push({ type: 'circle', c: { u: 0.6, v: 1.25 }, r: 0.3 }); _skcIds(); _skcPush([{ t: 'dia', refs: [{ id: _sk.ents[_sk.ents.length - 1].id, p: null }], val: 0.5 }]); });
  ok(await wait(5), 'Anhänger: Loch ⌀5');
  await p.evaluate(async () => { _skExtrude(); _skxSet('end', 'dist'); _skxSet('op', 'auto'); _skxSet('d', '4'); _skxSet('bevT', 'fil'); _skxSet('bevTmm', '1'); _skxSet('bevB', 'none'); await _skxApply(); });
  ok(await wait(6), 'Anhänger: 4 mm mit Rundung oben');
  await p.evaluate(() => { enterSketchMode(); _skSetFrame(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.4, 0)); _sk.onFace = true;
    _sk.ents.push({ type: 'spline', pts: [{ u: 1.3, v: 1.25 }, { u: 2.2, v: 0.8 }, { u: 3.2, v: 1.7 }, { u: 4.3, v: 1.25 }] }); _skRender(); });
  ok(await wait(8), 'Anhänger: Skizze oben + Zierlinie');
  await p.evaluate(async () => { _embOpen(); Object.assign(_emb.p, { mode: 'cut', prof: 'v', w: 1.5, d: 0.8 }); await _embApply(); });
  for (let k = 0; k < 30 && await step() < 9; k++) await p.waitForTimeout(300);
  ok(await step() === 9, 'Anhänger: eingeprägt → geschafft');
  await p.evaluate(() => _tutEnd());
  // ── Flansch ──
  await p.evaluate(() => _tutStart(3));
  await p.evaluate(() => { enterSketchMode(); _sk.ents.push({ type: 'circle', c: { u: 0, v: 0 }, r: 3.5 }, { type: 'circle', c: { u: 0, v: 0 }, r: 1.2 }, { type: 'circle', c: { u: 3, v: 0 }, r: 0.3 }); _skcIds();
    const [A, B, C] = _sk.ents; _skcPush([{ t: 'dia', refs: [{ id: A.id, p: null }], val: 8 }]); _skcPush([{ t: 'dia', refs: [{ id: B.id, p: null }], val: 2 }]); _skcPush([{ t: 'dia', refs: [{ id: C.id, p: null }], val: 0.8 }]);
    _skSetTool('sel'); _sk.sel = [{ id: C.id, p: null }, { id: A.id, p: 'c' }]; _skpOpen(); _skpSet('kind', 'circ'); _skpSet('n', '6'); _skpSet('tot', '360'); _skpApply(); });
  ok(await wait(5), 'Flansch: Kreise, Maße, Lochkreis 6× erkannt');
  r = await p.evaluate(() => _sk.ents.filter(e => e.type === 'circle' && Math.abs(e.r - 0.4) < 1e-6).map(e => Math.round(Math.hypot(e.c.u, e.c.v) * 100) / 10).join(','));
  ok(r === '30,30,30,30,30,30', `alle 6 Löcher auf dem Lochkreis r 30 (${r})`);
  await p.evaluate(async () => { _skExtrude(); _skxSet('end', 'dist'); _skxSet('op', 'auto'); _skxSet('d', '8'); _skxSet('bevT', 'cha'); _skxSet('bevTmm', '1'); _skxSet('bevB', 'none'); await _skxApply(); });
  for (let k = 0; k < 20 && await step() < 6; k++) await p.waitForTimeout(200);
  ok(await step() === 6, 'Flansch fertig (Maße, Fase, Volumen geprüft)');
  await p.evaluate(() => _tutEnd());
  // ── STL bearbeitbar ──
  await p.evaluate(() => _tutStart(4));
  for (let k = 0; k < 20 && !(await p.evaluate(() => objects.length === 1)); k++) await p.waitForTimeout(200);
  ok(await p.evaluate(() => objects.length === 1 && objects[0].userData.name === 'Halter.stl'), 'STL: Übungsteil liegt bereit');
  await p.evaluate(() => selectObjs([objects[0]])); ok(await wait(1), 'STL: angeklickt');
  await p.evaluate(async () => { await meshToCad(); }); ok(await wait(2), 'STL: Mesh → CAD');
  await p.evaluate(() => { const o = objects.find(x => x.userData.feat && x.visible !== false); _featEditSketch(o.userData.id, 0); }); ok(await wait(3), 'STL: Skizze aus dem Verlauf offen');
  await p.evaluate(() => { const c = _sk.ents.find(e => e.type === 'circle'); _skcIds(); _skSetTool('sel'); _skcDimEdit(_skcDimSpec([{ id: c.id, p: null }])); document.getElementById('sk-cdim-v').value = '8'; _skcDimCommit(); });
  ok(await wait(4), 'STL: Bohrung ⌀8');
  await p.evaluate(async () => { _skExtrude(); await _skxApply(); });
  for (let k = 0; k < 30 && await step() < 5; k++) await p.waitForTimeout(300);
  ok(await step() === 5, 'STL: neu gerechnet (Volumen geprüft)');
  await p.evaluate(() => _tutEnd());
  r = await p.evaluate(() => objects.length);
  ok(r === own.n, 'nach allen Anleitungen: eigenes Projekt wieder da');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
