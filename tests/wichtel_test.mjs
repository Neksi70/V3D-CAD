// Wichtel: Menü (Weihnachten) → Fenster → Vorschau → Erstellen (Körper/Gesicht/2 Beine, dicht, ohne Überlappung,
// auf der Platte) → Beine passen in die Löcher → glatt + ohne Beine → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8988, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _wchOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Wichtel').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#wch-modal.show');
  await p.waitForFunction(() => _gpv['wch'] && _gpv['wch'].group, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!(_gpv['wch'] && _gpv['wch'].group)), 'Vorschau steht');
  await p.screenshot({ path: SHOTS + '/wch-dialog.png', clip: await p.locator('#wch-modal .g3box').boundingBox() });
  const pass = await p.evaluate(async () => { const w = await _mfInit(), M = w.Manifold, r = _wchBuild(w, _wchP);
    const res = { hohl: !!r.boden, ein: M.intersection(r.boden, r.koerper).volume(), dreh: M.intersection(r.boden.rotate([0, 0, 45]), r.koerper).volume(),
      haelt: M.intersection(r.boden.rotate([0, 0, 45]).translate([0, 0, -3]), r.koerper).volume(), ges: M.intersection(r.gesicht, r.koerper).volume(),
      led: M.intersection(M.cylinder(16, _wchP.ledD / 2, _wchP.ledD / 2, 64).translate([0, 0, 2.4]), M.union(r.koerper, r.boden)).volume(), ledPasst: r.info.ledPasst,
      teile: [r.koerper, r.gesicht, r.boden].map(m => m.decompose().length), vol: r.koerper.volume() };
    [r.koerper, r.gesicht, r.boden].forEach(m => m.delete()); return res; });
  ok(pass.hohl && pass.teile.every(n => n === 1), `hohl (Standard): Körper/Gesicht/Boden je ein Teil, Körper ${Math.round(pass.vol / 1000)} cm³`);
  ok(pass.ein < 0.01 && pass.dreh < 0.01 && pass.haelt > 1, `Bajonett: einstecken + 45° drehen frei, gedreht hält die Platte (${pass.haelt.toFixed(1)} mm³ Anschlag)`);
  ok(pass.ledPasst && pass.led < 0.01 && pass.ges < 0.01, `LED-Teelicht Ø${38} passt in Mulde + Innenraum, Gesicht-Stifte ohne Überschneidung`);
  const r1 = await p.evaluate(async () => {
    await _wchCreate();
    return objects.map(o => ({ name: o.userData.name, minY: getMeshBox(o).min.y }));
  });
  ok(r1.length === 3 && r1.every(t => Math.abs(t.minY) < 1e-3 || /Gesicht/.test(t.name)), 'Erstellt: ' + r1.map(t => t.name).join(', '));
  await p.evaluate(() => { _newCreate(false); _wchOpen(); _wchSet('hohl', 0); });
  const r1b = await p.evaluate(async () => { await _wchCreate(); const w = await _mfInit(); return objects.map(o => ({ name: o.userData.name, s: _mfUnionObjs(w, [o]).decompose().length })); });
  ok(r1b.length === 4 && r1b.every(t => t.s === 1), 'massiv: ' + r1b.map(t => t.name).join(', '));
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/wch-szene.png' });
  await p.evaluate(() => { _newCreate(false); _wchOpen(); _wchSet('hohl', 0); _wchSet('rillen', 0); _wchSet('beinL', 0); _wchStr('aufhaenger', 'oben'); _wchSet('bart', 0); });
  const r2 = await p.evaluate(async () => { await _wchCreate(); return objects.map(o => o.userData.name); });
  ok(r2.length === 2, 'glatt, ohne Beine: ' + r2.join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
