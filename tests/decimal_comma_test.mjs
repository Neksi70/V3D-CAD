// Dezimalkomma = Dezimalpunkt in Zahlenfeldern (type=number + inputmode=decimal),
// in deutscher UND englischer Browsersprache. Echte Tastatureingaben.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
const PORT = 8938;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
let bad = 0;
for (const locale of ['de-DE', 'en-US']) {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { hideStarter(); _newCreate(false); addShape('box'); selectObjs([objects[0]]); });
  await page.waitForTimeout(400);
  // 1) Maßfeld im Eigenschaften-Fenster (Text, inputmode=decimal)
  const fp = page.locator('input.fp-inp:visible').first();
  const fpId = await fp.getAttribute('id');
  await fp.click({ clickCount: 3 }); await page.keyboard.type('13,7'); await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => { const b = getMeshBox(objects[0]);
    return [b.max.x-b.min.x, b.max.y-b.min.y, b.max.z-b.min.z].map(v => +(v*10).toFixed(2)); });
  // 2) Zahlfeld im Füllen-Dialog (type=number)
  await page.evaluate(() => { selectObjs([objects[0]]); fillPlateTool(); });
  const gap = page.locator('#pat-fill-gap');
  await gap.click({ clickCount: 3 }); await page.keyboard.type('1,3');
  const r2 = await gap.inputValue();
  // 3) Textfeld bleibt Text
  await page.evaluate(() => { _closePat(); const i = document.getElementById('name-text'); i.value = ''; });
  const r3 = await page.evaluate(() => { const i = document.getElementById('name-text'); i.value = 'a,b';
    i.dispatchEvent(new InputEvent('input', { bubbles: true })); return i.value; });
  const ok = r1.includes(13.7) && r2 === '1.3' && r3 === 'a,b' && !errs.length;
  if (!ok) bad++;
  console.log(locale, fpId, JSON.stringify(r1), 'number:', r2, 'text:', r3, errs, ok ? 'OK' : 'FEHLER');
  await ctx.close();
}
await browser.close(); srv.kill();
process.exitCode = bad ? 1 : 0;
