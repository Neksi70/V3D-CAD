// Regressionstest für den Halterplatten-Generator (🪛 Halterplatte).
//
// Geprüft wird, was beim Drucken zählt:
//   1. die Hülle ist WASSERDICHT (jede Kante genau 2×, gegenläufig) — Sacklöcher
//      werden konstruktiv gebaut, genau um den BSP-Sackloch-Bug zu umgehen
//   2. die Außenmaße stimmen mit dem angezeigten Layout überein
//   3. die Aufnahmen sind wirklich da: Material fehlt an den Lochpositionen
//   4. Sackloch bleibt Sackloch (Boden dicht), durchgehend geht wirklich durch
//   5. das Spar-Gitter hebt den Materialverbrauch nicht auf und bleibt dicht
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
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

// Analyse-Helfer in die Seite injizieren
await pg.evaluate(() => {
  window._hpTest = {
    // Kanten-Parität: geschlossene Mannigfaltigkeit ⇒ jede Kante genau 1× hin, 1× zurück
    watertight(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const key = i => {
        const j = idx ? idx.getX(i) : i;
        return Math.round(p.getX(j) * 1e4) + ',' + Math.round(p.getY(j) * 1e4) + ',' + Math.round(p.getZ(j) * 1e4);
      };
      const m = new Map();
      let tris = 0, degen = 0;
      for (let t = 0; t < n; t += 3) {
        const a = key(t), b = key(t + 1), c = key(t + 2);
        if (a === b || b === c || a === c) { degen++; continue; }
        tris++;
        for (const [u, v] of [[a, b], [b, c], [c, a]]) m.set(u + '|' + v, (m.get(u + '|' + v) || 0) + 1);
      }
      let bad = 0;
      for (const [k, cnt] of m) {
        const [u, v] = k.split('|');
        if (cnt !== 1 || (m.get(v + '|' + u) || 0) !== 1) bad++;
      }
      return { tris, degen, badEdges: bad };
    },
    // grober Punkt-im-Körper-Test per Strahlschnitt entlang +Y (ungerade Treffer = innen)
    hitsBelow(geo, x, z, y) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const g = i => { const j = idx ? idx.getX(i) : i; return [p.getX(j), p.getY(j), p.getZ(j)]; };
      let hits = 0;
      for (let t = 0; t < n; t += 3) {
        const A = g(t), B = g(t + 1), C = g(t + 2);
        // Strahl von (x, y, z) nach +Y: Dreieck in XZ projizieren
        const d1 = (B[0] - A[0]) * (z - A[2]) - (B[2] - A[2]) * (x - A[0]);
        const d2 = (C[0] - B[0]) * (z - B[2]) - (C[2] - B[2]) * (x - B[0]);
        const d3 = (A[0] - C[0]) * (z - C[2]) - (A[2] - C[2]) * (x - C[0]);
        if (!((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0))) continue;
        const area = (B[0] - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (B[2] - A[2]);
        if (Math.abs(area) < 1e-12) continue;
        const w1 = ((B[0] - x) * (C[2] - z) - (C[0] - x) * (B[2] - z)) / area;
        const w2 = ((C[0] - x) * (A[2] - z) - (A[0] - x) * (C[2] - z)) / area;
        const w3 = 1 - w1 - w2;
        const hy = w1 * A[1] + w2 * B[1] + w3 * C[1];
        if (hy > y + 1e-6) hits++;
      }
      return hits;
    },
    inside(geo, x, z, y) { return this.hitsBelow(geo, x, z, y) % 2 === 1; },
  };
});

const U = 0.1;   // 1 Unit = 10 mm

