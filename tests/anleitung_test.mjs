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
  ok(await p.evaluate(() => document.querySelectorAll('#tut-menu .btn.pri').length === 2), 'Menü zeigt 2 Anleitungen');
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
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
