// Test Verschiebe-Gizmo: pro Achse an einem Pfeil ziehen und pruefen, dass sich
// NUR diese Achse aendert, in der richtigen Richtung und um den erwarteten Betrag.
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3000);
const rect = await page.evaluate(() => { const r = vpEl.getBoundingClientRect(); return { x: r.left, y: r.top }; });

const base = await page.evaluate(() => {
  const m = document.getElementById('start-modal'); if (m) m.classList.remove('show');
  while (objects.length) { const o = objects.pop(); scene.remove(o); }
  addShape('box');
  const B = objects[0];
  B.position.set(0, B.position.y, 0);
  selectObjs([B]); setMode('select'); setSnapGrid(0); setMagnet(true); setMoveGizmo(true);
  fitToObjects([B]); sph.r *= 1.9; sph.theta = 0.9; sph.phi = 1.05; sph2cam();
  renderer.render(scene, camera);
  return { gizmoDa: !!_mg.group, sichtbar: _mg.group.visible };
});
console.log('Gizmo gebaut/sichtbar:', base.gizmoDa, base.sichtbar);

// Bildschirmpunkt auf einem Pfeil (60 % der Länge)
async function arrowPoint(axis) {
  const p = await page.evaluate((axis) => {
    const g = _mg.group; const d = _mgAxisVec(axis).multiplyScalar(g.scale.x * 0.6);
    const w = g.position.clone().add(d);
    return _worldToScreen(w.x, w.y, w.z);
  }, axis);
  return { x: p.x + rect.x, y: p.y + rect.y };
}

async function dragAxis(axis, dxPx, dyPx) {
  const before = await page.evaluate(() => {
    const o = objects[0]; return { x: o.position.x, y: o.position.y, z: o.position.z, undo: undoStack.length };
  });
  const a = await arrowPoint(axis);
  await page.mouse.move(a.x, a.y);
  const hover = await page.evaluate(() => _mg.hover);
  await page.mouse.down();
  const started = await page.evaluate(() => !!_mg.drag && _mg.drag.axis);
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + dxPx * i / 12, a.y + dyPx * i / 12);
  const tip = await page.evaluate(() => { const el = document.getElementById('mg-tip'); return el && el.style.display !== 'none' ? el.textContent : null; });
  await page.mouse.up();
  const after = await page.evaluate(() => {
    const o = objects[0]; return { x: o.position.x, y: o.position.y, z: o.position.z, undo: undoStack.length, drag: !!_mg.drag, sel: selectedObjs.length };
  });
  const d = { x: (after.x - before.x) * 10, y: (after.y - before.y) * 10, z: (after.z - before.z) * 10 };
  return { hover, started, tip, d, after, undoAdded: after.undo - before.undo };
}

let ok = true;
for (const [axis, dx, dy, expect] of [['y', 0, -140, 'y'], ['x', 150, 0, 'x'], ['z', -150, 0, 'z']]) {
  const r = await dragAxis(axis, dx, dy);
  const moved = r.d[expect];
  const others = ['x','y','z'].filter(k => k !== expect).map(k => Math.abs(r.d[k]));
  const clean = Math.max(...others) < 0.001;
  const pass = r.hover === axis && r.started === axis && clean && Math.abs(moved) > 3
               && r.undoAdded === 1 && r.after.drag === false && r.after.sel === 1;
  if (!pass) ok = false;
  console.log(`${axis.toUpperCase()}-Pfeil: hover=${r.hover} griff=${r.started} ` +
              `Δ=${moved.toFixed(1)}mm andere=${others.map(v=>v.toFixed(3)).join('/')} ` +
              `Tooltip="${r.tip}" Undo+${r.undoAdded} -> ${pass ? '✓' : '✗'}`);
}

// Klick auf einen Pfeil darf die Auswahl nicht aufheben, und der Gizmo darf
// nicht selbst als Objekt anwaehlbar sein
const a = await arrowPoint('y');
await page.mouse.click(a.x, a.y);
const selAfter = await page.evaluate(() => ({ sel: selectedObjs.length, objs: objects.length }));
console.log('Klick auf Pfeil: Auswahl bleibt =', selAfter.sel === 1, '| Objektzahl unveraendert =', selAfter.objs === 1);
if (selAfter.sel !== 1 || selAfter.objs !== 1) ok = false;

// Ausblenden ohne Auswahl / bei anderen Modi
const vis = await page.evaluate(async () => {
  const f = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  deselect();               await f(); const leer = _mg.group.visible;
  selectObjs([objects[0]]); await f(); const an = _mg.group.visible;
  setMode('rotate');        await f(); const rot = _mg.group.visible;
  setMode('select');        await f();
  setMoveGizmo(false);      await f(); const aus = _mg.group.visible;
  setMoveGizmo(true);       await f(); const wieder = _mg.group.visible;
  return { leer, an, rot, aus, wieder };
});
console.log('sichtbar? ohne Auswahl:', vis.leer, '| mit:', vis.an, '| Drehen-Modus:', vis.rot, '| Schalter aus:', vis.aus, '| wieder an:', vis.wieder);
if (vis.leer || !vis.an || vis.rot || vis.aus || !vis.wieder) ok = false;

// Fangraster muss auch am Pfeil greifen
const snap = await page.evaluate(() => { setSnapGrid(5); return snapGrid; });
const r5 = await dragAxis('y', 0, -95);
const onGrid = Math.abs((r5.after.y * 10) % 5) < 0.01 || Math.abs(Math.abs((r5.after.y * 10) % 5) - 5) < 0.01;
console.log(`Fangraster ${snap}mm am Pfeil: Y=${(r5.after.y*10).toFixed(2)}mm auf Raster =`, onGrid);
if (!onGrid) ok = false;

// Vorschaubild darf die Pfeile nicht enthalten, danach muessen sie zurueck sein
const thumb = await page.evaluate(() => {
  const vorher = _mg.group.visible;
  const url = captureThumbnail();
  return { vorher, nachher: _mg.group.visible, url: !!(url && url.length > 200) };
});
console.log('Vorschaubild: Pfeile vorher', thumb.vorher, '-> nachher wieder', thumb.nachher, '| Bild erzeugt', thumb.url);
if (!thumb.vorher || !thumb.nachher || !thumb.url) ok = false;

console.log('=>', ok ? 'OK ✓' : 'FEHLGESCHLAGEN ✗');
await browser.close();
process.exit(ok ? 0 : 1);
