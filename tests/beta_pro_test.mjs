// Beta-Hinweis beim Start (höchstens 1× pro Woche) + ⭐ PRO am großen „Druck prüfen“-Knopf (Volker 9.11.)
// Start: python3 volme3d_server.py 8887 --dev  →  node tests/beta_pro_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8887/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => { localStorage.setItem('v3d_umsteiger_hinweis', '1'); localStorage.setItem('volme3d_hide_start', '1'); });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP); await pg.waitForFunction(() => typeof _betaHinweis === 'function', { timeout: 60000 });
await pg.evaluate(() => document.getElementById('auth-overlay')?.classList.add('hidden'));
await pg.waitForSelector('#beta-hinweis', { timeout: 20000 });
const t = await pg.textContent('#beta-hinweis');
ok('Beta-Hinweis erscheint beim Start', /31\. März 2027/.test(t) && /Grundfunktionen für alle kostenlos/.test(t) && /Volme 3D Akademie/.test(t), t.slice(0, 160));
ok('Kurse-Link', await pg.$eval('#beta-hinweis a[href*="kurse.volme3dakademie.de"]', a => !!a));
await pg.screenshot({ path: '/tmp/beta_hinweis.png' });
await pg.click('#beta-hinweis .bh-ok');
ok('Verstanden schließt', !(await pg.$('#beta-hinweis')));
await pg.reload(); await pg.waitForFunction(() => typeof _betaHinweis === 'function'); await pg.evaluate(() => document.getElementById('auth-overlay')?.classList.add('hidden'));
await pg.waitForTimeout(9000);
ok('innerhalb einer Woche nicht noch einmal', !(await pg.$('#beta-hinweis')));
// großer Prüfknopf mit PRO an 3MF-Kacheln, nicht an STL
const k = await pg.evaluate(() => {
  _stlFiles.splice(0, _stlFiles.length, { name: 'A.3mf', path: 'A.3mf', lib: true, size: 10, mtime: Date.now() }, { name: 'B.stl', path: 'B.stl', lib: true, size: 10, mtime: Date.now() });
  _stlLibOpen && _stlLibOpen(); _stlRenderGrid();
  const knoepfe = [...document.querySelectorAll('#stllib-grid .dcb-gross')];
  return { n: knoepfe.length, text: knoepfe[0] && knoepfe[0].textContent, breite: knoepfe[0] && knoepfe[0].getBoundingClientRect().width, pro: !!(knoepfe[0] && knoepfe[0].querySelector('.pro-tag')) };
});
ok('nur an 3MF: großer Knopf „Druck prüfen & verbessern“ mit ⭐ PRO', k.n === 1 && /Druck prüfen & verbessern/.test(k.text) && k.pro && k.breite > 150, k);
await pg.screenshot({ path: '/tmp/bibliothek_pro.png' });
ok('Sperre in der Beta aus: Prüfen erlaubt', await pg.evaluate(() => _proFrei('druckcheck') === true && V3D_PRO.sperreAn === false));
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
