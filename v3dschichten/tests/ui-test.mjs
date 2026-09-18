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

// Erwartete Schichtzahl direkt aus dem Rechenkern (Bambu 0,4, Qualität 0,5) statt fester Zahl
const { computeLayerPlan: _plan } = await import('/home/v3da/orca-wasm/web/adaptive-layers.js');
const EXP = (() => { const b = readFileSync(T + 'adaptive-relief.stl'), n = b.readUInt32LE(80), p = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) p[t * 9 + k] = b.readFloatLE(84 + t * 50 + 12 + k * 4);
  return _plan(p, null, { hBase: 0.2, hFirst: 0.2, hMin: 0.08, hMax: 0.28, nozzle: 0.4, quality: 0.5 }).nLayers; })();
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
ok(pl && pl.nLayers === EXP && pl.snaps.includes(3) && pl.snaps.includes(3.6), `Plan wie im Rechenkern (${EXP} Schichten, Kanten 3/3,6) → ${pl && pl.nLayers}`);
await page.waitForFunction(() => !window._schDebug().previewPending && window._schDebug().preview.length === 1, null, { timeout: 30000 });
const pv1 = await page.evaluate(() => window._schDebug());
ok(pv1.view === 'print' && pv1.preview[0] > 1000, `Druckvorschau steht (${pv1.preview[0]} Punkte, ${Math.round(pv1.previewMs)} ms)`);
await page.evaluate(() => { const q = document.getElementById('quality'); q.value = 1; q.dispatchEvent(new Event('input')); });
await page.waitForFunction((n) => { const d = window._schDebug(); return !d.previewPending && d.preview[0] !== n; }, pv1.preview[0], { timeout: 30000 }).catch(() => {});
const pv2 = await page.evaluate(() => window._schDebug());
ok(pv2.preview[0] > pv1.preview[0] * 1.1, `Regler „feiner" → mehr Stufen in der Vorschau (${pv1.preview[0]} → ${pv2.preview[0]})`);
await page.evaluate(() => { const q = document.getElementById('quality'); q.value = 0.5; q.dispatchEvent(new Event('input')); });
await page.waitForFunction((n) => { const d = window._schDebug(); return !d.previewPending && d.preview[0] === n; }, pv1.preview[0], { timeout: 30000 }).catch(() => {});
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
  ok(zs.length === EXP && [3, 3.6].every(k => zs.some(z => Math.abs(z - k) < 1e-6)), `Orca slict den Export mit dem Profil (${zs.length} Schichten)`);
} else ok(false, 'Orca-Slice des Exports: ' + JSON.stringify(done));

// 2) Rundreise: eigener Export wieder laden
r = await load(page, f3);
ok(r.dbg.objects[0] && r.dbg.objects[0].nLayers === EXP, 'eigenes 3MF wieder geladen → gleicher Plan');
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
ok(r.dbg.objects[0] && r.dbg.objects[0].nLayers === EXP, 'file:// (offline) rechnet genauso');
ok(await s2.page.evaluate(() => document.getElementById('offline').hidden), 'Offline-Link im Offline-Modus ausgeblendet');
ok(!s2.errors.length, 'offline keine JS-Fehler ' + (s2.errors.length ? JSON.stringify(s2.errors) : ''));

// 6) STEP online (Server → OCCT-Backend) über den Funnel-Pfad OHNE Schrägstrich
const STEP = '/home/v3da/projekte/cad/step_export/zylinder_fillet.step';
let stepOnline = null;
if (existsSync(STEP)) {
  const s3 = await session(URL_.replace(/\/$/, '') + '/schichten');
  r = await load(s3.page, STEP);
  stepOnline = r.dbg.objects[0];
  console.log('STEP online:', r.file, '|', r.status, '|', JSON.stringify(stepOnline));
  ok(stepOnline && stepOnline.height > 1 && stepOnline.nLayers > 5, 'STEP online gelesen und geplant');
  ok(!s3.errors.length, 'STEP online ohne JS-Fehler ' + (s3.errors.length ? JSON.stringify(s3.errors) : ''));
  // 7) STEP offline (occt-import-js eingebettet, file://)
  const s4 = await session('file:///home/v3da/v3dschichten/offline.html');
  r = await load(s4.page, STEP);
  const so = r.dbg.objects[0];
  console.log('STEP offline:', r.file, '|', r.status, '|', JSON.stringify(so));
  ok(so && Math.abs(so.height - stepOnline.height) < 0.01 && Math.abs(so.nLayers - stepOnline.nLayers) <= 3,
     `STEP offline ≈ online (${so && so.nLayers} / ${stepOnline.nLayers} Schichten)`);
  ok(!s4.errors.length, 'STEP offline ohne JS-Fehler ' + (s4.errors.length ? JSON.stringify(s4.errors) : ''));
  // 8) Online-Datei per file:// → verständliche Meldung statt Absturz
  r = await load(s2.page, STEP);
  ok(/Online-Seite/.test(r.status), 'index.html offline: STEP-Hinweis statt Fehler');
}

