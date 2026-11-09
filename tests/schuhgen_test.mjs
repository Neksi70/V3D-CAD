// Badelatschen & Clogs: Menü → Fenster → Vorschau → Badelatschen-Paar / Clog → dicht, Maße, Fuß frei, Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8985, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _sgnOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Badelatschen & Clogs').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click();
  await p.waitForSelector('#sgn-modal.show');
  await p.waitForFunction(() => _gpv['sgn'] && _gpv['sgn'].group && _sgnP._info, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(600);
  ok(await p.evaluate(() => !!(_gpv['sgn'] && _gpv['sgn'].group)), 'Vorschau steht');
  const info = await p.evaluate(() => document.getElementById('sgn-info').innerText);
  ok(/Fußlänge 265 mm/.test(info) && /Schuh 2\d\d ×/.test(info), 'Info: ' + info.split('\n')[0]);
  await p.screenshot({ path: SHOTS + '/sgn-dialog.png', clip: await p.locator('#sgn-modal .g3box').boundingBox() });
  const bauen = (opt) => p.evaluate(async (opt) => {
    Object.assign(_sgnP, opt); await _sgnCreate();
    const w = await _mfInit(), M = w.Manifold, res = [];
    for (const o of objects) { const m = _mfUnionObjs(w, [o]), bb = getMeshBox(o), s = bb.getSize(new THREE.Vector3());
      res.push({ name: o.userData.name, shells: m.decompose().length, vol: m.volume(), L: s.x * 10, B: s.z * 10, H: s.y * 10, minY: bb.min.y }); }
    return res;
  }, opt);
  const r1 = await bauen({ typ: 'slide', paar: 1 });
  ok(r1.length === 2 && r1.every(x => x.shells === 1 && x.vol > 100000), `Badelatschen-Paar: ${r1.map(x => x.name).join(' + ')}, je 1 Schale, ${(r1[0].vol / 1000).toFixed(0)} cm³`);
  ok(Math.abs(r1[0].L - 279) < 6 && r1[0].H > 50 && r1.every(x => Math.abs(x.minY) < 1e-3), `Maße ${r1[0].L.toFixed(0)} × ${r1[0].B.toFixed(0)} × ${r1[0].H.toFixed(0)} mm, auf der Platte`);
  await p.evaluate(() => { _newCreate(false); _sgnOpen(); _sgnStr('typ', 'clog'); });
  ok(await p.evaluate(() => _sgnP.sohle === 14 && _sgnP.luft === 4), 'Clog setzt Sohle 14 / Luft 4');
  const r2 = await bauen({ paar: 0, eu: 30, farbe: '#3aa655' });
  ok(r2.length === 1 && r2[0].shells === 1 && /Clog EU 30/.test(r2[0].name) && r2[0].L > 190 && r2[0].L < 215, `Clog EU 30: ${r2[0].L.toFixed(0)} mm lang, 1 Schale`);
  // Fuß frei: Leisten an seiner Stelle im Kern schneidet den Clog nicht
  const frei = await p.evaluate(async () => { const w = await _mfInit(), r = _sgnBuild(w, { ..._sgnP, eu: 30 }), L = _ksuLeisten(w, { ..._sgnP, eu: 30 }, 0, 0).translate([r.fussX, 0, r.fussZ]); const v = w.Manifold.intersection(L, r.m).volume(); r.m.delete(); L.delete(); return v; });
  ok(frei < 1, `Fuß (Leisten) frei im Clog: Überschneidung ${frei.toFixed(2)} mm³`);
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/sgn-clog.png' });
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt den Clog');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
