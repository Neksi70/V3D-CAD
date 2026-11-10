// Strick-Elch: Menü (Weihnachten) → Vorschau → am Stück (1 Teil, Höhe) → längs halbiert (2 Hälften flach, je 1 Teil, Stiftlöcher) → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8999;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _elcOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Strick-Elch').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#elc-modal.show');
  await p.waitForFunction(() => _gpv['elc'] && _gpv['elc'].group, null, { timeout: 60000 }).catch(() => {});
  ok(await p.evaluate(() => !!(_gpv['elc'] && _gpv['elc'].group)), 'Vorschau steht');
  const r1 = await p.evaluate(async () => { await _elcCreate(); const w = await _mfInit(); return objects.map(o => { const m = _mfUnionObjs(w, [o]), bb = getMeshBox(o); return { name: o.userData.name, s: m.decompose().length, h: bb.getSize(new THREE.Vector3()).y * 10, minY: bb.min.y }; }); });
  ok(r1.length === 1 && r1[0].s === 1 && Math.abs(r1[0].h - 180) < 8 && Math.abs(r1[0].minY) < 1e-3, `am Stück: ${r1[0].name}, 1 Teil, ${r1[0].h.toFixed(0)} mm hoch, steht auf der Platte`);
  await p.evaluate(() => { _newCreate(false); _elcOpen(); _elcSet('teilen', 1); });
  const r2 = await p.evaluate(async () => { await _elcCreate(); const w = await _mfInit(); return objects.map(o => { const m = _mfUnionObjs(w, [o]), bb = getMeshBox(o); return { name: o.userData.name, s: m.decompose().length, g: m.genus(), h: bb.getSize(new THREE.Vector3()).y * 10, minY: bb.min.y }; }); });
  ok(r2.length === 2 && r2.every(t => Math.abs(t.minY) < 1e-3 && t.h < 40), 'halbiert: ' + r2.map(t => `${t.name} (${t.h.toFixed(0)} mm hoch liegend, ${t.s} Teil(e))`).join(', '));
  ok(r2.every(t => t.s <= 2), 'Hälften zerfallen nicht in viele Stücke');
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
