// FlexiGen: Herz flach → Glieder mit Fass-Scharnieren, getrennt, beweglich, übernehmen als ein Teil, Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8978;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _flxOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    _newCreate(false); addShape('heart'); const o = objects[0]; o.scale.set(4, 1, 4); o.updateMatrixWorld(true); o.position.y -= getMeshBox(o).min.y; selectObjs([o]); _flxOpen(); });
  const r0 = await p.evaluate(() => document.getElementById('flx-panel').innerText);
  ok(/5 mm dick/.test(r0), 'Fenster zeigt Maße: ' + r0.split('\n').find(l => /dick/.test(l)));
  await p.evaluate(() => { _flxSet('n', 6); });
  await p.click('#flx-go');
  await p.waitForFunction(() => _flx.teile && !_flx.busy, null, { timeout: 60000 });
  const r1 = await p.evaluate(async () => {
    const w = await _mfInit(), M = w.Manifold;
    const mf = _flx.teile.map(m => _mfUnionObjs(w, [m]));
    let ov = 0, minGap = 99;
    for (let i = 0; i < mf.length; i++) for (let j = i + 1; j < mf.length; j++) { ov += M.intersection(mf[i], mf[j]).volume(); minGap = Math.min(minGap, mf[i].minGap(mf[j], 2)); }
    const ganz = mf.every(x => x.decompose().length === 1);
    return { n: _flx.teile.length, gel: _flx.gelenke.length, ov, minGap, ganz, maxGrad: _flx.info.maxGrad, origHidden: !objects[0].visible, txt: document.getElementById('flx-panel').innerText };
  });
  ok(r1.n === 6 && r1.gel === 5, `6 Glieder, 5 Gelenke`);
  ok(r1.ov < 1e-3 && r1.minGap >= 0.15, `Glieder getrennt: Überlappung ${r1.ov.toFixed(4)} mm³, kleinster Abstand ${r1.minGap.toFixed(2)} mm`);
  ok(r1.ganz, 'jedes Glied ist ein zusammenhängendes Stück');
  ok(r1.maxGrad >= 30, 'biegt je Gelenk bis ca. ' + r1.maxGrad + '°');
  ok(r1.origHidden, 'Original während der Vorschau ausgeblendet');
  // Biegen-Vorschau
  const r2 = await p.evaluate(() => { _flxBiegen(30); const last = _flx.teile[_flx.teile.length - 1]; const e = last.matrix.elements; const moved = Math.abs(e[13]) + Math.abs(e[12]) + Math.abs(e[14]) > 0.01; _flxBiegen(0); return { moved, back: _flx.teile.every(m => m.matrix.equals(new THREE.Matrix4())) }; });
  ok(r2.moved && r2.back, 'Biegen bewegt die Kette, 0° = wieder flach');
  // Übernehmen
  const r3 = await p.evaluate(async () => {
    _flxUebernehmen();
    const w = await _mfInit(), o = objects[0], mf = _mfUnionObjs(w, [o]);
    return { n: objects.length, name: o.userData.name, shells: mf.decompose().length, minY: getMeshBox(o).min.y, panel: !!document.getElementById('flx-panel'), preview: scene.children.filter(c => c.isMesh && !objects.includes(c) && c.material && c.material.color && c.geometry && c.geometry.attributes.position.count > 1000 && !c.userData.isEdgeLines).length };
  });
  ok(r3.n === 1 && r3.shells === 6 && /^Flexi/.test(r3.name), `übernommen als EIN Teil „${r3.name}" mit 6 getrennten Gliedern`);
  ok(Math.abs(r3.minY) < 1e-3 && !r3.panel, 'liegt flach auf der Platte, Fenster zu');
  const r4 = await p.evaluate(async () => { undo(); await new Promise(r => setTimeout(r, 300)); return { n: objects.length, type: objects[0].userData.shapeType, vis: objects[0].visible }; });
  ok(r4.n === 1 && r4.type === 'heart' && r4.vis, 'Rückgängig: Herz wieder da');
  // zu dick → Hinweis, Knopf aus
  const r5 = await p.evaluate(() => { _newCreate(false); addShape('box'); const o = objects[0]; o.scale.set(2, 2, 2); o.updateMatrixWorld(true); selectObjs([o]); _flxOpen(); return { txt: document.getElementById('flx-panel').innerText, dis: document.getElementById('flx-go').disabled }; });
  ok(/Zu dick/.test(r5.txt) && r5.dis, 'Würfel 40 mm: „zu dick", Bauen gesperrt');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
