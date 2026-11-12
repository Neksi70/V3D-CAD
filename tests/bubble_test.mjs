// Bubble-Buchstaben (🫧 _bub*): Menü → Vorschau → EMMA erstellen (4 Teile, Höhe/Dicke, Rückseite flach, je 1 Schale)
// → Kleinbuchstaben + Zahlen → Magnet-Taschen → Schlüsselloch → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8885, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _bubOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Bubble-Buchstaben').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click();
  await p.waitForSelector('#bub-modal.show');
  await p.waitForFunction(() => window._threeFont_baloo_local, null, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => _gpv['bub'] && _gpv['bub'].group, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => !!(_gpv['bub'] && _gpv['bub'].group)), 'Vorschau steht');
  await p.screenshot({ path: SHOTS + '/bub-dialog.png', clip: await p.locator('#bub-modal .g3box').boundingBox() });
  const bau = () => p.evaluate(async () => { const t0 = performance.now(); await _bubCreate(); const ms = performance.now() - t0, w = await _mfInit();
    return { ms, teile: objects.map(o => { const m = _mfUnionObjs(w, [o]), bb = m.boundingBox(), cs = m.slice(0.05), r = { name: o.userData.name, s: m.decompose().length, vol: m.volume(), h: bb.max[1] - bb.min[1], b: bb.max[0] - bb.min[0], d: bb.max[2] - bb.min[2], z0: bb.min[2], unten: cs.area(), mitte: 0 };
      const c2 = m.slice(0.6); r.mitte = c2.area(); c2.delete(); cs.delete(); m.delete(); return r; }) }; });
  const r1 = await bau();
  ok(r1.teile.length === 4 && r1.teile.every(t => t.s === 1), `EMMA: ${r1.teile.map(t => t.name.replace(/ #\d+/, '')).join(', ')} – je 1 Schale (${(r1.ms / 1000).toFixed(1)} s)`);
  const E = r1.teile[0];
  ok(Math.abs(E.h - 80) < 3 && E.d > 17 && E.d < 20.5 && Math.abs(E.z0) < 0.05, `„E“: ${E.b.toFixed(0)} × ${E.h.toFixed(1)} mm, ${E.d.toFixed(1)} mm dick, liegt auf der Platte`);
  ok(r1.teile.every(t => t.unten > t.mitte * 0.9), 'Rückseite flach (Querschnitt unten ≈ voll)');
  const xs = await p.evaluate(() => objects.map(o => { const bb = getMeshBox(o); return [bb.min.x * 10, bb.max.x * 10]; }));
  ok(xs.every((x, i) => i === 0 || x[0] > xs[i - 1][1] + 2), 'Buchstaben berühren sich nicht (Abstand bleibt)');
  await p.evaluate(() => { _newCreate(false); _bubOpen(); _bubStr('text', 'Hallo 2026'); });
  const r2 = await bau();
  ok(r2.teile.length === 9 && r2.teile.every(t => t.s === 1), `„Hallo 2026“: ${r2.teile.length} Teile (${r2.teile.map(t => t.name.replace(/Bubble | #\d+/g, '')).join('')})`);
  // B behält seine Innenlöcher (Mulden bis fast zur Rückseite) — beim Aufweiten dürfen die Löcher nicht zulaufen
  const bL = await p.evaluate(async () => { const w = await _mfInit(), r = _bubBuild(w, { ..._bubP, text: 'B' }, _bubText), m = r.teile[0].mf, bb = m.boundingBox();
    const cs = m.slice(bb.max[2] * 0.6), n = cs.toPolygons().length; cs.delete(); m.delete(); return n; });
  ok(bL >= 3, `„B“ behält seine zwei Löcher (${bL} Konturen auf 60 % Höhe)`);
  await p.evaluate(() => { _newCreate(false); _bubOpen(); _bubStr('text', 'MO'); _bubStr('halter', 'magnet'); });
  const r3 = await bau();
  await p.evaluate(() => { _newCreate(false); _bubOpen(); _bubStr('text', 'MO'); _bubStr('halter', 'flach'); });
  const r3f = await bau();
  ok(r3.teile.every((t, i) => t.vol < r3f.teile[i].vol - 200) && r3.teile[0].vol < r3f.teile[0].vol - 400, `Magnet-Taschen: M ${(r3f.teile[0].vol - r3.teile[0].vol).toFixed(0)} mm³ (zwei), O ${(r3f.teile[1].vol - r3.teile[1].vol).toFixed(0)} mm³ weniger`);
  await p.evaluate(() => { _newCreate(false); _bubOpen(); _bubStr('text', 'MO'); _bubStr('halter', 'loch'); });
  const r4 = await bau();
  ok(r4.teile.every((t, i) => t.vol < r3f.teile[i].vol - 150 && t.s === 1), `Schlüsselloch: ${r4.teile.map((t, i) => (r3f.teile[i].vol - t.vol).toFixed(0) + ' mm³').join(' / ')} weniger, je 1 Schale`);
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/bub-szene.png' });
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Buchstaben');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
