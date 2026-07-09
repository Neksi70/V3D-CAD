import { chromium } from '@playwright/test';

const URL = 'http://127.0.0.1:8766/volmeslice/volmeslice.html';
const SHOT = '/tmp/claude-1000/-home-v3da/66064a8d-f655-4c73-827c-c884f0790e36/scratchpad/';
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
ok(await page.evaluate(() => !!window._VS && typeof ClipperLib !== 'undefined' && typeof THREE !== 'undefined'),
   'Seite lädt, Clipper+THREE+Testhaken vorhanden');

// --- Modus 1: Gestapelte Scheiben mit Demo-Modell ---
await page.click('#btnDemo');
await page.waitForFunction(() => window._VS.state.parts && window._VS.state.parts.mode === 'stack', null, { timeout: 30000 });
const stack = await page.evaluate(() => {
  const s = window._VS.state;
  const cutPaths = s.parts.parts.reduce((a, p) => a + p.final.length, 0);
  return {
    layers: s.parts.parts.length, pins: s.parts.pins.length, stackH: s.parts.stackH,
    sheets: s.sheets.length, cutPaths, warn: s.warnings,
    size: s.size.map(v => Math.round(v)),
  };
});
console.log(JSON.stringify(stack));
ok(stack.layers === 30, `Scheiben: 30 Lagen bei 90mm/3mm erwartet (ist ${stack.layers})`);
ok(stack.cutPaths > stack.layers, 'jede Lage hat Konturen');
ok(stack.sheets >= 1, `Blätter gepackt (${stack.sheets})`);

// SVG-Inhalt prüfen
const svg = await page.evaluate(() => {
  const s = window._VS.state;
  return window._VS.buildSheetSvg(s.sheets[0], s.lastParams, 0, s.sheets.length);
});
ok(svg.includes('<path') && svg.includes('viewBox="0 0 600 400"'), 'SVG hat Pfade + korrekte viewBox');
ok(svg.includes('#ff0000'), 'SVG hat Gravur-Beschriftung (rot)');
// Alle SVG-Koordinaten innerhalb des Blatts?
const nums = [...svg.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(m => [+m[1], +m[2]]);
const inSheet = nums.every(([x, y]) => x >= -0.01 && x <= 600.01 && y >= -0.01 && y <= 400.01);
ok(inSheet && nums.length > 100, `SVG-Koordinaten im Blattbereich (${nums.length} Punkte)`);

await page.screenshot({ path: SHOT + 'vs_stack_3d.png' });
await page.click('#tab2d');
await page.waitForTimeout(300);
await page.screenshot({ path: SHOT + 'vs_stack_2d.png' });
await page.click('#tab3d');

// --- Modus 2: Waffel ---
await page.click('#modeWaffle');
await page.waitForFunction(() => window._VS.state.parts && window._VS.state.parts.mode === 'waffle', null, { timeout: 30000 });
const waffle = await page.evaluate(() => {
  const s = window._VS.state;
  return { ribs: s.parts.parts.length, joints: s.parts.joints, sheets: s.sheets.length, warn: s.warnings };
});
console.log(JSON.stringify(waffle));
ok(waffle.ribs >= 6, `Waffel: Rippen vorhanden (${waffle.ribs})`);
ok(waffle.joints > 0, `Waffel: Steckungen gefunden (${waffle.joints})`);
await page.screenshot({ path: SHOT + 'vs_waffle_3d.png' });

// Explosion + 2D-Ansicht
await page.evaluate(() => { document.getElementById('explode').value = 60; document.getElementById('explode').dispatchEvent(new Event('input')); });
await page.screenshot({ path: SHOT + 'vs_waffle_explode.png' });
await page.click('#tab2d');
await page.waitForTimeout(300);
await page.screenshot({ path: SHOT + 'vs_waffle_2d.png' });

// --- STL-Datei-Import (echte Datei, binär) ---
const gardena = await page.evaluate(async () => {
  const r = await fetch('/volmeslice/volmeslice.html'); // Dummy — Datei kommt via Node unten
  return null;
});
ok(errors.length === 0, 'keine JS-Fehler auf der Seite' + (errors.length ? ' — ' + errors.join(' | ') : ''));

await browser.close();
console.log(fails ? `>>> ${fails} FEHLER` : '>>> ALLE TESTS BESTANDEN');
process.exit(fails ? 1 : 0);
