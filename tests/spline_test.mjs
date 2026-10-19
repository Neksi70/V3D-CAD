// Spline: schließen per Startpunkt, Punkt ziehen/einfügen/löschen, Kamm, Extrudieren (v1.18.197)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8869;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _skCombToggle === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} enterSketchMode(); });
  const scr = (u, v) => p.evaluate(([u, v]) => _skScreen(u, v), [u, v]);
  const click = async (u, v, mod) => { const s = await scr(u, v); await p.mouse.move(s.x - 24, s.y + 24); await p.mouse.move(s.x, s.y, { steps: 8 });
    if (mod) await p.keyboard.down(mod); await p.mouse.click(s.x, s.y); if (mod) await p.keyboard.up(mod); await p.waitForTimeout(80); };
  await p.keyboard.press('i');
  for (const [u, v] of [[0, 0], [3, -1], [5, 1], [2, 3]]) await click(u, v);
  await click(0, 0);   // Startpunkt → geschlossen
  let r = await p.evaluate(() => ({ n: _sk.ents.length, closed: !!(_sk.ents[0] && _sk.ents[0].closed), pts: _sk.ents[0] && _sk.ents[0].pts.length, shapes: _skBuildShapes().length }));
  ok(r.n === 1 && r.closed && r.pts === 4 && r.shapes === 1, `Startpunkt angeklickt → geschlossener Spline, 1 Fläche (${JSON.stringify(r)})`);
  // Punkt ziehen (5,1) → (6,2)
  await p.keyboard.press('s');
  const s0 = await scr(5, 1), s1 = await scr(6, 2);
  await p.mouse.move(s0.x - 20, s0.y + 20); await p.mouse.move(s0.x, s0.y, { steps: 6 }); await p.mouse.down();
  for (let i = 1; i <= 8; i++) { await p.mouse.move(s0.x + (s1.x - s0.x) * i / 8, s0.y + (s1.y - s0.y) * i / 8); await p.waitForTimeout(20); }
  await p.mouse.up(); await p.waitForTimeout(100);
  r = await p.evaluate(() => _sk.ents[0].pts[2]);
  ok(Math.abs(r.u - 6) < 0.05 && Math.abs(r.v - 2) < 0.05, `Punkt gezogen auf (${r.u.toFixed(2)}, ${r.v.toFixed(2)})`);
  // Alt+Klick auf die Kurve → Punkt einfügen
  const mid = await p.evaluate(() => { const S = _skSampleSplineEn(_sk.ents[0]); return S[Math.floor(S.length * 0.1)]; });
  await click(mid.u, mid.v, 'Alt');
  r = await p.evaluate(() => ({ n: _sk.ents[0].pts.length, sel: _sk.sel[0] && _sk.sel[0].p }));
  ok(r.n === 5 && r.sel === 'k1', `Alt+Klick: Punkt eingefügt an Stelle 2 (${JSON.stringify(r)})`);
  await p.keyboard.press('Delete'); await p.waitForTimeout(100);
  r = await p.evaluate(() => _sk.ents[0].pts.length);
  ok(r === 4, 'Entf löscht den gewählten Punkt');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(100);
  r = await p.evaluate(() => _sk.ents[0].pts.length);
  ok(r === 5, 'Strg+Z holt ihn zurück');
  // Kamm
  r = await p.evaluate(() => { const n0 = _sk.group.children.length; _skCombToggle(); const n1 = _sk.group.children.length; _skCombToggle(); return n1 - n0; });
  ok(r >= 2, `Krümmungskamm zeichnet Stacheln + Hüllkurve (+${r} Objekte)`);
  // Öffnen/Schließen per Knopf
  r = await p.evaluate(() => { _sk.sel = [{ id: _sk.ents[0].id, p: null }]; _skSplineClose(); const o = !_sk.ents[0].closed; _sk.sel = [{ id: _sk.ents[0].id, p: null }]; _skSplineClose(); return [o, !!_sk.ents[0].closed]; });
  ok(r[0] && r[1], 'Knopf öffnet und schließt wieder');
  // Extrudieren
  r = await p.evaluate(async () => { _skExtrude(); _skxSet('end', 'dist'); _skxSet('op', 'new'); _skxSet('d', '4'); await _skxApply(); await new Promise(r => setTimeout(r, 300));
    const bb = getMeshBox(objects[0]); return { n: objects.length, h: +(bb.max.y * 10).toFixed(2) }; });
  ok(r.n === 1 && Math.abs(r.h - 4) < 0.05, `geschlossener Spline extrudiert, 4 mm (${JSON.stringify(r)})`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
