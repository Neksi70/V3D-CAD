// Headless-Smoke-Test für VolmeCut (Playwright gegen 127.0.0.1:8774)
import { chromium } from 'playwright';

const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">
  <rect x="5" y="5" width="40" height="30"/>
  <circle cx="70" cy="20" r="12"/>
  <!-- Donut: Pfad mit 2 Unterpfaden (Loch) — testet den Subpfad-Splitter -->
  <path d="M 30 50 a 8 8 0 1 0 0.001 0 z M 30 46 a 4 4 0 1 1 -0.001 0 z"/>
  <g transform="translate(60,40) scale(0.5)">
    <polygon points="0,0 20,0 10,15"/>
  </g>
</svg>`;

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:8774/', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._vcImportSvgText === 'function');

const result = await page.evaluate((svgText) => {
  localStorage.clear();
  window._vcState.objects.length = 0;
  const n = window._vcImportSvgText(svgText, 'test');
  const objs = window._vcState.objects.map(o => ({
    name: o.name, polys: o.polys.length,
    w: +o.baseW.toFixed(1), h: +o.baseH.toFixed(1),
    pts: o.polys.reduce((a, p) => a + p.pts.length, 0),
  }));
  const ds = window._vcBuildDesignSpaceSvg();
  const gpgl = window._vcBuildGpgl();
  return { n, objs, dsLen: ds.length, dsHead: ds.slice(0, 400),
           dsHasMatrix: ds.includes('matrix('), gpglLen: gpgl.length,
           gpglHead: JSON.stringify(gpgl.slice(0, 80)) };
}, TEST_SVG);

console.log(JSON.stringify(result, null, 2));

// Erwartungen
const fail = (msg) => { console.error('FAIL: ' + msg); process.exitCode = 1; };
if (result.n !== 4) fail('4 Objekte erwartet, ' + result.n + ' bekommen');
const donut = result.objs.find(o => o.polys === 2);
if (!donut) fail('Donut sollte 2 Unterpfade haben (Splitter defekt?)');
const rect = result.objs[0];
if (Math.abs(rect.w - 40) > 0.5 || Math.abs(rect.h - 30) > 0.5)
  fail('Rechteck sollte 40×30 mm sein, ist ' + rect.w + '×' + rect.h);
const tri = result.objs[3];
if (Math.abs(tri.w - 10) > 0.5) fail('Dreieck (0.5-skaliert) sollte 10 mm breit sein, ist ' + tri.w);
if (!result.dsHasMatrix) fail('Design-Space-Export ohne matrix()-Transform');
if (result.gpglLen < 100) fail('GPGL verdächtig kurz');
if (errors.length) fail('JS-Fehler: ' + errors.join(' | '));

// Maßstab-Check im DS-Export: Matte 305mm → 864.57px (72dpi)
if (!result.dsHead.includes('864.567')) fail('DS-Export: 72dpi-Mattenbreite fehlt (305mm → 864.567px)');

console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK');
await browser.close();
