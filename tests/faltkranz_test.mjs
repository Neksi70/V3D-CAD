// Regressionstest für den Generator „Faltkranz" (🪭, _fkz*).
//   1. alle Varianten bauen wasserdicht, EIN Stück, Volumen > 0; Wand/offen = Ring (Geschlecht 1),
//      mit Boden bzw. massiv (Vasenmodus) Geschlecht 0
//   2. Unterseite eben auf y = 0, Höhe + Außen-Ø stimmen
//   3. der freie Innen-Ø ist wirklich frei (kein Dreieck näher an der Achse, über dem Boden)
//   4. kein Wandstück hängt flacher als ~55° über (Druck ohne Stützen)
//   5. Erstellen legt ein Teil an
// Start: python3 volme3d_server.py 8851 --dev   →   V3D_URL=http://127.0.0.1:8851/volme3d.html node tests/faltkranz_test.mjs
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
await pg.evaluate(async () => { await _mfInit(); });

const varianten = [
  { name: 'Standard (Stumpen 70, Wand, Boden)', p: {}, genus: 0 },
  { name: 'Offener Ring',                       p: { boden: 0 }, genus: 1 },
  { name: 'Vasenmodus',                         p: { druck: 'vase' }, genus: 0 },
  { name: 'Teelicht, klein, 20 Falten',         p: { innen: 44, dia: 120, hoehe: 35, falten: 20 }, genus: 0 },
  { name: 'Kantig, Bauch oben, Drall',          p: { rund: 4.5, bauch: 70, drall: 40 }, genus: 0 },
  { name: 'Viele Falten, dicke Wand',           p: { falten: 72, wand: 2 }, genus: 0 },
  { name: 'Bauch unten, schmaler Fuß',          p: { bauch: 0, fuss: 30 }, genus: 0 },
];

for (const v of varianten) {
  const r = await pg.evaluate(p => {
    Object.assign(_fkzP, _FKZ_DEF, p);
    const t0 = performance.now();
    const res = _fkzBuild(_mfWasm, _fkzP, 'fein'), d = res.d, geo = res.geo;
    const ms = performance.now() - t0;
    const pos = geo.toNonIndexed().attributes.position.array;
    const mf = _mfFromSoup(_mfWasm, pos);
    const genus = mf.genus(), vol = mf.volume(), parts = mf.decompose().length; mf.delete();
    geo.computeBoundingBox(); const bb = geo.boundingBox;
    let rMin = Infinity, worst = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const A = [pos[i], pos[i+1], pos[i+2]], B = [pos[i+3], pos[i+4], pos[i+5]], C = [pos[i+6], pos[i+7], pos[i+8]];
      const yMin = Math.min(A[1], B[1], C[1]), yMax = Math.max(A[1], B[1], C[1]);
      if (yMin > d.boden + 0.01) for (const P of [A, B, C]) rMin = Math.min(rMin, Math.hypot(P[0], P[2]));
      // Überhang nur an Wandflächen (Deckel/Boden-Kappen flach, die zählen nicht)
      if (yMax - yMin < 0.05) continue;
      const ux = B[0]-A[0], uy = B[1]-A[1], uz = B[2]-A[2], vx = C[0]-A[0], vy = C[1]-A[1], vz = C[2]-A[2];
      const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx, nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-6) continue;
      const ang = Math.asin(Math.min(1, Math.abs(ny) / nl)) * 180 / Math.PI;   // 0 = senkrecht
      if (ang > worst && yMin > 0.5 && yMax < d.H - 0.5) worst = ang;
    }
    return { ms: Math.round(ms), genus, vol: Math.round(vol), parts, tris: pos.length / 9,
             y0: bb.min.y, y1: bb.max.y, dia: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), rMin, worst,
             innen: _fkzP.innen, dia0: _fkzP.dia, H: _fkzP.hoehe, vase: d.vase };
  }, v.p);
  console.log(v.name, JSON.stringify(r));
  ok(v.name + ': wasserdicht, ein Teil, Volumen > 0', r.parts === 1 && r.vol > 0);
  ok(v.name + ': Geschlecht ' + v.genus, r.genus === v.genus, r.genus);
  ok(v.name + ': Unterseite y=0, Höhe', Math.abs(r.y0) < 1e-3 && Math.abs(r.y1 - r.H) < 0.05, [r.y0, r.y1]);
  ok(v.name + ': Außen-Ø', Math.abs(r.dia - r.dia0) < r.dia0 * 0.04, r.dia);
  if (!r.vase) ok(v.name + ': Innen-Ø frei', r.rMin * 2 >= r.innen - 0.5, r.rMin * 2);
  ok(v.name + ': Überhang ≤ 55°', r.worst <= 55, r.worst.toFixed(1));
}

const made = await pg.evaluate(async () => {
  Object.assign(_fkzP, _FKZ_DEF);
  _fkzOpen();
  const n0 = objects.length;
  await _fkzCreate();
  return { n: objects.length - n0, name: objects[objects.length - 1]?.userData?.name, open: document.getElementById('fkz-modal').classList.contains('show') };
});
ok('Erstellen legt ein Teil an', made.n === 1 && /Faltkranz/.test(made.name) && !made.open, made);
const kanten = await pg.evaluate(async () => {
  const cnt = m => { const e = m.children.find(c => c.userData.isEdgeLines); return e ? e.geometry.attributes.position.count / 2 : -1; };
  const o = objects[objects.length - 1], roh = new THREE.EdgesGeometry(o.geometry, 30).attributes.position.count / 2;
  const o2 = await buildObjectFromData(JSON.parse(JSON.stringify(objectToData(o))));
  return { roh, neu: cnt(o), geladen: cnt(o2) };
});
// 30° schraffiert die leicht verdrehten Täler (~27k Kanten), 60° lässt nur die Faltlinien (~20k)
ok('Kantenlinien ohne Schraffur, auch nach Laden', kanten.neu < kanten.roh * 0.8 && Math.abs(kanten.geladen - kanten.neu) < kanten.neu * 0.01, kanten);
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors);
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
