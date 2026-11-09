// Volker 9.11.2026 (zwei Videos): „Bisher“ im Spielraum zeigte beim Öffnen einen alten
// Wert (−0,4 bzw. +0,4); nach dem ersten Anwenden von −0,2 stand −0,2 da → sah aus wie
// falsch gerechnet. Ursache: _offsetSumMm wurde nicht gespeichert (Rückgängig/Laden
// setzte sie auf 0) und die Anzeige folgte weder Auswahl noch Rückgängig.
// Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 60000 });
const bisher = async () => { await pg.waitForTimeout(450); return (await pg.locator('#offset-sum').textContent()) + ' ' + (await pg.locator('#offset-wer').textContent()); };
const breite = i => pg.evaluate(i => { const bb = new THREE.Box3().setFromObject(objects[i]); return +((bb.max.x - bb.min.x) * 10).toFixed(2); }, i);
await pg.evaluate(() => { localStorage.setItem('v3d_umsteiger_hinweis', '1'); hideStarter(); setShapeMode('solid');
  addShape('box'); objects[0].userData.name = 'Teil A'; addShape('box'); objects[1].userData.name = 'Teil B'; objects[1].position.x += 5; selectObjs([objects[0]]); });
const r = {};
await pg.locator('button:has-text("Spielraum")').first().click();
await pg.locator('#offset-panel .off-wahl[data-v="0.2"]').click();
await pg.locator('#offset-go').click(); await pg.locator('#offset-go').click();
r.zweimal = await bisher(); r.breiteA = await breite(0);
// andere Aktion + Rückgängig: Summe muss bleiben (vorher 0)
await pg.evaluate(() => { saveUndo(); objects[0].position.z += 1; undo(); });
await pg.waitForTimeout(400);
await pg.evaluate(() => selectObjs([objects.find(o => o.userData.name === 'Teil A')]));
r.nachUndoAnders = await bisher();
// Rückgängig des letzten Spielraums: +0,2
await pg.evaluate(() => { undo(); }); await pg.waitForTimeout(400);
await pg.evaluate(() => selectObjs([objects.find(o => o.userData.name === 'Teil A')]));
r.nachUndoSpr = await bisher();
// anderer Körper / keiner
await pg.evaluate(() => selectObjs([objects.find(o => o.userData.name === 'Teil B')])); r.teilB = await bisher();
await pg.evaluate(() => selectObjs([])); r.keiner = await bisher();
// Speichern/Laden
r.geladen = await pg.evaluate(() => { const a = objects.find(o => o.userData.name === 'Teil A'); const d = JSON.parse(JSON.stringify(objectToData(a))); const l = buildObjectFromData(d); return l.userData._offsetSumMm; });
// erstes Anwenden nach dem Öffnen zählt vom richtigen Wert weiter (wie im Video)
await pg.evaluate(() => selectObjs([objects.find(o => o.userData.name === 'Teil A')]));
await pg.locator('#offset-panel .off-wahl[data-v="-0.2"]').click(); await pg.locator('#offset-go').click();
r.weiter = await bisher();
console.log(JSON.stringify(r));
const checks = [
  ['zweimal +0,2 → +0,4 (Teil A)', r.zweimal === '+0,4 mm (Teil A)' && Math.abs(r.breiteA - 20.8) < 0.01],
  ['andere Aktion rückgängig: Summe bleibt +0,4', r.nachUndoAnders.startsWith('+0,4 mm')],
  ['Spielraum rückgängig: +0,2', r.nachUndoSpr.startsWith('+0,2 mm')],
  ['anderer Körper: dessen Wert', r.teilB === '0 mm (Teil B)'],
  ['kein Körper: Strich + Hinweis', r.keiner === '– kein Körper gewählt'],
  ['Summe übersteht Speichern/Laden', r.geladen === 0.2],
  ['erstes Anwenden zählt richtig weiter (+0,2 − 0,2 = 0)', r.weiter.startsWith('0 mm')],
  ['keine Seitenfehler', errs.length === 0],
];
let ok = true; for (const [n, v] of checks) { console.log((v ? '✔ ' : '✘ ') + n); ok = ok && v; }
if (errs.length) console.log(errs);
await b.close(); process.exit(ok ? 0 : 1);
