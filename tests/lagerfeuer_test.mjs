// Regressionstest für den Generator „Lagerfeuer-Teelicht" (🔥, _lgf*).
//   1. Flamme und Sockel bauen wasserdicht, je EIN Stück, Volumen > 0, unten eben auf y = 0
//   2. Mulde frei: kein Sockel-Dreieck innerhalb des Mulden-Radius über dem Muldenboden
//   3. Flamme (eingesteckt) berührt den Sockel nicht: Schnittvolumen ≈ 0
//   4. Kragen der Flamme: innen Platz fürs Teelicht
//   5. Überhang der Flamme außen höchstens ~55° (Druck ohne Stützen)
//   6. Erstellen legt zwei Teile an, Bild für die Sichtkontrolle
// Start: python3 volme3d_server.py 8766 --dev   →   node tests/lagerfeuer_test.mjs
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
  { name: 'Standard (Vasenmodus)', p: {} },
  { name: 'Fertige Wand',          p: { druck: 'wand' } },
  { name: 'Maxi, groß, 7 Zungen',  p: { licht: 58, hoehe: 150, breite: 100, zungen: 7, scheite: 10, dicke: 20 } },
  { name: 'Schmal, viel Drall',    p: { breite: 48, drall: -80, zTief: 40, neig: 40, druck: 'wand', wand: 2 } },
  { name: 'Glatt, kurze Scheite',  p: { zTief: 0, rinde: 0, laenge: 10, scheite: 4, seed: 99 } },
];

