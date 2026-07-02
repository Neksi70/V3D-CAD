// Smoke-Test Volme Draw: laedt die App headless, prueft auf JS-Fehler,
// zieht eine Form auf und klickt die neuen Profi-Aktionen durch.
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
  await page.waitForTimeout(1500); // Fabric CDN + Init
} catch (e) { errors.push('GOTO: ' + e.message); }

// Globals der Top-Level-Funktionen
const globals = await page.evaluate(() => {
  const names = ['setTool', 'zoomFit', 'zoomReset', 'align', 'distribute', 'groupSel',
    'ungroupSel', 'doDuplicate', 'doPaste', 'makeMask', 'unmask', 'buildGenerated',
    'refreshLayers', 'refreshMeasures'];
  const out = {}; for (const n of names) out[n] = typeof window[n]; return out;
});
const fabricLoaded = await page.evaluate(() => typeof window.fabric);

// Form aufziehen: Rechteck-Werkzeug -> Drag ueber der oberen Canvas
await page.click('[data-tool="rect"]');
const box = await page.locator('canvas.upper-canvas').boundingBox();
await page.mouse.move(box.x + 120, box.y + 100);
await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 240, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);

// Polygon-Werkzeug -> zweite Form
await page.click('[data-tool="polygon"]');
await page.mouse.move(box.x + 360, box.y + 120);
await page.mouse.down();
await page.mouse.move(box.x + 500, box.y + 260, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);

const layerCount = await page.evaluate(() => document.querySelectorAll('#layers li').length);

// Alles auswaehlen + Aktionen durchklicken (duerfen nicht werfen)
await page.locator('canvas.upper-canvas').click();
await page.keyboard.press('Control+a');
for (const id of ['a-dup', 'al-left', 'al-cy', 'a-flip-h', 'a-group', 'z-fit', 'z-reset', 'a-ungroup']) {
  await page.click('#' + id).catch(e => errors.push('CLICK ' + id + ': ' + e.message));
  await page.waitForTimeout(60);
}

// Maske: zwei Objekte auswaehlen und maskieren
await page.keyboard.press('Control+a');
await page.click('#a-mask').catch(e => errors.push('MASK: ' + e.message));
await page.waitForTimeout(120);

// SVG-Export: darf keinen Fehler werfen, Download muss kommen
let svgOk = false;
try {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 4000 }),
    page.click('#btn-svg')
  ]);
  const stream = await dl.createReadStream();
  let data = ''; for await (const c of stream) data += c;
  svgOk = data.includes('<svg') && data.includes('mm');
} catch (e) { errors.push('SVG: ' + e.message); }

await browser.close();
srv.kill();

console.log('HTTP:          ', served);
console.log('fabric:        ', fabricLoaded);
console.log('Globals:       ', JSON.stringify(globals));
console.log('Ebenen nach 2 Formen:', layerCount);
console.log('SVG-Export ok (mm, kein bg):', svgOk);
console.log('Fehler:        ', errors.length);
for (const e of errors) console.log('   •', e.slice(0, 180));

const allFns = Object.values(globals).every(t => t === 'function');
const ok = allFns && fabricLoaded === 'object' && layerCount >= 2 && svgOk && errors.length === 0;
console.log('\n=> Smoke:', ok ? 'BESTANDEN ✓' : 'FEHLGESCHLAGEN ✗');
process.exit(ok ? 0 : 1);
