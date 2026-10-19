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
  // G1/G2 (1.18.210)
  r = await p.evaluate(() => { if (_sk.active) exitSketchMode(); enterSketchMode();
    _sk.ents.push({ type: 'line', a: { u: 0, v: 0 }, b: { u: 2, v: 0 } }, { type: 'spline', pts: [{ u: 2, v: 0 }, { u: 3, v: 0.6 }, { u: 4, v: 1.6 }, { u: 5, v: 1.8 }] }); _skcIds();
    const [L, S] = _sk.ents; const before = _skcCurveEnd(S, 'k0');
    _skSetTool('sel'); _sk.sel = [{ id: S.id, p: null }, { id: L.id, p: null }]; _skcApply('g2');
    const [L2, S2] = _sk.ents, a = _skcCurveEnd(S2, 'k0'), b = _skcCurveEnd(L2, 'b');
    return { k0: before.k, cross: Math.abs(a.T.u * b.T.v - a.T.v * b.T.u), dot: a.T.u * b.T.u + a.T.v * b.T.v, k: a.k, cons: _sk.cons.map(c => c.t + (c.lvl || '')).join(',') }; });
  ok(r.cross < 1e-6 && r.dot < -0.99 && Math.abs(r.k) < 1e-3, `G2 Spline↔Linie: tangential (×${r.cross.toExponential(1)}), Krümmung am Übergang ${r.k.toExponential(1)} (vorher ${r.k0.toFixed(2)}) [${r.cons}]`);
  r = await p.evaluate(() => { exitSketchMode(); enterSketchMode();
    _sk.ents.push({ type: 'arc', c: { u: 0, v: 1 }, r: 1, a0: -Math.PI / 2, a1: 0 }, { type: 'spline', pts: [{ u: 1, v: 1 }, { u: 1.2, v: 2.2 }, { u: 2.5, v: 3 }, { u: 4, v: 3.1 }] }); _skcIds();
    const [A, S] = _sk.ents; _skSetTool('sel'); _sk.sel = [{ id: S.id, p: null }, { id: A.id, p: null }]; _skcApply('g2');
    const [A2, S2] = _sk.ents, a = _skcCurveEnd(S2, 'k0'), b = _skcCurveEnd(A2, 'e'); return { cross: Math.abs(a.T.u * b.T.v - a.T.v * b.T.u), sum: Math.abs(a.k + b.k), ka: a.k, kb: b.k, r: A2.r }; });
  ok(r.cross < 1e-6 && r.sum < 1e-3, `G2 Spline↔Bogen: Krümmung stetig (Spline ${r.ka.toFixed(3)}, Bogen ${(-r.kb).toFixed(3)} = 1/r ${(1 / r.r).toFixed(3)})`);
  r = await p.evaluate(() => { exitSketchMode(); enterSketchMode();
    _sk.ents.push({ type: 'line', a: { u: 0, v: 0 }, b: { u: 2, v: 0 } }, { type: 'spline', pts: [{ u: 2, v: 0 }, { u: 3, v: 0.8 }, { u: 4, v: 1.6 }] }); _skcIds();
    const [L, S] = _sk.ents; _skSetTool('sel'); _sk.sel = [{ id: S.id, p: null }, { id: L.id, p: null }]; _skcApply('tan');
    const [L2, S2] = _sk.ents, a = _skcCurveEnd(S2, 'k0'), b = _skcCurveEnd(L2, 'b'); return { cross: Math.abs(a.T.u * b.T.v - a.T.v * b.T.u), lab: _skcLabel(_sk.cons.find(c => c.t === 'g2')) }; });
  ok(r.cross < 1e-6 && r.lab === 'G1', `Tangential an Spline = G1 (${r.lab})`);
  // Ziehen eines Spline-Punkts hält G2
  const sp = await p.evaluate(() => { _sk.cons = []; _sk.ents = []; _sk.ents.push({ type: 'line', a: { u: 0, v: 0 }, b: { u: 2, v: 0 } }, { type: 'spline', pts: [{ u: 2, v: 0 }, { u: 3, v: 0.6 }, { u: 4, v: 1.6 }, { u: 5, v: 1.8 }] }); _skcIds();
    const [L, S] = _sk.ents; _sk.sel = [{ id: S.id, p: null }, { id: L.id, p: null }]; _skcApply('g2'); _skSetTool('sel'); _skRender(); return [S.pts[3].u, S.pts[3].v]; });
  const g0 = await p.evaluate(([u, v]) => _skScreen(u, v), sp), g1 = await p.evaluate(([u, v]) => _skScreen(u + 0.5, v + 0.8), sp);
  await p.mouse.move(g0.x - 20, g0.y + 20); await p.mouse.move(g0.x, g0.y, { steps: 6 }); await p.mouse.down();
  for (let i = 1; i <= 8; i++) { await p.mouse.move(g0.x + (g1.x - g0.x) * i / 8, g0.y + (g1.y - g0.y) * i / 8); await p.waitForTimeout(20); }
  await p.mouse.up(); await p.waitForTimeout(100);
  r = await p.evaluate(() => { const [L, S] = _sk.ents, a = _skcCurveEnd(S, 'k0'), b = _skcCurveEnd(L, 'b'); return { cross: Math.abs(a.T.u * b.T.v - a.T.v * b.T.u), k: Math.abs(a.k), end: S.pts[3] }; });
  ok(r.cross < 1e-5 && r.k < 1e-3 && Math.abs(r.end.u - sp[0] - 0.5) < 0.05, `Spline-Ende gezogen: Punkt folgt, G2 bleibt (×${r.cross.toExponential(1)}, k ${r.k.toExponential(1)})`);

  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
