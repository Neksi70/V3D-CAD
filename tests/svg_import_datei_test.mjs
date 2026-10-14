// SVG-Import unter „Datei" (Burkhard 14.10.26) + Generator-Testhinweis aus
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
const PORT = 8951;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const SVG = '/tmp/_v3d_test_stern.svg';
writeFileSync(SVG, '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40"><path d="M20 2 L25 15 L38 15 L27 23 L31 37 L20 28 L9 37 L13 23 L2 15 L15 15 Z"/></svg>');
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fails = 0; const ok = (n, c, x) => { console.log((c ? '  OK  ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails++; };
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function', { timeout: 60000 });
  await pg.evaluate(() => { localStorage.removeItem('v3d_hinweis_genseite'); hideStarter(); });
  const menu = await pg.evaluate(() => [...document.querySelectorAll('#burger-menu .sli-item')].map(e => e.textContent.trim()));
  ok('☰ Menü: „SVG importieren" unter Datei', menu.includes('⬆ SVG importieren') && menu.indexOf('⬆ SVG importieren') < menu.indexOf('💾 Speichern'), menu.slice(0, 6));
  ok('Leiste Datei-Gruppe hat SVG-Knopf', await pg.evaluate(() => !!document.querySelector('.tbg[data-g="datei"] button[onclick="_svgImportOpen()"]')));
  for (const [name, how] of [['Menü/Leiste', 'svg'], ['normaler Import', 'imp']]) {
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.evaluate(h => h === 'svg' ? _svgImportOpen() : doImport(), how)]);
    await fc.setFiles(SVG);
    await pg.waitForTimeout(600);
    const shown = await pg.evaluate(() => { const m = document.getElementById('svg-modal') || document.querySelector('.modal.show #svg-preview')?.closest('.modal'); return !!(_svgParsedData && _svgParsedData.fileName) && !!document.querySelector('#svg-preview iframe'); });
    ok(name + ' → SVG-Dialog mit Vorschau', shown);
    await pg.evaluate(() => { _closeSvgModal(); _svgParsedData = null; });
  }
  await pg.waitForTimeout(3500);
  ok('keine Generator-Testkarte mehr', await pg.evaluate(() => !document.getElementById('gp-testkarte') && !document.querySelector('.gp-testhinweis')));
  ok('Generator-Menü rechts bleibt', await pg.evaluate(() => !!document.getElementById('gen-dd-btn')));
  ok('keine Seitenfehler', errs.length === 0, errs);
} catch (e) { console.log('ABBRUCH', e); fails++; } finally { await b.close(); srv.kill(); }
console.log(fails ? `\n${fails} FEHLER` : '\nalles OK'); process.exit(fails ? 1 : 0);
