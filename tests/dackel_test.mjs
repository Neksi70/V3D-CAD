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
  ok('Mops über den Katalog: Titel, Umschalter, Teilenamen', /Mops/.test(info.titel) && info.on === 'mops' && info.namen.length === 2 && info.namen.every(n => /^Mops/.test(n)) && info.rasse === 'mops', info);
  await pg.evaluate(() => _dklOpen('dackel'));
}
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
