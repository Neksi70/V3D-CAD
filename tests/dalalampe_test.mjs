// Dala-Lampe: Menü (Wohnen & Licht) → Fenster → Vorschau → LED-Vorlagen → Erstellen (Drucklage, 5 Teile,
// dicht, auf der Platte) → Passmaße (Stab ↔ Loch/Nabe, LED-Mulde, Schirm ↔ Kranz) → Kerzenteller → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8986, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _dlpOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Dala-Lampe').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click();
  await p.waitForSelector('#dlp-modal.show');
  await p.waitForFunction(() => _gpv['dlp'] && _gpv['dlp'].group && _dlpP._r, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(600);
  ok(await p.evaluate(() => !!(_gpv['dlp'] && _gpv['dlp'].group)), 'Vorschau steht');
  const info = await p.evaluate(() => document.getElementById('dlp-info').innerText);
  ok(/Lampe gesamt \d+ mm/.test(info) && /Farbwechsel/.test(info), 'Info: ' + info.split('\n')[0] + ' | ' + (info.match(/Farbwechsel[^\n]*/) || [''])[0].slice(0, 80));
  await p.screenshot({ path: SHOTS + '/dlp-dialog.png', clip: await p.locator('#dlp-modal .g3box').boundingBox() });
  await p.evaluate(() => _dlpLed('puck'));
  ok(await p.evaluate(() => _dlpP.ledD === 30 && _dlpP.ledH === 21 && document.querySelector('#dlp-led-bg .vtb.on').dataset.v === 'puck'), 'LED-Vorlage Puck Ø30 × 21');
  // Passmaße direkt am Kern
  const pass = await p.evaluate(async () => {
    const w = await _mfInit(), M = w.Manifold, r = _dlpBuild(w, _dlpP), res = {};
    res.stabPferd = M.intersection(r.stab, r.pferd).volume(); res.stabKranz = M.intersection(r.stab, r.aufsatz).volume();
    res.schirmKranz = M.intersection(r.schirmA, r.aufsatz).volume() + M.intersection(r.schirmB, r.aufsatz).volume();
    res.gapSchirm = r.schirmA.minGap(r.aufsatz, 2);
    // LED-Puck (Ø30×21) passt in die Mulde
    const ledZ = r.zAuflage - _dlpP.ledH, led = M.cylinder(_dlpP.ledH, _dlpP.ledD / 2, _dlpP.ledD / 2, 48).translate([r.m.xL, 0, ledZ]);
    res.led = M.intersection(led, r.aufsatz).volume();
    // Schirm liegt auf dem Kranz (Unterkante Schirm = Oberkante Kranz)
    res.auflage = r.schirmA.boundingBox().min[2] - r.aufsatz.boundingBox().max[2];
    ['pferd', 'stab', 'aufsatz', 'schirmA', 'schirmB'].forEach(k => r[k] && r[k].delete()); led.delete();
    return res;
  });
  ok(pass.stabPferd < 0.01 && pass.stabKranz < 0.01, `Stab steckt frei in Pferd und Kranz (${pass.stabPferd.toFixed(3)} / ${pass.stabKranz.toFixed(3)} mm³)`);
  ok(pass.led < 0.01, `LED passt in die Mulde (${pass.led.toFixed(3)} mm³)`);
  ok(pass.schirmKranz < 0.01 && Math.abs(pass.auflage) < 0.01, `Schirm liegt auf dem Kranz auf (Spalt ${pass.auflage.toFixed(2)} mm, Überschneidung ${pass.schirmKranz.toFixed(3)})`);
  const r1 = await p.evaluate(async () => {
    await _dlpCreate();
    const w = await _mfInit(), res = [];
    for (const o of objects) { const m = _mfUnionObjs(w, [o]), bb = getMeshBox(o), s = bb.getSize(new THREE.Vector3());
      res.push({ name: o.userData.name, shells: m.decompose().length, vol: m.volume(), minY: bb.min.y, L: s.x * 10, B: s.z * 10, H: s.y * 10 }); }
    return res;
  });
  ok(r1.length === 5, 'Teile: ' + r1.map(x => x.name).join(', '));
  const pf = r1.find(x => /Pferd/.test(x.name)), st = r1.find(x => /^Stab/.test(x.name));
  ok(pf && Math.abs(pf.H - 30) < 0.5 && st && st.H < 14, `Pferd liegt flach (${pf.H.toFixed(1)} mm hoch), Stab liegt (${st.H.toFixed(1)} mm hoch, abgeflacht)`);
  ok(r1.filter(x => !/dunkel/.test(x.name)).every(x => Math.abs(x.minY) < 1e-3) && Math.abs(r1.find(x => /dunkel/.test(x.name)).minY * 10 - 110 / 8) < 0.1 && r1.filter(x => !/Schirm/.test(x.name)).every(x => x.shells === 1), 'alles auf der Platte, Pferd/Stab/Kranz je eine Schale: ' + r1.map(x => x.name + ' ' + x.shells + 'S y' + x.minY.toFixed(3)).join(', '));
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/dlp-drucklage.png' });
  await p.evaluate(() => { _newCreate(false); _dlpOpen(); _dlpStr('aufsatz', 'kerze'); _dlpStr('farbe', 'beige'); });
  const r2 = await p.evaluate(async () => { await _dlpCreate(); return objects.map(o => o.userData.name); });
  ok(r2.length === 3 && r2.some(n => /Kerzenteller/.test(n)), 'Kerzenteller-Variante: ' + r2.join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
