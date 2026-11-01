// Regressionstest für die Generatoren „Dackel-Kerzenhalter" (🐕) und „Mops-Kerzenhalter" (🐶), _dkl*.
//   0. Dackel-Geometrie bleibt gleich (Volumen-Referenz von v1.18.287, vor dem Mops)
//   5. Mops: Adventsmops 2 × 2, Kerzen auseinander, Teile heißen „Mops …"
//   1. Hund baut wasserdicht als EIN Stück, Volumen > 0, unten eben auf y = 0
//   2. Kerzenlöcher frei: Zylinder (Loch − 0,1, 300 mm hoch = Kerze) schneidet weder Hund noch Mütze, Loch ist wirklich da (Wand drumherum)
//   3. Bommel (eigenes Teil) eingesteckt: keine Überschneidung mit dem Hund, sitzt auf der Mütze
//   4. Vorschau + Erstellen legen Teile an; Bilder nach /tmp/dkl_*.png
// Start: python3 volme3d_server.py 8766 --dev   →   node tests/dackel_test.mjs
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

const varianten = (process.env.ONLY ? [] : [
  { name: '4 Kerzen Mittel', p: {} },
  { name: '1 Kerze Klein', p: { kerzen: 1, groesse: 140 } },
  { name: '4 Kerzen Groß Ø25', p: { groesse: 260, kerzeD: 25 } },
  { name: '2 Kerzen ohne Mütze, glatt', p: { kerzen: 2, muetze: 0, strick: 0 } },
  { name: '1 Kerze Mini, Bommel fest', p: { kerzen: 1, groesse: 100, kerzeD: 14, bommel: 0 } },
  { name: '3 Kerzen 360', p: { kerzen: 3, groesse: 360 } },
  { name: 'Mops 4 Kerzen Mittel (2×2)', p: { rasse: 'mops' } },
  { name: 'Mops 1 Kerze Klein', p: { rasse: 'mops', kerzen: 1, groesse: 140 } },
  { name: 'Mops 3 Kerzen Groß', p: { rasse: 'mops', kerzen: 3, groesse: 260 } },
  { name: 'Mops 2 Kerzen ohne Mütze, glatt', p: { rasse: 'mops', kerzen: 2, muetze: 0, strick: 0 } },
  { name: 'Mops 4 Kerzen Mini Ø14, Bommel fest', p: { rasse: 'mops', groesse: 100, kerzeD: 14, bommel: 0 } },
]);

// Dackel unverändert durch den Mops-Umbau (Vorschau-Raster, Werte von v1.18.287)
{
  const ref = await pg.evaluate(() => [{}, { kerzen: 1, groesse: 140 }, { muetze: 0 }].map(p => {
    Object.assign(_dklP, _DKL_DEF, p);
    const R = _dklBuild(_mfWasm, _dklP, 'vorschau'), v = [Math.round(R.hund.volume() * 100) / 100, R.hund.numTri()];
    R.hund.delete(); if (R.bommel) R.bommel.delete();
    return v;
  }));
  ok('Dackel-Geometrie unverändert', JSON.stringify(ref) === JSON.stringify([[460495.51, 65448], [124257.91, 60168], [441706.77, 70054]]), ref);
}
for (const v of varianten) {
  const r = await pg.evaluate(p => {
    Object.assign(_dklP, _DKL_DEF, p);
    const w = _mfWasm, M = w.Manifold, t0 = performance.now();
    const R = _dklBuild(w, _dklP, 'fein'), d = R.d, ms = performance.now() - t0;
    const h = R.hund, bb = h.boundingBox();
    const res = { ms: Math.round(ms), edge: +R.edge.toFixed(2), parts: h.decompose().length, vol: Math.round(h.volume()), tris: h.numTri(),
      bb: [bb.min, bb.max].map(a => a.map(x => Math.round(x))), len: Math.round(d.len), hoch: Math.round(d.hoehe) };
    let lochHit = 0, wand = Infinity;
    res.zs = d.zs.map(z => Math.round(z)); res.rows = d.rows;
    for (let i = 0; i < d.xs.length; i++) {
      const xc = d.xs[i], zc = d.zs[i];
      const rT = d.ri - 0.1 - 0.3 * R.edge, c = M.cylinder(300, rT, rT, 48).rotate([-90, 0, 0]).translate([xc, d.yLoch + 0.2, zc]);   // Loch + Platz für die Kerze
      const x = c.intersect(h); lochHit += x.volume(); x.delete(); c.delete();
      const ring = M.cylinder(d.yT - d.yLoch - 2, d.ro - 0.3, d.ro - 0.3, 48).rotate([-90, 0, 0]).translate([xc, d.yLoch + 1, zc]);
      const y = ring.intersect(h); wand = Math.min(wand, y.volume()); y.delete(); ring.delete();
    }
    res.lochHit = +lochHit.toFixed(2); res.wandVol = Math.round(wand);
    if (R.bommel) {
      const bm = _dklBommelPlace(R.bommel, d), x = bm.intersect(h);
      res.bommelHit = +x.volume().toFixed(2); res.bommelParts = R.bommel.decompose().length;
      const bb2 = bm.boundingBox(); res.bommelYmin = Math.round(bb2.min[1]); x.delete(); bm.delete(); R.bommel.delete();
    }
    h.delete();
    return res;
  }, v.p);
  console.log(v.name, JSON.stringify(r));
  ok(v.name + ': ein Stück', r.parts === 1, r.parts);
  ok(v.name + ': steht auf y=0', r.bb[0][1] === 0, r.bb);
  ok(v.name + ': Löcher frei', r.lochHit < 1, r.lochHit);
  ok(v.name + ': Tüllenwand vorhanden', r.wandVol > 0, r.wandVol);
  if (v.p.rasse === 'mops' && (v.p.kerzen || 4) === 4) ok(v.name + ': Kerzen 2 × 2 nebeneinander', r.rows === 2 && r.zs[0] === -r.zs[1], r.zs);
  if (r.bommelHit !== undefined) ok(v.name + ': Bommel ohne Überschneidung, 1 Stück', r.bommelHit < 1 && r.bommelParts === 1, [r.bommelHit, r.bommelParts]);
}

