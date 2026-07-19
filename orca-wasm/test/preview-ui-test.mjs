// Headless-Check Vorschau (Studio-Look): Modell laden → slicen →
// Slicing-Ergebnis-Panel, vertikaler Schicht-Slider, Toast prüfen + Screenshot.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const sid = JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/sessions.json', 'utf8'))[0][0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);

await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('status').textContent.includes('bereit'), null, { timeout: 60000 });

await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
await page.waitForFunction(() => !document.getElementById('btnSlice').disabled, null, { timeout: 30000 });
await page.click('#btnSlice');
await page.waitForFunction(() => document.getElementById('done'), null, { timeout: 180000 });
await page.waitForTimeout(600);

const snap = await page.evaluate(() => ({
  tab: document.querySelector('.tab.active').dataset.tab,
  panelVisible: !document.getElementById('sliceResult').hidden,
  total: document.getElementById('srTotal').textContent,
  time: document.getElementById('srTime').textContent,
  legend: document.getElementById('legend').textContent.trim(),
  colorRowHidden: document.getElementById('viewColorRow').hidden,
  layerLabel: document.getElementById('layerLabel').textContent,
  sliderVertical: getComputedStyle(document.getElementById('layerSlider')).writingMode,
  toastVisible: !document.getElementById('sliceToast').hidden,
}));
console.log(JSON.stringify(snap, null, 2));

// Slider auf halbe Höhe ziehen → Badge muss mitgehen
await page.evaluate(() => {
  const s = document.getElementById('layerSlider');
  s.value = Math.round(+s.max / 2); s.dispatchEvent(new Event('input'));
});
console.log('Badge bei halber Höhe:', await page.evaluate(() => document.getElementById('layerLabel').textContent));

await page.screenshot({ path: '/tmp/claude-1000/-home-v3da/91ec4714-e8c9-4eb4-9e8e-fa5b15082c99/scratchpad/preview-page.png' });

// Tab-Wechsel: Panel/Slider/Toast weg auf „Vorbereiten", wieder da auf „Vorschau"
await page.click('[data-tab="prepare"]');
const onPrepare = await page.evaluate(() => ({
  panel: document.getElementById('sliceResult').hidden,
  overlay: document.getElementById('overlay').hidden,
  toast: document.getElementById('sliceToast').hidden,
}));
console.log('Auf Vorbereiten alles versteckt:', JSON.stringify(onPrepare));
await page.click('[data-tab="preview"]');
console.log('Zurück auf Vorschau sichtbar:', await page.evaluate(() =>
  !document.getElementById('sliceResult').hidden && !document.getElementById('overlay').hidden));

console.log('Fehler:', errors.length ? errors : 'keine');
await browser.close();
