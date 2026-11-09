// Export-Knöpfe präsent + Menü mit Erklärungen (Volker 9.11.: „Speicherbuttons in der Ecke viel zu klein“, ▾ verwirrt)
// Start: python3 volme3d_server.py 8888 --dev  →  node tests/export_menue_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8888/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => { localStorage.setItem('v3d_umsteiger_hinweis', '1'); localStorage.setItem('volme3d_hide_start', '1'); localStorage.setItem('v3d_beta_hinweis', String(Date.now())); });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP); await pg.waitForFunction(() => typeof toggleStlMenu === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('auth-overlay')?.classList.add('hidden'); _newCreate(false); addShape('box'); });
const k = await pg.evaluate(() => { const a = document.querySelector('#stl-wrap .main-stl').getBoundingClientRect(), s = document.querySelector('#stl-wrap .spl');
  return { a: [Math.round(a.width), Math.round(a.height)], s: [Math.round(s.getBoundingClientRect().width)], text: s.textContent.trim(), haupt: document.querySelector('#stl-wrap .main-stl').textContent.trim() }; });
ok('Knöpfe mit Schrift: „⬇ STL“ + „📦 Speichern & Drucken“', k.haupt === '⬇ STL' && /Speichern & Drucken/.test(k.text) && k.s[0] > 120, k);
await pg.click('#stl-wrap .spl');
const m = await pg.evaluate(() => ({ sicht: document.getElementById('stl-menu').classList.contains('show'),
  sek: [...document.querySelectorAll('#stl-menu .stl-sec')].map(e => e.textContent), erkl: document.querySelectorAll('#stl-menu .sli-erkl .si-d').length,
  breite: Math.round(document.getElementById('stl-menu').getBoundingClientRect().width), rechts: Math.round(document.getElementById('stl-menu').getBoundingClientRect().right) }));
ok('Menü offen, 3 Abschnitte, Erklärungen', m.sicht && m.sek.join('|') === 'Herunterladen|Drucken|Bild & Fertigung' && m.erkl >= 12, m);
ok('Menü passt ins Fenster', m.rechts <= 1400, m.rechts);
await pg.screenshot({ path: '/tmp/export_menue.png' });
// 3MF-Eintrag löst den 3MF-Weg aus
const r = await pg.evaluate(() => { let n = 0; const o = window._3mfSpeichern; window._3mfSpeichern = () => { n++; }; [...document.querySelectorAll('#stl-menu .sli-erkl')].find(e => /3MF/.test(e.textContent)).click(); window._3mfSpeichern = o; return n; });
ok('Eintrag „3MF (mit Farben)“ ruft _3mfSpeichern', r === 1, r);
// Symbol-Modus: Export bleibt mit Schrift
const sym = await pg.evaluate(() => { _symToggle(true); const t = [document.querySelector('#stl-wrap .main-stl').textContent.trim(), document.querySelector('#stl-wrap .spl').textContent.trim()]; _symToggle(false); return t; });
ok('Symbol-Modus: Export-Knöpfe behalten Schrift', sym[0] === '⬇ STL' && /Speichern/.test(sym[1]), sym);
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
