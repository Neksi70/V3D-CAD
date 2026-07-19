// Headless-Check kombinierter Sync-Button: App laden, 🔄 Sync klicken →
// Düsen-Dialog erscheint → Abbrechen → AMS-Teil läuft trotzdem an.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const sid = JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/sessions.json', 'utf8'))[0][0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);

await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });

// Alte Buttons weg, neuer Button da und sichtbar sobald Drucker geladen
await page.waitForFunction(() => !document.getElementById('devSync')?.hidden, null, { timeout: 30000 });
const gone = await page.evaluate(() => ({
  nozSync: !!document.getElementById('nozSync'),
  amsSync: !!document.getElementById('amsSync'),
}));
console.log('Alte Buttons entfernt:', JSON.stringify(gone));

// H2C-Profil wählen, damit der Düsen-Dialog-Pfad getestet wird
await page.evaluate(async () => {
  const sel = document.getElementById('machine');
  const h2c = [...sel.options].map(o => o.value).find(v => v.includes('H2C') && v.includes('0.4'));
  if (h2c) { sel.value = h2c; await sel.onchange(); }
});
await page.waitForTimeout(500);

// Sync klicken → Düsen-Dialog sollte aufgehen (H2C meldet Düsenstatus)
await page.click('#devSync');
let dialog = false;
try {
  await page.waitForFunction(() => !document.getElementById('nozDlg').hidden, null, { timeout: 20000 });
  dialog = true;
} catch { /* Drucker offline? Dann direkt AMS-Hinweis prüfen */ }
console.log('Düsen-Dialog offen:', dialog);

if (dialog) {
  const body = await page.evaluate(() => document.getElementById('nozBody').innerText.slice(0, 120));
  console.log('Dialog-Inhalt:', body.replace(/\n/g, ' | '));
  await page.click('#nozCancel');
}

// Nach Dialog-Schließen muss der AMS-Teil laufen (Hint oder Slot-Auswahl)
await page.waitForFunction(() => {
  const h = document.getElementById('amsHint').textContent;
  const p = document.getElementById('amsPick');
  return h.trim() !== '' || p.style.display === 'flex';
}, null, { timeout: 20000 });
const ams = await page.evaluate(() => ({
  hint: document.getElementById('amsHint').textContent,
  pick: document.getElementById('amsPick').style.display,
  slots: document.getElementById('amsPick').querySelectorAll('button').length,
  filament: document.getElementById('filament').value,
  nozHint: document.getElementById('nozHint').textContent,
}));
console.log('AMS-Teil:', JSON.stringify(ams, null, 1));

await page.screenshot({ path: 'devsync.png' });
console.log('Fehler:', errors.length ? errors : 'keine');
await browser.close();
