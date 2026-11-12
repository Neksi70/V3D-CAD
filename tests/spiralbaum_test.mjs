// Spiral-Baum (🌀 _spb*): Menü → Vorschau → Erstellen: Baum 1 Stück, Stern eigenes Teil ohne Überlappung, steht auf y = 0
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process'; import fs from 'fs';
const PORT = 8895;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _spbOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Spiral-Baum').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click(); await p.waitForSelector('#spb-modal.show');
  await p.waitForFunction(() => _gpv['spb'] && _gpv['spb'].group, null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!(_gpv['spb'] && _gpv['spb'].group)), 'Vorschau steht');
  const r = await p.evaluate(async () => { const t0 = performance.now(), w = await _mfInit(), r = _spbBuild(w, _spbP, 'fein'), ms = performance.now() - t0, bb = r.baum.boundingBox();
    const bin = m => { const me = m.getMesh(), V = me.vertProperties, T = me.triVerts, np = me.numProp, a = []; for (let i = 0; i < T.length; i++) { const q = T[i] * np; a.push(V[q], -V[q + 2], V[q + 1]); } return a; };
    const o = { ms, s: r.baum.decompose().length, st: r.stern.decompose().length, ov: w.Manifold.intersection(r.baum, r.stern).volume(), gap: r.stern.minGap(r.baum, 1), y0: bb.min[1], y1: bb.max[1], bin: [bin(r.baum), bin(r.stern)] };
    return o; });
  fs.writeFileSync('/tmp/spb_b.bin', Buffer.from(new Float32Array(r.bin[0]).buffer)); fs.writeFileSync('/tmp/spb_s.bin', Buffer.from(new Float32Array(r.bin[1]).buffer)); delete r.bin;
  ok(r.s === 1 && r.st === 1 && r.ov < 0.01 && r.gap < 0.01, `Baum 1 Stück, Stern 1 Stück, sitzt auf der Spitze ohne Überlappung (${(r.ms / 1000).toFixed(1)} s)`);
  ok(Math.abs(r.y0) < 0.3 && r.y1 > 130, `steht auf der Platte, Band bis ${r.y1.toFixed(0)} mm`);
  const n = await p.evaluate(async () => { await _spbCreate(); return objects.length; });
  ok(n === 2, 'Erstellen: Baum + Stern');
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
