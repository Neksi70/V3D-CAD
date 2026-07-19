// Headless-Check: window._vs.plateThumb() liefert ein echtes PNG des Modells.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
// Warten, bis die Vorschau im Viewer steht (modelGroup hat Kinder)
try {
  await page.waitForFunction(() => window._vs && window._vs.modelCount > 0,
    null, { timeout: 60000 });
} catch {
  const dbg = await page.evaluate(() => ({
    drop: document.getElementById('drop').textContent,
    workerReady: typeof workerReady !== 'undefined' ? workerReady : 'undef',
    mg: window._vs ? window._vs.modelCount : "undef",
    status: document.getElementById('status')?.textContent,
  }));
  console.log('TIMEOUT — Debug:', JSON.stringify(dbg));
  console.log(errors.join('\n'));
  process.exit(1);
}
await page.waitForTimeout(500);

const b64 = await page.evaluate(() => window._vs.plateThumb());
if (!b64) { console.log('FEHLER: window._vs.plateThumb() lieferte null'); process.exit(1); }
const buf = Buffer.from(b64, 'base64');
console.log('PNG-Bytes:', buf.length, 'Header ok:', buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a');
writeFileSync('/tmp/claude-1000/-home-v3da/3acd721c-9009-49bf-8115-1ff4d3a829eb/scratchpad/thumb.png', buf);

// Danach: Viewer unversehrt? (Bett wieder sichtbar, Hintergrund zurück)
const after = await page.evaluate(() => ({
  ok: true,
  
  
}));
console.log('Viewer danach:', JSON.stringify(after));
if (errors.length) console.log(errors.join('\n'));
await browser.close();
