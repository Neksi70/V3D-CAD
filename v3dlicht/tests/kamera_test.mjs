// Prueft den Messweg mit einer simulierten Kamera (Playwright fake device).
import { chromium } from 'playwright';
const PORT = process.argv[2] || 8793;
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream',
                                         '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ permissions: ['camera'] });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('PAGEERROR: ' + e.message));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.evaluate(() => zeigeTab('messen'));
await p.click('#b_cam');
await p.waitForFunction(() => {
  const t = document.getElementById('m_wert').textContent;
  return t !== '–' && parseFloat(t.replace(/\./g, '')) > 0;
}, null, { timeout: 8000 }).catch(() => fehler.push('Kamera liefert keinen Messwert'));
const wert = await p.textContent('#m_wert');
console.log('Messwert der Fake-Kamera:', wert, 'lx');
const status = await p.textContent('#sensorStatus');
console.log('Status:', status.slice(0, 120).replace(/\s+/g, ' '));

// Kalibrierung
await p.evaluate(() => document.querySelectorAll('#camBox details').forEach(d => d.open = true));
await p.fill('#i_ref', '500');
await p.evaluate(() => kalibrieren());
const kal = await p.inputValue('#i_kal');
console.log('Kalibrierfaktor nach Referenz 500 lx:', kal);
// Das Testbild der Fake-Kamera wandert, deshalb wird der Faktor geprueft, nicht der Folgewert
const vorher = parseFloat(wert.replace(/\./g, '').replace(',', '.'));
const erwartet = 500 / vorher;
console.log('Faktor erwartet ca.', erwartet.toFixed(3));
if (Math.abs(parseFloat(kal) - erwartet) > erwartet * 0.6)
  fehler.push('Kalibrierfaktor falsch: ' + kal + ' statt ~' + erwartet.toFixed(3));
await p.waitForTimeout(900);
const neu = parseFloat((await p.textContent('#m_wert')).replace(/\./g, '').replace(',', '.'));
console.log('Messwert nach Kalibrierung:', neu, '(Fake-Kamera schwankt stark)');
if (!(neu > 0)) fehler.push('Nach Kalibrierung kein Messwert mehr');

// Messpunkt merken -> Protokoll
await p.fill('#i_punktName', 'Schreibtisch');
await p.evaluate(() => punktMerken());
const zeilen = await p.$$eval('#punkteBody tr', r => r.length);
if (zeilen !== 1) fehler.push('Messpunkt nicht im Protokoll');
await p.evaluate(() => rasterVorschlag());
const raster = await p.textContent('#rasterInfo');
console.log('Rastervorschlag:', raster.slice(0, 100));
if (!/Messpunkte/.test(raster)) fehler.push('Rastervorschlag fehlt');
await p.evaluate(() => kameraStop());

// Screenshots aller Reiter
for (const t of ['raum','leuchten','verteilung','energie','elektro','bericht']) {
  await p.evaluate(x => zeigeTab(x), t);
  await p.waitForTimeout(120);
  await p.screenshot({ path: `/tmp/licht_${t}.png`, fullPage: false });
}
await b.close();
if (fehler.length) { console.log('\nFEHLER:\n' + fehler.join('\n')); process.exit(1); }
console.log('\nKamerapfad ok.');
