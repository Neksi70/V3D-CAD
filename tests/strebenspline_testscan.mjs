// Künstlicher "Colani-Kanzel"-Scan für die Strebe→Spline-Tests.
// Nachgebildet nach der Beschreibung des echten Scans (Colani_001.stl):
//  - kegelförmige Spitze unten (Z 0–400), Innenseite
//  - zwei gebogene Streben nach oben/hinten, links bis Z 2100, rechts nur bis Z ~1600
//  - Streben = runde Wülste (~30 mm breit) mit S-Flanken, in sich verdreht
//  - Buckel/Dellen auf dem Kamm, Löcher (auch quer über den Kamm), Rauschen, ein Fremdteil
//  - offenes Netz, NICHT ausgerichtet (gedreht + verschoben)
// Liefert die Soll-Kammlinie im ausgerichteten System (Mitte X=0, Spitze im Ursprung).

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const BEAD_H = 14;          // Wulsthöhe über Flansch (mm)
export const BEAD_SIGMA = 9;       // Gauß-Breite → sichtbar ~30 mm breit
export const BUMPS = [             // Buckel (+) / Dellen (−) auf dem Kamm: t, Höhe mm, Breite in t
  [0.20, +3.0, 0.015], [0.40, -2.5, 0.012], [0.62, +2.0, 0.018], [0.85, -3.0, 0.015]];

// Mittellinie der linken Strebe (Flansch-Mitte), t ∈ [0,1]
export function center(t, side = -1) {
  const x = side * (160 + 540 * Math.sin(Math.PI * t / 2));
  const y = 250 - 1050 * Math.pow(t, 1.4);
  const z = 400 + 1700 * t * (1.25 - 0.25 * t);
  return [x, y, z];
}
function frameAt(t, side) {
  const e = 1e-4;
  const T = norm(sub(center(Math.min(1, t + e), side), center(Math.max(0, t - e), side)));
  const C = center(t, side);
  let b = sub([0, C[1] - 200, C[2]], C);          // zur Kanzel-Innenseite (Fahrzeugmitte)
  b = norm(sub(b, mul(T, dot(b, T))));
  let u = norm(cross(T, b));
  const phi = (15 * Math.PI / 180) * Math.sin(2 * Math.PI * t) * side;   // in sich verdreht
  const c = Math.cos(phi), s = Math.sin(phi);
  const b2 = add(mul(b, c), mul(u, s)), u2 = add(mul(u, c), mul(b, -s));
  return { C, T, b: b2, u: u2 };
}
export function bump(t) { let d = 0; for (const [tj, a, w] of BUMPS) d += a * Math.exp(-0.5 * ((t - tj) / w) ** 2); return d; }
function profile(uu, t) {
  const H = BEAD_H + bump(t);
  return H * Math.exp(-0.5 * (uu / BEAD_SIGMA) ** 2) - 0.002 * uu * uu;
}
export function trueCrest(t, side = -1, withBumps = true) {
  const f = frameAt(t, side);
  return add(f.C, mul(f.b, withBumps ? BEAD_H + bump(t) : BEAD_H));
}