// ✂️ Halbiert mit Steckstiften: Hälften je 1 Stück, liegen flach, Stifte passen, weniger Überhang
for (const [name, P] of [['Dackel 4 Kerzen', {}], ['Dackel 1 Kerze Mini', { kerzen: 1, groesse: 100, kerzeD: 14 }], ['Mops 4 Kerzen', { rasse: 'mops' }], ['Mops 3 Kerzen Groß', { rasse: 'mops', kerzen: 3, groesse: 260 }]]) {
  const r = await pg.evaluate(P => {
    const w = _mfWasm, M = w.Manifold;
    // Stützvolumen (mm³, Schätzung wie Baum-/Normalstützen): 1-mm-Raster von oben; in jeder Säule zählt
    // die Luft zwischen Bett bzw. nach oben zeigender Fläche und der nächsten steil (> 45°) nach unten
    // zeigenden Fläche darüber. Strickmaschen über dem Körper ergeben so nur winzige Spalten.
    const ueber = m => { const mesh = m.getMesh(), V = mesh.vertProperties, T = mesh.triVerts, np = mesh.numProp, col = new Map();
      for (let i = 0; i < T.length; i += 3) { const a = T[i] * np, b = T[i + 1] * np, c = T[i + 2] * np;
        const ax = V[a], ay = V[a + 1], az = V[a + 2], bx = V[b], by = V[b + 1], bz = V[b + 2], cx = V[c], cy = V[c + 1], cz = V[c + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
        if (!(L > 0) || Math.abs(ny) < 1e-9) continue;
        const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
        for (let gx = Math.ceil(Math.min(ax, bx, cx)); gx <= Math.max(ax, bx, cx); gx++) for (let gz = Math.ceil(Math.min(az, bz, cz)); gz <= Math.max(az, bz, cz); gz++) {
          const l1 = ((bx - gx) * (cz - gz) - (cx - gx) * (bz - gz)) / d, l2 = ((cx - gx) * (az - gz) - (ax - gx) * (cz - gz)) / d, l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const k = gx * 100000 + gz; let e = col.get(k); if (!e) col.set(k, e = []);
          e.push([l1 * ay + l2 * by + l3 * cy, ny / L]);
        } }
      let vol = 0;
      for (const e of col.values()) { e.sort((p, q) => p[0] - q[0]); let boden = 0;
        for (const [y, n] of e) { if (n > 0) boden = y; else { if (n < -0.7071 && y - boden > 0.4) vol += y - boden; boden = y; } } }
      return vol; };
    Object.assign(_dklP, _DKL_DEF, P);
    const R0 = _dklBuild(w, _dklP, 'vorschau'), aGanz = ueber(R0.hund); R0.hund.delete(); if (R0.bommel) R0.bommel.delete();
    Object.assign(_dklP, { teilen: 1 });
    const R = _dklBuild(w, _dklP, 'vorschau'), pin = R.pin;
    const a = R.plus.rotate([-90, 0, 0]), b = R.minus.rotate([90, 0, 0]);
    const flach = m => { const s = m.trimByPlane([0, -1, 0], -0.3), bb = s.boundingBox(), v = s.volume(); s.delete(); return Math.round(v / 0.3); };   // Auflagefläche ≈ Volumen der untersten 0,3 mm / 0,3
    const res = { pins: R.pins.length, parts: [R.plus.decompose().length, R.minus.decompose().length], ymin: [a.boundingBox().min[1], b.boundingBox().min[1]].map(v => +v.toFixed(3)),
      flaeche: [flach(a), flach(b)], ueberGanz: Math.round(aGanz), ueberHalb: Math.round(ueber(a) + ueber(b)) };
    // Stifte (volle Länge 2L) an ihren Plätzen im zusammengesetzten Hund: keine Überschneidung
    const asm = M.union([R.plus, R.minus]); let hit = 0;
    for (const [x, y] of R.pins) { const c = M.cylinder(2 * pin.L, pin.r, pin.r, 40).translate([x, y, -pin.L]), i = c.intersect(asm); hit += i.volume(); i.delete(); c.delete(); }
    res.hit = +hit.toFixed(3);
    const sb = R.stifte.boundingBox(); res.stifte = { n: R.stifte.decompose().length, ymin: +sb.min[1].toFixed(3), len: +(sb.max[0] - sb.min[0]).toFixed(2), L2: 2 * pin.L, dp: pin.dp };
    [a, b, asm, R.plus, R.minus, R.stifte].forEach(m => m.delete()); if (R.bommel) R.bommel.delete();
    return res;
  }, P);
  console.log('✂️ ' + name, JSON.stringify(r));
  ok('✂️ ' + name + ': mind. 3 Steckstifte', r.pins >= 3, r.pins);
  ok('✂️ ' + name + ': Hälften je ein Stück, liegen auf y = 0', r.parts.every(n => n === 1) && r.ymin.every(v => Math.abs(v) < 0.01), [r.parts, r.ymin]);
  ok('✂️ ' + name + ': große Auflagefläche', r.flaeche.every(v => v > 1000), r.flaeche);
  ok('✂️ ' + name + ': Stifte passen in die Löcher', r.hit < 0.5, r.hit);
  ok('✂️ ' + name + ': Stifte liegen flach, Länge 2L', r.stifte.n === r.pins && Math.abs(r.stifte.ymin) < 0.01 && Math.abs(r.stifte.len - r.stifte.L2) < 0.01, r.stifte);
  ok('✂️ ' + name + ': deutlich weniger Stützvolumen (< 50 %)', r.ueberHalb < 0.5 * r.ueberGanz, [r.ueberGanz, r.ueberHalb]);
}

// Vorschau + Erstellen + Bilder
await pg.evaluate(() => { Object.assign(_dklP, _DKL_DEF); _dklOpen(); });
await pg.waitForTimeout(4000);
await pg.locator('#dkl-modal .g3box').screenshot({ path: '/tmp/dkl_fenster.png' });
for (const k of [1, 4]) {
  await pg.evaluate(async k => {
    Object.assign(_dklP, _DKL_DEF, { kerzen: k, groesse: k === 1 ? 160 : 200 });
    objects.slice().forEach(o => { scene.remove(o); }); objects.length = 0;
    await _dklCreate();
  }, k);
  await pg.waitForTimeout(800);
  const info = await pg.evaluate(() => objects.map(o => o.userData.name));
  ok('Erstellen ' + k + ' Kerze(n) legt Teile an', info.length === 2, info);
  await pg.screenshot({ path: '/tmp/dkl_szene' + k + '.png' });
}
{
  const info = await pg.evaluate(async () => {
    objects.slice().forEach(o => { scene.remove(o); }); objects.length = 0;
    Object.assign(_dklP, _DKL_DEF); _dklOpen('mops');
    const titel = document.getElementById('dkl-titel').textContent, on = document.querySelector('#dkl-rasse-bg .vtb.on').dataset.v;
    await _dklCreate();
    return { titel, on, namen: objects.map(o => o.userData.name), rasse: objects[0] && objects[0].userData.dackelParams.rasse };
  });
  const teil = await pg.evaluate(async () => {
    objects.slice().forEach(o => { scene.remove(o); }); objects.length = 0;
    Object.assign(_dklP, _DKL_DEF, { rasse: 'mops', teilen: 1 }); await _dklCreate();
    const boxes = objects.map(o => { const b = new THREE.Box3().setFromObject(o); return [o.userData.name, +b.min.y.toFixed(3), +b.min.z.toFixed(1), +b.max.z.toFixed(1)]; });
    return boxes;
  });
  ok('✂️ Erstellen halbiert: Hälften, Stifte, Bommel auf der Platte, ohne Überlappung', teil.length === 4 && teil.every(b => Math.abs(b[1]) < 0.01) &&
     teil.filter(b => /Hälfte|Steckstifte/.test(b[0])).sort((a, b) => a[2] - b[2]).every((b, i, A) => i === 0 || b[2] >= A[i - 1][3]), teil);
  await pg.screenshot({ path: '/tmp/dkl_szene_teil.png' });
  ok('Mops über den Katalog: Titel, Umschalter, Teilenamen', /Mops/.test(info.titel) && info.on === 'mops' && info.namen.length === 2 && info.namen.every(n => /^Mops/.test(n)) && info.rasse === 'mops', info);
  await pg.evaluate(() => _dklOpen('dackel'));
}
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
