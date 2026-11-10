// Wort-Tanne: Menü (Weihnachten) → Namens-Anhänger (ein Teil, Öse) → Aufsteller mit Fuß (Zunge passt in den Schlitz, Gravur) → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8992, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _wtbOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Wort-Tanne').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#wtb-modal.show');
  await p.waitForFunction(() => window._threeFont_helvetiker_bold && window._threeFont_greatvibes_local, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.screenshot({ path: SHOTS + '/wtb-namen.png', clip: await p.locator('#wtb-modal .g3box').boundingBox() });
  const r1 = await p.evaluate(async () => { const w = await _mfInit(), r = _wtbBuild(w, _wtbP, _wtbText), res = { stuecke: r.stuecke, b: r.breite, h: r.hoehe, vol: r.modell.volume() }; r.modell.delete(); return res; });
  ok(r1.stuecke === 1 && r1.vol > 1000, `Namens-Anhänger: 1 Teil, ${Math.round(r1.b)} × ${Math.round(r1.h)} mm`);
  await p.evaluate(() => _wtbVorlage('werte')); await p.waitForTimeout(1500);
  await p.screenshot({ path: SHOTS + '/wtb-werte.png', clip: await p.locator('#wtb-modal .g3box').boundingBox() });
  const r2 = await p.evaluate(async () => { const w = await _mfInit(), M = w.Manifold, r = _wtbBuild(w, _wtbP, _wtbText);
    // Zunge (Modell aufgestellt: Front −Y, Dicke Y) in den Fuß: Modell um 90° um X drehen, Zunge unten bündig in den Schlitz
    const auf = r.modell.rotate([90, 0, 0]).translate([0, _wtbP.dickeAuf / 2, 0]), ab = auf.boundingBox();
    const ein = auf.translate([0, 0, _wtbP.fussH - _wtbP.fussSchlitz - ab.min[2] + 0.3]);
    const ov = M.intersection(ein, r.fuss).volume(), fb = r.fuss.boundingBox();
    const voll = M.cube([fb.max[0] - fb.min[0], fb.max[1] - fb.min[1], fb.max[2]]).translate([fb.min[0], fb.min[1], 0]);
    const leer = voll.volume() - r.fuss.volume();
    const res = { stuecke: r.stuecke, fuss: r.fuss.decompose().length, ov, leer }; [r.modell, r.fuss, auf, ein, voll].forEach(m => m.delete()); return res; });
  ok(r2.stuecke === 1 && r2.fuss === 1, `Wort-Tanne 1 Teil, Fuß 1 Teil (${r2.stuecke}/${r2.fuss})`);
  ok(r2.ov < 0.5, `Steckzunge passt in den Schlitz (Überschneidung ${r2.ov.toFixed(2)} mm³)`);
  ok(r2.leer > 1500, `Schlitz + Gravur im Fuß (${Math.round(r2.leer)} mm³ ausgespart)`);
  const r3 = await p.evaluate(async () => { await _wtbCreate(); return objects.map(o => ({ name: o.userData.name, minY: getMeshBox(o).min.y })); });
  ok(r3.length === 2 && r3.every(t => Math.abs(t.minY) < 1e-3), 'Erstellt: ' + r3.map(t => t.name).join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
