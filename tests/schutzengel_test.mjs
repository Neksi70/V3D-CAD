// Schutzengel: Menü (Weihnachten) → Fenster → Vorschau mit Text → Vorlagen → Erstellen (Körper/Flügel/Text,
// dicht, ohne Überlappung, Text liegt oben drauf) → Streifen + beide Flügel → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8987, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _sgeOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Schutzengel').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#sge-modal.show');
  await p.waitForFunction(() => window._threeFont_greatvibes_local && window._threeFont_helvetiker_bold, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  ok(await p.evaluate(() => !!(_gpv['sge'] && _gpv['sge'].group)), 'Vorschau steht');
  ok(await p.evaluate(() => document.getElementById('sge-font2').querySelectorAll('option').length >= 8 && document.getElementById('sge-text2').value === 'Schutzengel'), 'Schriftauswahl gefüllt, Text „Schutzengel“');
  await p.screenshot({ path: SHOTS + '/sge-dialog.png', clip: await p.locator('#sge-modal .g3box').boundingBox() });
  const bauen = () => p.evaluate(async () => {
    await _sgeCreate();
    const w = await _mfInit(), M = w.Manifold, mf = objects.map(o => _mfUnionObjs(w, [o])), res = { teile: [] };
    objects.forEach((o, i) => { const bb = getMeshBox(o); res.teile.push({ name: o.userData.name, shells: mf[i].decompose().length, vol: mf[i].volume(), minY: bb.min.y * 10, maxY: bb.max.y * 10 }); });
    let ov = 0; for (let i = 0; i < mf.length; i++) for (let j = i + 1; j < mf.length; j++) ov += M.intersection(mf[i], mf[j]).volume();
    res.ov = ov; return res;
  });
  const r1 = await bauen();
  const k = r1.teile.find(t => /^Schutzengel/.test(t.name)), f = r1.teile.find(t => /Flügel/.test(t.name)), d = r1.teile.find(t => /Text/.test(t.name));
  ok(k && f && d && r1.teile.length === 3, 'Teile: ' + r1.teile.map(t => t.name).join(', '));
  ok(k.shells === 1 && f.shells === 1 && d.vol > 20 && r1.ov < 0.01, `Körper/Flügel je 1 Schale, Text ${d.vol.toFixed(0)} mm³, Überlappung ${r1.ov.toFixed(3)}`);
  ok(Math.abs(k.minY) < 1e-3 && Math.abs(d.minY - 4) < 0.05 && Math.abs(d.maxY - 4.6) < 0.05, `Text liegt oben auf (${d.minY.toFixed(2)}–${d.maxY.toFixed(2)} mm), Körper auf der Platte`);
  await p.evaluate(() => { _newCreate(false); _sgeOpen(); _sgeVorlage('streifen'); _sgeStr('fluegel', 'beide'); });
  const r2 = await bauen();
  ok(r2.teile.length === 3 && r2.teile.find(t => /Flügel/.test(t.name)).shells === 2 && r2.ov < 0.01, 'Streifen + beide Flügel: ' + r2.teile.map(t => t.name + ' ' + t.shells + 'S').join(', '));
  // Engelsflügel dazu (ohne Fähnchen): Flügel-Teil = 2 Schwingen, berühren den Körper, keine Überlappung
  await p.evaluate(() => { _newCreate(false); _sgeOpen(); _sgeVorlage('text'); _sgeFluegel('engel'); });
  ok(await p.evaluate(() => _sgeP.fluegel === 'keine' && _sgeP.engel === 1 && document.querySelector('#sge-fluegel-bg .vtb.on').dataset.v === 'engel' && document.getElementById('sge-herz').style.display === 'none'), 'Flügel-Wahl: Engelsflügel statt Fähnchen, Herz-Knopf ausgeblendet');
  const rE = await bauen(), fE = rE.teile.find(t => /Flügel/.test(t.name)), kE = rE.teile.find(t => /^Schutzengel/.test(t.name));
  ok(fE && fE.shells === 2 && kE.shells === 1 && rE.ov < 0.01 && fE.vol > 1500, `Engelsflügel: ${fE ? fE.shells + ' Schwingen, ' + fE.vol.toFixed(0) + ' mm³' : 'fehlen'}, Überlappung ${rE.ov.toFixed(3)}`);
  ok(await p.evaluate(async () => { const w = await _mfInit(), r = _sgeBuild(w, { ..._sgeP, engel: 1, fluegel: 'keine' }, null), g = w.Manifold.union(r.koerper, r.fluegel), n = g.decompose().length; return n === 1; }), 'Engelsflügel sitzen am Körper an (zusammen 1 Stück)');
  await p.evaluate(() => { _sgeFluegel('fahne'); });
  ok(await p.evaluate(() => _sgeP.fluegel === 'rechts' && _sgeP.engel === 0), 'Flügel-Wahl: zurück zum Fähnchen rechts');
  // Glatt: Schrift nach unten, alles bündig eingelegt, Pünktchen eigenes Teil
  await p.evaluate(() => { _newCreate(false); _sgeOpen(); _sgeVorlage('text'); _sgeStr('fluegel', 'rechts'); _sgeStr('druck', 'glatt'); _sgeSet('stern', 1); });
  const r3 = await bauen();
  const k3 = r3.teile.find(t => /^Schutzengel/.test(t.name)), d3 = r3.teile.find(t => /Text/.test(t.name)), p3 = r3.teile.find(t => /Pünktchen/.test(t.name));
  ok(r3.teile.length === 4 && k3 && d3 && p3 && p3.vol > 20, 'Glatt: ' + r3.teile.map(t => t.name + ' ' + t.vol.toFixed(0) + 'mm³').join(', '));
  ok(r3.teile.every(t => t.minY > -1e-3 && t.maxY < 4 + 1e-3) && Math.abs(d3.minY) < 1e-3 && Math.abs(d3.maxY - 0.6) < 0.05 && Math.abs(p3.minY) < 1e-3,
     `Glatt: alles in 0–4 mm, Text ${d3.minY.toFixed(2)}–${d3.maxY.toFixed(2)} mm auf der Platte`);
  ok(k3.shells === 1 && r3.ov < 0.01, `Glatt: Körper 1 Schale, Überlappung ${r3.ov.toFixed(3)}`);
  const vSoll = await p.evaluate(async () => { const w = await _mfInit(), r = _sgeBuild(w, { ..._sgeP, druck: 'oben' }, _sgeText), v = r.koerper.volume();
    for (const x of ['koerper', 'fluegel', 'dunkel', 'punkte']) if (r[x]) r[x].delete(); return v; });
  ok(vSoll > 0, 'Erhaben-Bau läuft weiter');
  await p.evaluate(() => { _sgeStr('druck', 'oben'); });
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(500);
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
