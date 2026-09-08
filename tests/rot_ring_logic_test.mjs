// Test: Drehringe verhalten sich "logisch" —
//  (1) jeder Ring dreht um SEINE Weltachse, auch wenn das Objekt schon gekippt ist
//      (Ralf 8.9.26: "Wenn ich an dem blauen drehen will macht er einen Überschlag."),
//  (2) der angefasste Griff läuft unter dem Mauszeiger mit (richtige Richtung + Betrag).
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

await pg.evaluate(() => {
  // Punkt auf dem Ring bei Ebenen-Winkel ang (Weltkoordinaten)
  const ringPt = (piv, u, v, r, ang) => piv.clone()
    .addScaledVector(u, Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r);

  window._rtTest = (axis, tilt, dragDeg) => {
    const o = getFirst();
    o.rotation.set(tilt.x || 0, tilt.y || 0, tilt.z || 0);   // Ralfs Ausgangslage: vorgekippt
    o.updateMatrixWorld(true);
    setMode('rotate'); updateRotHandles();
    const vr = vpEl.getBoundingClientRect();
    const mk = (x, y) => ({ clientX: vr.left + x, clientY: vr.top + y, preventDefault(){}, stopPropagation(){} });

    const q0  = o.quaternion.clone();
    const dirs0 = ['up','fw','rt'].map((_, i) =>
      new THREE.Vector3(i===2?1:0, i===0?1:0, i===1?1:0).applyQuaternion(q0));

    // Griff da anfassen, wo er im Bild am weitesten außen liegt
    const [t0] = _rhBestAngles(axis);
    const h = _rhRingPt(axis, t0);
    _rhStartDrag(axis, mk(h.x, h.y));

    // Zielpunkt: echter Ringpunkt, um dragDeg in der Ringebene weitergedreht
    const piv = rh_piv.clone(), u = rh_plane.u.clone(), v = rh_plane.v.clone(), R3 = rh_3dR;
    const w0  = ringPt(piv, u, v, R3, rh_pa0);
    const tgt = ringPt(piv, u, v, R3, rh_pa0 + dragDeg * Math.PI / 180);
    const sT  = _rhPrj(tgt.x, tgt.y, tgt.z);
    if (!sT) { _rhUp(); return { skip: true }; }

    _rhMove(mk(sT.x, sT.y));
    const qEnd = o.quaternion.clone();
    _rhUp();
    o.updateMatrixWorld(true);

    // Wie hat sich das Objekt wirklich gedreht?
    const dq = qEnd.clone().multiply(q0.clone().invert());
    const dirs1 = dirs0.map(d => d.clone().applyQuaternion(dq));
    const comp = { x: 'x', y: 'y', z: 'z' }[axis];
    // Drehung um Weltachse a ⇒ a-Komponente jeder Richtung bleibt gleich
    const keep = Math.max(...dirs0.map((d, i) => Math.abs(dirs1[i][comp] - d[comp])));
    // Und: der angefasste Punkt muss auf dem Zielpunkt landen
    const w1 = w0.clone().sub(piv).applyQuaternion(dq).add(piv);
    return { keep, followErr: w1.distanceTo(tgt), R3, dragDeg };
  };
});

await pg.evaluate(() => { addShape('cube'); const o = getFirst(); o.scale.set(1, 0.4, 2); o.updateMatrixWorld(true); });

for (const [name, axis, tilt] of [
  ['Blau (Y), ungekippt',       'y', {}],
  ['Blau (Y), 40° vorgekippt',  'y', { x: 0.7 }],
  ['Blau (Y), schräg (X+Z)',    'y', { x: 0.7, z: 0.6 }],
  ['Rot (X), ungekippt',        'x', {}],
  ['Rot (X), Y vorgedreht',     'x', { y: 0.7 }],
  ['Rot (X), schräg (Y+Z)',     'x', { y: 0.7, z: 0.6 }],
  ['Grün (Z), ungekippt',       'z', {}],
  ['Grün (Z), Y vorgedreht',    'z', { y: 0.7 }],
  ['Grün (Z), schräg (X+Y)',    'z', { x: 0.6, y: 0.7 }],
]) {
  for (const deg of [45, -45]) {
    const r = await pg.evaluate(([a, t, d]) => window._rtTest(a, t, d), [axis, tilt, deg]);
    const tag = `${name} ${deg > 0 ? '+' : ''}${deg}°`;
    if (r.skip) { console.log('  ÜBERSPRUNGEN ' + tag); continue; }
    ok(tag + ' — dreht um seine Weltachse', r.keep < 1e-6, { keep: r.keep });
    ok(tag + ' — Griff landet unter der Maus', r.followErr < r.R3 * 0.03,
       { err: +r.followErr.toFixed(3), ringR: +r.R3.toFixed(2) });
  }
}

// ── Freies Ziehen im Dreh-Modus (echte Maus-Ereignisse durch die App) ──
// Waagerecht ziehen = Plattenteller um die Welt-Hochachse. Ein schon gekipptes
// Teil darf dabei nicht zusaetzlich wegkippen.
const freeRes = await pg.evaluate(() => new Promise(res => {
  const o = getFirst();
  o.rotation.set(0.7, 0, 0.6);
  o.updateMatrixWorld(true);
  selectedObjs = [o];
  setMode('rotate');
  const up0 = new THREE.Vector3(0, 1, 0).applyQuaternion(o.quaternion);
  camera.updateMatrixWorld(true);
  const c = getMeshBox(o).getCenter(new THREE.Vector3()).project(camera);
  const vr = vpEl.getBoundingClientRect();
  const sx = vr.left + (c.x + 1) / 2 * vr.width, sy = vr.top + (-c.y + 1) / 2 * vr.height;
  const me = (type, x, y, tgt) => tgt.dispatchEvent(new MouseEvent(type,
    { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true }));
  me('mousedown', sx, sy, canvas);
  me('mousemove', sx + 100, sy, window);      // nur waagerecht
  const up1 = new THREE.Vector3(0, 1, 0).applyQuaternion(o.quaternion);
  me('mouseup', sx + 100, sy, window);
  res({ dY: Math.abs(up1.y - up0.y), moved: Math.abs(up1.x - up0.x) + Math.abs(up1.z - up0.z) });
}));
ok('Freies Ziehen: waagerecht dreht wirklich', freeRes.moved > 0.05, freeRes);
ok('Freies Ziehen: Neigung bleibt (kein Wegkippen)', freeRes.dY < 1e-9, freeRes);

ok('Keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
if (fails.length) { console.log('\nFEHLGESCHLAGEN: ' + fails.length + ' Prüfungen'); process.exit(1); }
console.log('\nAlle Prüfungen bestanden.');
