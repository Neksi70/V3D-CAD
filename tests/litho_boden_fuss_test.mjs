// Volker 6.11.: Lithophane-Zylinder/Kegel/Laterne mit Boden (Übertopf) und Fuß-Ring (eigenes Teil).
// Prüft über das echte „Erstellen“: Topf mit Boden ist EIN dichtes Stück und unten zu; Fuß-Ring dicht;
// Topf steckt im Fuß ohne Überschneidung (seitlich 1 mm verschoben stößt er an); ohne Boden hat der
// Fuß eine Teelicht-Mulde, in die ein LED-Teelicht passt; Fuß flach druckbar (Stützvolumen 0).
// Start: python3 volme3d_server.py 8853 --dev → V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/litho_boden_fuss_test.mjs
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof _buildLithoMantelGeo === 'function', null, { timeout: 60000 });
const r = await pg.evaluate(async () => {
  hideStarter();
  const c = document.createElement('canvas'); c.width = 120; c.height = 80; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 120, 80); x.fillStyle = '#000'; x.fillRect(0, 0, 60, 80);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  _openLithoModal(); await _lithoFile({ target: { files: [new File([blob], 't.png', { type: 'image/png' })], value: '' } });
  for (let i = 0; i < 50 && !_litho.lum; i++) await new Promise(r => setTimeout(r, 100));
  const w = await _mfInit(), M = w.Manifold, out = {};
  const mf = g => { const P = g.attributes.position, I = g.index ? g.index.array : null, n = I ? I.length : P.count, t = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const k = I ? I[i] : i; t[i * 3] = P.getX(k) * 10; t[i * 3 + 1] = P.getY(k) * 10; t[i * 3 + 2] = P.getZ(k) * 10; } return _mfFromSoup(w, t); };
  const hit = (a, bb) => { const i = a.intersect(bb), v = i.volume(); i.delete(); return +v.toFixed(3); };
  const stuetz = m => { const mesh = m.getMesh(), Vp = mesh.vertProperties, T = mesh.triVerts, np = mesh.numProp, col = new Map();   // Y oben
    for (let i = 0; i < T.length; i += 3) { const a = T[i] * np, bq = T[i + 1] * np, cq = T[i + 2] * np;
      const ax = Vp[a], ay = Vp[a + 2], az = Vp[a + 1], bx = Vp[bq], by = Vp[bq + 2], bz = Vp[bq + 1], cx = Vp[cq], cy = Vp[cq + 2], cz = Vp[cq + 1];
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; nz = -nz; nx = -nx; ny = -ny;   // Achsentausch y↔z spiegelt → Normale umdrehen
      const L = Math.hypot(nx, ny, nz); if (!(L > 0) || Math.abs(nz) < 1e-9) continue;
      const dd = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      for (let gx = Math.ceil(Math.min(ax, bx, cx)); gx <= Math.max(ax, bx, cx); gx++) for (let gy = Math.ceil(Math.min(ay, by, cy)); gy <= Math.max(ay, by, cy); gy++) {
        const l1 = ((bx - gx) * (cy - gy) - (cx - gx) * (by - gy)) / dd, l2 = ((cx - gx) * (ay - gy) - (ax - gx) * (cy - gy)) / dd, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const k = gx * 100000 + gy; let e = col.get(k); if (!e) col.set(k, e = []); e.push([l1 * az + l2 * bz + l3 * cz, nz / L]); } }
    let vol = 0; for (const e of col.values()) { e.sort((p, q) => p[0] - q[0]); let boden = 0;
      for (const [z, n] of e) { if (n > 0) boden = z; else { if (n < -0.75 && z - boden > 0.4) vol += z - boden; boden = z; } } }
    return Math.round(vol); };
  for (const form of ['zylinder', 'kegel', 'laterne']) for (const mBoden of [1, 0]) {
    const key = form + (mBoden ? '+Boden' : ' offen');
    Object.assign(_litho.p, { form, mD: 80, mH: 60, mOben: form === 'kegel' ? 120 : 100, mEcke: 12, mRand: 3, maxT: 3, minT: 0.8, kFit: 'strecken',
      mBoden, mBodenD: 2, mFuss: 1, mFussH: 10, mFussRand: 8, mFussT: 4, mFussPass: 0.4, tlD: 38 });
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
    const ohne = mf(_buildLithoGeo(false)), vOhne = ohne.volume(); ohne.delete();
    await _createLitho();
    const topf = objects.find(o => !/Fuß/.test(o.userData.name)), fuss = objects.find(o => /Fuß/.test(o.userData.name));
    const T = mf(topf.geometry), F = mf(fuss.geometry), Fm = _lithoFussMasse(_litho.p);
    const res = { teile: [T.decompose().length, F.decompose().length], namen: objects.map(o => o.userData.name), mehr: Math.round(T.volume() - vOhne) };
    // unten zu? Strahl durch die Mitte: Topf-Volumen in einer dünnen Säule um die Achse
    const saeule = M.cylinder(5, 3, 3, 24).rotate([-90, 0, 0]).translate([0, 0.2, 0]); res.mitte = hit(T, saeule); saeule.delete();
    const auf = T.translate([0, Fm.H - Fm.T, 0]), seit = T.translate([1, Fm.H - Fm.T, 0]);
    res.steckt = hit(auf, F); res.seitlich = hit(seit, F); auf.delete(); seit.delete();
    if (!mBoden) { const rt = Fm.tl / 2 - 0.75, tl = M.cylinder(15, rt, rt, 64).rotate([-90, 0, 0]).translate([0, Fm.H - Fm.T - 5.95, 0]); res.teelicht = hit(tl, F); res.led = Fm.led; tl.delete(); }
    res.stuetzFuss = stuetz(F);
    T.delete(); F.delete();
    out[key] = res;
  }
  _closeLithoModal();
  return out;
});
console.log(JSON.stringify(r, null, 1));
let fehler = 0; const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
for (const [k, x] of Object.entries(r)) {
  ok(`${k}: Topf und Fuß-Ring je ein Stück`, x.teile[0] === 1 && x.teile[1] === 1 && x.namen.length === 2, x.namen);
  if (/Boden/.test(k)) ok(`${k}: Boden da (unten zu, Volumen gewachsen)`, x.mitte > 5 && x.mehr > 1000, [x.mitte, x.mehr]);
  else ok(`${k}: unten offen`, x.mitte < 0.01, x.mitte);
  ok(`${k}: Topf steckt im Fuß ohne Überschneidung, seitlich stößt er an`, x.steckt < 0.01 && x.seitlich > 1, [x.steckt, x.seitlich]);
  if (x.teelicht !== undefined) ok(`${k}: LED-Teelicht passt in die Mulde im Fuß`, x.led && x.teelicht < 0.01, [x.led, x.teelicht]);
  ok(`${k}: Fuß flach ohne Stützen druckbar`, x.stuetzFuss === 0, x.stuetzFuss);
}
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
