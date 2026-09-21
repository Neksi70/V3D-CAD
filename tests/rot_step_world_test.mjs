// Test: Knöpfe Drehen/Kippen (rotate225) und X±/Y±/Z± (rotate90) drehen um die
// WELTACHSE — auch wenn das Teil schon schräg liegt (Ralf 21.9.2026: „Drehen und
// Kippen machen je nach Lage tanzende Bewegungen"). Geometrie mit versetztem
// Ursprung, wie bei STL-Importen.
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

// Ausgangslagen: gerade, gekippt, krumm (wie nach Dreh-Ring / Fläche unten)
const starts = [
  [0, 0, 0], [Math.PI / 4, 0, 0], [0.37, 1.1, -0.6], [Math.PI / 2, Math.PI / 8, 0], [2.2, -0.4, 0.9],
];
const cases = [['rotate225', 'y', 1, -Math.PI / 8], ['rotate225', 'y', -1, Math.PI / 8],
               ['rotate225', 'x', 1, -Math.PI / 8], ['rotate90', 'z', 1, Math.PI / 2],
               ['rotate90', 'y', -1, -Math.PI / 2]];

const res = await pg.evaluate(({ starts, cases }) => {
  const out = [];
  for (const e of starts) for (const [fn, ax, dir, ang] of cases) {
    _newCreate(false);
    addShape('cube');
    const o = getFirst();
    o.geometry.translate(4, 1, 2);            // Ursprung NEBEN dem Körper
    o.scale.set(1, 2.5, 0.6);                 // länglich, damit Lagefehler sichtbar werden
    o.rotation.set(e[0], e[1], e[2]);
    o.position.set(1, 0, -1);
    o.updateMatrixWorld(true);
    selectedObjs.length = 0; selectedObjs.push(o);
    const q0 = o.quaternion.clone();
    const c0 = getMeshBox(o).getCenter(new THREE.Vector3());
    window[fn](ax, dir);
    const q1 = o.quaternion.clone();
    const d = q1.clone().multiply(q0.clone().invert());       // Welt-Delta
    const axv = new THREE.Vector3(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0);
    const want = new THREE.Quaternion().setFromAxisAngle(axv, ang);
    const err = Math.acos(Math.min(1, Math.abs(d.dot(want)))) * 2;
    const c1 = getMeshBox(o).getCenter(new THREE.Vector3());
    const bb = getMeshBox(o);
    out.push({ e, fn, ax, dir, errDeg: err * 180 / Math.PI,
               dx: c1.x - c0.x, dz: c1.z - c0.z, ymin: bb.min.y });
  }
  // 16× Drehen an krummer Lage → wieder exakt am Start (kein Wandern)
  _newCreate(false); addShape('cube');
  const o = getFirst(); o.geometry.translate(4, 1, 2); o.scale.set(1, 2.5, 0.6);
  o.rotation.set(0.37, 1.1, -0.6); o.updateMatrixWorld(true);
  selectedObjs.length = 0; selectedObjs.push(o);
  rotate225('y', 1);
  const qa = o.quaternion.clone(), pa = o.position.clone();
  for (let i = 0; i < 16; i++) rotate225('y', 1);
  const loop = { qErr: 1 - Math.abs(qa.dot(o.quaternion)), pErr: pa.distanceTo(o.position) };
  return { out, loop };
}, { starts, cases });

for (const r of res.out) {
  const tag = `${r.fn}('${r.ax}',${r.dir}) ab [${r.e.map(v => v.toFixed(2))}]`;
  ok(tag + ' dreht um Weltachse', r.errDeg < 1e-4, r.errDeg);
  if (r.fn === 'rotate225') {
    ok(tag + ' bleibt an Ort (X/Z)', Math.abs(r.dx) < 0.35 && Math.abs(r.dz) < 0.35, [r.dx, r.dz]);
    ok(tag + ' steht auf dem Boden', Math.abs(r.ymin) < 1e-6, r.ymin);
  }
}
ok('16× Drehen = volle Runde, Lage identisch', res.loop.qErr < 1e-9, res.loop.qErr);
ok('16× Drehen = volle Runde, kein Wandern', res.loop.pErr < 1e-6, res.loop.pErr);
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors);
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
