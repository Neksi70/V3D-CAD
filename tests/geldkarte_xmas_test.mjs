// Geldgeschenk-Platten: 7 Weihnachts-Vorlagen → Layout (Schnitt + Gravur), Schablonen-GELD hält Innenteile, SVG
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8994, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _ggpXmas === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} localStorage.removeItem('v3d_ggp'); _ggpReset(); _ggpOpen(); });
  await p.waitForFunction(() => window._threeFont_greatvibes_local && window._threeFont_helvetiker_bold && typeof _mfWasm !== 'undefined' && _mfWasm, null, { timeout: 40000 }).catch(() => {});
  ok(await p.evaluate(() => document.querySelectorAll('#ggp-xmas .vtb').length === 7), '7 Weihnachts-Vorlagen im Dialog');
  for (const v of ['kleinigkeit', 'rentier', 'stiefel', 'geld', 'geld2', 'tanne', 'tanne2']) {
    const r = await p.evaluate(async (v) => { _ggpXmas(v); await new Promise(res => setTimeout(res, 600)); const L = _ggpLayout(_ggpP);
      const svg = await _ggpBuildSVG(_ggpP, 'beide'); return { cut: L.front.cut.length, eng: L.front.eng.length, mb: L.info.motivBox, svg: svg.length, t2: _ggpP.text2 }; }, v);
    ok(r.cut >= 3 && r.eng >= 3 && r.mb && r.svg > 2000, `Vorlage ${v}: ${r.cut} Schnitte, ${r.eng} Gravurformen, Motiv ${r.mb ? Math.round(r.mb[2] - r.mb[0]) + '×' + Math.round(r.mb[3] - r.mb[1]) : '–'} mm`);
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${SHOTS}/ggp-${v}.png`, clip: await p.locator('#ggp-cvwrap').boundingBox() });
  }
  // Schablone: das D behält sein Innenteil (Stege) → mehr als 4 Fensterteile für GELD
  const n = await p.evaluate(() => { _ggpXmas('geld'); return _ggpSchablone(_ggpP).length; });
  ok(n > 4, `Schablonen-GELD: ${n} Fensterteile (Innenteil des D über Stege gehalten)`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
