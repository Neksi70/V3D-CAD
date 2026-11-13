// Glücks-Aufladestation (✨ _gls*): Stern hohl (1 Stück), Gravur vorhanden, Füße passen in die Sockeltaschen ohne
// Überlappung, Teelicht passt in die Mulde, Lichtloch über dem Teelicht, Erstellen → 2 Teile auf der Platte
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process'; import fs from 'fs';
const PORT = 8899;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _glsOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Glücks-Aufladestation').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click(); await p.waitForSelector('#gls-modal.show');
  await p.waitForFunction(() => window._threeFont_greatvibes_local && window._threeFont_baloo_local, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  ok(await p.evaluate(() => !!(_gpv['gls'] && _gpv['gls'].group)), 'Vorschau steht');
  const r = await p.evaluate(async () => { const w = await _mfInit(), M = w.Manifold, t0 = performance.now(), r = _glsBuild(w, _glsP, _glsText, 'fein'), ms = performance.now() - t0;
    const voll = _glsBuild(w, { ..._glsP, text1: '', text2: '', punkte: 0, sternchen: 0 }, _glsText, 'fein');
    const sb = r.stern.boundingBox(), mitte = M.cube([4, 4, 4], true).translate([0, (sb.min[1] + sb.max[1]) / 2, 0]);
    const led = M.cylinder(16, _glsP.ledD / 2 - 0.5, _glsP.ledD / 2 - 0.5, 64).rotate([-90, 0, 0]).translate([0, _glsP.sockelH - 14 + 0.05, 0]);
    const bin = m => { const me = m.getMesh(), V = me.vertProperties, T = me.triVerts, np = me.numProp, a = []; for (let i = 0; i < T.length; i++) { const q = T[i] * np; a.push(V[q], -V[q + 2], V[q + 1]); } return a; };
    const o = { ms, s: r.stern.decompose().length, hohl: M.intersection(r.stern, mitte).volume(), gravur: voll.stern.volume() - r.stern.volume(), ov: M.intersection(r.stern, r.sockel).volume(),
      aufsitzen: M.intersection(r.stern.translate([0, -0.5, 0]), r.sockel).volume(), ledFrei: M.intersection(led, r.sockel).volume(), sockel: r.sockel.decompose().length, info: r.info, bin: [bin(r.stern), bin(r.sockel)] };
    return o; });
  fs.writeFileSync('/tmp/gls_s.bin', Buffer.from(new Float32Array(r.bin[0]).buffer)); fs.writeFileSync('/tmp/gls_k.bin', Buffer.from(new Float32Array(r.bin[1]).buffer)); delete r.bin;
  ok(r.s === 1 && r.hohl < 0.01 && r.gravur > 50, `Stern 1 Stück, hohl, Gravur ${Math.round(r.gravur)} mm³ (${(r.ms / 1000).toFixed(1)} s)`);
  ok(r.ov < 0.01 && r.aufsitzen > 1, `Füße stehen in den Taschen (kein Überlappen, 0,5 mm tiefer stößt an: ${r.aufsitzen.toFixed(1)} mm³)`);
  ok(r.ledFrei < 0.01 && r.info.ledPasst && r.sockel === 1, `LED-Teelicht passt in die Mulde, ${r.info.notchHoehe.toFixed(0)} mm Luft bis zum Stern`);
  const n = await p.evaluate(async () => { await _glsCreate(); return objects.map(o => { const bb = getMeshBox(o); return +(bb.min.y * 10).toFixed(2); }); });
  ok(n.length === 2 && n.every(y => Math.abs(y) < 0.05), 'Erstellen: Stern + Sockel auf der Platte');
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
