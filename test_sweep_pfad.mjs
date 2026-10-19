// Funktionstest „↝ Skizze entlang Pfad" (1.18.217): Hilfslinie = Pfad, hohl, Ring, Gehrung, Fehler, Verlauf, MCP
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8871;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => typeof _swpGeo === 'function' && typeof enterSketchMode === 'function', null, { timeout: 30000 });
await page.evaluate(() => { try { hideStarter(); } catch (e) {} });

const res = await page.evaluate(async () => {
  const out = {};
  function stats(geo){
    const pos = geo.attributes.position, n = geo.index ? geo.index.count : pos.count, ix = i => geo.index ? geo.index.getX(i) : i;
    const q = 1e-3, key = i => Math.round(pos.getX(i)/q)+','+Math.round(pos.getY(i)/q)+','+Math.round(pos.getZ(i)/q);
    const ec = new Map(); let vol = 0;
    for (let t = 0; t < n; t += 3){ const a = ix(t), b = ix(t+1), c = ix(t+2);
      for (const [i, j] of [[a,b],[b,c],[c,a]]){ const ki = key(i), kj = key(j), k = ki < kj ? ki+'|'+kj : kj+'|'+ki; ec.set(k, (ec.get(k)||0)+1); }
      vol += pos.getX(a)*(pos.getY(b)*pos.getZ(c)-pos.getZ(b)*pos.getY(c)) - pos.getY(a)*(pos.getX(b)*pos.getZ(c)-pos.getZ(b)*pos.getX(c)) + pos.getZ(a)*(pos.getX(b)*pos.getY(c)-pos.getY(b)*pos.getX(c)); }
    let open = 0, over = 0; for (const v of ec.values()){ if (v === 1) open++; else if (v > 2) over++; }
    geo.computeBoundingBox(); const bb = geo.boundingBox;
    return { open, over, vol: +(vol/6).toFixed(4), min: bb.min.toArray().map(x => +x.toFixed(3)), max: bb.max.toArray().map(x => +x.toFixed(3)) };
  }
  const L = (a, b, hl) => ({ type: 'line', a: { u: a[0], v: a[1] }, b: { u: b[0], v: b[1] }, ...(hl ? { hl: 1 } : {}) });
  const rect = (x0, y0, x1, y1) => [L([x0,y0],[x1,y0]), L([x1,y0],[x1,y1]), L([x1,y1],[x0,y1]), L([x0,y1],[x0,y0])];
  const run = (ents) => { enterSketchMode(); _sk.ents = ents; _skRender(); const pl = _swpPlanFromEnts(); let g = null, err = pl.err;
    if (!err) try { g = _swpGeo(pl.prof, pl.path, pl.closed); } catch (e) { err = e.message; } exitSketchMode(); return { pl, g, err }; };

  // 1) L-Pfad (Hilfslinien), hohler Rechteck-Querschnitt 2×1, Wand 0,2 → V = A·L
  let r = run([...rect(-1, -5, 1, -4), ...rect(-0.8, -4.8, 0.8, -4.2), L([0,0],[10,0],1), L([10,0],[10,8],1)]);
  out.L = { err: r.err, closed: r.pl.closed, hohl: r.pl.info && r.pl.info.hohl, ...(r.g ? stats(r.g) : {}), exp: +((2*1 - 1.6*0.6) * 18).toFixed(4) };
  // 2) geschlossenes Sechseck (Hilfslinien), Kreis Ø1 → V = π/4 · 30
  const hex = []; for (let i = 0; i < 6; i++){ const a = i*Math.PI/3, b = (i+1)*Math.PI/3; hex.push(L([5*Math.cos(a), 5*Math.sin(a)], [5*Math.cos(b), 5*Math.sin(b)], 1)); }
  r = run([{ type: 'circle', c: { u: 0, v: -9 }, r: 0.5 }, ...hex]);
  out.ring = { err: r.err, closed: r.pl.closed, ...(r.g ? stats(r.g) : {}), exp: +(Math.PI*0.25*30).toFixed(4) };
  // 3) Bogen als Pfad (Kreis Ø1 auf Bogen r=5, 90°) → glatt, V ≈ π/4 · 5π/2
  r = run([{ type: 'circle', c: { u: 5, v: 3 }, r: 0.5 }, { type: 'arc', c: { u: 0, v: 0 }, r: 5, a0: 0, a1: Math.PI/2, hl: 1 }]);
  out.arc = { err: r.err, ...(r.g ? stats(r.g) : {}), exp: +(Math.PI*0.25*5*Math.PI/2).toFixed(4) };
  // 4) zu breit für die Kurve
  r = run([...rect(-3, 3, 3, 4), { type: 'arc', c: { u: 0, v: 0 }, r: 1, a0: 0, a1: Math.PI, hl: 1 }]);
  out.tooWide = r.err;
  // 5) ohne Hilfslinie: alte Bedienung (offene Linie = Pfad)
  r = run([{ type: 'circle', c: { u: 0, v: 3 }, r: 0.5 }, L([0,0],[10,0])]);
  out.legacy = { err: r.err, legacy: r.pl.legacy, ...(r.g ? stats(r.g) : {}) };
  // 6) Fehler: kein Pfad / zwei Pfade
  out.noPath = run([...rect(0,0,1,1)]).err;
  out.twoPaths = run([...rect(0,0,1,1), L([3,0],[5,0],1), L([7,0],[9,0],1)]).err;
  // 7) Hilfslinien werden nie zum Körper (geschlossenes Sechseck allein = keine Fläche)
  enterSketchMode(); _sk.ents = hex.map(e => ({ ...e })); out.hlShapes = _skBuildShapes().length; exitSketchMode();
  // 8) asymmetrisches Profil: quer mittig, Unterkante 0
  r = run([...rect(2, -3, 4, -1), L([0,0],[10,0],1)]);
  out.asym = r.g ? stats(r.g) : r.err;
  // 9) Hilfslinien-Modus stempelt neue Elemente + Trim-Erbe
  enterSketchMode(); _skToggleHl(); _sk.ents.push(L([0,0],[5,0])); _skRender(); out.stamp = !!_sk.ents[0].hl; _skToggleHl(); _sk.ents.push(L([0,1],[5,1])); _skRender(); out.stamp2 = !_sk.ents[1].hl; exitSketchMode();
  // 10) Ganzer Ablauf: Panel + OK → Körper mit Verlauf; Neuberechnung via Manifold
  const n0 = objects.length;
  enterSketchMode(); _sk.ents = [...rect(-1, -5, 1, -4), L([0,0],[10,0],1), L([10,0],[10,8],1)]; _skRender();
  _skSweep(); out.panel = !!document.getElementById('swp-panel'); await _swpApply();
  const o = objects[objects.length - 1];
  out.made = { n: objects.length - n0, type: o.userData.type, feat: o.userData.feat && o.userData.feat.list[0].typ, label: _featLabel(o.userData.feat.list[0], 0), vol: stats(o.geometry).vol };
  const H = _featClone(o.userData.feat); H.list[0].ents.push(L([10,8],[14,8],1));   // Pfad verlängern
  await _featApply(o, H); out.rebuilt = stats(o.geometry);
  // Bearbeiten öffnet die Skizze mit Hilfslinien
  _featEditSweep(o.userData.id, 0); out.editOpen = _sk.active && !!_sk.editSwp && _sk.ents.filter(e => e.hl).length; exitSketchMode();
  // Speichern/Laden
  const d = objectToData(o); const b = buildObjectFromData(JSON.parse(JSON.stringify(d))); out.reload = { type: b.userData.type, feat: !!(b.userData.feat || d.feat) };
  // 11) MCP-Befehl
  const m = await window.v3dApi.execute('sketch.sweep', { path: [[0,0],[50,0],[50,40]], section: { kind: 'rect', width: 10, height: 6, wall: 1.5 } });
  out.mcp = m;
  const m2 = await window.v3dApi.execute('sketch.sweep', { path: [[0,0],[5,0]], closed: true, section: { kind: 'circle', width: 30 } }).catch(e => 'ERR ' + e.message);
  out.mcpErr = m2;
  return out;
});
console.log(JSON.stringify(res, null, 1));
console.log('pageerrors:', errs);
await browser.close(); srv.kill();
