// Kardan: Stab → Glieder mit Kardangelenken (Gabel–Kreuz–Gabel), getrennt, in alle Richtungen beweglich,
// Vorschau nicken/seitlich/kreisen, übernehmen als ein Teil, Undo, zu dünn → gesperrt
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8979, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _kdgOpen === 'function' && typeof objects !== 'undefined');
  const stab = (lx, h, lz) => p.evaluate(([lx, h, lz]) => { try { hideStarter(); } catch (e) {}
    _newCreate(false); addShape('box'); const o = objects[0]; const s = getMeshBox(o).getSize(new THREE.Vector3());
    o.scale.multiply(new THREE.Vector3(lx / 10 / s.x, h / 10 / s.y, lz / 10 / s.z)); o.updateMatrixWorld(true);
    o.position.y -= getMeshBox(o).min.y; o.updateMatrixWorld(true); selectObjs([o]); _kdgOpen(); return document.getElementById('kdg-panel').innerText; }, [lx, h, lz]);
  const t0 = await stab(120, 14, 16);
  ok(/120 × 16 × 14 mm/.test(t0), 'Fenster zeigt Maße: ' + t0.split('\n').find(l => /mm/.test(l)));
  await p.evaluate(() => _kdgSet('n', 4));
  await p.click('#kdg-go');
  await p.waitForFunction(() => _kdg.teile && !_kdg.busy, null, { timeout: 60000 });
  const r1 = await p.evaluate(async () => {
    const w = await _mfInit(), M = w.Manifold;
    const mf = [..._kdg.teile, ..._kdg.kreuze].map(m => _mfUnionObjs(w, [m]));
    let ov = 0, minGap = 99;
    for (let i = 0; i < mf.length; i++) for (let j = i + 1; j < mf.length; j++) { ov += M.intersection(mf[i], mf[j]).volume(); minGap = Math.min(minGap, mf[i].minGap(mf[j], 2)); }
    return { n: _kdg.teile.length, k: _kdg.kreuze.length, ov, minGap, ganz: mf.every(x => x.decompose().length === 1), frei: _kdg.info.frei, hidden: !objects[0].visible };
  });
  ok(r1.n === 4 && r1.k === 3, '4 Glieder, 3 Kardankreuze');
  ok(r1.ov < 1e-3 && r1.minGap >= 0.15, `alle Teile getrennt: Überlappung ${r1.ov.toFixed(4)} mm³, kleinster Abstand ${r1.minGap.toFixed(2)} mm`);
  ok(r1.ganz, 'jedes Glied/Kreuz ist ein zusammenhängendes Stück');
  ok(r1.frei.nick >= 25 && r1.frei.seit >= 25, `frei hoch/runter ${r1.frei.nick}°, seitlich ${r1.frei.seit}°`);
  ok(r1.hidden, 'Original während der Vorschau ausgeblendet');
  const r2 = await p.evaluate(async () => {
    const box = () => { const bb = new THREE.Box3(), t = new THREE.Box3(); [..._kdg.teile, ..._kdg.kreuze].forEach(m => { m.updateMatrixWorld(true); t.setFromObject(m); bb.union(t); }); return bb; };
    const b0 = box();
    _kdg.nick = 25; _kdg.seit = 0; _kdgBiegen(); const bN = box();
    _kdg.nick = 0; _kdg.seit = 25; _kdgBiegen(); const bS = box();
    _kdg.nick = -25; _kdg.seit = 0; _kdgBiegen(); const bU = box();
    _kdg.nick = 0; _kdg.seit = 0; _kdgBiegen();
    const flach = [..._kdg.teile, ..._kdg.kreuze].every(m => m.matrix.equals(new THREE.Matrix4()));
    _kdgAnimToggle(); await new Promise(r => setTimeout(r, 500)); const a1 = [_kdg.nick, _kdg.seit]; await new Promise(r => setTimeout(r, 400)); const a2 = [_kdg.nick, _kdg.seit];
    const btn = document.getElementById('kdg-anim').textContent; _kdgAnimToggle(); const stop = !_kdg.anim;
    return { h0: b0.max.y - b0.min.y, hN: bN.max.y - bN.min.y, hU: bU.max.y - bU.min.y, z0: b0.max.z - b0.min.z, zS: bS.max.z - bS.min.z, minN: bN.min.y, minU: bU.min.y, flach, a1, a2, btn, stop };
  });
  ok(r2.hN > r2.h0 * 1.5 && r2.hU > r2.h0 * 1.5, `Hoch/Runter hebt die Enden (Höhe ${(r2.h0*10).toFixed(0)} → ${(r2.hN*10).toFixed(0)} / ${(r2.hU*10).toFixed(0)} mm)`);
  ok(r2.zS > r2.z0 * 1.5, `Seitlich schwenkt zur Seite (Tiefe ${(r2.z0*10).toFixed(0)} → ${(r2.zS*10).toFixed(0)} mm)`);
  ok(Math.abs(r2.minN) < 1e-3 && Math.abs(r2.minU) < 1e-3, 'gebogen bleibt der tiefste Punkt auf der Platte');
  ok(r2.flach, '0°/0° = wieder gerade');
  ok((r2.a1[0] !== r2.a2[0] || r2.a1[1] !== r2.a2[1]) && /Anhalten/.test(r2.btn) && r2.stop, `„Kreisen lassen“ läuft (${r2.a1.map(v => v.toFixed(0))} → ${r2.a2.map(v => v.toFixed(0))}) und hält an`);
  await p.evaluate(() => { _kdg.nick = 20; _kdg.seit = 18; _kdgBiegen(); fitToObjects(_kdg.teile); });
  await p.waitForTimeout(500); await p.screenshot({ path: SHOTS + '/kdg-vorschau.png' });
  await p.evaluate(() => { _kdg.nick = 0; _kdg.seit = 0; _kdgBiegen(); });
  const r3 = await p.evaluate(async () => {
    _kdgUebernehmen();
    const w = await _mfInit(), o = objects[0], mf = _mfUnionObjs(w, [o]);
    return { n: objects.length, name: o.userData.name, shells: mf.decompose().length, minY: getMeshBox(o).min.y, panel: !!document.getElementById('kdg-panel') };
  });
  ok(r3.n === 1 && r3.shells === 7 && /^Kardan/.test(r3.name), `übernommen als EIN Teil „${r3.name}" mit ${r3.shells} Schalen (4 Glieder + 3 Kreuze)`);
  ok(Math.abs(r3.minY) < 1e-3 && !r3.panel, 'liegt auf der Platte, Fenster zu');
  const r4 = await p.evaluate(async () => { undo(); await new Promise(r => setTimeout(r, 300)); return { n: objects.length, type: objects[0].userData.shapeType, vis: objects[0].visible }; });
  ok(r4.n === 1 && r4.type === 'box' && r4.vis, 'Rückgängig: Stab wieder da');
  const t5 = await stab(100, 6, 30);
  ok(/Zu schmal\/dünn/.test(t5) && await p.evaluate(() => document.getElementById('kdg-go').disabled), '6 mm dünne Platte: Hinweis, Bauen gesperrt');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
