// Headless /slicer2 (OrcaSlicer 2.5): Mischfilament in der App anlegen und server-slicen.
// Ablauf: Würfel laden → 2 Filamente (Mal-Panel „+“) → 🎨 Mischfilament 50/50 aus 1+2 →
// Objekt markieren, Taste 3 → Server-Slice → G-Code: T0+T1 abwechselnd, kein T2.
// Kein Senden.
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const sid = (JSON.parse(readFileSync('/home/v3da/orca-wasm/bridge/sessions.json', 'utf8'))[0] || [''])[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.addInitScript((s) => sessionStorage.setItem('vs-sid', s), sid);
const step = (m) => console.log('▸', m);

await page.goto((process.env.APP_URL || 'http://127.0.0.1:8858/slicer2/app/'), { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._paintDebug === 'function', null, { timeout: 60000 });
step('Seite geladen');

await page.setInputFiles('#file', '/home/v3da/orca-wasm/test/cube20.stl');
await page.waitForFunction(() => !document.getElementById('tbPaint').disabled, null, { timeout: 180000 });
step('Modell geladen');

// 2 physische Filamente über das Mal-Panel anlegen, dann Werkzeug wieder schließen
const box = await page.locator('#view').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
await page.click('#tbPaint');
await page.waitForTimeout(150);
await page.click('#toolPanel [data-pt="add"]');
await page.waitForTimeout(600);
await page.evaluate(() => { const f = window._vs.filaments[1]; if (f) f.color = '#ff0000'; });
await page.click('#tbPaint');
await page.waitForTimeout(300);
step('Filamente: ' + await page.evaluate(() => window._vs.filaments.length));

// Mischfilament anlegen
await page.waitForFunction(() => !document.getElementById('mixRow').hidden, null, { timeout: 10000 });
await page.click('#mixToggle');
await page.evaluate(() => {
  const r = document.getElementById('mixRatio'); r.value = 50; r.dispatchEvent(new Event('input'));
});
await page.click('#mixAdd');
await page.waitForTimeout(800);
const fils = await page.evaluate(() => window._vs.filaments.map(f => ({ label: f.label, mixed: f.mixed || null })));
step('Projekt-Filamente: ' + JSON.stringify(fils));
const mixNo = fils.findIndex(f => f.mixed) + 1;
if (!mixNo) { console.log('kein Mischfilament angelegt ❌'); await browser.close(); process.exit(1); }

// Objekt markieren + Taste → Mischslot
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
await page.keyboard.press(String(mixNo));
step('Hinweis: ' + await page.locator('#amsHint').textContent());

// Server-Slice
await page.waitForFunction(() => !document.getElementById('srvSliceRow').hidden, null, { timeout: 30000 })
  .catch(() => console.log('WARNUNG: Server-Slice nicht verfügbar'));
await page.evaluate(() => { const c = document.getElementById('srvSlice'); if (c) c.checked = true; });
await page.click('#btnSlice');
await page.waitForFunction(() =>
  !document.getElementById('btnSend').disabled || document.querySelector('#status .err'),
  null, { timeout: 600000 });
step('Status: ' + (await page.locator('#status').textContent())?.slice(0, 160));

const g = await page.evaluate(() => window._lastGcode || '');
const tc = {}; for (const m of g.matchAll(/^T(\d+)\s*$/gm)) tc[m[1]] = (tc[m[1]] || 0) + 1;
console.log('Werkzeugwechsel:', JSON.stringify(tc), '| enable_mixed_color_sublayer:', /; enable_mixed_color_sublayer = 1/.test(g));
const ok = g.length > 0 && tc['0'] > 1 && tc['1'] > 1 && !tc['2'] && !errors.length;
console.log('Fehler:', errors.length ? errors : 'keine');
console.log(ok ? 'MIXED-COLOR-UI-TEST OK ✅' : 'MIXED-COLOR-UI-TEST FEHLGESCHLAGEN ❌');
await browser.close();
process.exit(ok ? 0 : 1);