// Rotation (Grad) als 3×3 + Verschiebung: so "liegt" der Scan im Raum
export const MISALIGN = { rz: 7, rx: -4, ry: 3, t: [123, -87, 35] };
function rotMat({ rz, rx, ry }) {
  const d = Math.PI / 180;
  const Rz = [[Math.cos(rz * d), -Math.sin(rz * d), 0], [Math.sin(rz * d), Math.cos(rz * d), 0], [0, 0, 1]];
  const Rx = [[1, 0, 0], [0, Math.cos(rx * d), -Math.sin(rx * d)], [0, Math.sin(rx * d), Math.cos(rx * d)]];
  const Ry = [[Math.cos(ry * d), 0, Math.sin(ry * d)], [0, 1, 0], [-Math.sin(ry * d), 0, Math.cos(ry * d)]];
  const m = (A, B) => A.map((r, i) => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return m(Rz, m(Rx, Ry));
}

export function makeTestScan(opts = {}) {
  const r = rng(opts.seed || 7);
  const dl = opts.dl || 3, du = opts.du || 1.6, noise = opts.noise ?? 0.15;
  const tris = [];
  // Löcher: [side, t0, t1, uMin, uMax]
  const holes = [[-1, 0.30, 0.33, -99, 99], [-1, 0.55, 0.565, -6, 99], [1, 0.45, 0.47, -99, 99], [-1, 0.72, 0.73, -99, 2]];
  for (let k = 0; k < 14; k++) holes.push([r() < 0.5 ? -1 : 1, 0.05 + 0.9 * r(), 0, -60 + 100 * r(), 0]);
  for (const h of holes) if (h[2] === 0) { h[2] = h[1] + 0.006 + 0.006 * r(); h[4] = h[3] + 12 + 10 * r(); }
  const inHole = (side, t, uu) => holes.some(h => h[0] === side && t >= h[1] && t <= h[2] && uu >= h[3] && uu <= h[4]);

  function addGrid(nA, nB, P, keep) {   // P(i,j) → Punkt; Gitter → Dreiecke
    const V = [];
    for (let i = 0; i <= nA; i++) { const row = []; for (let j = 0; j <= nB; j++) { const p = P(i, j); row.push([p[0] + noise * gauss(r), p[1] + noise * gauss(r), p[2] + noise * gauss(r)]); } V.push(row); }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
      if (keep && !keep(i + 0.5, j + 0.5)) continue;
      tris.push(V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j], V[i + 1][j + 1], V[i][j + 1]);
    }
  }
  // Streben
  const W = 55;
  for (const side of [-1, 1]) {
    const tMax = side < 0 ? 1 : 0.68;
    const L = 2400 * tMax, nA = Math.round(L / dl), nB = Math.round(2 * W / du);
    addGrid(nA, nB, (i, j) => {
      const t = tMax * i / nA, uu = -W + 2 * W * j / nB, f = frameAt(t, side);
      return add(add(f.C, mul(f.u, uu)), mul(f.b, profile(uu, t)));
    }, (i, j) => !inHole(side, tMax * i / nA, -W + 2 * W * j / nB));
  }
  // Kegel-Spitze (Innenseite), Spitze im Ursprung
  {
    const nZ = Math.round(430 / dl), nT = Math.round(2 * 80 / 0.6);
    addGrid(nZ, nT, (i, j) => {
      const z = 430 * i / nZ, th = (-80 + 160 * j / nT) * Math.PI / 180, rr = 0.74 * z;
      return [rr * Math.sin(th), rr * Math.cos(th), z];
    }, null);
  }
  // Fremdteil (lose Fläche neben der rechten Strebe)
  addGrid(20, 20, (i, j) => [420 + 3 * i, -100 + 3 * j, 1250 + 0.5 * i], null);

  // Fehlausrichtung anwenden
  const R = rotMat(opts.misalign || MISALIGN), tv = (opts.misalign || MISALIGN).t;
  const pos = new Float32Array(tris.length * 3);
  tris.forEach((p, k) => {
    for (let a = 0; a < 3; a++) pos[k * 3 + a] = R[a][0] * p[0] + R[a][1] * p[1] + R[a][2] * p[2] + tv[a];
  });
  return { positions: pos, nTri: tris.length / 3, R, t: tv };
}

export function toBinarySTL(positions) {
  const n = positions.length / 9, buf = Buffer.alloc(84 + 50 * n);
  buf.write('V3D Testscan Colani-Kanzel', 0); buf.writeUInt32LE(n, 80);
  for (let i = 0; i < n; i++) {
    const o = 84 + 50 * i;
    for (let k = 0; k < 9; k++) buf.writeFloatLE(positions[9 * i + k], o + 12 + 4 * k);
  }
  return buf;
}

// Direktaufruf: STL schreiben  →  node tests/strebenspline_testscan.mjs [ziel.stl]
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const s = makeTestScan();
  const out = process.argv[2] || 'tests/out/colani_testscan.stl';
  fs.mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true });
  fs.writeFileSync(out, toBinarySTL(s.positions));
  console.log(out, s.nTri, 'Dreiecke');
}
