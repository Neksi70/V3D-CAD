// Oswald 14.11.2026: Beim Verschieben stand „X · Breite“ – klingt nach Größenänderung. Und:
// Rechtsklick auf den Pfeil → Feld, in das man die Strecke eintippt (−2,5 → steht auf 10).
// Prüft mit echter Maus: Hinweis über dem Pfeil (nur „X“, Mitte), Rechtsklick öffnet Feld
// (kein Kontextmenü), „um“ relativ, „auf“ absolut, Y = Tiefe nach hinten, Rückgängig.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 60000 });
await pg.evaluate(() => { localStorage.setItem('v3d_umsteiger_hinweis', '1'); hideStarter(); addShape('box'); const o = objects[0]; o.position.x = 1.25; o.updateMatrixWorld(true); selectObjs([o]); setView('iso'); });
await pg.waitForTimeout(800);
const pfeil = ax => pg.evaluate(ax => { _mgUpdate(); let p = null;
  _mg.group.traverse(o => { if (o.isMesh && o.userData._mgAxis === ax && o.geometry.parameters && o.geometry.parameters.radiusTop === 0.11) { o.updateMatrixWorld(true); p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); } });
  const v = p.clone().project(camera), r = canvas.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }, ax);
const lage = () => pg.evaluate(() => { const o = objects[0]; return { x: +(o.position.x * 10).toFixed(2), y: +(o.position.y * 10).toFixed(2), z: +(o.position.z * 10).toFixed(2) }; });
const r = {};
let p = await pfeil('x');
await pg.mouse.move(p.x - 5, p.y - 5); await pg.mouse.move(p.x, p.y); await pg.waitForTimeout(200);
r.hover = await pg.evaluate(() => { const t = document.getElementById('mg-tip'); return t && t.style.display !== 'none' ? t.textContent : null; });
await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(300);
r.feld = await pg.evaluate(() => !!document.getElementById('mg-genau'));
r.ctx = await pg.evaluate(() => !!(window._vpCtx && _vpCtx.classList.contains('show')));
r.vor = await lage();
await pg.keyboard.type('-2,5'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
r.nachUm = await lage(); r.feldZu = await pg.evaluate(() => !document.getElementById('mg-genau'));
// „auf“: Mitte X auf 30 mm
p = await pfeil('x'); await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(200);
await pg.fill('#mg-genau-auf', '30'); await pg.press('#mg-genau-auf', 'Enter'); await pg.waitForTimeout(200);
r.nachAuf = await lage();
// Y = Tiefe: +10 → nach hinten (Szene −z)
p = await pfeil('z'); await pg.mouse.move(p.x, p.y); await pg.waitForTimeout(150);
r.hoverY = await pg.evaluate(() => { const t = document.getElementById('mg-tip'); return t ? t.textContent : null; });
await pg.mouse.click(p.x, p.y, { button: 'right' }); await pg.waitForTimeout(200);
await pg.keyboard.type('10'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
r.nachY = await lage();
// Rückgängig: Y-Schritt zurück
await pg.evaluate(() => undo()); await pg.waitForTimeout(400);
r.undo = await pg.evaluate(() => +(objects[0].position.z * 10).toFixed(2));
await pg.evaluate(() => selectObjs([objects[0]])); await pg.waitForTimeout(300);
// Ziehen: Hinweis ohne „Breite“
p = await pfeil('x'); await pg.mouse.move(p.x, p.y); await pg.mouse.down(); await pg.mouse.move(p.x + 40, p.y + 5, { steps: 5 });
r.zieh = await pg.evaluate(() => document.getElementById('mg-tip').textContent); await pg.mouse.up();
console.log(JSON.stringify(r, null, 1));
const checks = [
  ['Hinweis über dem Pfeil: X und Mitte, ohne „Breite“', /Mitte bei X = 12,5 mm/.test(r.hover || '') && !/Breite/.test(r.hover)],
  ['Rechtsklick öffnet das Feld, kein Kontextmenü', r.feld && !r.ctx],
  ['„um −2,5“ → X 12,5 → 10', r.vor.x === 12.5 && r.nachUm.x === 10 && r.feldZu],
  ['„auf 30“ → Mitte X = 30', r.nachAuf.x === 30],
  ['Y heißt Y, +10 → 10 mm nach hinten', /Mitte bei Y =/.test(r.hoverY || '') && r.nachY.z === r.nachAuf.z - 10 && r.nachY.y === r.nachAuf.y],
  ['Rückgängig', r.undo === r.nachAuf.z],
  ['Ziehen: „X +… mm · Mitte bei“, ohne „Breite“', /^X [+−]/.test(r.zieh) && /Mitte bei X/.test(r.zieh) && !/Breite/.test(r.zieh)],
  ['keine Seitenfehler', errs.length === 0],
];
let ok = true; for (const [n, v] of checks) { console.log((v ? '✔ ' : '✘ ') + n); ok = ok && v; }
if (errs.length) console.log(errs);
await b.close(); process.exit(ok ? 0 : 1);
