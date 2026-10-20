// Volker 20.10.26: Standard ist die eigene V3D-Oberfläche; V3D-SionCAD (Fusion-artig) und
// V3D-ShapeCAD (Shapr3D-artig) sind nur Umschalter. Was dort gebaut wird, muss nach dem
// Zurückspringen erhalten und weiter bearbeitbar sein.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const HIER = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 18829;
const srv = spawn('python3', [path.join(HIER, 'umgebungen-test-server.py'), String(PORT), '--dev'], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d-umgebungen.html`);
  await p.waitForFunction(() => typeof _advSet === 'function' && window.v3dApi && v3dApi.ready());
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  ok(await p.evaluate(() => _advMode === 'beginner'), 'Neuer Nutzer startet in der V3D-Oberfläche (V3D-CAD)');
  const A = (c, q) => p.evaluate(([c, q]) => v3dApi.execute(c, q), [c, q]);
  const stand = () => p.evaluate(() => objects.map(o => ({ id: o.userData.id, exakt: !!o.userData.exakt,
    v: Math.round(Math.abs(_geoSignedVolume(o.geometry.clone().applyMatrix4(o.matrixWorld))) * 1e4) / 1e4 })));

  for (const [modus, name] of [['shape', 'V3D-ShapeCAD'], ['advanced', 'V3D-SionCAD']]) {
    await p.evaluate(m => { _newCreate(false); _advSet(m); }, modus);
    ok(await p.evaluate(m => _advMode === m && localStorage.getItem('v3d_modus') === m, modus), `${name} eingeschaltet`);
    const box = (await A('shape.add', { type: 'box', size: [40, 30, 20] })).result;
    await A('body.fillet', { id: box.id, radius: 3, edges: 'vertical' });
    const loch = (await A('shape.add', { type: 'cylinder', size: [10, 10, 30], center: [0, 0, 10], hole: true })).result;
    const r = await A('bool.subtract', { target: box.id, tools: [loch.id] });
    ok(r.ok, `${name}: Körper gebaut (Runden + Abziehen)`);
    const vorher = await stand();
    await p.evaluate(() => _advSet('beginner'));
    const nachher = await stand();
    ok(await p.evaluate(() => _advMode === 'beginner'), `${name} → zurück zu V3D-CAD`);
    ok(JSON.stringify(vorher) === JSON.stringify(nachher), `${name}: Modell nach dem Zurückspringen unverändert (${nachher.length} Körper, exakt ${nachher.map(x => x.exakt).join('/')})`);
    // in V3D-CAD weiterbearbeiten: Größe über das normale Maß-Feld ändern + Rückgängig
    const id = nachher[0].id;
    const breite = await p.evaluate(id => { const o = objects.find(x => x.userData.id === id); selectObjs([o]); saveUndo(); scaleLocked = false; applyDimChange('sw', 60);
      return Math.round(getMeshBox(o).getSize(new THREE.Vector3()).x * 100) / 10; }, id);
    ok(Math.abs(breite - 60) < 0.05, `${name}-Teil in V3D-CAD weiter bearbeitbar: Breite 40 → ${breite} mm`);
    await p.evaluate(() => undo());
    const zurueck = await stand();
    ok(Math.abs(zurueck[0].v - nachher[0].v) < 1e-3, `${name}-Teil: Rückgängig in V3D-CAD stellt es wieder her`);
    // Speichern in V3D-CAD und wieder laden → exakte Form bleibt
    const snap = await p.evaluate(() => JSON.stringify(_sceneSnapshot()));
    await p.evaluate(s => { _newCreate(false); _applySnapshot(JSON.parse(s)); }, snap);
    const geladen = await stand();
    ok(geladen.length === zurueck.length && geladen[0].exakt === zurueck[0].exakt, `${name}-Teil: Speichern/Laden in V3D-CAD (exakt ${geladen[0].exakt})`);
  }
  // Umsteiger-Hinweis: frischer Nutzer → einmal Sprechblase, Knopf schaltet um, danach nie wieder
  const ctx2 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const q = await ctx2.newPage();
  q.on('pageerror', e => errs.push(e.message));
  await q.goto(`http://127.0.0.1:${PORT}/volme3d-umgebungen.html`);
  await q.waitForFunction(() => typeof _advSet === 'function');
  await q.evaluate(() => { try { hideStarter(); } catch (e) {} });
  await q.waitForSelector('#umsteiger-hinweis', { timeout: 15000 });
  const txt = await q.textContent('#umsteiger-hinweis');
  ok(/Fusion/.test(txt) && /V3D-SionCAD/.test(txt) && /Shapr3D/.test(txt) && /V3D-ShapeCAD/.test(txt), 'Umsteiger-Hinweis erscheint für neue Nutzer in V3D-CAD');
  await q.screenshot({ path: '/tmp/umsteiger-hinweis.png', clip: { x: 0, y: 0, width: 1400, height: 330 } });
  await q.click('#umsteiger-hinweis [data-u="shape"]');
  ok(await q.evaluate(() => _advMode === 'shape' && !document.getElementById('umsteiger-hinweis')), 'Knopf im Hinweis schaltet auf V3D-ShapeCAD, Hinweis verschwindet');
  await q.evaluate(() => _advSet('beginner'));
  await q.reload();
  await q.waitForFunction(() => typeof _advSet === 'function');
  await q.evaluate(() => { try { hideStarter(); } catch (e) {} });
  await q.waitForTimeout(6000);
  ok(await q.evaluate(() => !document.getElementById('umsteiger-hinweis')), 'nach dem Neuladen kein Hinweis mehr (nur einmal)');
  await ctx2.close();
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | ').slice(0, 200));
} catch (e) { console.error(e); fail++; }
await b.close(); srv.kill();
console.log(fail ? `\n${fail} FEHLER` : '\nALLE OK');
process.exit(fail ? 1 : 0);
