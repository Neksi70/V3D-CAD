// Josy 4.10.26: Tab seit dem Vorabend offen → Fix vom Vorabend nie geladen, Fehler
// erneut gemeldet. Prüft: /api/version liefert die ausgelieferte Version; meldet der
// Server eine neuere, erscheint beim Zurückkehren zum Tab der Hinweis, „Neu laden“
// lädt die Seite neu. Gleiche Version → kein Hinweis.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
const echt = await pg.evaluate(async () => [(await (await fetch('/api/version')).json()).version, VOLME3D_VERSION]);
ok('/api/version = ausgelieferte Version', echt[0] === echt[1], echt);
// gleiche Version: kein Hinweis
await pg.evaluate(() => { _verCheckT = 0; window.dispatchEvent(new Event('focus')); });
await pg.waitForTimeout(800);
ok('gleiche Version: kein Hinweis', !(await pg.$('#ver-neu-hinweis')));
// Server meldet neuere Version
await pg.route('**/api/version', r => r.fulfill({ contentType: 'application/json', body: '{"version":"99.0.0"}' }));
await pg.evaluate(() => { _verCheckT = 0; window.dispatchEvent(new Event('focus')); });
await pg.waitForSelector('#ver-neu-hinweis', { timeout: 5000 }).catch(() => {});
const txt = await pg.evaluate(() => document.getElementById('ver-neu-hinweis')?.textContent || '');
ok('neuere Version: Hinweis erscheint', /99\.0\.0/.test(txt), txt);
// nicht doppelt
await pg.evaluate(() => { _verCheckT = 0; window.dispatchEvent(new Event('focus')); });
await pg.waitForTimeout(500);
ok('Hinweis nur einmal', (await pg.$$('#ver-neu-hinweis')).length === 1);
await pg.evaluate(() => { window._vorReload = 1; });
await Promise.all([pg.waitForNavigation({ timeout: 30000 }), pg.click('#ver-neu-laden')]);
ok('Neu laden lädt die Seite neu', await pg.evaluate(() => window._vorReload === undefined));
ok('keine JS-Fehler', errs.length === 0, errs);
await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER`); process.exit(1); }
console.log('\nAlles grün.');
