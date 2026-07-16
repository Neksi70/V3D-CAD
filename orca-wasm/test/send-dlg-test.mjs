// Headless-Check Sende-Dialog (Bambu): slicen, Dialog öffnen, prüfen, ABBRECHEN.
// Achtung: niemals sendGo klicken — echter Drucker!
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const H2C = '31B8BP5B2601310';
const sid = JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/sessions.json', 'utf8'))[0][0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);

const step = (m) => console.log('▸', m);
await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
// Modul lädt oben den WASM-Kern — Handler existieren erst am Modulende
await page.waitForFunction(() => typeof window._previewDebug === 'function', null, { timeout: 60000 });
step('Seite geladen (Modul fertig)');
await page.waitForFunction((h) =>
  [...document.getElementById('sendPrinter').options].some(o => o.value === h), H2C, { timeout: 60000 });
step('H2C in der Druckerliste');
await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
await page.waitForFunction(() => !document.getElementById('btnSlice').disabled, null, { timeout: 180000 })
  .catch(async (e) => { console.log('Status:', await page.locator('#status').textContent()); throw e; });
step('Slicen möglich');
await page.click('#btnSlice');
await page.waitForFunction(() => !document.getElementById('btnSend').disabled, null, { timeout: 300000 })
  .catch(async (e) => { console.log('Status:', await page.locator('#status').textContent()); throw e; });
step('G-Code fertig');
await page.selectOption('#sendPrinter', H2C);
await page.click('#btnSend');
await page.waitForFunction(() => !document.getElementById('sendDlg').hidden, null, { timeout: 30000 });
step('Dialog offen');
console.log('Dialog:', (await page.$eval('#sendBody', e => e.innerText)).replace(/\n+/g, ' | '));
const slots = await page.$$eval('#sendBody select.sdTray', ss =>
  ss.map(s => [...s.options].map(o => o.text + (o.selected ? ' *' : ''))));
console.log('Slots:', JSON.stringify(slots));
await page.screenshot({ path: '/tmp/claude-1000/-home-v3da/bdbc9fc6-d2f0-4d4e-b71a-1872e145755b/scratchpad/send-dialog.png' });
await page.click('#sendCancel');   // NICHT senden!
console.log('Dialog geschlossen:', await page.$eval('#sendDlg', e => e.hidden));
console.log(errors.length ? errors.join('; ') : 'keine Seitenfehler');
await browser.close();
