// Funktionstest „↝ Entlang Pfad" mit Anstieg/Wendel (1.18.226)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8876;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => typeof _swpPath3 === 'function' && window.v3dApi, null, { timeout: 30000 });
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
  const sq = [{ outer: [{s:-0.5,h:0},{s:0.5,h:0},{s:0.5,h:1},{s:-0.5,h:1}], holes: [] }];
  const circ = [{ outer: Array.from({length:48}, (_, i) => ({ s: 0.5*Math.cos(i/48*2*Math.PI), h: 0.5 + 0.5*Math.sin(i/48*2*Math.PI) })), holes: [] }];
  const G = (prof, path, cl, opt) => { try { return stats(_swpGeo(prof, path, cl, opt)); } catch (e) { return 'ERR ' + e.message; } };
  // 1) gerade Rampe 45°: V = A · 3D-Länge
  out.ramp = { ...G(sq, [{u:0,v:0},{u:10,v:0}], false, { rise: 10 }), exp: +(10*Math.SQRT2).toFixed(4) };
  // 2) L-Pfad mit gleicher Steigung: V = A · 3D-Länge
  // Querschnitt mittig auf dem Pfad (Schwerpunkt auf der Achse) → V = A · 3D-Länge, auch an der ansteigenden Ecke
  const sqM = [{ outer: [{s:-0.5,h:-0.5},{s:0.5,h:-0.5},{s:0.5,h:0.5},{s:-0.5,h:0.5}], holes: [] }];
  out.Lrise = { ...G(sqM, [{u:0,v:0},{u:10,v:0},{u:10,v:8}], false, { rise: 6 }), exp: +Math.hypot(18, 6).toFixed(4) };
  out.Zrise = { ...G(sqM, [{u:0,v:0},{u:6,v:0},{u:6,v:6},{u:12,v:6},{u:12,v:0}], false, { rise: 8 }), exp: +Math.hypot(24, 8).toFixed(4) };
  // 3) Wendel um Sechseck: 3 Windungen, 6 hoch
  const hex = []; for (let i = 0; i < 6; i++) hex.push({ u: 5*Math.cos(i*Math.PI/3), v: 5*Math.sin(i*Math.PI/3) });
  const polyA = 0.25*48/2*Math.sin(2*Math.PI/48)*4/4;   // Fläche des 48-Ecks mit r = 0,5
  out.helix = { ...G(circ, hex, true, { rise: 6, turns: 3 }), exp: +(polyA * Math.hypot(90, 6)).toFixed(4) };
  out.overlap = G(circ, hex, true, { rise: 2, turns: 3 });
  // 4) weich: Ende flach, Höhe stimmt
  out.ease = G(sq, [{u:0,v:0},{u:20,v:0}], false, { rise: 5, ease: true });
  out.steep = G(sq, [{u:0,v:0},{u:0.1,v:0}], false, { rise: 10 });
  // 5) Ablauf über das Fenster + Verlauf (Manifold-Neuberechnung)
  const L = (a, b, hl) => ({ type: 'line', a: { u: a[0], v: a[1] }, b: { u: b[0], v: b[1] }, ...(hl ? { hl: 1 } : {}) });
  const rect = (x0, y0, x1, y1) => [L([x0,y0],[x1,y0]), L([x1,y0],[x1,y1]), L([x1,y1],[x0,y1]), L([x0,y1],[x0,y0])];
  enterSketchMode(); _sk.ents = [...rect(-0.5, -4, 0.5, -3), L([0,0],[10,0],1), L([10,0],[10,8],1)]; _skRender();
  _swp.p = { op: 'auto', lage: 'auf', rise: 60, ease: false }; _skSweep(); out.panelTxt = document.getElementById('swp-panel').textContent.includes('↗ 60 mm');
  await _swpApply();
  const o = objects[objects.length - 1];
  out.made = { label: _featLabel(o.userData.feat.list[0], 0), f: (({ rise, turns, ease }) => ({ rise, turns, ease }))(o.userData.feat.list[0]), ...stats(o.geometry) };
  await _featApply(o, _featClone(o.userData.feat)); out.rebuilt = stats(o.geometry);
  _featEditSweep(o.userData.id, 0); _skSweep(); out.editRise = _swp.p.rise; _swpClose(true); exitSketchMode();
  // 6) MCP: Wendel
  const m = await v3dApi.execute('sketch.sweep', { path: [[50,0],[25,43.3],[-25,43.3],[-50,0],[-25,-43.3],[25,-43.3]], closed: true, rise: 60, turns: 3, section: { kind: 'circle', width: 10 } });
  out.mcp = m.ok ? { size: m.result.size, vol: m.result.volume_mm3 } : m;
  return out;
});
console.log(JSON.stringify(res, null, 1)); console.log('pageerrors:', errs);
await browser.close(); srv.kill();
