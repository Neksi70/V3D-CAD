// Wichtel-Türecke (🚪 _wsi*): Türecke + Aufsteller bauen: Grundplatte 1 Stück, Auflagen ohne Überlappung auf der Platte
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process'; import fs from 'fs';
const PORT = 8896;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _wsiOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Wichtel-Türecke').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click(); await p.waitForSelector('#wsi-modal.show'); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => !!(_gpv['wsi'] && _gpv['wsi'].group)), 'Vorschau steht');
  for (const modus of ['ecke', 'aufsteller']) {
    const r = await p.evaluate(async (modus) => { const w = await _mfInit(), M = w.Manifold, r = _wsiBuild(w, { ..._wsiP, modus });
      const bin = m => { const me = m.getMesh(), V = me.vertProperties, T = me.triVerts, np = me.numProp, a = []; for (let i = 0; i < T.length; i++) { const q = T[i] * np; a.push(V[q], V[q + 1], V[q + 2]); } return a; };
      const o = { g: r.grund.decompose().length, ov: M.intersection(r.grund, r.weiss).volume() + M.intersection(r.grund, r.nase).volume() + M.intersection(r.weiss, r.nase).volume(),
        aufGrund: M.intersection(r.weiss.translate([0, 0, -0.81]), r.grund).volume() > 0, z: r.weiss.boundingBox().max[2], fuss: !!r.fuss, bin: modus === 'ecke' ? [bin(r.grund), bin(r.weiss), bin(r.nase)] : null };
      return o; }, modus);
    if (r.bin) { ['g', 'w', 'n'].forEach((n, i) => fs.writeFileSync(`/tmp/wsi_${n}.bin`, Buffer.from(new Float32Array(r.bin[i]).buffer))); delete r.bin; }
    ok(r.g === 1 && r.ov < 0.01 && r.aufGrund && Math.abs(r.z - 3.8) < 0.01 && r.fuss === (modus === 'aufsteller'), `${modus}: Grundplatte 1 Stück, Auflagen auf der Platte ohne Überlappung ` + JSON.stringify(r));
  }
  const n = await p.evaluate(async () => { await _wsiCreate(); return objects.length; });
  ok(n === 3, 'Erstellen: Grund, Weiß, Nasen');
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
