// Volker 21.10.: neue Projekte hießen „Zesty Hopper" o. ä. Jetzt „Neues Projekt", „Neues Projekt 2" …
// und beim neuen Tab (＋) / Neu wird gleich nach dem Namen gefragt. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let antworten = [], fragen = [];
pg.on('dialog', d => { fragen.push(d.message()); const a = antworten.shift(); a === null ? d.dismiss() : d.accept(a); });
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
let fehler = 0;
const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
const name = () => pg.evaluate(() => ({ meta: dsGetMeta(currentDesignId)?.name, tab: document.querySelector('.dtab-act .dtab-nm')?.textContent }));
await pg.evaluate(() => { hideStarter(); localStorage.setItem('volme3d_designs', '[]'); localStorage.removeItem('volme3d_tabs'); });

// 1) Tab ＋, Vorschlag mit Enter übernommen
antworten = [undefined]; fragen = [];
await pg.evaluate(() => _tabNew()); await pg.waitForTimeout(300);
let n = await name();
ok('Namensabfrage kommt beim neuen Tab', fragen.length === 1 && /heißen/.test(fragen[0]), fragen);
ok('Vorschlag = Neues Projekt', n.meta === 'Neues Projekt' && n.tab === 'Neues Projekt', n);
// 2) zweiter Tab, abgebrochen → Vorschlag bleibt
antworten = [null];
await pg.evaluate(() => { addShape('box'); _tabNew(); }); await pg.waitForTimeout(300);
n = await name(); ok('2. Tab heißt Neues Projekt 2', n.meta === 'Neues Projekt 2' && n.tab === 'Neues Projekt 2', n);
// 3) dritter Tab mit eigenem Namen
antworten = ['Schlüsselanhänger'];
await pg.evaluate(() => _tabNew()); await pg.waitForTimeout(300);
n = await name(); ok('eigener Name wird übernommen', n.meta === 'Schlüsselanhänger' && n.tab === 'Schlüsselanhänger', n);
ok('Export heißt danach so', (await pg.evaluate(() => _designFilename('stl'))) === 'Schlüsselanhänger.stl', await pg.evaluate(() => _designFilename('stl')));
// 4) nächster freier: 3
antworten = [undefined];
await pg.evaluate(() => _tabNew()); await pg.waitForTimeout(300);
n = await name(); ok('nächster freier = Neues Projekt 3', n.meta === 'Neues Projekt 3', n);
// 5) Agent-API / letzter Tab zu: keine Abfrage
fragen = [];
await pg.evaluate(() => _newCreate(false)); await pg.waitForTimeout(200);
ok('ohne ask keine Abfrage', fragen.length === 0, fragen);
// 6) kein Fantasiename mehr irgendwo
const alle = await pg.evaluate(() => _dsIdx().map(d => d.name));
ok('alle Namen sind Neues Projekt … oder eigener Name', alle.every(x => /^Neues Projekt( \d+)?$|^Schlüsselanhänger$/.test(x)), alle);
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
