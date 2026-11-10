// Häuser-Ring: Menü (Weihnachten) → Fenster → Vorschau mit HOME → Erstellen (Ring + Motiv, dicht, Motiv oben auf) → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8991, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _rhsOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Häuser-Ring').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#rhs-modal.show');
  await p.waitForFunction(() => window._threeFont_baloo_local, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  ok(await p.evaluate(() => !!(_gpv['rhs'] && _gpv['rhs'].group)), 'Vorschau steht');
  await p.screenshot({ path: SHOTS + '/rhs-dialog.png', clip: await p.locator('#rhs-modal .g3box').boundingBox() });
  const r1 = await p.evaluate(async () => {
    const w = await _mfInit(), r = _rhsBuild(w, _rhsP, _rhsText), M = w.Manifold;
    const res = { k: r.koerper.decompose().length, mot: r.motiv.volume(), ov: M.intersection(r.koerper, r.motiv).volume(), zMin: r.motiv.boundingBox().min[2] };
    r.koerper.delete(); r.motiv.delete();
    const r0 = _rhsBuild(w, _rhsP, null), v0 = r0.motiv.volume(); r0.koerper.delete(); r0.motiv.delete(); res.buchst = res.mot - v0; return res; });
  ok(r1.k === 1 && r1.ov < 0.01 && Math.abs(r1.zMin - 3) < 0.01, `Ring = 1 Schale, Motiv ${r1.mot.toFixed(0)} mm³ ab z = ${r1.zMin.toFixed(2)}, Überlappung ${r1.ov.toFixed(3)}`);
  ok(r1.buchst > 5, `Buchstaben HOME auf den Wimpeln (${r1.buchst.toFixed(0)} mm³)`);
  const r2 = await p.evaluate(async () => { await _rhsCreate(); return objects.map(o => ({ name: o.userData.name, minY: getMeshBox(o).min.y })); });
  ok(r2.length === 2 && Math.abs(r2[0].minY) < 1e-3, 'Teile: ' + r2.map(t => t.name).join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
