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
    const v = M.intersection(r.koerper, r.beine[0]).volume() + M.intersection(r.koerper, r.beine[1]).volume() + M.intersection(r.koerper, r.gesicht).volume();
    const gap = r.koerper.minGap(r.gesicht, 1); [r.koerper, r.gesicht, ...r.beine].forEach(m => m.delete()); return { v, gap }; });
  ok(pass.v < 0.01 && pass.gap < 0.05, `Beine stecken frei in den Löchern, Gesicht liegt bündig in der Mulde (Überschneidung ${pass.v.toFixed(3)}, Abstand ${pass.gap.toFixed(3)} mm)`);
  const r1 = await p.evaluate(async () => {
    await _wchCreate();
    const w = await _mfInit(), M = w.Manifold, mf = objects.map(o => _mfUnionObjs(w, [o]));
    let ov = 0; for (let i = 0; i < mf.length; i++) for (let j = i + 1; j < mf.length; j++) ov += M.intersection(mf[i], mf[j]).volume();
    return { teile: objects.map((o, i) => ({ name: o.userData.name, shells: mf[i].decompose().length, minY: getMeshBox(o).min.y, h: getMeshBox(o).getSize(new THREE.Vector3()).y * 10 })), ov };
  });
  ok(r1.teile.length === 4 && r1.teile.every(t => t.shells === 1) && r1.ov < 0.5, 'Teile: ' + r1.teile.map(t => t.name + ' ' + t.shells + 'S').join(', ') + `, Überlappung ${r1.ov.toFixed(3)}`);
  ok(r1.teile.every(t => Math.abs(t.minY) < 1e-3 || /Gesicht/.test(t.name)) && Math.abs(r1.teile[0].h - 95) < 0.5, `alles auf der Platte, Wichtel ${r1.teile[0].h.toFixed(1)} mm hoch`);
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/wch-szene.png' });
  await p.evaluate(() => { _newCreate(false); _wchOpen(); _wchSet('rillen', 0); _wchSet('beinL', 0); _wchStr('aufhaenger', 'oben'); _wchSet('bart', 0); });
  const r2 = await p.evaluate(async () => { await _wchCreate(); return objects.map(o => o.userData.name); });
  ok(r2.length === 2, 'glatt, ohne Beine: ' + r2.join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
