// Skizzenmuster: linear/kreis, Kopien folgen der Vorlage, lösen, Verlauf (v1.18.196)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8868;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _skpOpen === 'function', { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} enterSketchMode(); });
  const scr = (u, v) => p.evaluate(([u, v]) => _skScreen(u, v), [u, v]);
  const click = async (u, v) => { const s = await scr(u, v); await p.mouse.move(s.x - 24, s.y + 24); await p.mouse.move(s.x, s.y, { steps: 8 }); await p.mouse.click(s.x, s.y); await p.waitForTimeout(80); };
  // Kreis r=0,3 bei (0,0) zeichnen, wählen, Muster linear 5× 10 mm
  await p.keyboard.press('c'); await click(0, 0); await click(0.3, 0);
  await p.keyboard.press('s'); await click(0.3, 0);
  await p.evaluate(() => { _skpOpen(); _skpSet('kind', 'lin'); _skpSet('n', '5'); _skpSet('d', '10'); _skpSet('ang', '0'); _skpApply(); });
  let r = await p.evaluate(() => ({ n: _sk.ents.length, us: _sk.ents.map(e => +(e.c.u * 10).toFixed(2)).join(',') }));
  ok(r.n === 5 && r.us === '0,10,20,30,40', `linear 5× 10 mm: ${r.us}`);
  // Vorlage bemaßen: ⌀ 6 → 10 → alle Kopien folgen
  await p.keyboard.press('m'); await click(0.3, 0);
  await p.fill('#sk-cdim-v', '10'); await p.press('#sk-cdim-v', 'Enter'); await p.waitForTimeout(150);
  r = await p.evaluate(() => _sk.ents.map(e => +(e.r * 20).toFixed(2)).join(','));
  ok(r === '10,10,10,10,10', `Vorlage ⌀10 → alle Kopien ⌀10 (${r})`);
  // Kopie anklicken → nicht greifbar
  await p.keyboard.press('Escape');
  await click(2.5, 0); 
  r = await p.evaluate(() => _sk.sel.length);
  ok(r === 0, 'Kopie ist nicht einzeln wählbar');
  // Muster ändern: Anzahl 3, Abstand 15
  await p.evaluate(() => { const c = _sk.cons.find(x => x.t === 'pat'); _skpOpen(c); _skpSet('n', '3'); _skpSet('d', '15'); _skpApply(); });
  r = await p.evaluate(() => _sk.ents.map(e => +(e.c.u * 10).toFixed(2)).join(','));
  ok(r === '0,15,30', `geändert auf 3× 15 mm: ${r}`);
  // Strg+Z → wieder 5×10
  await p.keyboard.press('Control+z'); await p.waitForTimeout(150);
  r = await p.evaluate(() => _sk.ents.map(e => +(e.c.u * 10).toFixed(2)).join(','));
  ok(r === '0,10,20,30,40', `Strg+Z: ${r}`);
  // Kreismuster: Linie von (1,0)-(2,0), 6× 360° um (0,0)
  r = await p.evaluate(() => { exitSketchMode(); enterSketchMode(); _sk.ents.push({ type: 'line', a: { u: 1, v: 0 }, b: { u: 2, v: 0 } }); _skcIds(); _skSetTool('sel');
    _sk.sel = [{ id: _sk.ents[0].id, p: null }]; _skpOpen(); _skpSet('kind', 'circ'); _skpSet('n', '6'); _skpSet('tot', '360'); _skpSet('cu', '0'); _skpSet('cv', '0'); _skpApply();
    return _sk.ents.map(e => Math.round(Math.atan2(e.a.v, e.a.u) * 180 / Math.PI)).join(','); });
  ok(r === '0,60,120,180,-120,-60', `Kreismuster 6× 60°: ${r}`);
  // lösen: Rechtsklick-Pfad = _skcRemove → Kopien wieder normal
  r = await p.evaluate(() => { _skcRemove(_sk.cons.find(c => c.t === 'pat')); return { pat: _sk.ents.filter(e => e.pat).length, n: _sk.ents.length }; });
  ok(r.pat === 0 && r.n === 6, `Muster gelöst: 6 eigenständige Linien (${JSON.stringify(r)})`);
  // Verlauf: Muster mit Rechteck-Platte + Lochreihe extrudieren, wieder öffnen, Anzahl ändern
  r = await p.evaluate(async () => { exitSketchMode(); _newCreate(false); enterSketchMode();
    const R = [[-1,-1,5,-1],[5,-1,5,1],[5,1,-1,1],[-1,1,-1,-1]]; R.forEach(([a,b,c,d]) => _sk.ents.push({ type: 'line', a: { u: a, v: b }, b: { u: c, v: d } }));
    _sk.ents.push({ type: 'circle', c: { u: 0, v: 0 }, r: 0.3 }); _skcIds(); _skSetTool('sel');
    _sk.sel = [{ id: _sk.ents[4].id, p: null }]; _skpOpen(); _skpSet('kind', 'lin'); _skpSet('n', '4'); _skpSet('d', '10'); _skpSet('ang', '0'); _skpApply();
    _skExtrude(); _skxSet('end', 'dist'); _skxSet('op', 'new'); _skxSet('d', '5'); await _skxApply(); await new Promise(r => setTimeout(r, 300));
    const o = objects[0], f = o.userData.feat.list[0];
    _featEditSketch(o.userData.id, 0);
    const c = _sk.cons.find(x => x.t === 'pat'); const hasPat = !!c;
    _skpOpen(c); _skpSet('n', '5'); _skpApply();
    const holes = _skBuildShapes()[0].holes.length;
    return { hasPat, holes, cons: f.cons.length }; });
  ok(r.hasPat && r.holes === 5, `Verlauf: Muster gespeichert, wieder geöffnet, 4→5 Löcher (${JSON.stringify(r)})`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
