// Test: Die Maß-Anfasser (weiße Ecken, schwarze Kanten) ändern nur die GRÖSSE —
// sie dürfen das Teil nicht verschieben oder kippen. Ralf 26.9.26: „Die Richtungen
// beim Ziehen stimmen nicht überein. Teil wird manchmal nicht größer oder kleiner,
// sondern wird verschoben oder gekippt."
// Fälle, die am zentrierten Würfel in Standardlage unsichtbar sind:
//   versetzt  — Geometrie-Ursprung neben dem Körper (Schnittteil, Import)
//   gedreht   — um die Hochachse gedreht
//   gekippt   — 22,5° gekippt (⤵ Kippen)
//   import    — Z-up-Import (rotation.x = −90°), Scheibe wie in Ralfs Video
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
  _mgOn = false;   // Verschiebe-Pfeile aus: hier geht es um die Anfasser selbst
});

await pg.evaluate(() => {
  const FALL = {
    versetzt: o => { o.geometry.translate(4, 1, -3); },          // Ursprung neben dem Körper
    gedreht:  o => { o.rotation.set(0, Math.PI / 6, 0); },
    gekippt:  o => { o.rotation.set(Math.PI / 8, 0, 0); },
    import:   o => { o.geometry.scale(2.8, 1.1, 2.8); o.geometry.translate(0, 1.1, 0);
                     o.geometry.rotateX(Math.PI / 2); o.rotation.set(-Math.PI / 2, 0, 0); },
  };
  window._hdSetup = (fall) => {
    _newCreate(false);
    addShape('cube');
    const o = getFirst();
    o.scale.set(1, 1, 1); o.rotation.set(0, 0, 0); o.position.set(0, 0, 0);
    FALL[fall](o);
    o.updateMatrixWorld(true);
    const bb = getMeshBox(o);
    o.position.x += 1 - (bb.min.x + bb.max.x) / 2;
    o.position.z += -1 - (bb.min.z + bb.max.z) / 2;
    o.position.y -= bb.min.y;                                    // auf der Platte
    o.updateMatrixWorld(true);
    selectedObjs = [o];
    updateDimHandles();
  };
  window._hdDrag = (key, px) => {
    const o = getFirst();
    const item = _dimHandleData.find(d => d.key === key);
    // Auch Griffe auf der Rückseite anfassen (per Ereignis) — die Rechnung ist
    // dieselbe, und so deckt ein Kamerablick alle Ecken/Kanten ab.
    if (!item) return { skip: 'kein Griff' };
    camera.updateMatrixWorld(true);
    const vr = vpEl.getBoundingClientRect(), cR = canvas.getBoundingClientRect();
    const b0 = getMeshBox(o);
    const c = b0.getCenter(new THREE.Vector3()).project(camera);
    const cs = { x: (cR.left - vr.left) + (c.x + 1) / 2 * vr.width,
                 y: (cR.top - vr.top) + (-c.y + 1) / 2 * vr.height };
    let ux = item.sx - cs.x, uy = item.sy - cs.y;
    const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
    const q0 = o.quaternion.clone();
    const pe = (type, x, y, tgt) => tgt.dispatchEvent(new PointerEvent(type,
      { clientX: x, clientY: y, button: 0, buttons: 1, pointerType: 'mouse', bubbles: true, cancelable: true }));
    const from = { x: vr.left + item.sx, y: vr.top + item.sy };
    pe('pointerdown', from.x, from.y, item.el);
    if (!_dragHandle) return { skip: 'nicht gefasst' };
    pe('pointermove', from.x + ux * px, from.y + uy * px, window);
    pe('pointerup', from.x + ux * px, from.y + uy * px, window);
    const b1 = getMeshBox(o);
    const box = bx => ({ min: bx.min.toArray(), max: bx.max.toArray() });
    return { b0: box(b0), b1: box(b1), qDot: Math.abs(q0.dot(o.quaternion)) };
  };
});

