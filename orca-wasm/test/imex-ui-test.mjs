// Headless /slicer2 (OrcaSlicer 2.5): IDEX/IQEX-Druckmodus. Vivedino Xplorer IDEX wählen →
// Auswahl „IDEX/IQEX-Druckmodus“ erscheint → „Kopieren“ → slicen → Modus-G-Code des Profils im
// Ergebnis (SET_PRINT_MODE MODE=COPY). Kein Senden.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
const step = (m) => console.log('▸', m);
const MODE = process.env.MODE || 'copy';

await page.goto((process.env.APP_URL || 'http://127.0.0.1:8858/slicer2/app/'), { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._paintDebug === 'function', null, { timeout: 60000 });
await page.waitForFunction(() => [...document.getElementById('vendor').options].some(o => o.value === 'Vivedino'),
  null, { timeout: 60000 });
await page.selectOption('#vendor', 'Vivedino');
await page.waitForFunction(() => [...document.getElementById('machine').options].some(o => /Xplorer IDEX 0\.4/.test(o.value)),
  null, { timeout: 60000 });
const m = await page.$$eval('#machine option', os => os.map(o => o.value).find(v => /Xplorer IDEX 0\.4/.test(v)));
await page.selectOption('#machine', m);
step('Maschine: ' + m);
await page.waitForFunction(() => !document.getElementById('imexRow').hidden, null, { timeout: 30000 });
const modes = await page.$$eval('#imexMode option', os => os.map(o => `${o.value}=${o.textContent}`));
step('Modi: ' + modes.join(' | '));
await page.selectOption('#imexMode', MODE);

await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
await page.waitForFunction(() => !document.getElementById('btnSlice').disabled, null, { timeout: 180000 });
await page.click('#btnSlice');
await page.waitForFunction(() =>
  (window._lastGcode || '').length > 0 || document.querySelector('#status .err'), null, { timeout: 600000 });
step('Status: ' + (await page.locator('#status').textContent())?.slice(0, 160));
const g = await page.evaluate(() => window._lastGcode || '');
const modeLine = (g.match(/^.*SET_PRINT_MODE.*$/m) || [''])[0];
const cfg = (g.match(/^; imex_parallel_mode = .*$/m) || [''])[0];
console.log('Modus-G-Code:', modeLine || '—', '|', cfg || '—');
const ok = new RegExp(`MODE=${MODE.toUpperCase()}`).test(modeLine) && !errors.length;
console.log('Fehler:', errors.length ? errors : 'keine');
console.log(ok ? 'IMEX-UI-TEST OK ✅' : 'IMEX-UI-TEST FEHLGESCHLAGEN ❌');
await browser.close();
process.exit(ok ? 0 : 1);
