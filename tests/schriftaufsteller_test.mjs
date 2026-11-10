// Schrift-Aufsteller: Menü (Weihnachten) → 3 Vorlagen (Block 1 Teil, Schreibschrift 1 Teil, keine Überlappung) → Erstellen (Vorderseite unten) → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 9001, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _swaOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Schrift-Aufsteller').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#swa-modal.show');
  await p.waitForFunction(() => window._threeFont_helvetiker_bold && window._threeFont_pacifico_local, null, { timeout: 30000 }).catch(() => {});
  for (const v of ['weihnachten', 'fest', 'xmas']) {
    const r = await p.evaluate(async (v) => { _swaVorlage(v); await new Promise(res => setTimeout(res, 600)); const w = await _mfInit(), x = _swaBuild(w, _swaP, _swaText);
      const res = { b: x.stuecke, s: x.schriftTeile, ov: w.Manifold.intersection(x.block, x.schrift).volume(), br: x.breite, h: x.hoehe }; x.block.delete(); x.schrift.delete(); return res; }, v);
    ok(r.b === 1 && r.s === 1 && r.ov < 0.01, `${v}: Block ${r.b} Teil(e), Schreibschrift ${r.s} Teil(e), ${Math.round(r.br)} × ${Math.round(r.h)} mm, Überlappung ${r.ov.toFixed(3)}`);
    await p.waitForTimeout(500); await p.screenshot({ path: `${SHOTS}/swa-${v}.png`, clip: await p.locator('#swa-modal .g3box').boundingBox() });
  }
  const r2 = await p.evaluate(async () => { await _swaCreate(); return objects.map(o => ({ name: o.userData.name, minY: getMeshBox(o).min.y })); });
  ok(r2.length === 2 && r2.every(t => Math.abs(t.minY) < 1e-3), 'Erstellt, beide Teile auf der Platte: ' + r2.map(t => t.name).join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