console.log('\n=== 1. Wasserdicht in allen Formen/Betriebsarten ===');
const r1 = await pg.evaluate(() => {
  const cases = [
    ['Bohrersatz rund gestaffelt', { shape: 'round', cols: 8, rows: 1, size: 3, grade: 1, step: 1, label: 0 }],
    ['Sechskant (Inbus)', { shape: 'hex', cols: 6, rows: 2, size: 4, grade: 1, step: 0.5, label: 0 }],
    ['Quadrat, Raster', { shape: 'square', cols: 4, rows: 3, size: 10, grade: 0, label: 0 }],
    ['Rechteck-Schlitz (Topper)', { shape: 'rect', cols: 5, rows: 2, size: 3, size2: 40, grade: 0, label: 0 }],
    ['durchgehende Löcher', { shape: 'round', cols: 4, rows: 2, size: 8, grade: 0, through: 1, label: 0 }],
    ['Spar-Gitter', { shape: 'round', cols: 6, rows: 2, size: 6, grade: 0, fill: 'grid', fillPct: 40, h: 30, depth: 12, label: 0 }],
    ['ohne Fase, ohne Eckenradius', { shape: 'round', cols: 3, rows: 1, size: 12, grade: 0, cham: 0, corner: 0, label: 0 }],
    ['festes Außenmaß', { shape: 'round', cols: 6, rows: 1, size: 5, grade: 0, outer: 'fixed', ow: 200, od: 60, label: 0 }],
    ['Außenmaß zu klein', { shape: 'round', cols: 10, rows: 1, size: 12, grade: 0, outer: 'fixed', ow: 40, od: 20, label: 0 }],
    ['eine einzelne Aufnahme', { shape: 'round', cols: 1, rows: 1, size: 20, grade: 0, label: 0 }],
  ];
  return cases.map(([name, over]) => {
    const p = { ..._HP_DEFAULTS, ...over };
    try {
      const geo = _hpBuild(p, false);
      return { name, ...window._hpTest.watertight(geo) };
    } catch (e) { return { name, error: String(e) }; }
  });
});
for (const r of r1) ok(r.name, !r.error && r.badEdges === 0 && r.tris > 50, r);

console.log('\n=== 2. Außenmaße = angezeigtes Layout ===');
const r2 = await pg.evaluate(() => {
  const p = { ..._HP_DEFAULTS, shape: 'round', cols: 8, rows: 1, size: 3, grade: 1, step: 1, h: 22, label: 0 };
  const L = _hpLayout(p), geo = _hpBuild(p, false);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  return {
    layout: { W: +L.W.toFixed(2), D: +L.D.toFixed(2), H: L.H },
    mesh: { W: +((bb.max.x - bb.min.x) * 10).toFixed(2), D: +((bb.max.z - bb.min.z) * 10).toFixed(2), H: +((bb.max.y - bb.min.y) * 10).toFixed(2) },
    y0: +bb.min.y.toFixed(4),
    sizes: { min: L.minNom, max: L.maxNom },
  };
});
ok('Länge stimmt', Math.abs(r2.layout.W - r2.mesh.W) < 0.05, r2);
ok('Breite stimmt', Math.abs(r2.layout.D - r2.mesh.D) < 0.05);
ok('Höhe stimmt', Math.abs(r2.layout.H - r2.mesh.H) < 0.05);
ok('steht auf y = 0', Math.abs(r2.y0) < 1e-6, r2.y0);
ok('Staffelung 3 → 10 mm', r2.sizes.min === 3 && r2.sizes.max === 10, r2.sizes);

console.log('\n=== 3. Aufnahmen sind wirklich Löcher ===');
const r3 = await pg.evaluate(() => {
  const U = 0.1;
  const p = { ..._HP_DEFAULTS, shape: 'round', cols: 4, rows: 1, size: 8, grade: 0, clr: 0, depth: 12, h: 20, cham: 0, label: 0, fill: 'solid' };
  const L = _hpLayout(p), geo = _hpBuild(p, false);
  const T = window._hpTest;
  const a = L.aps[1];
  return {
    // knapp unter der Oberfläche in der Lochmitte → muss LEER sein
    lochMitte: T.inside(geo, a.x * U, a.z * U, (L.H - 0.5) * U),
    // dicht am Lochrand, aber im Steg → muss MATERIAL sein
    steg: T.inside(geo, (a.x + L.aps[0].x) / 2 * U, a.z * U, (L.H - 0.5) * U),
    // unter dem Taschenboden → Material (Sackloch!)
    unterTasche: T.inside(geo, a.x * U, a.z * U, (L.H - L.T - 0.4) * U),
    // im Taschenraum selbst → leer
    inTasche: T.inside(geo, a.x * U, a.z * U, (L.H - L.T + 0.4) * U),
    T: L.T, H: L.H,
  };
});
ok('Lochmitte oben ist leer', r3.lochMitte === false, r3);
ok('Steg zwischen den Löchern ist massiv', r3.steg === true);
ok('Sackloch: unter dem Taschenboden ist Material', r3.unterTasche === true);
ok('Sackloch: in der Tasche ist Luft', r3.inTasche === false);

