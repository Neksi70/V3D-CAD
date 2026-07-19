// Headless Mehrfarb-Check: H2C wählen, cube20 laden, 2. Filament anlegen,
// bemalen, SERVER-Slice (natives .gcode.3mf) — dann prüft check-multicolor-3mf.sh
// die Datei auf Slot-Konsistenz (slice_info/filament_maps/G-Code-Header).
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const sid = JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/sessions.json', 'utf8'))[0][0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
// Slice-Payload mitschneiden → direkter orca_native-Testlauf ohne Browser möglich
import { writeFileSync } from 'fs';
page.on('request', r => {
  if (r.url().includes('/api/slice') && r.method() === 'POST') {
    try { writeFileSync('/tmp/claude-1000/-home-v3da/3c78b2ae-35da-457c-9da0-975ecf6cf3b4/scratchpad/slice-payload.json', r.postData() || ''); console.log('▸ Payload gesichert'); } catch (e) { console.log('Payload-Dump:', e.message); }
  }
});
await page.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);
const step = (m) => console.log('▸', m);

await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._paintDebug === 'function', null, { timeout: 60000 });
step('Seite geladen');

await page.waitForFunction(() =>
  [...document.getElementById('machine').options].some(o => /H2C/i.test(o.value)),
  null, { timeout: 60000 }).catch(() => {});
const machineOpts = await page.$$eval('#machine option', os => os.map(o => o.value));
const h2c = machineOpts.find(v => /H2C/i.test(v));
if (!h2c) { console.log('KEINE H2C-Maschine!'); await browser.close(); process.exit(2); }
await page.selectOption('#machine', h2c);
await page.evaluate(() => document.getElementById('machine').dispatchEvent(new Event('change')));
step('H2C gewählt: ' + h2c);
await page.waitForTimeout(1500);
// H2C-Filamentprofil wählen (liefert die H2-spezifischen Werte wie filament_retract_length_nc).
// #filament ist ein Input mit Datalist — Wert direkt setzen.
const filH2C = await page.evaluate(() => {
  const names = [...document.querySelectorAll('#filamentList option')].map(o => o.value);
  return names.find(n => /PLA Basic @BBL H2C$/.test(n)) || names.find(n => /@BBL H2C$/.test(n)) || null;
});
if (filH2C) {
  await page.evaluate((n) => {
    const f = document.getElementById('filament');
    f.value = n; f.dispatchEvent(new Event('change'));
  }, filH2C);
  step('Filament: ' + filH2C);
  await page.waitForTimeout(1200);
} else step('WARNUNG: kein H2C-Filament in der Datalist');

// Drucker wählen — sonst liefert amsTopology() null und der Manual-filament_map-
// Override (AMS-Düse rechts) fehlt im Slice
await page.waitForFunction(() =>
  [...document.getElementById('sendPrinter').options].some(o => o.value), null, { timeout: 30000 })
  .catch(() => console.log('WARNUNG: kein Drucker im Dropdown'));
const printerOpts = await page.$$eval('#sendPrinter option', os => os.map(o => ({ v: o.value, t: o.textContent })));
const h2cPrinter = printerOpts.find(o => /H2|31B8/i.test(o.t + o.v)) || printerOpts.find(o => o.v);
if (h2cPrinter) {
  await page.selectOption('#sendPrinter', h2cPrinter.v);
  await page.evaluate(() => document.getElementById('sendPrinter').dispatchEvent(new Event('change')));
  step('Drucker: ' + h2cPrinter.t);
} else step('WARNUNG: kein Drucker wählbar');

await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
await page.waitForFunction(() => !document.getElementById('tbPaint').disabled, null, { timeout: 180000 });
step('Modell geladen');

// Objekt anwählen, Mal-Werkzeug, 2. Filament anlegen
const box = await page.locator('#view').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height * 0.55;
await page.mouse.click(cx, cy);
await page.click('#tbPaint');
await page.waitForTimeout(150);
await page.click('#toolPanel [data-pt="add"]');
await page.waitForTimeout(600);
// Filament 2 klar unterscheidbar einfärben (rot)
await page.evaluate(() => {
  const f = window._vs.filaments[1]; if (f) f.color = '#ff0000';
});

// Kugel-Pinsel groß, eine Hälfte bemalen
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
if (!dbg.painted) { console.log('nichts bemalt ❌'); await browser.close(); process.exit(1); }

// Server-Slice erzwingen (natives .gcode.3mf entsteht nur dort)
await page.waitForFunction(() => !document.getElementById('srvSliceRow').hidden, null, { timeout: 30000 })
  .catch(() => console.log('WARNUNG: srvSliceRow bleibt versteckt — Bridge-Slice nicht verfügbar?'));
await page.evaluate(() => { const c = document.getElementById('srvSlice'); if (c) c.checked = true; });

await page.click('#btnSlice');
await page.waitForFunction(() =>
  !document.getElementById('btnSend').disabled || document.querySelector('#status .err'),
  null, { timeout: 600000 });
const statusTxt = await page.locator('#status').textContent();
console.log('Status:', statusTxt?.slice(0, 160));

const out = await page.evaluate(() => ({
  sliceId: window._vs.sliceId,
  filaments: window._vs.filaments.map(f => ({ name: f.name, color: f.color })),
  gcodeLen: (window._lastGcode || '').length,
}));
console.log('RESULT ' + JSON.stringify(out));
console.log('Fehler:', errors.length ? errors : 'keine');
await browser.close();
process.exit(out.sliceId ? 0 : 1);
