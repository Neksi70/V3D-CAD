// Schneemann (⛄ _snm*): Menü (Weihnachten) → Vorschau → Erstellen: Teile je Farbe, ohne Überlappung,
// steht auf y = 0, Höhe ≈ Vorgabe, Teile je Farbe ohne Überlappung → ohne Bommel → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process'; import fs from 'fs';
const PORT = 8891, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _snmOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Schneemann').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click();
  await p.waitForSelector('#snm-modal.show');
  await p.waitForFunction(() => _gpv["snm"] && _gpv["snm"].group, null, { timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(1000);
  ok(await p.evaluate(() => !!(_gpv["snm"] && _gpv["snm"].group)), 'Vorschau steht');
  await p.screenshot({ path: SHOTS + '/snm-dialog.png', clip: await p.locator('#snm-modal .g3box').boundingBox() });
  const r = await p.evaluate(async () => {
    const t0 = performance.now(); await _snmCreate(); const ms = performance.now() - t0, w = await _mfInit();
    const mf = objects.map(o => _mfUnionObjs(w, [o])), out = { ms, teile: [], ov: 0, y0: Infinity, y1: -Infinity };
    objects.forEach((o, i) => { const bb = mf[i].boundingBox(); out.teile.push({ n: o.userData.name.replace(/ #\d+/, ''), s: mf[i].decompose().length, vol: Math.round(mf[i].volume()) });
      out.y0 = Math.min(out.y0, bb.min[2]); out.y1 = Math.max(out.y1, bb.max[2]); });
    for (let i = 0; i < mf.length; i++) for (let j = i + 1; j < mf.length; j++) out.ov += w.Manifold.intersection(mf[i], mf[j]).volume();
    // gebaute Teile als Bild-Rohdaten
    out.bin = objects.map(o => { const g = o.geometry.attributes.position.array, a = []; for (let k = 0; k < g.length; k += 3) a.push(g[k] * 10, -g[k + 2] * 10, g[k + 1] * 10); return [o.userData.color, a]; });
    return out; });
  r.bin.forEach(([c, a], i) => fs.writeFileSync(`/tmp/snm${i}.bin`, Buffer.from(new Float32Array(a).buffer)));
  fs.writeFileSync('/tmp/snm_farben.txt', r.bin.map(([c], i) => `/tmp/snm${i}.bin:${c}`).join(' '));
  ok(r.teile.length === 4, 'Teile: ' + r.teile.map(t => `${t.n} (${t.vol} mm³)`).join(', ') + ` – ${(r.ms / 1000).toFixed(1)} s`);
  const st = await p.evaluate(async () => { const w = await _mfInit(), r = _snmBuild(w, _snmP, 'fein'), o = {};
    for (const k of ['koerper', 'muetze', 'nase', 'bommel']) { o[k] = r[k] ? r[k].decompose().length : 0; r[k] && r[k].delete(); } return o; });
  ok(Object.values(st).every(n => n === 1), 'Stücke im Kern je 1: ' + JSON.stringify(st));
  ok(r.ov < 1, `keine Überlappung zwischen den Teilen (${r.ov.toFixed(2)} mm³)`);
  ok(Math.abs(r.y0) < 0.05 && r.y1 > 105 && r.y1 < 125, `steht auf der Platte, ${r.y1.toFixed(0)} mm hoch (Vorgabe 120)`);
  await p.evaluate(() => { _newCreate(false); _snmOpen(); _snmSet('bommel', 0); });
  const n2 = await p.evaluate(async () => { await _snmCreate(); return objects.length; });
  ok(n2 === 3, 'ohne Bommel: 3 Teile');
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
