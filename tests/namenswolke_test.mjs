// Regressionstest für den Generator „Namenswolke mit Regenbogen" (☁️, _nwk*).
//   1. Varianten (Schriften, lange Namen, Füße/Sterne/Teile/Bögen, Breiten): Wolke ein Stück,
//      Relief liegt genau auf der Vorderseite und ganz innerhalb des Wolken-Umrisses, keine Warnung
//   2. Bögen: je ein Stück, stehen auf y = 0, überschneiden sich nicht (konzentrisch mit Fuge)
//   3. Drucklage (wie gebaut, Z oben): Stützvolumen 0 für Wolke, Relief und Bögen
//   4. Erstellen legt alle Teile flach auf die Platte
// Start: python3 volme3d_server.py 8853 --dev → V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/namenswolke_test.mjs
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
await pg.evaluate(async () => {
  await _mfInit();
  for (const [k] of _GGP_FONTS) await new Promise(res => { if (window['_threeFont_' + k]) return res(); _npLoadFont(k, () => res()); setTimeout(res, 10000); });
});

const varianten = [
  { name: 'Tom (Standard)', p: {} },
  { name: 'Charlotte, Great Vibes, ohne Füße, Sterne erhaben, 3 Bögen', p: { name: 'Charlotte', font: 'greatvibes_local', fuesse: 0, sterne: 'erhaben', anzahl: 3 } },
  { name: 'Maximilian, Pacifico, alles ein Teil, Regenbogen ein Stück', p: { name: 'Maximilian', font: 'pacifico_local', teile: 'eins', bogen: 'eins' } },
  { name: 'Mia, Baloo, groß, ohne Regenbogen, ohne Sterne', p: { name: 'Mia', font: 'baloo_local', nameGr: 130, bogen: 'ohne', sterne: 'keine' } },
  { name: 'Leo, Sniglet, klein 80 mm, 2 Bögen', p: { name: 'Leo', font: 'sniglet_local', breite: 80, dicke: 10, anzahl: 2, bogenT: 8 } },
  { name: 'Emma-Sophie, breit 250, 6 Bögen, flach', p: { name: 'Emma-Sophie', breite: 250, anzahl: 6, bogenH: 60, dicke: 24, relief: 3 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(P => {
    const w = _mfWasm, M = w.Manifold, CS = w.CrossSection;
    Object.assign(_nwkP, JSON.parse(JSON.stringify(_NWK_DEF)), P);
    const R = _nwkBuild(w, _nwkP, 'fein'), d = R.d;
    const stuetz = m => { const mesh = m.getMesh(), Vp = mesh.vertProperties, T = mesh.triVerts, np = mesh.numProp, col = new Map();
      for (let i = 0; i < T.length; i += 3) { const a = T[i] * np, bb = T[i + 1] * np, c = T[i + 2] * np;
        const ax = Vp[a], ay = Vp[a + 1], az = Vp[a + 2], bx = Vp[bb], by = Vp[bb + 1], bz = Vp[bb + 2], cx = Vp[c], cy = Vp[c + 1], cz = Vp[c + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
        if (!(L > 0) || Math.abs(nz) < 1e-9) continue;
        const dd = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
        for (let gx = Math.ceil(Math.min(ax, bx, cx)); gx <= Math.max(ax, bx, cx); gx++) for (let gy = Math.ceil(Math.min(ay, by, cy)); gy <= Math.max(ay, by, cy); gy++) {
          const l1 = ((bx - gx) * (cy - gy) - (cx - gx) * (by - gy)) / dd, l2 = ((cx - gx) * (ay - gy) - (ax - gx) * (cy - gy)) / dd, l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const k = gx * 100000 + gy; let e = col.get(k); if (!e) col.set(k, e = []); e.push([l1 * az + l2 * bz + l3 * cz, nz / L]); } }
      let vol = 0;
      for (const e of col.values()) { e.sort((p, q) => p[0] - q[0]); let boden = 0;
        for (const [z, n] of e) { if (n > 0) boden = z; else { if (n < -0.75 && z - boden > 0.4) vol += z - boden; boden = z; } } }
      return Math.round(vol); };
    const res = { warn: R.warn, wolkeTeile: R.wolke.decompose().length, wolkeZ: +R.wolke.boundingBox().min[2].toFixed(3), skala: +(R.nameSkala || 1).toFixed(2) };
    // Relief wird mit der Wolke zusammen gedruckt (ein 3MF-Objekt mit Teilen) → gemeinsam messen
    const ganz = R.relief ? M.union([R.wolke, R.relief]) : R.wolke;
    res.stuetz = [stuetz(ganz)]; if (ganz !== R.wolke) ganz.delete();
    // Relief: auf der Vorderseite (z = D) und innerhalb des Umrisses
    const keep = x => x, umriss = _nwkWolke(CS, keep, d.W), prisma = umriss.extrude(d.D + 20);
    if (R.relief) {
      const bb = R.relief.boundingBox(), aus = R.relief.subtract(prisma);
      res.relief = { zmin: +bb.min[2].toFixed(3), aussen: +aus.volume().toFixed(3) }; aus.delete();
      R.relief.delete();
    }
    prisma.delete();
    // Bögen
    res.boegen = R.boegen.map(m => { const bb = m.boundingBox(); return [m.decompose().length, +bb.min[1].toFixed(3), +bb.min[2].toFixed(3)]; });
    let ueber = 0;
    for (let i = 0; i < R.boegen.length; i++) for (let j = i + 1; j < R.boegen.length; j++) { const x = R.boegen[i].intersect(R.boegen[j]); ueber += x.volume(); x.delete(); }
    res.ueber = +ueber.toFixed(3);
    for (const m of R.boegen) { res.stuetz.push(stuetz(m)); m.delete(); }
    R.wolke.delete();
    res.n = d.n;
    return res;
  }, v.p);
  console.log('— ' + v.name, JSON.stringify(r));
  ok(v.name + ': Wolke ein Stück, liegt auf z = 0, keine Warnung', r.wolkeTeile === 1 && Math.abs(r.wolkeZ) < 0.01 && !r.warn.length, [r.wolkeTeile, r.wolkeZ, r.warn]);
  if (v.p.teile !== 'eins') ok(v.name + ': Relief liegt auf der Vorderseite, ganz auf der Wolke', r.relief && Math.abs(r.relief.zmin - (v.p.dicke || 16)) < 0.01 && r.relief.aussen < 0.01, r.relief);
  if (v.p.bogen !== 'ohne') ok(v.name + ': Bögen je ein Stück, stehen auf y = 0, ohne Überschneidung', r.boegen.length === (v.p.bogen === 'eins' ? 1 : r.n) && r.boegen.every(x => x[0] === 1 && Math.abs(x[1]) < 0.01 && Math.abs(x[2]) < 0.01) && r.ueber < 0.01, [r.boegen, r.ueber]);
  ok(v.name + ': Drucklage ohne Stützen', r.stuetz.every(x => x === 0), r.stuetz);
}

// Oberfläche + Erstellen
{
  const r = await pg.evaluate(async () => {
    _newCreate(false);
    Object.assign(_nwkP, JSON.parse(JSON.stringify(_NWK_DEF)));
    _nwkOpen();
    document.getElementById('nwk-name').value = 'Ben'; _nwkTxt('Ben');
    await new Promise(res => setTimeout(res, 600));
    const prev = _nwkPreviewGeo().attributes.position.count, info = document.getElementById('nwk-info').textContent;
    await _nwkCreate();
    return { prev, info: info.slice(0, 60), objs: objects.map(o => { const bb = new THREE.Box3().setFromObject(o); return [o.userData.name, +bb.min.y.toFixed(3)]; }) };
  });
  ok('Vorschau baut', r.prev > 1000, r.prev);
  ok('Erstellen: Wolke + Bögen flach auf der Platte, Name/Füße liegen auf der Wolke (16 mm)', r.objs.length === 6 && r.objs.every(o => Math.abs(o[1] - (/Name & Füße/.test(o[0]) ? 1.6 : 0)) < 0.01) && r.objs[0][0] === 'Namenswolke Ben', r.objs);
}
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
