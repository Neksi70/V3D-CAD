// Headless-Test V3D Schichthöhe: STL/3MF laden, Profil prüfen, 3MF exportieren,
// Export mit dem echten Orca-Kern (orca_native) slicen → Schichten = Plan.
// Offline-Check: dieselbe index.html per file:// öffnen.
// Aufruf (cwd unter ~ wegen node_modules): node v3dschichten/tests/ui-test.mjs [url]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const URL_ = process.argv[2] || 'http://127.0.0.1:8798/';
const OUT = process.env.OUT_DIR || '/tmp';
const T = '/home/v3da/orca-wasm/test/';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const browser = await chromium.launch();
async function session(url) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors };
}
async function load(page, file) {
  await page.setInputFiles('#file', file);
  await page.waitForFunction(() => /✅|Fehler/.test(document.getElementById('fileName').textContent + document.getElementById('status').textContent), null, { timeout: 60000 });
  return page.evaluate(() => ({ dbg: window._schDebug(), status: document.getElementById('status').textContent, file: document.getElementById('fileName').textContent }));
}

// 1) STL + Export
const { page, errors } = await session(URL_);
let r = await load(page, T + 'adaptive-relief.stl');
console.log('STL:', r.file, '|', r.status);
const pl = r.dbg.objects[0];
ok(pl && pl.nLayers === 60 && pl.snaps.includes(3) && pl.snaps.includes(3.6), `Plan wie im Slicer (60 Schichten, Kanten 3/3,6) → ${pl && pl.nLayers}`);
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/schichten-app.png` });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
const f3 = `${OUT}/${dl.suggestedFilename()}`;
await dl.saveAs(f3);
ok(dl.suggestedFilename() === 'adaptive-relief_adaptiv.3mf', 'Dateiname ' + dl.suggestedFilename());

// Export mit orca_native slicen (Bambu-0,4-Werte wie in der App)
const BIN = '/home/v3da/orca-wasm/OrcaSlicer/build-native/src/wasm/orca_native';
const job = { id: 1, model: f3, filename: 'x.3mf', profiles: [], transforms: null, filament_chains: [], paints: null, cuts: [], adaptive: null,
  overrides: 'layer_height = 0.2\ninitial_layer_print_height = 0.2\nmin_layer_height = 0.08\nmax_layer_height = 0.28\nnozzle_diameter = 0.4\nprintable_area = 0x0,256x0,256x256,0x256\nprintable_height = 250\nenable_support = 0\nuse_relative_e_distances = 1\nlayer_change_gcode = G92 E0' };
const proc = spawn(BIN, [], { env: { ...process.env, SLIC3R_RESOURCES: '/home/v3da/orca-wasm/OrcaSlicer/resources' } });
let so = ''; proc.stdout.on('data', d => so += d); proc.stderr.on('data', () => {});
proc.stdin.write(JSON.stringify(job) + '\n'); proc.stdin.end();
await new Promise(res => proc.on('exit', res));
const done = so.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(l => l && (l.done || l.error));
if (done && done.gcode && existsSync(done.gcode)) {
  const zs = [...readFileSync(done.gcode, 'utf8').matchAll(/^;Z:([\d.]+)/gm)].map(m => +m[1]);
  ok(zs.length === 60 && [3, 3.6].every(k => zs.some(z => Math.abs(z - k) < 1e-6)), `Orca slict den Export mit dem Profil (${zs.length} Schichten)`);
} else ok(false, 'Orca-Slice des Exports: ' + JSON.stringify(done));

// 2) Rundreise: eigener Export wieder laden
r = await load(page, f3);
ok(r.dbg.objects[0] && r.dbg.objects[0].nLayers === 60, 'eigenes 3MF wieder geladen → gleicher Plan');
// 3) fremde 3MF (Slicer-Testdateien)
for (const f of ['cube20.3mf', 'double.3mf']) {
  if (!existsSync(T + f)) continue;
  r = await load(page, T + f);
  console.log(`${f}: ${r.file} | ${JSON.stringify(r.dbg.objects.map(o => o && [o.height, o.nLayers]))}`);
  ok(r.dbg.objects.length >= 1 && r.dbg.objects.every(o => o && o.height > 1), `${f} geladen`);
}
// 4) Drehen ändert die Höhe
r = await load(page, T + 'adaptive-relief.stl');
await page.click('#rotX'); await page.waitForTimeout(300);
const h2 = await page.evaluate(() => window._schDebug().objects[0].height);
ok(Math.abs(h2 - 40) < 0.01, `nach X-Drehung Höhe 40 mm (${h2})`);
ok(await page.evaluate(() => !document.getElementById('offline').hidden), 'Offline-Link sichtbar (Server-Modus)');
ok(!errors.length, 'keine JS-Fehler ' + (errors.length ? JSON.stringify(errors) : ''));

// 5) Offline per file://
const s2 = await session('file:///home/v3da/v3dschichten/index.html');
r = await load(s2.page, T + 'adaptive-relief.stl');
ok(r.dbg.objects[0] && r.dbg.objects[0].nLayers === 60, 'file:// (offline) rechnet genauso');
ok(await s2.page.evaluate(() => document.getElementById('offline').hidden), 'Offline-Link im Offline-Modus ausgeblendet');
ok(!s2.errors.length, 'offline keine JS-Fehler ' + (s2.errors.length ? JSON.stringify(s2.errors) : ''));

await browser.close();
console.log(fails ? `SCHICHTEN-UI-TEST FEHLGESCHLAGEN ❌ (${fails})` : 'SCHICHTEN-UI-TEST OK ✅');
process.exit(fails ? 1 : 0);
