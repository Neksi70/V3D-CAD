// Regressionstest für den Generator „Kordel-Topf / Seil-Vase" (🪢, _kdl*).
//   1. Formen × Seil × Optionen: ein Stück, keine Hohlräume, steht flach auf z = 0
//   2. Außendurchmesser = Vorgabe (ohne Seilende), Innenwand glatt (nichts ragt nach innen)
//   3. Kein Ring steht mehr als r/2 über dem darunter (Form wird bei Bedarf abgeflacht)
//   4. Mit 45°-Unterseite und ohne Seilende: Stützvolumen ≈ 0
//   5. Erstellen legt ein Teil auf die Platte
// Start: python3 volme3d_server.py 8853 --dev → V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/kordeltopf_test.mjs
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
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
await pg.evaluate(async () => { await _mfInit(); });

const varianten = [
  { name: 'Topf (Standard)', p: {} },
  { name: 'Topf rund, gerade Wand', p: { trane: 0, schraeg: 0 } },
  { name: 'Vase 120×200', p: { form: 'vase', durchm: 120, hoehe: 200 } },
  { name: 'Schale 180×70', p: { form: 'schale', durchm: 180, hoehe: 70 } },
  { name: 'Topf ohne Seilende, glatt (Stützprobe)', p: { ende: 0, rille: 0 } },
  { name: 'Topf ohne Seilende, Standard-Seil (Stützprobe)', p: { ende: 0 } },
  { name: 'Topf ohne Seilende, 5 Stränge (Stützprobe)', p: { ende: 0, straenge: 5, rille: 25 } },
  { name: 'Groß 240×300, Seil 16', p: { durchm: 240, hoehe: 300, seil: 16 } },
  { name: 'Klein 60×40, Seil 5, dicke Wand', p: { durchm: 60, hoehe: 40, seil: 5, wand: 3, boden: 4 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(P => {
    const w = _mfWasm;
    Object.assign(_kdlP, _KDL_DEF, P);
    const t0 = performance.now(), R = _kdlBuild(w, _kdlP, 'fein'), ms = Math.round(performance.now() - t0), d = R.d, m = R.m;
    const bb = m.boundingBox(), mesh = m.getMesh(), V = mesh.vertProperties, np = mesh.numProp, T = mesh.triVerts;
    // Innenwand: kein Punkt innerhalb von Ri(z) (über dem Boden, unter dem Rand)
    let innen = 0;
    const zw = d.H - 0.4 * d.r;
    for (let i = 0; i < V.length; i += np) { const x = V[i], y = V[i + 1], z = V[i + 2];
      if (z > _kdlP.boden + 0.3 && z < zw - 0.3 && Math.hypot(x, y) < d.Ri(z) - 0.05) innen++; }
    // Stützvolumen (1-mm-Säulen, Luft unter > 45°-Überhängen, Spalten > 0,4 mm)
    const col = new Map();
    for (let i = 0; i < T.length; i += 3) { const a = T[i] * np, bq = T[i + 1] * np, c = T[i + 2] * np;
      const ax = V[a], ay = V[a + 1], az = V[a + 2], bx = V[bq], by = V[bq + 1], bz = V[bq + 2], cx = V[c], cy = V[c + 1], cz = V[c + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
      if (!(L > 0) || Math.abs(nz) < 1e-9) continue;
      const dd = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      for (let gx = Math.ceil(Math.min(ax, bx, cx)); gx <= Math.max(ax, bx, cx); gx++) for (let gy = Math.ceil(Math.min(ay, by, cy)); gy <= Math.max(ay, by, cy); gy++) {
        const l1 = ((bx - gx) * (cy - gy) - (cx - gx) * (by - gy)) / dd, l2 = ((cx - gx) * (ay - gy) - (ax - gx) * (cy - gy)) / dd, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const k = gx * 100000 + gy; let e = col.get(k); if (!e) col.set(k, e = []); e.push([l1 * az + l2 * bz + l3 * cz, nz / L]); } }
    // Grundform streng (45°); mit Seilrillen 60° — deren Flanken sind < 1 mm tief und drucken problemlos
    const grenze = P.rille === 0 ? -0.75 : -0.87;
    let stuetz = 0;
    for (const e of col.values()) { e.sort((p, q) => p[0] - q[0]); let boden = 0;
      for (const [z, n] of e) { if (n > 0) boden = z; else { if (n < grenze && z - boden > 0.4) stuetz += z - boden; boden = z; } } }
    const res = { ms, teile: m.decompose().length, hohl: R.hohl, zmin: +bb.min[2].toFixed(3), breite: +(bb.max[0] - bb.min[0]).toFixed(1),
      innen, stufe: +d.maxStufe.toFixed(2), r: d.r, abfl: +d.abfl.toFixed(2), stuetz: Math.round(stuetz), vol: Math.round(m.volume()), tri: m.numTri() };
    m.delete();
    return res;
  }, v.p);
  console.log('— ' + v.name, JSON.stringify(r));
  const D = v.p.durchm || 150;
  ok(v.name + ': ein Stück, keine Hohlräume, steht auf z = 0', r.teile === 1 && r.hohl === 0 && Math.abs(r.zmin) < 0.01, [r.teile, r.hohl, r.zmin]);
  ok(v.name + ': Außen-Ø = Vorgabe, Innenwand glatt', Math.abs(r.breite - D) < 1.2 && r.innen === 0, [r.breite, D, r.innen]);
  ok(v.name + ': kein Ring steht mehr als r/2 über', r.stufe <= 0.5 * r.r + 0.05, [r.stufe, r.r, r.abfl]);
  if (v.p.ende === 0) ok(v.name + ': ohne Stützen druckbar', r.stuetz < 0.001 * r.vol, [r.stuetz, r.vol]);
}

{
  const r = await pg.evaluate(async () => {
    _newCreate(false);
    Object.assign(_kdlP, _KDL_DEF);
    _kdlOpen(); _kdlStr('form', 'vase');
    const info = document.getElementById('kdl-info').innerHTML;
    await new Promise(res => setTimeout(res, 400));
    const prev = _kdlPreviewGeo().attributes.position.count;
    await _kdlCreate();
    return { prev, abgefl: /abgeflacht/.test(info), objs: objects.map(o => { const bb = new THREE.Box3().setFromObject(o); return [o.userData.name, +bb.min.y.toFixed(3), +(bb.max.y * 10).toFixed(1)]; }) };
  });
  ok('Vorschau baut, Hinweis „abgeflacht“ bei der Vase', r.prev > 1000 && r.abgefl, r);
  ok('Erstellen: Seil-Vase steht auf der Platte', r.objs.length === 1 && /Seil-Vase/.test(r.objs[0][0]) && Math.abs(r.objs[0][1]) < 0.01, r.objs);
}
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