for (const v of varianten) {
  const r = await pg.evaluate(p => {
    Object.assign(_lgfP, _LGF_DEF, p);
    const w = _mfWasm, d = _lgfDims(_lgfP), t0 = performance.now();
    const fl = _lgfFlameBuild(w, _lgfP, d, 'fein');
    const ba = _lgfBaseBuild(w, _lgfP, d, 'fein', fl.F);
    const ms = performance.now() - t0;
    const info = geo => {
      const pos = geo.toNonIndexed().attributes.position.array;
      const mf = _mfFromSoup(w, pos);
      geo.computeBoundingBox();
      return { pos, mf, parts: mf.decompose().length, vol: mf.volume(), yMin: geo.boundingBox.min.y, yMax: geo.boundingBox.max.y, tris: pos.length / 9 };
    };
    const F = info(fl.geo), B = info(ba.geo);
    // 2. Mulde frei
    let muldeHit = 0;
    for (let i = 0; i < B.pos.length; i += 3) {
      const x = B.pos[i], y = B.pos[i + 1], z = B.pos[i + 2];
      if (y > d.boden + 0.05 && Math.hypot(x, z) < d.Rrec - 0.05) muldeHit++;
    }
    // 3. Kollision Flamme/Sockel
    const fPos = F.mf.translate([0, d.boden, 0]);
    const cut = fPos.intersect(B.mf), kollision = cut.volume(); cut.delete(); fPos.delete();
    // 4. Kragen innen (nur Wand-Modus hohl)
    let kragenMin = Infinity;
    for (let i = 0; i < F.pos.length; i += 3) {
      const y = F.pos[i + 1];
      if (y > 0.01 && y <= d.hk + 0.01) kragenMin = Math.min(kragenMin, Math.hypot(F.pos[i], F.pos[i + 2]));
    }
    // 5. Überhang außen: Dreiecke mit Normale nach unten, gewichtet nach Fläche
    let schlecht = 0, gesamt = 0, worst = 0;
    const P = F.pos;
    for (let i = 0; i < P.length; i += 9) {
      const ax = P[i], ay = P[i+1], az = P[i+2], bx = P[i+3], by = P[i+4], bz = P[i+5], cx = P[i+6], cy = P[i+7], cz = P[i+8];
      const ux = bx-ax, uy = by-ay, uz = bz-az, vx = cx-ax, vy = cy-ay, vz = cz-az;
      let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx; const L = Math.hypot(nx, ny, nz) || 1;
      ny /= L; const A = L / 2;
      const ym = (ay + by + cy) / 3;
      if (ym < 0.05) continue;                                  // Boden/Bettkante
      // nur Außenhaut: Mittelpunkt weiter außen als Innenseite → Normale zeigt radial nach außen
      const mx = (ax+bx+cx)/3, mz = (az+bz+cz)/3;
      if ((nx * mx + nz * mz) / L < 0 && ny < 0) continue;      // Innenseite der Haube
      gesamt += A;
      if (ny < -Math.sin(57 * Math.PI / 180)) { schlecht += A; worst = Math.max(worst, Math.asin(-ny) * 180 / Math.PI); }
    }
    const res = { ms: Math.round(ms), fParts: F.parts, bParts: B.parts, fVol: Math.round(F.vol), bVol: Math.round(B.vol),
      fYmin: +F.yMin.toFixed(3), bYmin: +B.yMin.toFixed(3), fH: +F.yMax.toFixed(1), Hf: +d.Hf.toFixed(1),
      muldeHit, kollision: +kollision.toFixed(3), kragenMin: +kragenMin.toFixed(2), Rci: +d.Rci.toFixed(2), Rc: +d.Rc.toFixed(2),
      ueberhangAnteil: +(schlecht / gesamt * 100).toFixed(3), worst: +worst.toFixed(1), fTris: F.tris, bTris: B.tris, vase: d.vase };
    F.mf.delete(); B.mf.delete();
    return res;
  }, v.p);
  console.log('— ' + v.name, JSON.stringify(r));
  ok(v.name + ': Flamme ein Stück', r.fParts === 1 && r.fVol > 0, r.fParts);
  ok(v.name + ': Sockel ein Stück', r.bParts === 1 && r.bVol > 0, r.bParts);
  ok(v.name + ': beide unten auf y=0', Math.abs(r.fYmin) < 1e-3 && Math.abs(r.bYmin) < 1e-3, [r.fYmin, r.bYmin]);
  ok(v.name + ': Flammenhöhe', Math.abs(r.fH - r.Hf) < 0.6, [r.fH, r.Hf]);
  ok(v.name + ': Mulde frei', r.muldeHit === 0, r.muldeHit);
  ok(v.name + ': Flamme berührt Sockel nicht', r.kollision < 0.01, r.kollision);
  ok(v.name + ': Kragen passt', r.vase ? Math.abs(r.kragenMin - r.Rc) < 0.1 : r.kragenMin >= r.Rci - 0.05, [r.kragenMin, r.Rci]);
  ok(v.name + ': Überhang ≤ 57° (Fläche < 0,5 %)', r.ueberhangAnteil < 0.5, [r.ueberhangAnteil, r.worst]);
}

// 6. Klickweg: Generator-Liste → Dialog → Erstellen
await pg.evaluate(() => Object.assign(_lgfP, _LGF_DEF));
const n0 = await pg.evaluate(() => objects.length);
await pg.evaluate(() => { const s = _STARTERS.find(x => x.t === 'Lagerfeuer-Teelicht'); s.run(); });
await pg.waitForFunction(() => document.getElementById('lgf-modal').classList.contains('show') && _gpv['lgf'] && _gpv['lgf'].group, { timeout: 30000 });
await pg.waitForTimeout(800);
await pg.locator('#lgf-modal .g3box').screenshot({ path: '/tmp/lgf/dialog.png' });
await pg.evaluate(() => _lgfCreate());
await pg.waitForFunction(n => objects.length >= n + 2, n0, { timeout: 60000 });
const names = await pg.evaluate(n => objects.slice(n).map(o => o.userData.name), n0);
ok('Erstellen: zwei Teile', names.length === 2 && names.some(x => /Sockel/.test(x)) && names.some(x => /Flamme/.test(x)), names);
await pg.waitForTimeout(800);
await pg.screenshot({ path: '/tmp/lgf/szene.png' });

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
