// Regressionstest feiner Verlauf (_uh*): Beschriftung je Schritt aus Schnappschuss-Vergleich,
// Vorschaubild je Schritt, Hover über ↩ zeigt Ziel, ▾-Liste springt mehrere Schritte (Wiederholen bleibt),
// Erfolgsmeldung als Zusatz, Strg+Z wie bisher, Symbol-Modus unbeschädigt.
// Start: python3 volme3d_server.py 8876 --dev  →  node tests/verlauf_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8876/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _uhSprung === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); localStorage.setItem('v3d_umsteiger_hinweis', '1'); document.getElementById('umsteiger-hinweis')?.remove(); });

const r = await pg.evaluate(() => {
  _newCreate(false);
  addShape('box'); const box = objects[0];
  saveUndo(); box.position.x += 2; box.updateMatrixWorld(true);
  addShape('cylinder'); const zyl = objects[1];
  saveUndo(); zyl.userData.color = '#ff0000'; notify('Farbe übernommen', 'ok');
  selectObjs([zyl]); deleteSelected();
  const labels = []; for (let i = 0; i < undoStack.length; i++) { const L = _uhLabelAt('undo', i); labels.push(L.icon + ' ' + L.text + (L.hint ? ' | ' + L.hint : '')); }
  const thumbs = undoStack.map(s => !!(s._meta && /^data:image\/jpeg/.test(s._meta.thumb || '')));
  return { labels, thumbs, n: undoStack.length, boxName: box.userData.name, zylName: zyl.userData.name };
});
console.log('       Schritte:', r.labels);
ok('5 Schritte im Verlauf', r.n === 5, r.n);
ok('oberster: Zylinder gelöscht', /gelöscht/.test(r.labels[0]) && r.labels[0].includes(r.zylName), r.labels[0]);
ok('dann: Farbe geändert + Meldung als Zusatz', /Farbe geändert/.test(r.labels[1]) && /Farbe übernommen/.test(r.labels[1]), r.labels[1]);
ok('dann: Zylinder hinzugefügt', /hinzugefügt/.test(r.labels[2]) && r.labels[2].includes(r.zylName), r.labels[2]);
ok('dann: Box verschoben', /verschoben/.test(r.labels[3]) && r.labels[3].includes(r.boxName), r.labels[3]);
ok('unterster: Box hinzugefügt', /hinzugefügt/.test(r.labels[4]) && r.labels[4].includes(r.boxName), r.labels[4]);
ok('jeder Schritt hat ein Vorschaubild', r.thumbs.every(Boolean), r.thumbs);

// Hover über ↩ (echte Maus)
await pg.hover('#btn-undo'); await pg.waitForSelector('#uh-tip.show', { timeout: 3000 });
const tip = await pg.evaluate(() => ({ txt: document.getElementById('uh-tip').innerText, img: !!document.querySelector('#uh-tip img') }));
ok('Hover zeigt Ziel + Bild', /gelöscht/.test(tip.txt) && tip.img, tip.txt.replace(/\n/g, ' / '));
await pg.mouse.move(700, 600);

// ▾-Liste, Hover auf 4. Schritt zeigt großes Bild, Klick springt 4 Schritte
await pg.click('#btn-undo-list'); await pg.waitForSelector('#uh-liste');
const zeilen = await pg.$$eval('#uh-liste .uh-z.undo', z => z.length);
ok('Liste zeigt 5 Rückgängig-Zeilen', zeilen === 5, zeilen);
await pg.hover('#uh-liste .uh-z.undo[data-n="4"]');
const gross = await pg.evaluate(() => ({ sichtbar: document.getElementById('uh-gross-img').style.display !== 'none', txt: document.getElementById('uh-gross-txt').textContent }));
ok('Hover in der Liste: großes Bild', gross.sichtbar && /4 Schritte zurück/.test(gross.txt), gross);
await pg.screenshot({ path: '/tmp/verlauf_liste.png' });
await pg.click('#uh-liste .uh-z.undo[data-n="4"]');
const s1 = await pg.evaluate(() => ({ n: objects.length, x: +objects[0]?.position.x.toFixed(3), undo: undoStack.length, redo: redoStack.length,
  redoLabels: [0, 1, 2, 3].map(i => _uhLabelAt('redo', i)?.text), liste: !!document.getElementById('uh-liste'), redoZeilen: document.querySelectorAll('#uh-liste .uh-z.redo').length }));
ok('4 Schritte zurück: nur Box, unverschoben', s1.n === 1 && s1.x === 0 && s1.undo === 1 && s1.redo === 4, s1);
ok('Wiederholen-Schritte richtig beschriftet', /verschoben/.test(s1.redoLabels[0]) && /hinzugefügt/.test(s1.redoLabels[1]) && /Farbe/.test(s1.redoLabels[2]) && /gelöscht/.test(s1.redoLabels[3]), s1.redoLabels);
ok('Liste bleibt offen und zeigt 4 Wiederholen-Zeilen', s1.liste && s1.redoZeilen === 4, s1.redoZeilen);
// 3 vor per Liste
await pg.click('#uh-liste .uh-z.redo[data-n="3"]');
const s2 = await pg.evaluate(() => ({ n: objects.length, x: +objects[0].position.x.toFixed(3), farbe: objects[1]?.userData.color, redo: redoStack.length, undo: undoStack.length, next: _uhLabelAt('redo', 0)?.text }));
ok('3 Schritte vor: Box verschoben, roter Zylinder', s2.n === 2 && s2.x === 0.2 * 10 / 10 * 1 + 0 || (s2.n === 2 && s2.x > 0 && s2.farbe === '#ff0000'), s2);
ok('nächstes Wiederholen = gelöscht', /gelöscht/.test(s2.next) && s2.redo === 1 && s2.undo === 4, s2);
await pg.keyboard.press('Escape');
ok('Esc schließt die Liste', await pg.evaluate(() => !document.getElementById('uh-liste')));
// Strg+Z wie bisher
await pg.evaluate(() => document.activeElement && document.activeElement.blur());
const fokus = await pg.evaluate(() => document.activeElement?.tagName);
await pg.keyboard.press('Control+z');
const s3 = await pg.evaluate(() => ({ undo: undoStack.length, redo: redoStack.length, n: objects.length }));
ok('Strg+Z: ein Schritt zurück', s3.undo === 3 && s3.redo === 2 && s3.n === 2, { ...s3, fokus });
// neue Aktion löscht Wiederholen
await pg.evaluate(() => { addShape('sphere'); });
ok('neue Aktion leert Wiederholen', await pg.evaluate(() => redoStack.length === 0));
// Symbol-Modus: ↩/↪ werden weiter zu Symbolen, ▾ bleibt
const sym = await pg.evaluate(() => { _symToggle(true); const r = { undo: !!document.querySelector('#btn-undo svg'), redo: !!document.querySelector('#btn-redo svg'), liste: document.getElementById('btn-undo-list').textContent.trim() }; _symToggle(false); return r; });
ok('Symbol-Modus unbeschädigt', sym.undo && sym.redo && sym.liste === '▾', sym);
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
