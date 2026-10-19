// Sebastian 19.10.: im Textur-Fenster blieb „Quer“ markiert, egal wie oft er „Längs“ klickte
// (_syncTexPanel zog Richtung und Eingeprägt/Aufgesetzt nicht nach). Braucht `npm run dev` (8766).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1366, height: 640 } })).newPage();
const errs=[]; pg.on('pageerror', e => errs.push(e.message));
await pg.goto('http://localhost:8766/volme3d.html');
await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
await pg.evaluate(() => { hideStarter(); _newCreate(false); setShapeMode('solid'); addShape('box'); const o = objects[0]; selectObjs([o]); numChanged('sw', 80); numChanged('sd', 40); numChanged('sh', 10); });
await pg.evaluate(() => toggleTexPanel()); await pg.waitForTimeout(300);
await pg.locator('#tex-body .fp-tex-thumb').nth(2).click(); await pg.waitForTimeout(800);
const st = () => pg.evaluate(() => { const bs = [...document.querySelectorAll('#tex-body .fp-toggle-btn')].filter(b => /^(Längs|Quer|Kantig|Rund|Eingeprägt|Aufgesetzt)$/.test(b.textContent)).map(b => b.textContent + (b.classList.contains('on') ? '*' : ''));
  const o = objects[0]; return { knoepfe: bs.join(' '), texOrient: o.userData.texOrient, prof: o.userData.texProfile, dir: o.userData.texDir, pat: o.userData.displacementPattern }; });
console.log('Start', JSON.stringify(await st())); const erg = [];
for (const t of ['Quer', 'Längs', 'Quer', 'Rund', 'Kantig', 'Aufgesetzt', 'Eingeprägt']) { const l = pg.locator('#tex-body .fp-toggle-btn', { hasText: new RegExp('^' + t + '$') }); await l.scrollIntoViewIfNeeded(); await l.click(); await pg.waitForTimeout(600); const z = await st(); erg.push([t, z]); console.log(t, JSON.stringify(z)); }
let fehler = 0;
for (const [t, ist] of erg) { const an = ist.knoepfe.split(' ').filter(k => k.endsWith('*')).map(k => k.slice(0, -1)); if (!an.includes(t)) { fehler++; console.log('FEHLER:', t, 'geklickt, markiert:', an.join(',')); } }
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
