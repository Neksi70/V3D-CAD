// Headless-Check Mal-Werkzeug: App laden, STL öffnen, Objekt anklicken,
// Bemalen aktivieren, 2 Filamente anlegen, Stroke malen → bemalte Dreiecke?
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
// Vorschau fertig = Bemalen-Button aktiv
await page.waitForFunction(() => !document.getElementById('tbPaint').disabled, null, { timeout: 120000 })
  .catch(async (e) => {
    console.log('Status:', await page.locator('#status').textContent().catch(() => '?'));
    throw e;
  });

// Objekt anklicken (Würfel liegt in Bettmitte, Kamera-Default schaut drauf)
const box = await page.locator('#view').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height * 0.55;
await page.mouse.click(cx, cy);
await page.click('#tbPaint');
await page.waitForTimeout(150);

// Panel da? → Filamente anlegen (+ legt beim ersten Mal Basis + neues an)
const t1 = (await page.locator('#toolPanel').textContent())?.slice(0, 120);
await page.click('#toolPanel [data-pt="add"]');
await page.waitForTimeout(600);   // Session-Aufbau (Mesh-Unterteilung)
const chips = await page.locator('#toolPanel .pfChip').count();

// Stroke: über dem Objekt drücken + ziehen (links = malen)
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 30, cy + 12, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(250);

const dbg = await page.evaluate(() => window._paintDebug && window._paintDebug());
console.log('Panel:', JSON.stringify(t1));
console.log('Chips:', chips, '| Debug:', JSON.stringify(dbg));
console.log('Fehler:', errors.length ? errors : 'keine');
await browser.close();
const ok = !errors.length && chips >= 2 && dbg && dbg.session && dbg.painted > 0;
console.log(ok ? 'PAINT-UI-TEST OK ✅' : 'PAINT-UI-TEST FEHLGESCHLAGEN ❌');
process.exit(ok ? 0 : 1);