// 9) ✨ Magic: auf dem Kopf liegender Körper → umdrehen, Qualität hoch, Rückgängig
{
  const { rotateToBed, matMul, ROT_X90 } = await import('/home/v3da/orca-wasm/web/adaptive-layers.js');
  const stl = readFileSync(T + 'adaptive-relief.stl'), nt = stl.readUInt32LE(80);
  const p = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 9; k++) p[t * 9 + k] = stl.readFloatLE(84 + t * 50 + 12 + k * 4);
  const q = rotateToBed(p, matMul(ROT_X90, ROT_X90));
  const out = Buffer.alloc(84 + nt * 50);
  for (let t = 0; t < nt; t++) { out.writeFloatLE(-1, 84 + t * 50 + 8); for (let k = 0; k < 9; k++) out.writeFloatLE(q[t * 9 + k], 84 + t * 50 + 12 + k * 4); }
  out.writeUInt32LE(nt, 80);
  const flipped = `${OUT}/relief-kopfueber.stl`;
  writeFileSync(flipped, out);
  const s5 = await session(URL_);
  r = await load(s5.page, flipped);
  const before = r.dbg.objects[0];
  // 🧭 Ausrichtung wird OHNE Knopfdruck vorgeschlagen
  await s5.page.waitForFunction(() => window._schDebug().banner, null, { timeout: 30000 });
  let d = await s5.page.evaluate(() => window._schDebug());
  const list = await s5.page.locator('#orientList').innerText();
  console.log('Ausrichtung:', JSON.stringify(d.orient[0]), '|', (await s5.page.locator('#orientBanner').innerText()).replace(/\n/g, ' '));
  ok(d.orient[0][0].top && d.orient[0][0].over === 0 && /Empfohlen/.test(list) && /aktuell/.test(list), 'Lage-Vorschläge direkt nach dem Laden, Empfehlung ohne Stützen');
  await s5.page.screenshot({ path: `${OUT}/schichten-orient.png` });
  // ✨ Magic ändert die Lage nicht
  await s5.page.click('#magic');
  await s5.page.waitForFunction(() => window._schDebug().magic, null, { timeout: 60000 });
  let after = await s5.page.evaluate(() => window._schDebug());
  const card = await s5.page.locator('#magicCard').innerText();
  ok(/Optimale Schichthöhe/.test(card) && after.quality >= 0.8, `Magic stellt hohe Qualitätsstufe ein (${after.quality})`);
  ok(JSON.stringify(after.objects[0].snaps) === JSON.stringify(before.snaps) && after.banner, 'Magic lässt die Lage in Ruhe, Hinweis bleibt');
  await s5.page.locator('#magicCard').screenshot({ path: `${OUT}/schichten-magic.png` });
  await s5.page.click('#magicCard [data-v="fast"]');
  const fast = await s5.page.evaluate(() => window._schDebug());
  ok(fast.quality < after.quality && fast.objects[0].nLayers < after.objects[0].nLayers, `Variante „Schnell" (${fast.quality}, ${fast.objects[0].nLayers} Schichten)`);
  await s5.page.click('#magicUndo');
  const undone = await s5.page.evaluate(() => window._schDebug());
  ok(!undone.magic && undone.quality === r.dbg.quality, 'Rückgängig stellt die Qualität wieder her');
  // Hinweis „Übernehmen" → Platte unten, Hinweis weg, Liste markiert Empfehlung als aktuell
  await s5.page.click('#orientAdopt');
  await s5.page.waitForFunction(() => window._schDebug().objects[0].snaps.includes(3.6), null, { timeout: 30000 });
  d = await s5.page.evaluate(() => window._schDebug());
  const cur = await s5.page.locator('#orientList button.cur').innerText();
  ok(d.objects[0].snaps.includes(3) && !d.banner && /Empfohlen/.test(cur), 'Empfehlung übernommen → Platte unten, Hinweis weg');
  await s5.page.screenshot({ path: `${OUT}/schichten-magic-voll.png` });
  ok(!s5.errors.length, 'Magic ohne JS-Fehler ' + (s5.errors.length ? JSON.stringify(s5.errors) : ''));
}

await browser.close();
console.log(fails ? `SCHICHTEN-UI-TEST FEHLGESCHLAGEN ❌ (${fails})` : 'SCHICHTEN-UI-TEST OK ✅');
process.exit(fails ? 1 : 0);
