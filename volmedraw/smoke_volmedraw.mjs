// Smoke-Test Volme Draw (Paint.NET-Oberflaeche, Vektor-Kern).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8798;
const srv = spawn('python3', ['volme3d_server.py', String(PORT)], { cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 900));

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

let served = '?';
try {
  const resp = await page.goto(`http://localhost:${PORT}/volmedraw/volmedraw.html`, { waitUntil: 'load', timeout: 20000 });
  served = resp.status();
  await page.waitForTimeout(1500);
} catch (e) { errors.push('GOTO: ' + e.message); }

const globals = await page.evaluate(() => {
  const names = ['setTool', 'zoomFit', 'align', 'distribute', 'groupSel', 'ungroupSel',
    'doDuplicate', 'doPaste', 'makeMask', 'unmask', 'buildGenerated', 'refreshLayers',
    'refreshMeasures', 'buildMenus', 'buildPalette', 'exportSVG', 'restoreIndex', 'clearSelection'];
  const out = {}; for (const n of names) out[n] = typeof window[n]; return out;
});
const fabricLoaded = await page.evaluate(() => typeof window.fabric);
const menuCount = await page.evaluate(() => document.querySelectorAll('#menus .menu-title').length);
const paletteCount = await page.evaluate(() => document.querySelectorAll('#palette .pc').length);

const box = await page.locator('canvas.upper-canvas').boundingBox();
async function tool(t) { await page.evaluate(n => setTool(n), t); }
async function drag(x0, y0, x1, y1) {
  await page.mouse.move(box.x + x0, box.y + y0); await page.mouse.down();
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(120);
}

// Rechteck + Polygon zeichnen
await tool('rect'); await drag(120, 100, 300, 240);
await tool('polygon'); await drag(360, 120, 500, 260);

// Auswahl-Maske ziehen, dann Pinselstrich hinein (darf nicht werfen)
await tool('sel-rect'); await drag(140, 130, 280, 220);
await tool('brush'); await drag(150, 150, 260, 200);
await page.keyboard.press('Escape');

const layerCount = await page.evaluate(() => document.querySelectorAll('#layers li').length);
const histCount = await page.evaluate(() => document.querySelectorAll('#history li').length);

// Auswahl-Aktionen
await tool('select');
await page.keyboard.press('Control+a');
await page.evaluate(() => { align('left'); groupSel(); doDuplicate(); });
await page.waitForTimeout(120);

// Clipping-Maske ueber window
await page.keyboard.press('Control+a');
await page.evaluate(() => makeMask());
await page.waitForTimeout(120);

// Verlauf-Sprung testen
await page.evaluate(() => restoreIndex(1));
await page.waitForTimeout(120);

// SVG-Export
let svgOk = false;
try {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), page.click('#q-svg')]);
  const stream = await dl.createReadStream(); let data = ''; for await (const c of stream) data += c;
  svgOk = data.includes('<svg') && data.includes('mm');
} catch (e) { errors.push('SVG: ' + e.message); }

await browser.close(); srv.kill();

console.log('HTTP:          ', served);
console.log('fabric:        ', fabricLoaded);
console.log('Menues:        ', menuCount, ' Palette:', paletteCount);
console.log('Globals fehlen:', Object.entries(globals).filter(([, t]) => t !== 'function').map(([n]) => n).join(', ') || '(keine)');
console.log('Ebenen:        ', layerCount, ' Verlauf-Eintraege:', histCount);
console.log('SVG-Export ok: ', svgOk);
console.log('Fehler:        ', errors.length);
for (const e of errors) console.log('   •', e.slice(0, 180));

const allFns = Object.values(globals).every(t => t === 'function');
const ok = allFns && fabricLoaded === 'object' && menuCount >= 6 && paletteCount >= 8 && layerCount >= 2 && histCount >= 2 && svgOk && errors.length === 0;
console.log('\n=> Smoke:', ok ? 'BESTANDEN ✓' : 'FEHLGESCHLAGEN ✗');
process.exit(ok ? 0 : 1);
