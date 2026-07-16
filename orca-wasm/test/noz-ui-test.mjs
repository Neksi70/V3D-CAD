// Headless-Check Düsen-Sync: App laden (mit Cloud-Session), H2C wählen,
// 🔄 Düse klicken → Dialog prüfen → 0.6 wählen → OK → Maschinen-Variante?
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const sid = JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/sessions.json', 'utf8'))[0][0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);

await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });

// Drucker geladen + Düsen-Button sichtbar
await page.waitForFunction(() => !document.getElementById('nozSync').hidden, null, { timeout: 30000 });
// Maschinenliste geladen (BBL-Vendor default)
await page.waitForFunction(() => {
  const m = document.getElementById('machine');
  return m.options.length > 1 && !m.options[0].disabled;
}, null, { timeout: 30000 });

// H2C als Sende-Drucker wählen
await page.selectOption('#sendPrinter', '31B8BP5B2601310');
// Ausgangslage: bewusst eine andere Variante wählen
await page.selectOption('#machine', 'Bambu Lab H2C 0.2 nozzle');
await page.waitForTimeout(500);

await page.click('#nozSync');
await page.waitForFunction(() => !document.getElementById('nozDlg').hidden, null, { timeout: 20000 });

const rows = await page.$$eval('#nozBody tr', trs => trs.map(tr =>
  [...tr.children].map(td => td.textContent.trim().replace(/\s+/g, ' ')).join(' | ')));
console.log('Tabelle:');
rows.forEach(r => console.log('  ' + r));
const checked = await page.$eval('#nozBody input[name=nozDiam]:checked', r => r.value).catch(() => null);
console.log('Vorauswahl:', checked);
const mag = await page.$$eval('#nozBody .nozMag .nozCell', cs => cs.map(c => c.textContent.trim().replace(/\s+/g, ' ')));
console.log('Magazin:', mag);
const exts = await page.$$eval('#nozBody .nozExts .nozCell', cs => cs.map(c => c.textContent.trim().replace(/\s+/g, ' ')));
console.log('Extruder:', exts);

await page.screenshot({ path: '/tmp/claude-1000/-home-v3da/bdbc9fc6-d2f0-4d4e-b71a-1872e145755b/scratchpad/noz-dialog.png' });

// 0.6 wählen → OK → Variante muss wechseln
await page.check('#nozBody input[name=nozDiam][value="0.6"]');
await page.click('#nozOk');
await page.waitForTimeout(1500);
const machine = await page.$eval('#machine', m => m.value);
const hint = await page.$eval('#nozHint', e => e.textContent);
const process = await page.$eval('#process', e => e.value);
console.log('Maschine nach OK:', machine);
console.log('Hint:', hint, '| Prozess:', process);

console.log(errors.length ? 'FEHLER: ' + errors.join('; ') : 'keine Seitenfehler');
console.log(machine === 'Bambu Lab H2C 0.6 nozzle' ? 'TEST OK' : 'TEST FEHLGESCHLAGEN');
await browser.close();
