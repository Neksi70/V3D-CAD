// Strick-Stern: Menü (Weihnachten) → Fenster → Vorschau → Erstellen → dicht, flach, Öse, Stile, Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8982, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _sstOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Strick-Stern').first();
  ok(await item.count() > 0, 'Eintrag „Strick-Stern“ im Generator-Menü');
  await item.click();
  await p.waitForSelector('#sst-modal.show');
  await p.waitForFunction(() => _gpv['sst'] && _gpv['sst'].group, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!(_gpv['sst'] && _gpv['sst'].group)), 'Vorschau steht');
  await p.screenshot({ path: SHOTS + '/sst-dialog.png', clip: await p.locator('#sst-modal .g3box').boundingBox() });
  const info = await p.evaluate(() => document.getElementById('sst-info').innerText);
  ok(/ohne Stützen/.test(info), 'Info: ' + info.split('\n')[0]);
  const bauen = async (opt) => p.evaluate(async (opt) => {
    Object.assign(_sstP, opt); const t0 = performance.now(); await _sstCreate(); const ms = performance.now() - t0;
    const o = objects[objects.length - 1], w = await _mfInit(), mf = _mfUnionObjs(w, [o]), bb = getMeshBox(o);
    return { ms, n: objects.length, name: o.userData.name, shells: mf.decompose().length, genus: mf.genus(), vol: mf.volume(), minY: bb.min.y, size: bb.getSize(new THREE.Vector3()).toArray().map(v => v * 10) };
  }, opt);
  const r1 = await bauen({});
  ok(r1.shells === 1 && r1.genus === 0 && r1.vol > 50000, `Rand + Zöpfe: dicht, 1 Schale, ${(r1.vol / 1000).toFixed(0)} cm³, ${r1.size.map(v => v.toFixed(0)).join(' × ')} mm, ${(r1.ms / 1000).toFixed(1)} s`);
  ok(Math.abs(r1.minY) < 1e-3 && /^Strick-Stern/.test(r1.name), 'liegt auf der Platte, Name ' + r1.name);
  ok(Math.abs(r1.size[0] - 114) < 6 && Math.abs(r1.size[2] - 115) < 8 && r1.size[1] > 25 && r1.size[1] < 40, 'Maße passen zu 120 mm / 30 mm');
  await p.evaluate(() => { _sstOpen(); });
  const r2 = await bauen({ oese: 1 });
  ok(r2.genus === 1 && r2.shells === 1, 'mit Öse: Loch durch (Geschlecht 1)');
  await p.evaluate(() => { _sstOpen(); });
  const r3 = await bauen({ oese: 0, stil: 'rand', zacken: 7, farbe: '#7b5b4b', dia: 90 });
  ok(r3.shells === 1 && r3.genus === 0, `Rand + Kissen, 7 Zacken, 90 mm: dicht (${r3.size.map(v => v.toFixed(0)).join(' × ')} mm)`);
  const r4 = await p.evaluate(() => { undo(); return objects.length; });
  ok(r4 === 2, 'Rückgängig entfernt den letzten Stern');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