console.log('\n=== 4. Durchgehende Löcher gehen wirklich durch ===');
const r4 = await pg.evaluate(() => {
  const U = 0.1;
  const p = { ..._HP_DEFAULTS, shape: 'round', cols: 3, rows: 1, size: 10, grade: 0, clr: 0, through: 1, h: 15, cham: 0, label: 0 };
  const L = _hpLayout(p), geo = _hpBuild(p, false), T = window._hpTest;
  const a = L.aps[1];
  return {
    unten: T.inside(geo, a.x * U, a.z * U, 0.5 * U),
    mitte: T.inside(geo, a.x * U, a.z * U, (L.H / 2) * U),
    steg: T.inside(geo, (a.x + L.aps[0].x) / 2 * U, a.z * U, (L.H / 2) * U),
  };
});
ok('durchgehend: unten leer', r4.unten === false, r4);
ok('durchgehend: Mitte leer', r4.mitte === false);
ok('durchgehend: Steg massiv', r4.steg === true);

console.log('\n=== 5. Spar-Gitter spart wirklich und bleibt geschlossen ===');
const r5 = await pg.evaluate(() => {
  const base = { ..._HP_DEFAULTS, shape: 'round', cols: 6, rows: 3, size: 6, grade: 0, h: 34, depth: 12, label: 0 };
  const vol = geo => {   // Signiertes Volumen über das Divergenztheorem
    const p = geo.attributes.position, idx = geo.index, n = idx ? idx.count : p.count;
    const g = i => { const j = idx ? idx.getX(i) : i; return [p.getX(j), p.getY(j), p.getZ(j)]; };
    let v = 0;
    for (let t = 0; t < n; t += 3) {
      const A = g(t), B = g(t + 1), C = g(t + 2);
      v += (A[0] * (B[1] * C[2] - C[1] * B[2]) - A[1] * (B[0] * C[2] - C[0] * B[2]) + A[2] * (B[0] * C[1] - C[0] * B[1])) / 6;
    }
    return v * 1000;   // Units³ → mm³
  };
  const solid = _hpBuild({ ...base, fill: 'solid' }, false);
  const grid = _hpBuild({ ...base, fill: 'grid', fillPct: 40 }, false);
  const gc = _hpGridCells(_hpLayout({ ...base, fill: 'grid', fillPct: 40 }), { ..._hpLayout({ ...base, fill: 'grid', fillPct: 40 }) });
  return {
    solid: Math.round(vol(solid)), grid: Math.round(vol(grid)),
    zellen: _hpGridCells({ ...base, fill: 'grid', fillPct: 40 }, _hpLayout({ ...base, fill: 'grid', fillPct: 40 })).cells.length,
    dicht: window._hpTest.watertight(grid),
  };
});
ok('Gitter hat Aussparungen', r5.zellen > 4, r5);
ok('Gitter spart Material', r5.grid > 0 && r5.grid < r5.solid * 0.92, { solid: r5.solid, grid: r5.grid });
ok('Gitter-Hülle geschlossen', r5.dicht.badEdges === 0, r5.dicht);

console.log('\n=== 6. Beschriftung + Erstellen in der Szene ===');
const r6 = await pg.evaluate(async () => {
  await new Promise(res => _npLoadFont('baloo_local', res));
  const before = objects.length;
  Object.assign(_hpP, _HP_DEFAULTS);
  const geoOhne = _hpBuild({ ..._HP_DEFAULTS, label: 0 }, false);
  const geoMit = _hpBuild({ ..._HP_DEFAULTS, label: 1 }, false);
  _createHp();
  const o = objects[objects.length - 1];
  return {
    fontDa: !!_hpFont(),
    mehrDreiecke: geoMit.index.count > geoOhne.index.count,
    neu: objects.length - before,
    typ: o?.userData?.shapeType,
    name: o?.userData?.name,
    hatParams: o?.userData?.hpShape === 'round' && o?.userData?.hpCols === 8,
  };
});
ok('Schrift geladen (lokal, kein CDN)', r6.fontDa === true, r6);
ok('Beschriftung fügt Geometrie hinzu', r6.mehrDreiecke === true);
ok('Objekt landet in der Szene', r6.neu === 1 && r6.typ === 'holder');
ok('Parameter am Objekt gespeichert', r6.hatParams === true);

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log('\n' + (fails.length ? '❌ FEHLGESCHLAGEN: ' + fails.join(', ') : '✅ alle Prüfungen bestanden'));
process.exit(fails.length ? 1 : 0);
