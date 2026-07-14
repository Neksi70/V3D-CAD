// E2E Mal-Werkzeug: malen wie paint-ui-test, dann slicen (Worker/Server, wie
// die App es selbst entscheidet) und den G-Code auf Werkzeugwechsel prüfen.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
await page.waitForFunction(() => !document.getElementById('tbPaint').disabled, null, { timeout: 120000 });

const box = await page.locator('#view').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height * 0.55;
await page.mouse.click(cx, cy);
await page.click('#tbPaint');
await page.waitForTimeout(150);
await page.click('#toolPanel [data-pt="add"]');
await page.waitForTimeout(600);

// großzügig malen (Kugel-Pinsel, groß), damit sicher ganze Regionen umfärben
await page.evaluate(() => { document.querySelector('#toolPanel [data-ptool="sphere"]')?.click(); });
await page.waitForTimeout(100);
await page.evaluate(() => {
  const r = document.querySelector('#toolPanel [data-pt="rad"]');
  if (r) { r.value = 10; r.dispatchEvent(new Event('input')); }
});
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 60, cy, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);
const dbg = await page.evaluate(() => window._paintDebug());
console.log('Bemalt:', JSON.stringify(dbg));
if (!dbg.painted) { console.log('nichts bemalt ❌'); process.exit(1); }

// Slicen und auf Ergebnis warten
await page.click('#btnSlice');
await page.waitForFunction(() =>
  document.getElementById('done') || document.querySelector('#status .err'), null, { timeout: 600000 });
const statusTxt = await page.locator('#status').textContent();
console.log('Status:', statusTxt?.slice(0, 160));
const g = await page.evaluate(() => {
  const gc = window._lastGcode || '';
  return { len: gc.length, t0: /^T0\b/m.test(gc), t1: /^T1\b/m.test(gc),
           tchanges: (gc.match(/^T1\b/gm) || []).length };
});
console.log('G-Code:', JSON.stringify(g));
console.log('Fehler:', errors.length ? errors : 'keine');
await browser.close();
const ok = !errors.length && g.len > 1000 && g.t1;
console.log(ok ? 'PAINT-E2E OK ✅' : 'PAINT-E2E FEHLGESCHLAGEN ❌');
process.exit(ok ? 0 : 1);
