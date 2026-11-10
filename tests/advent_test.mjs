// Adventskalender: Menü (Weihnachten) → Vorschau → Berg + Ball zusammengebaut (Teile, Höhe, Bett) → Druckteile → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8994, SHOT = process.env.SHOT;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _advOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Adventskalender').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#adv-modal.show');
  await p.waitForFunction(() => _gpv['adv'] && _gpv['adv'].group && _advLast, null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!(_gpv['adv'] && _gpv['adv'].group)), 'Vorschau steht (Fußball)');
  await p.waitForFunction(() => !!window._threeFont_baloo_local, null, { timeout: 15000 }).catch(() => {});
  if (SHOT) { await p.waitForTimeout(1200); await p.locator('#adv-modal .g3box').screenshot({ path: SHOT + '_fenster_ball.png' }); }
  const mess = async () => p.evaluate(() => { const bb = new THREE.Box3(); objects.forEach(o => bb.union(getMeshBox(o))); const s = bb.getSize(new THREE.Vector3());
    return { n: objects.length, w: s.x * 10, h: s.y * 10, d: s.z * 10, minY: bb.min.y, namen: objects.map(o => o.userData.name) }; });
  for (const form of ['berg', 'ball']) {
    await p.evaluate(f => { _newCreate(false); _advOpen(); _advFormWahl(f); _advAnsicht('zusammen'); }, form);
    await p.evaluate(() => _advCreate());
    const r = await mess();
    ok(r.n >= (form === 'berg' ? 27 : 32) && Math.abs(r.h - 400) < 25 && Math.abs(r.minY) < 0.1, `${form} zusammengebaut: ${r.n} Teile, ${r.w.toFixed(0)} × ${r.h.toFixed(0)} × ${r.d.toFixed(0)} mm`);
    ok(r.namen.filter(n => /^(Fach|Stöpsel) \d\d/.test(n)).length === 24, `${form}: genau 24 Fächer/Stöpsel`);
    if (SHOT) { await p.mouse.click(700, 880); await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(800); await p.screenshot({ path: `${SHOT}_${form}.png` }); }
    await p.evaluate(f => { _newCreate(false); _advOpen(); _advFormWahl(f); _advAnsicht('druck'); }, form);
    await p.evaluate(() => _advCreate());
    const dr = await p.evaluate(() => objects.map(o => { const s = getMeshBox(o).getSize(new THREE.Vector3()); return [o.userData.name, s.x * 10, s.y * 10, s.z * 10, getMeshBox(o).min.y]; }));
    const bett = 256, zu = dr.filter(t => t.slice(1, 4).some(x => x > bett + 0.5));
    ok(!zu.length && dr.every(t => Math.abs(t[4]) < 0.01), `${form} Druckteile: ${dr.length}, alle ≤ ${bett} mm und auf der Platte` + (zu.length ? ' – zu groß: ' + zu.map(t => t[0]).join(', ') : ''));
    if (SHOT) { await p.mouse.click(700, 880); await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(800); await p.screenshot({ path: `${SHOT}_${form}_druck.png` }); }
  }
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
