// Skizze: Ecke runden / Ecke fasen (layerling-Abgleich 14.10.2026)
// Start: node tests/skizze_ecken_test.mjs  (startet eigenen --dev-Server)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8943;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK  ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function', { timeout: 60000 });
  await pg.evaluate(() => hideStarter());
  await pg.mouse.click(700, 450);
  const run = (mode, mm, extra) => pg.evaluate(({ mode, mm, extra }) => {
    _newCreate(false);
    if (_sk.active) exitSketchMode();
    enterSketchMode();
    // Rechteck 20 × 10 mm aus vier Linien (wie das Rechteck-Werkzeug)
    const R = [{ u: 0, v: 0 }, { u: 2, v: 0 }, { u: 2, v: 1 }, { u: 0, v: 1 }];
    for (let i = 0; i < 4; i++) _sk.ents.push({ type: 'line', a: { ...R[i] }, b: { ...R[(i + 1) % 4] } });
    if (extra === 'poly') { _sk.ents = [{ type: 'poly', pts: R.map(p => ({ ...p })), closed: true }]; }
    _skSetTool(mode); _sk.cornerMM[mode] = mm;
    const okN = R.map(p => _skCornerApply({ u: p.u + 0.01, v: p.v - 0.01 })).filter(Boolean).length;
    const loops = _skBuildLoops();
    const area = L => { let s = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; s += p.u * q.v - q.u * p.v; } return Math.abs(s) / 2; };
    const res = { okN, nLoops: loops.length, area: loops.length ? area(loops[0]) : 0, nEnts: _sk.ents.length };
    // Rückgängig: viermal → wieder Rechteck
    for (let i = 0; i < 4; i++) _skUndo();
    res.undoArea = area(_skBuildLoops()[0] || []);
    res.undoEnts = _sk.ents.length;
    exitSketchMode();
    return res;
  }, { mode, mm, extra });

  console.log('\n=== Rundung R 2 mm an allen 4 Ecken ===');
  let r = await run('filletc', 2);
  const wantF = 2 - 4 * (1 - Math.PI / 4) * 0.04;
  ok('4 Ecken gerundet, 1 geschlossene Kontur', r.okN === 4 && r.nLoops === 1 && r.nEnts === 8, r);
  ok('Fläche = Rechteck − 4·(1−π/4)·r²', Math.abs(r.area - wantF) < 0.002, { area: r.area, wantF });
  ok('Strg+Z nimmt alle 4 zurück', Math.abs(r.undoArea - 2) < 1e-6 && r.undoEnts === 4, r);

  console.log('\n=== Fase 1 mm ===');
  r = await run('chamferc', 1);
  ok('Fase: Fläche = Rechteck − 4·½·d²', r.okN === 4 && r.nLoops === 1 && Math.abs(r.area - (2 - 4 * 0.5 * 0.01)) < 1e-4, r);

  console.log('\n=== kleine Fase 0,5 mm (Verbinde-Toleranz der Konturen) ===');
  r = await run('chamferc', 0.5);
  ok('Fase 0,5: eine Kontur, richtige Fläche', r.nLoops === 1 && Math.abs(r.area - (2 - 4 * 0.5 * 0.0025)) < 1e-4, r);

  console.log('\n=== zu groß ===');
  r = await run('filletc', 11);
  ok('R 11 an 10-mm-Seite abgelehnt, Skizze unverändert', r.okN === 0 && Math.abs(r.area - 2) < 1e-6, r);

  console.log('\n=== Polylinie (z. B. SVG-Import) ===');
  r = await run('filletc', 2, 'poly');
  ok('Polylinie: 4 Knicke gerundet', r.okN === 4 && Math.abs(r.area - wantF) < 0.003, r);

  ok('keine Seitenfehler', errs.length === 0, errs);
} catch (e) {
  console.log('ABBRUCH', e); fails++;
} finally {
  await b.close(); srv.kill();
}
console.log(fails ? `\n${fails} FEHLER` : '\nalles OK');
process.exit(fails ? 1 : 0);
