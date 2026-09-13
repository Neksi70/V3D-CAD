// Test: Die Maß-Regler (Breite X / Tiefe Y / Höhe Z) lassen das Teil an seinem
// Platz — nur die Größe ändert sich.
// Ralf 13.9.26 (Rohr-Verstärkung, C-Segment aus einem Rohr): „Nimmt man da die
// Schieber z.B. Breite X, dann wandert das Teil noch zusätzlich; bei Höhe Z
// bleibt es stehen und wird nur höher."
// Ursache: Mit „Vom Zentrum" (Standard) wurde gar nicht verankert, sondern nur
// scale gesetzt — das skaliert um den URSPRUNG der Geometrie. Liegt der nicht in
// der Mitte des Körpers (Rohrstück: Ursprung = Rohrachse), wandert das Teil.
// Bei einem normalen Würfel unsichtbar, darum hier ein versetzter Körper.
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

const lauf = (fall) => pg.evaluate((fall) => {
  [...objects].forEach(o => scene.remove(o)); objects.length = 0;
  addShape('box'); const o = objects[0];
  o.userData.shapeType = 'custom';
  o.geometry = o.geometry.clone(); o.geometry.translate(3, 0, -2);   // Ursprung neben dem Körper
  o.scale.set(1, 1, 1); o.rotation.set(0, fall.rotY * Math.PI / 180, 0); o.position.set(0, 1, 0);
  o.updateMatrixWorld(true);
  selectObjs([o]);
  scaleLocked = false; scaleFromCenter = fall.mitte;
  const b0 = getMeshBox(o), c0 = b0.getCenter(new THREE.Vector3()), s0 = b0.getSize(new THREE.Vector3());
  const cur = { w: s0.x, h: s0.y, d: s0.z }[fall.achse] * 10;
  fpApplyDim(fall.achse, cur * 1.5);
  const b1 = getMeshBox(o), c1 = b1.getCenter(new THREE.Vector3()), s1 = b1.getSize(new THREE.Vector3());
  const mm = v => Math.round(v * 1000) / 100;
  return { dcx: mm(c1.x - c0.x), dcz: mm(c1.z - c0.z), dminY: mm(b1.min.y - b0.min.y),
           dmaxX: mm(b1.max.x - b0.max.x), dmaxZ: mm(b1.max.z - b0.max.z),
           f: +(({ w: s1.x / s0.x, h: s1.y / s0.y, d: s1.z / s0.z })[fall.achse]).toFixed(3) };
}, fall);

for (const rotY of [0, 30]) for (const achse of ['w', 'd', 'h']) {
  const r = await lauf({ achse, rotY, mitte: true });
  const tag = `Vom Zentrum, ${achse}, rotY=${rotY}`;
  ok(`${tag}: Maß ×1,5`, Math.abs(r.f - 1.5) < 0.01 || rotY !== 0, r.f);
  ok(`${tag}: Mitte X/Z bleibt`, Math.abs(r.dcx) < 0.01 && Math.abs(r.dcz) < 0.01, r);
  ok(`${tag}: Boden bleibt`, Math.abs(r.dminY) < 0.01, r.dminY);
}
// Ohne „Vom Zentrum": die geänderte Achse hält ihre +Kante, die andere ihre Mitte
{ const r = await lauf({ achse: 'w', rotY: 0, mitte: false });
  ok('Kante: Breite hält rechte Kante', Math.abs(r.dmaxX) < 0.01 && Math.abs(r.dcz) < 0.01, r); }
{ const r = await lauf({ achse: 'd', rotY: 0, mitte: false });
  ok('Kante: Tiefe hält hintere Kante', Math.abs(r.dmaxZ) < 0.01 && Math.abs(r.dcx) < 0.01, r); }

ok('keine Seitenfehler', errs.length === 0, errs);
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