const AX = { x: 0, y: 1, z: 2 };
const sz = (bx, k) => bx.max[AX[k]] - bx.min[AX[k]];
const mid = (bx, k) => (bx.max[AX[k]] + bx.min[AX[k]]) / 2;
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;   // Units (0,2 mm)
const r3 = v => +v.toFixed(3);

for (const fall of ['versetzt', 'gedreht', 'gekippt', 'import']) {
  console.log(`\n── ${fall}`);
  // weiße Ecken: gleichmäßig, Unterkante + Mitte X/Z bleiben
  let ecken = 0;
  for (const key of ['c000','c100','c010','c110','c001','c101','c011','c111']) {
    await pg.evaluate(f => window._hdSetup(f), fall);
    const r = await pg.evaluate(k => window._hdDrag(k, 80), key);
    if (r.skip) continue;
    ecken++;
    const f = ['x','y','z'].map(k => sz(r.b1, k) / sz(r.b0, k));
    ok(`${fall} ${key}: wird größer`, f[0] > 1.05, f.map(r3));
    ok(`${fall} ${key}: gleichmäßig (kein Stauchen)`, Math.max(...f) - Math.min(...f) < 0.01, f.map(r3));
    ok(`${fall} ${key}: bleibt auf der Platte`, near(r.b1.min[1], r.b0.min[1]), [r3(r.b0.min[1]), r3(r.b1.min[1])]);
    ok(`${fall} ${key}: Mitte X/Z bleibt (nicht verschoben)`,
       near(mid(r.b1,'x'), mid(r.b0,'x')) && near(mid(r.b1,'z'), mid(r.b0,'z')),
       [r3(mid(r.b0,'x')), r3(mid(r.b1,'x')), r3(mid(r.b0,'z')), r3(mid(r.b1,'z'))]);
    ok(`${fall} ${key}: nicht gekippt`, r.qDot > 0.99999, r3(r.qDot));
  }
  ok(`${fall}: Ecken getestet`, ecken === 8, { ecken });

  // schwarze Kanten: diese Welt-Achse wächst, Gegenkante bleibt, Lage bleibt
  let kanten = 0;
  for (const key of ['fx+','fx-','fz+','fz-','fy+']) {
    await pg.evaluate(f => window._hdSetup(f), fall);
    const r = await pg.evaluate(k => window._hdDrag(k, 80), key);
    if (r.skip) continue;
    kanten++;
    const k = key[1], side = key[2] === '+' ? 1 : -1, i = AX[k];
    ok(`${fall} ${key}: ${k} wird größer`, sz(r.b1, k) > sz(r.b0, k) * 1.05, [r3(sz(r.b0,k)), r3(sz(r.b1,k))]);
    if (k === 'y') {
      ok(`${fall} ${key}: Unterkante bleibt`, near(r.b1.min[1], r.b0.min[1]), [r3(r.b0.min[1]), r3(r.b1.min[1])]);
    } else {
      const fest0 = side > 0 ? r.b0.min[i] : r.b0.max[i], fest1 = side > 0 ? r.b1.min[i] : r.b1.max[i];
      ok(`${fall} ${key}: Gegenkante bleibt stehen`, near(fest0, fest1), [r3(fest0), r3(fest1)]);
      ok(`${fall} ${key}: bleibt auf der Platte`, near(r.b1.min[1], r.b0.min[1]), [r3(r.b0.min[1]), r3(r.b1.min[1])]);
    }
    const quer = ['x','z'].filter(q => q !== k);
    for (const q of quer)
      ok(`${fall} ${key}: Mitte ${q} bleibt`, near(mid(r.b1, q), mid(r.b0, q)), [r3(mid(r.b0,q)), r3(mid(r.b1,q))]);
    ok(`${fall} ${key}: nicht gekippt`, r.qDot > 0.99999, r3(r.qDot));
  }
  ok(`${fall}: Kanten getestet`, kanten === 5, { kanten });
}

ok('Keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
if (fails.length) { console.log('\nFEHLGESCHLAGEN: ' + fails.length + ' Prüfungen'); process.exit(1); }
console.log('\nAlle Prüfungen bestanden.');
