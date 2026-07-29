// Headless-Check der Fixes vom 2026-07-29:
// 1) Stützen-Sync: Typ-Wahl im Panel („Baum") schaltet die Haupt-Checkbox mit ein.
// 2) Sende-Dialog: Slot-Vorauswahl kennt jetzt den Filament-TYP (data-ftype)
//    und warnt bei Typ-Mismatch. Dialog wird ABGEBROCHEN — echter Drucker!
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const H2C = '31B8BP5B2601310';
const sid = (JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/sessions.json', 'utf8'))[0] || [])[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
if (sid) await page.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);
// LAN-Code aus der Bridge-Ablage vorbelegen (headless gibt es keinen prompt())
const lanAuth = JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/lan-auth.json', 'utf8'));
await page.addInitScript((entries) => {
  for (const [serial, v] of entries) localStorage.setItem('vs-lancode-' + serial, v.code);
}, lanAuth);

const step = (m) => console.log('▸', m);
const fail = (m) => { console.log('❌', m); process.exitCode = 1; };
await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._previewDebug === 'function', null, { timeout: 60000 });
step('Seite geladen (Modul fertig)');

// ---------- 1) Stützen-Sync ----------
await page.waitForFunction(() => document.querySelectorAll('#setTabs .setTab').length > 0, null, { timeout: 30000 });
await page.evaluate(() => {
  [...document.querySelectorAll('#setTabs .setTab')].find(b => b.textContent.trim() === 'Stützen')?.click();
});
await page.waitForSelector('#settings select[data-key="support_type"]', { timeout: 10000 });
const before = await page.$eval('#support', el => el.checked);
await page.evaluate(() => {
  const sel = document.querySelector('#settings select[data-key="support_type"]');
  sel.value = 'tree(auto)';
  sel.dispatchEvent(new Event('change'));
});
const afterType = await page.evaluate(() => ({
  master: document.getElementById('support').checked,
  panelDupe: !!document.querySelector('#settings [data-key="enable_support"]'),
}));
console.log('Stützen vorher:', before, '→ nach Typ-Wahl:', JSON.stringify(afterType));
if (!afterType.master) fail('Checkbox „Stützen" wurde durch Typ-Wahl NICHT aktiviert');
if (afterType.panelDupe) fail('enable_support taucht noch doppelt im Panel auf');
else step('Stützen: ein Schalter, Typ-Wahl aktiviert ihn');
// für den Slice-Test wieder an
await page.evaluate(() => { const c = document.getElementById('support'); c.checked = true; c.dispatchEvent(new Event('change')); });

// ---------- 2) Sende-Dialog: Typ in der Slot-Wahl + Warnung ----------
await page.waitForFunction((h) =>
  [...document.getElementById('sendPrinter').options].some(o => o.value === h), H2C, { timeout: 60000 });
// PETG-Profil wählen (falls vorhanden), damit ein Typ-Mismatch zu PLA-Slots entsteht
const petg = await page.evaluate(() => {
  const opts = [...document.getElementById('filament').options];
  const o = opts.find(o => /PETG/i.test(o.value) && /H2C/i.test(o.value))
         || opts.find(o => /PETG/i.test(o.value));
  if (!o) return null;
  const sel = document.getElementById('filament');
  sel.value = o.value; sel.dispatchEvent(new Event('change'));
  return o.value;
});
step(petg ? `Filament: ${petg}` : 'kein PETG-Profil — Test läuft mit aktuellem Filament');
await page.waitForTimeout(1500);   // refreshSettings nach Filamentwechsel
console.log('Filament nach Kompatibilitäts-Check:', await page.$eval('#filament', s => s.value));
await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
await page.waitForFunction(() => !document.getElementById('btnSlice').disabled, null, { timeout: 180000 });
await page.click('#btnSlice');
await page.waitForFunction(() => !document.getElementById('btnSend').disabled, null, { timeout: 300000 })
  .catch(async (e) => { console.log('Status:', await page.locator('#status').textContent()); throw e; });
step('G-Code fertig');
await page.selectOption('#sendPrinter', H2C);
await page.click('#btnSend');
await page.waitForFunction(() => !document.getElementById('sendDlg').hidden, null, { timeout: 30000 });
step('Dialog offen');
const dlg = await page.evaluate(() => {
  const sels = [...document.querySelectorAll('#sendBody select.sdTray')];
  return sels.map(s => ({
    ftype: s.dataset.ftype,
    selected: s.selectedOptions[0]?.textContent.trim(),
    selType: s.selectedOptions[0]?.dataset.type,
    warn: s.parentElement.querySelector('.sdTypeWarn')?.hidden === false
      ? s.parentElement.querySelector('.sdTypeWarn').textContent : '',
  }));
});
console.log('Slot-Zeilen:', JSON.stringify(dlg, null, 1));
if (!dlg.length) fail('keine AMS-Slot-Zeilen im Dialog (Drucker offline?)');
for (const r of dlg) {
  if (!r.ftype) fail('data-ftype fehlt — Typ wird der Slot-Wahl nicht übergeben');
  if (r.ftype && r.selType && r.ftype !== r.selType && !r.warn) fail('Typ-Mismatch ohne Warnung');
  if (r.ftype && r.selType && r.ftype === r.selType && r.warn) fail('Warnung trotz Typ-Treffer');
}
// Aktiv einen Slot mit ANDEREM Typ wählen → Warnung muss erscheinen
const mism = await page.evaluate(() => {
  const s = document.querySelector('#sendBody select.sdTray');
  const other = [...s.options].find(o => o.dataset.type && o.dataset.type !== s.dataset.ftype);
  if (!other) return null;
  s.value = other.value; s.dispatchEvent(new Event('change'));
  const w = s.parentElement.querySelector('.sdTypeWarn');
  return { picked: other.textContent.trim(), warn: w && !w.hidden ? w.textContent : '' };
});
if (mism === null) step('kein andersartiger Slot im AMS — Mismatch-Probe übersprungen');
else if (!mism.warn) fail(`Slot ${mism.picked} gewählt, aber KEINE Typ-Warnung`);
else step(`Mismatch-Warnung ok: ${mism.warn}`);
await page.screenshot({ path: '/tmp/claude-1000/-home-v3da/5a75704d-bcde-4533-84a0-8395ef861943/scratchpad/send-dialog-fix.png' });
await page.click('#sendCancel');   // NICHT senden!
step('Dialog abgebrochen (nichts gesendet)');
console.log(errors.length ? '❌ ' + errors.join('; ') : 'keine Seitenfehler');
if (errors.length) process.exitCode = 1;
await browser.close();
console.log(process.exitCode ? 'FEHLGESCHLAGEN' : 'OK');
