// Headless-Check „Druck-Check [P]" im V3D Slicer: Γ-Winkel ohne Stützen →
// Befund „Stützen nötig" → Übernehmen → Slice enthält wirklich Stützen.
// Aufruf: node test/check-ui-test.mjs [--no-slice]
import { chromium } from 'playwright';

const OUT = process.env.OUT_DIR || '/tmp';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

await page.addInitScript(() => { try { localStorage.removeItem('vs-presets'); } catch {} });
await page.goto('http://127.0.0.1:8778/app/', { waitUntil: 'load' });
await page.setInputFiles('#file', new URL('./lbracket.stl', import.meta.url).pathname);
await page.waitForFunction(() => !document.getElementById('tbCheck').disabled, null, { timeout: 120000 });
await page.waitForFunction(() => typeof window._adaptDebug === 'function' && window._adaptDebug().cfgKeys > 0, null, { timeout: 60000 });
await page.evaluate(() => { const s = document.getElementById('support'); if (s.checked) { s.checked = false; s.onchange(); } });

await page.keyboard.press('p');
await page.waitForSelector('#toolPanel .pcList');
const d1 = await page.evaluate(() => window._checkDebug());
console.log('Befunde:', d1.score, d1.ids.join(', '));
ok(d1.ids.includes('stuetzen_an'), 'Γ-Winkel: „Stützen nötig" erkannt');
ok(await page.evaluate(() => document.getElementById('tbCheck').classList.contains('warnOn') || document.getElementById('tbCheck').classList.contains('errOn')),
  'Werkzeug-Knopf zeigt Warnstreifen');
await page.locator('#toolPanel').screenshot({ path: `${OUT}/check-panel.png` });

const idx = d1.findings.findIndex(f => f.id === 'stuetzen_an');
await page.click(`#toolPanel button[data-pc="${idx}"]`);
const d2 = await page.evaluate(() => window._checkDebug());
ok(!d2.ids.includes('stuetzen_an'), 'nach Übernehmen kein Stützen-Befund mehr');
ok(await page.evaluate(() => document.getElementById('support').checked), 'Checkbox „Stützen" ist an');
ok(await page.evaluate(() => window._cadDebug ? true : true) && (await page.locator('#toolPanel').innerText()).includes('Neu slicen'), 'Panel sagt „Neu slicen"');
await page.locator('#toolPanel').screenshot({ path: `${OUT}/check-panel-nachher.png` });

if (!process.argv.includes('--no-slice')) {
  await page.waitForFunction(() => !document.getElementById('btnSlice').disabled, null, { timeout: 60000 });
  await page.click('#btnSlice');
  await page.waitForFunction(() => (window._lastGcode || '').length > 1000, null, { timeout: 300000 });
  const g = await page.evaluate(() => window._lastGcode);
  const sup = (g.match(/^;\s?(?:TYPE:|FEATURE: )Support/gm) || []).length;
  ok(sup > 0, `G-Code enthält Stützen (${sup} Abschnitte)`);
  ok(/^; enable_support = 1/m.test(g), 'Config im G-Code: enable_support = 1');
}
ok(!errors.length, 'keine Seitenfehler ' + errors.join(' | '));
await browser.close();
console.log(fails ? `\n${fails} FEHLGESCHLAGEN` : '\nalle grün');
process.exit(fails ? 1 : 0);
