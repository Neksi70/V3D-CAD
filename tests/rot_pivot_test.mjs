// Test: Drehringe drehen um die Objektmitte, auch wenn die Geometrie
// weit neben dem Objekt-Ursprung liegt (wie bei STL-Importen).
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

// Würfel anlegen, Geometrie künstlich 40 Units versetzen (Import-Situation)
const before = await pg.evaluate(() => {
  addShape('cube');
  const o = getFirst();
  o.geometry.translate(4, 0, 4);          // Ursprung liegt jetzt NEBEN dem Körper
  o.geometry.computeBoundingBox?.();
  o.updateMatrixWorld(true);
  const bb = getMeshBox(o);
  const c = bb.getCenter(new THREE.Vector3());
  setMode('rotate');
  updateRotHandles();
  return { cx: c.x, cy: c.y, cz: c.z, px: o.position.x, pz: o.position.z };
});

// Y-Ring-Drag simulieren: Start am Handle, 90° um die Mitte ziehen
const after = await pg.evaluate(() => new Promise(res => {
  const o = getFirst();
  const vr = vpEl.getBoundingClientRect();
  // Drag direkt über die internen Funktionen (Pointer-Events synthetisch)
  const mk = (x, y) => ({ clientX: vr.left + x, clientY: vr.top + y,
    preventDefault(){}, stopPropagation(){} });
  const sc = _rhPrj(rh_c3?.x ?? 0, rh_c3?.y ?? 0, rh_c3?.z ?? 0) || { x: 700, y: 450 };
  _rhStartDrag('y', mk(sc.x + 200, sc.y));
  _rhMove(mk(sc.x, sc.y + 200));          // ~90° weiter
  _rhUp();
  o.updateMatrixWorld(true);
  const bb = getMeshBox(o);
  const c = bb.getCenter(new THREE.Vector3());
  res({ cx: c.x, cy: c.y, cz: c.z, rotY: o.rotation.y, minY: bb.min.y });
}));

ok('Drehung ist angekommen (rot.y ≠ 0)', Math.abs(after.rotY) > 0.3, after.rotY);
ok('Mitte X bleibt stehen', Math.abs(after.cx - before.cx) < 0.01, [before.cx, after.cx]);
ok('Mitte Z bleibt stehen', Math.abs(after.cz - before.cz) < 0.01, [before.cz, after.cz]);
ok('Unterseite bleibt am Boden', Math.abs(after.minY) < 0.01, after.minY);

// Gleicher Test um X-Achse (kippt — Mitte darf horizontal nicht wandern)
const afterX = await pg.evaluate(() => new Promise(res => {
  const o = getFirst();
  const vr = vpEl.getBoundingClientRect();
  const mk = (x, y) => ({ clientX: vr.left + x, clientY: vr.top + y,
    preventDefault(){}, stopPropagation(){} });
  updateRotHandles();
  const sc = _rhPrj(rh_c3.x, rh_c3.y, rh_c3.z) || { x: 700, y: 450 };
  _rhStartDrag('x', mk(sc.x + 200, sc.y));
  _rhMove(mk(sc.x + 140, sc.y + 140));    // ~45°
  _rhUp();
  o.updateMatrixWorld(true);
  const bb = getMeshBox(o);
  const c = bb.getCenter(new THREE.Vector3());
  res({ cx: c.x, cz: c.z, minY: bb.min.y, rotX: o.rotation.x });
}));
ok('X-Kippen: Mitte X bleibt stehen', Math.abs(afterX.cx - before.cx) < 0.01, [before.cx, afterX.cx]);
ok('X-Kippen: Mitte Z bleibt stehen', Math.abs(afterX.cz - before.cz) < 0.01, [before.cz, afterX.cz]);
ok('X-Kippen: Unterseite am Boden', Math.abs(afterX.minY) < 0.01, afterX.minY);
ok('Keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
if (fails.length) { console.log('\nFEHLGESCHLAGEN:', fails.join(', ')); process.exit(1); }
console.log('\nAlle Prüfungen bestanden.');
