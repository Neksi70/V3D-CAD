// Headless-Check „Adaptive Schichthöhe automatisch": Standard aktiv, Panel mit
// Diagramm, 3MF-Export mit Schichtprofil, Slice nutzt das Profil (Kanten exakt).
// Aufruf: node test/adaptive-ui-test.mjs [--no-slice] [--local]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const OUT = process.env.OUT_DIR || '/tmp';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const LOCAL = process.argv.includes('--local');   // Browser-Kern (WASM) statt Server-Slice
await page.addInitScript((local) => { try {
  localStorage.removeItem('vs-adapt-mode'); localStorage.removeItem('vs-adapt-q');
  if (local) localStorage.setItem('vs-srv-slice', '0');
} catch {} }, LOCAL);
await page.goto((process.env.APP_URL || 'http://127.0.0.1:8778/app/'), { waitUntil: 'load' });
await page.setInputFiles('#file', new URL('./adaptive-relief.stl', import.meta.url).pathname);
await page.waitForFunction(() => !document.getElementById('tbAdapt').disabled, null, { timeout: 120000 });
await page.waitForFunction(() => typeof window._adaptDebug === 'function' && window._adaptDebug().cfgKeys > 0
  && window._adaptDebug().plans.some(Boolean), null, { timeout: 60000 });

const dbg = await page.evaluate(() => window._adaptDebug());
console.log('Debug:', JSON.stringify(dbg));
ok(dbg.mode === 'auto', 'Standardmodus = automatisch');
ok(dbg.opts.hMin > 0 && dbg.opts.hMax > dbg.opts.hMin && dbg.opts.hBase > 0, `Profilwerte übernommen (${JSON.stringify(dbg.opts)})`);
const pl = dbg.plans.find(Boolean);
ok(pl && pl.snaps.includes(3) && pl.snaps.includes(3.6), 'Kanten 3,0 und 3,6 mm erkannt');
ok(pl && pl.reasons['Relief/Schrift'] > 0 && pl.reasons['Schräge'] > 0, 'Relief + Schräge als Gründe');
ok(await page.evaluate(() => document.getElementById('tbAdapt').classList.contains('adaptOn')), 'Werkzeug-Knopf markiert aktiv');

await page.click('#tbAdapt');
await page.waitForSelector('#adPlot');
await page.waitForTimeout(200);
await page.locator('#toolPanel').screenshot({ path: `${OUT}/adaptive-panel.png` });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#toolPanel [data-tp="a3mf"]')]);
const file = `${OUT}/adaptive-relief_adaptiv.3mf`;
await dl.saveAs(file);
console.log('3MF:', file);

if (!process.argv.includes('--no-slice')) {
  await page.waitForFunction(() => !document.getElementById('btnSlice').disabled, null, { timeout: 60000 });
  const srv = await page.evaluate(() => !document.getElementById('srvSliceRow').hidden && document.getElementById('srvSlice').checked);
  await page.click('#btnSlice');
  await page.waitForSelector('#done', { timeout: 300000 });
  const g = await page.evaluate(() => window._lastGcode);
  writeFileSync(`${OUT}/adaptive-relief.gcode`, g);
  const zs = [...g.matchAll(/^; Z_HEIGHT: ([\d.]+)/gm)].map(m => +m[1]);
  const zs2 = zs.length ? zs : [...g.matchAll(/^;Z:([\d.]+)/gm)].map(m => +m[1]);
  const hs = [...g.matchAll(/^; LAYER_HEIGHT: ([\d.]+)/gm)].map(m => +m[1]);
  console.log(`Slice (${srv ? 'Server' : 'Browser'}): ${zs2.length} Schichten, Höhen ${[...new Set(hs.map(h => h.toFixed(3)))].slice(0, 12).join(' ')}`);
  ok(zs2.length === pl.nLayers, `G-Code-Schichtzahl = Plan (${zs2.length} / ${pl.nLayers})`);
  ok(zs2.some(z => Math.abs(z - 3) < 1e-3) && zs2.some(z => Math.abs(z - 3.6) < 1e-3), 'G-Code hat Schichtgrenzen exakt bei 3,0 und 3,6');
}
console.log('Fehler:', errors.length ? errors : 'keine');
await browser.close();
if (errors.length) fails++;
console.log(fails ? `ADAPTIVE-UI-TEST FEHLGESCHLAGEN ❌ (${fails})` : 'ADAPTIVE-UI-TEST OK ✅');
process.exit(fails ? 1 : 0);
