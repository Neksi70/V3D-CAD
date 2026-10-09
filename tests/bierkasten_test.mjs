// Regressionstest für den Generator „Bierkasten" (🍺, _bkx*).
//   1. alle Varianten bauen wasserdicht, EIN Stück, Volumen > 0
//   2. Außenmaß + Höhe stimmen, Unterseite auf y = 0
//   3. Fächer frei: kein Stegpunkt näher an einer Fachmitte als (Ø + Spiel)/2
//   4. Stapeln: zweiten Kasten absenken, bis er aufsitzt — er muss im Fuß
//      einsinken (greift), und die Flaschen darunter dürfen nicht anstoßen
//   5. ohne Grifflöcher kein Überhang flacher als 45° (+1° Rauschen) (außer Unterseite)
//   6. Erstellen legt ein Teil an
// Start: python3 volme3d_server.py 8851 --dev   →   V3D_URL=http://127.0.0.1:8851/volme3d.html node tests/bierkasten_test.mjs
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
  { name: 'Standard (2 cl, 3×4, Sterne, stapelbar)', p: {} },
  { name: 'Gitter 4×5, 4 cl',                        p: { reihen: 4, spalten: 5, faecher: 'gitter', dia: 30, flH: 105 } },
  { name: 'Alle Seiten, Langloch',                   p: { griff: 'alle', gform: 'langloch' } },
  { name: 'Nicht stapelbar, keine Griffe',           p: { stapel: 0, griff: 'keine' } },
  { name: 'Stapelbar, keine Griffe, eckig',          p: { griff: 'keine', rund: 0 } },
  { name: '1×1, dicke Wand, großer Fuß',             p: { reihen: 1, spalten: 1, wand: 4, fussH: 10 } },
  { name: 'Höhe von Hand, niedrig',                  p: { autoH: 0, hoehe: 40, stapel: 0 } },
];

for (const v of varianten) {
  const r = await pg.evaluate(p => {
    Object.assign(_bkxP, _BKX_DEF, p);
    const t0 = performance.now();
    const res = _bkxBuild(_mfWasm, _bkxP, 'fein'), d = res.d, geo = res.geo;
    const ms = performance.now() - t0;
    const pos = geo.toNonIndexed().attributes.position.array;
    const W = _mfWasm, mf = _mfFromSoup(W, pos);
    const genus = mf.genus(), vol = mf.volume(), parts = mf.decompose().length;
    geo.computeBoundingBox(); const bb = geo.boundingBox;
    // Fächer frei
    const R = (_bkxP.dia + _bkxP.spiel) / 2;
    let enge = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (y < d.zf + 0.05 || y > d.H - 0.5) continue;
      for (let a = 0; a < d.nx; a++) for (let c = 0; c < d.ny; c++) {
        const cx = -d.Wi / 2 + d.pitch * (a + 0.5), cz = -d.Di / 2 + d.pitch * (c + 0.5);
        enge = Math.min(enge, Math.hypot(x - cx, z - cz) - R);
      }
    }
    // Überhang (Normale nach unten, über der Unterseite)
    let ueber = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const A = [pos[i], pos[i+1], pos[i+2]], B = [pos[i+3], pos[i+4], pos[i+5]], C = [pos[i+6], pos[i+7], pos[i+8]];
      const ux = B[0]-A[0], uy = B[1]-A[1], uz = B[2]-A[2], vx = C[0]-A[0], vy = C[1]-A[1], vz = C[2]-A[2];
      const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx, nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9 || Math.min(A[1], B[1], C[1]) < 0.01) continue;
      if (ny / nl < -0.72) ueber += nl / 2;                            // Fase genau 45°, 1° Rauschen
    }
    // Stapeln: oberen Kasten absenken bis Berührung
    let stapel = null;
    if (d.stapel) {
      const hit = sink => { const up = mf.translate([0, d.H - sink, 0]); const x = mf.intersect(up); const v2 = x.volume(); x.delete(); up.delete(); return v2 > 0.5; };
      let lo = 0, hi = d.fH + d.s + d.cTop + 3;   // Fuß senkrecht: Sitz bei ≈ Fuß + Passung + Fase
      if (!hit(hi)) stapel = { sink: hi, frei: false };
      else { for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (hit(m)) hi = m; else lo = m; }
        stapel = { sink: lo, luftFlasche: (d.H - lo) - (d.zf + _bkxP.flH) }; }
    }
    mf.delete();
    return { ms: Math.round(ms), genus, vol: Math.round(vol), parts, tris: pos.length / 9,
             y0: bb.min.y, y1: bb.max.y, sx: bb.max.x - bb.min.x, sz: bb.max.z - bb.min.z,
             Wo: d.Wo, Do: d.Do, H: d.H, enge, ueber, stapel, stapelOk: d.stapelOk, fH: d.fH, griff: _bkxP.griff };
  }, v.p);
  console.log(v.name, JSON.stringify(r));
  ok(v.name + ': wasserdicht, ein Teil, Volumen > 0', r.parts === 1 && r.vol > 0, { parts: r.parts, vol: r.vol });
  ok(v.name + ': Unterseite y=0, Höhe', Math.abs(r.y0) < 1e-3 && Math.abs(r.y1 - r.H) < 0.05, [r.y0, r.y1, r.H]);
  ok(v.name + ': Außenmaß', Math.abs(r.sx - r.Wo) < 0.05 && Math.abs(r.sz - r.Do) < 0.05, [r.sx, r.sz]);
  ok(v.name + ': Fächer frei', r.enge >= -0.05, r.enge);
  if (r.griff === 'keine') ok(v.name + ': kein Überhang > 46°', r.ueber < 1, r.ueber);
  if (r.stapel) {
    ok(v.name + ': Stapel greift (sinkt ≥ Fußhöhe ein)', r.stapel.sink >= r.fH - 0.01, r.stapel.sink);
    if (r.stapelOk) ok(v.name + ': Flaschen stoßen beim Stapeln nicht an', r.stapel.luftFlasche > 0.5, r.stapel.luftFlasche);
  }
}

const ui = await pg.evaluate(async () => {
  Object.assign(_bkxP, _BKX_DEF);
  _bkxOpen();
  await new Promise(r => setTimeout(r, 600));
  const info = document.getElementById('bkx-info').textContent;
  _bkxSet('hoehe', 50);
  const warn = /Zu niedrig zum Stapeln/.test(document.getElementById('bkx-info').textContent);
  _bkxSet('autoH', 1);
  const n0 = objects.length;
  await _bkxCreate();
  return { info, warn, n: objects.length - n0, name: objects[objects.length - 1]?.userData?.name,
           open: document.getElementById('bkx-modal').classList.contains('show') };
});
ok('Info zeigt Maße', /Kasten .* mm/.test(ui.info) && /12 Fächer/.test(ui.info), ui.info);
ok('Warnung bei zu niedriger Höhe', ui.warn);
ok('Erstellen legt ein Teil an', ui.n === 1 && /Bierkasten/.test(ui.name) && !ui.open, ui);
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors);
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
