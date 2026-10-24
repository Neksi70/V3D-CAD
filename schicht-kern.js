// GENERIERT aus orca-wasm/web/adaptive-layers.js durch tools/bau_schicht_kern.mjs – NICHT von Hand ändern
window.V3D_SCHICHT = (function () {
// Adaptive Schichthöhe „Automatisch" (Krümmung + Details) — reiner Rechenkern
// ohne DOM, läuft im Browser und in Node (Tests).
//
// Eingabe: Dreiecke eines Objekts in Druck-Koordinaten (z ab 0, nach allen
// Nutzer-Transformationen). Ausgabe: fertige Schichtfolge + ein Orca-
// layer_height_profile, das GENAU diese Folge reproduziert.
//
// Kriterien (je Höhenband, das strengste gewinnt):
//  • Schräge  — Treppenstufen-Fehler ≈ h·|nz| → flache Schrägen fein, Wände grob
//  • Überhang — nach unten zeigende Flächen jenseits ~30° bekommen dünnere Schichten
//  • Relief   — zwischen zwei waagerechten Oberflächen ≤ 3 mm Abstand (Schrift,
//               Prägungen, kleine Stufen) wird fein gedruckt
//  • Kante    — waagerechte Flächen (Oberkante Schrift, Stufen, Deckel, Brücken-
//               unterseiten) liegen EXAKT auf einer Schichtgrenze (kein ±h/2-Fehler)
// Danach wird die Höhe weich begrenzt (max. Änderung je mm), damit keine
// sichtbaren Sprünge zwischen dick und dünn entstehen.
//
// Orca-Profil-Semantik (Slicing.cpp generate_object_layers): die Höhe einer
// Schicht wird bei z_unten + ½·min_layer_height aus dem Profil interpoliert.
// Je Schicht zwei Stützpunkte (z_unten, h) und (z_oben − PE, h) → die Lerp
// liefert exakt h. Erster Wert = Erstschichthöhe, letzter z = Objekthöhe —
// sonst verwirft Orca das Profil still.

const REASON = { BASE: 0, SLOPE: 1, OVERHANG: 2, RELIEF: 3, FIRST: 4 };
const REASON_NAMES = ['Grundhöhe', 'Schräge', 'Überhang', 'Relief/Schrift', 'Erste Schicht'];

const PE = 1e-3;            // Abstand des Schicht-End-Stützpunkts (übersteht Studios %f)
const BIN = 0.05;           // Auflösung der Höhenanalyse in mm
const LEVELS = 24;          // Quantisierung der erlaubten Höhen je Band
const FLAT_NZ = 0.99985;    // |nz| darüber = waagerecht (≤ 1°). NICHT 5°: flach abgeschrägte Deckflächen
                            // (Logos, 1–5°) sind die schlimmsten Treppen und brauchen die feinsten Schichten
const VERT_NZ = 0.0175;     // |nz| darunter = senkrecht (≤ 1°)
const RELIEF_MAX = 3.0;     // Relief-Band: waagerechte Flächen höchstens so weit auseinander
const MIN_KEY_AREA = 1.0;   // mm² — kleinere waagerechte Flächen sind Rauschen (Tessellation)
const SMOOTH_K = 0.1;       // max. Höhenänderung je mm z (0,08 → 0,28 in 2 mm)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Grenzen + Zielgrößen aus Profilwerten und Qualitätsregler (0 = schnell, 1 = fein)
function layerTargets({ hBase, hFirst, hMin, hMax, nozzle, quality = 0.5 }) {
  const nz = nozzle > 0 ? nozzle : 0.4;
  hMin = clamp(hMin > 0 ? hMin : 0.07, 0.03, nz * 0.5);
  hMax = clamp(hMax > 0 ? hMax : nz * 0.75, hMin, nz * 0.85);
  hBase = clamp(hBase > 0 ? hBase : 0.2, hMin, hMax);
  const q = clamp(quality, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  return {
    q, hMin, hMax, hBase, hFirst: hFirst > 0 ? hFirst : hBase,
    hCeil: lerp(hMax, hBase, q),                          // senkrechte Wände
    err: hBase * (1 - 0.6 * q),                           // erlaubte Stufe (senkrecht zur Fläche)
    hOvMin: Math.max(hMin, lerp(hBase, hMin, 0.3 + 0.5 * q)),   // stärkster Überhang
    hRelief: Math.max(hMin, lerp(hBase, hMin, 0.3 + 0.6 * q)),  // Schrift/Relief
  };
}

// pos: Float32Array/Array xyz je Vertex (Druck-Koordinaten); index: optional
function computeLayerPlan(pos, index, opts) {
  const T = layerTargets(opts);
  const { hMin, hMax, hCeil, err, hOvMin, hRelief, hFirst } = T;
  const nTri = index ? Math.floor(index.length / 3) : Math.floor(pos.length / 9);
  let zLo = Infinity, zHi = -Infinity;
  for (let i = 2; i < pos.length; i += 3) { const z = pos[i]; if (z < zLo) zLo = z; if (z > zHi) zHi = z; }
  const H = zHi - zLo;
  if (!(H > hFirst + hMin)) return null;   // zu flach für ein Profil

  const nb = Math.ceil(H / BIN) + 1;
  const histS = new Float64Array(nb * LEVELS);   // Fläche je (Band, Stufe) — Schräge
  const histO = new Float64Array(nb * LEVELS);   // … Überhang
  const lvlOf = (h) => clamp(Math.floor((h - hMin) / (hMax - hMin) * (LEVELS - 1)), 0, LEVELS - 1);
  const lvlH = (l) => hMin + l * (hMax - hMin) / (LEVELS - 1);
  const flats = new Map();   // gerundetes z → { z, up, down } (Fläche)

  const P = (vi, k) => pos[vi * 3 + k];
  for (let t = 0; t < nTri; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    const ax = P(a, 0), ay = P(a, 1), az = P(a, 2) - zLo;
    const ux = P(b, 0) - ax, uy = P(b, 1) - ay, uz = P(b, 2) - zLo - az;
    const vx = P(c, 0) - ax, vy = P(c, 1) - ay, vz = P(c, 2) - zLo - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-12) continue;
    const area = len * 0.5, nz = cz / len, anz = Math.abs(nz);
    const z0 = Math.min(az, az + uz, az + vz), z1 = Math.max(az, az + uz, az + vz);
    if (anz > FLAT_NZ) {
      const zm = (az * 3 + uz + vz) / 3;
      const key = Math.round(zm / 0.005);
      const f = flats.get(key) || { z: 0, w: 0, up: 0, down: 0 };
      f.z += zm * area; f.w += area;
      if (nz > 0) f.up += area; else f.down += area;
      flats.set(key, f);
      continue;
    }
    if (anz < VERT_NZ) continue;
    const hS = err / anz;
    let hO = Infinity;
    if (nz < -0.5) {   // Überhang: 30° (nz −0,5) … 64° (nz −0,9) aus der Senkrechten
      const s = clamp((-nz - 0.5) / 0.4, 0, 1);
      hO = hCeil - (hCeil - hOvMin) * s;
    }
    const h = Math.min(hS, hO);
    if (h >= hCeil) continue;
    const hist = hO < hS ? histO : histS;
    const l = lvlOf(h);
    const b0 = clamp(Math.floor(z0 / BIN), 0, nb - 1), b1 = clamp(Math.floor(z1 / BIN), 0, nb - 1);
    if (b0 === b1) { hist[b0 * LEVELS + l] += area; continue; }
    const span = z1 - z0;
    for (let bi = b0; bi <= b1; bi++) {
      const ov = Math.min(z1, (bi + 1) * BIN) - Math.max(z0, bi * BIN);
      if (ov > 0) hist[bi * LEVELS + l] += area * ov / span;
    }
  }

  // Obergrenze je Band + Grund
  const cap = new Float64Array(nb).fill(hCeil);
  const why = new Uint8Array(nb);   // REASON.BASE
  const minArea = 0.15 * (BIN / 0.05);
  for (let bi = 0; bi < nb; bi++) {
    let cs = 0, co = 0;
    for (let l = 0; l < LEVELS; l++) {
      cs += histS[bi * LEVELS + l]; co += histO[bi * LEVELS + l];
      if (cs + co >= minArea) {
        const h = lvlH(l);
        if (h < cap[bi]) { cap[bi] = h; why[bi] = co > cs ? REASON.OVERHANG : REASON.SLOPE; }
        break;
      }
    }
  }

  // Waagerechte Flächen → Kanten-Höhen (gebündelt)
  const flatList = [...flats.values()].filter(f => f.w >= MIN_KEY_AREA)
    .map(f => ({ z: f.z / f.w, up: f.up, down: f.down, area: f.w })).sort((x, y) => x.z - y.z);
  const clusters = [];
  for (const f of flatList) {
    const last = clusters[clusters.length - 1];
    if (last && f.z - last.z < 0.02) {   // gleiche Ebene (Tessellations-Streuung)
      const w = last.area + f.area;
      last.z = (last.z * last.area + f.z * f.area) / w; last.area = w; last.up += f.up; last.down += f.down;
    } else clusters.push({ ...f });
  }
  // Relief-Bänder: zwischen zwei nach oben zeigenden Flächen ≤ RELIEF_MAX
  const ups = clusters.filter(f => f.up >= MIN_KEY_AREA && f.z > 1e-3);
  for (let i = 1; i < ups.length; i++) {
    const za = ups[i - 1].z, zb = ups[i].z;
    if (zb - za > RELIEF_MAX) continue;
    const b0 = clamp(Math.floor(za / BIN), 0, nb - 1), b1 = clamp(Math.ceil(zb / BIN) - 1, 0, nb - 1);
    for (let bi = b0; bi <= b1; bi++)
      if (hRelief < cap[bi]) { cap[bi] = hRelief; why[bi] = REASON.RELIEF; }
  }

  // Weich begrenzen (Lipschitz in z), Grund der Quelle mitnehmen
  const dk = SMOOTH_K * BIN;
  for (let bi = 1; bi < nb; bi++)
    if (cap[bi - 1] + dk < cap[bi]) { cap[bi] = cap[bi - 1] + dk; why[bi] = why[bi - 1]; }
  for (let bi = nb - 2; bi >= 0; bi--)
    if (cap[bi + 1] + dk < cap[bi]) { cap[bi] = cap[bi + 1] + dk; why[bi] = why[bi + 1]; }

  const binOf = (z) => clamp(Math.floor(z / BIN), 0, nb - 1);
  const minCap = (za, zb) => {
    let m = Infinity, r = REASON.BASE;
    for (let bi = binOf(za), be = binOf(zb - 1e-9); bi <= be; bi++) if (cap[bi] < m) { m = cap[bi]; r = why[bi]; }
    return [m, r];
  };

  // Kanten zum Einrasten: nicht in/zu nah an der ersten Schicht, nicht am Dach,
  // untereinander mindestens hMin Abstand (die größere Fläche gewinnt)
  const keys = [];
  for (const f of clusters) {
    if (f.z < hFirst + hMin - 1e-9 || f.z > H - hMin + 1e-9) continue;
    const last = keys[keys.length - 1];
    if (last && f.z - last.z < hMin) { if (f.area > last.area) keys[keys.length - 1] = f; continue; }
    keys.push(f);
  }

  // Schichten stapeln
  const EPS = 1e-7;
  const layers = [{ z0: 0, h: hFirst, r: REASON.FIRST, snap: false }];
  let z = hFirst, ki = 0;
  while (H - z > EPS) {
    let [h, r] = minCap(z, z + cap[binOf(z)]);
    for (let it = 0; it < 3; it++) {
      const [m, mr] = minCap(z, z + h);
      if (m >= h - 1e-12) break;
      h = m; r = mr;
    }
    h = clamp(h, hMin, hMax);
    if (h >= T.hCeil - 1e-9 && r !== REASON.RELIEF) r = REASON.BASE;
    while (ki < keys.length && keys[ki].z <= z + EPS) ki++;
    const target = ki < keys.length ? keys[ki].z : H;
    const d = target - z;
    // Auf die nächste Kante (oder das Dach) zulaufen: die letzten ≤ 8 Schichten
    // gleichmäßig teilen statt einer dünnen/dicken Restschicht am Ende
    let snap = false;
    let n = Math.ceil(d / h - 1e-9);
    if (n <= 8) {
      if (d / n < hMin) n = Math.max(1, Math.floor(d / hMin + 1e-9));
      h = Math.min(d / n, hMax);
      snap = n === 1 && ki < keys.length;
    }
    if (h < EPS) break;
    layers.push({ z0: z, h, r, snap });
    z += h;
    if (snap || Math.abs(z - target) < EPS) z = target;
  }

  const profile = [];
  layers.forEach((L, i) => {
    profile.push(L.z0, L.h);
    profile.push(i === layers.length - 1 ? H : L.z0 + L.h - PE, L.h);
  });
  profile[profile.length - 2] = H;

  return {
    height: H, layers, profile,
    nLayers: layers.length,
    nUniform: 1 + Math.ceil(Math.max(0, H - hFirst) / T.hBase - 1e-9),
    snaps: layers.filter(L => L.snap).map(L => +(L.z0 + L.h).toFixed(3)),
    targets: T,
  };
}

// ---------------- ✨ Magic: optimale Schichthöhe (+ Lage-Tipp) ----------------
// Kern: Qualitätsstufen durchrechnen, mittleren Stufenfehler h·|nz| auf Schrägen messen.
//  • Beste Qualität = niedrigste Stufe, die höchstens 10 % hinter dem Optimum liegt
//  • Ausgewogen     = niedrigste Stufe innerhalb 35 %
//  • Schnell        = niedrigste Stufe
// Die Lage bleibt (opts.orient = true dreht mit). Eine deutlich bessere Lage (weniger
// Stützen/Stufen; Kandidaten: 6 Achsen + flächenstärkste Facetten nach unten) kommt
// nur als Vorschlag zurück (betterOrientation).
// Matrizen: 3×3 zeilenweise, wirken auf Spaltenvektoren (p' = R·p).

const MAT_I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function matMul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
const ROT_X90 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
const ROT_Y90 = [0, 0, 1, 0, 1, 0, -1, 0, 0];
// Drehung, die den Einheitsvektor n auf t abbildet (Rodrigues)
function rotFromTo(n, t) {
  const c = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
  if (c > 1 - 1e-9) return MAT_I.slice();
  if (c < -1 + 1e-9) {   // 180° um eine zu n senkrechte Achse
    const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let k = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]];
    const l = Math.hypot(...k); k = k.map(v => v / l);
    return [2 * k[0] * k[0] - 1, 2 * k[0] * k[1], 2 * k[0] * k[2],
            2 * k[1] * k[0], 2 * k[1] * k[1] - 1, 2 * k[1] * k[2],
            2 * k[2] * k[0], 2 * k[2] * k[1], 2 * k[2] * k[2] - 1];
  }
  const v = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  const K = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0], K2 = matMul(K, K), f = 1 / (1 + c);
  return MAT_I.map((e, i) => e + K[i] + K2[i] * f);
}
// Positionen drehen und aufs Bett setzen (z ab 0); XY bleibt, wo die Drehung es hinlegt
function rotateToBed(pos, R) {
  const out = new Float32Array(pos.length);
  let zmin = Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z;
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z;
    const zz = out[i + 2] = R[6] * x + R[7] * y + R[8] * z;
    if (zz < zmin) zmin = zz;
  }
  for (let i = 2; i < out.length; i += 3) out[i] -= zmin;
  return out;
}

// Dreiecke einmal vorbereiten (bei großen Netzen gleichmäßig ausgedünnt)
function triTable(pos, index, maxTris = 250000) {
  const n = index ? Math.floor(index.length / 3) : Math.floor(pos.length / 9);
  const step = Math.max(1, Math.ceil(n / maxTris)), m = Math.ceil(n / step);
  const T = new Float64Array(m * 13);   // nx ny nz area | x0 y0 z0 x1 y1 z1 x2 y2 z2
  let k = 0, atot = 0;
  for (let t = 0; t < n; t += step) {
    const vi = [0, 1, 2].map(j => index ? index[t * 3 + j] : t * 3 + j);
    const p = vi.map(v => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(c[0], c[1], c[2]);
    if (len < 1e-12) continue;
    const o = k * 13;
    T[o] = c[0] / len; T[o + 1] = c[1] / len; T[o + 2] = c[2] / len; T[o + 3] = len * 0.5 * step;
    for (let j = 0; j < 3; j++) { T[o + 4 + j * 3] = p[j][0]; T[o + 5 + j * 3] = p[j][1]; T[o + 6 + j * 3] = p[j][2]; }
    atot += T[o + 3]; k++;
  }
  return { T, m: k, atot };
}

// Kennzahlen einer Lage R: Stufenfläche, Überhang (braucht Stützen), Standfläche, Höhe
function orientMetrics(tt, R) {
  const { T, m, atot } = tt;
  let zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < m; k++) for (let j = 0; j < 3; j++) {
    const o = k * 13 + 4 + j * 3, z = R[6] * T[o] + R[7] * T[o + 1] + R[8] * T[o + 2];
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const rx = (q) => R[0] * T[q] + R[1] * T[q + 1] + R[2] * T[q + 2];
  const ry = (q) => R[3] * T[q] + R[4] * T[q + 1] + R[5] * T[q + 2];
  const rz = (q) => R[6] * T[q] + R[7] * T[q + 1] + R[8] * T[q + 2];
  // Nach oben zeigende ebene Dreiecke im Raster: eine nach unten zeigende Fläche, die
  // genau darauf liegt (Böden von Schrift/Kuppel auf einer Platte = mehrere Teilkörper),
  // ist gestützt — kein Überhang
  const CELL = 4, ups = new Map();
  const cellKey = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.round(z / 0.05)}`;
  for (let k = 0; k < m; k++) {
    const o = k * 13;
    if (rz(o) <= FLAT_NZ) continue;
    const xs = [0, 1, 2].map(j => rx(o + 4 + j * 3)), ys = [0, 1, 2].map(j => ry(o + 4 + j * 3));
    const z = rz(o + 4), tri = [xs[0], ys[0], xs[1], ys[1], xs[2], ys[2]];
    for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++)
      for (let cy = Math.floor(Math.min(...ys) / CELL); cy <= Math.floor(Math.max(...ys) / CELL); cy++) {
        const key = `${cx},${cy},${Math.round(z / 0.05)}`;
        const l = ups.get(key); if (l) l.push(tri); else ups.set(key, [tri]);
      }
  }
  const inTri = (px, py, t) => {
    const d1 = (px - t[2]) * (t[1] - t[3]) - (t[0] - t[2]) * (py - t[3]);
    const d2 = (px - t[4]) * (t[3] - t[5]) - (t[2] - t[4]) * (py - t[5]);
    const d3 = (px - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (py - t[1]);
    return !((d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9) && (d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9));
  };
  const resting = (o) => {
    const px = (rx(o + 4) + rx(o + 7) + rx(o + 10)) / 3, py = (ry(o + 4) + ry(o + 7) + ry(o + 10)) / 3;
    const pz = (rz(o + 4) + rz(o + 7) + rz(o + 10)) / 3;
    for (const dz of [0, -1, 1]) {
      const l = ups.get(cellKey(px, py, pz + dz * 0.05));
      if (l && l.some(t => inTri(px, py, t))) return true;
    }
    return false;
  };
  let stair = 0, over = 0, bed = 0, slopeA = 0;
  for (let k = 0; k < m; k++) {
    const o = k * 13, a = T[o + 3];
    const nz = rz(o), anz = Math.abs(nz);
    const tz = Math.min(rz(o + 4), rz(o + 7), rz(o + 10));
    const onBed = tz - zmin < 0.1;
    if (nz < -FLAT_NZ && onBed) { bed += a; continue; }
    if (anz > VERT_NZ && anz < FLAT_NZ) { stair += a * anz; slopeA += a; }
    if (nz < -0.7071 && !onBed && !(nz < -FLAT_NZ && resting(o)))
      over += a * (nz < -FLAT_NZ ? 0.7 : 1);   // flache Decken lassen sich teils überbrücken
  }
  return { stair: stair / atot, over, overShare: over / atot, bed, slopeShare: slopeA / atot, height: zmax - zmin };
}
function orientScore(M, atot) {
  const tinyBed = M.bed < Math.max(20, 0.01 * atot);
  return M.stair + 4 * M.overShare + (tinyBed ? 0.25 : 0) + 0.02 * Math.min(5, M.height / Math.sqrt(atot));
}

// Mittlerer Stufenfehler (mm) auf Schrägen für einen Schichtplan (oder feste Höhe hFixed)
function stairError(tt, plan, hFixed) {
  const { T, m } = tt, L = plan && plan.layers;
  let sum = 0, area = 0, atMin = 0;
  for (let k = 0; k < m; k++) {
    const o = k * 13, anz = Math.abs(T[o + 2]), a = T[o + 3];
    if (anz <= VERT_NZ || anz >= FLAT_NZ) continue;
    let h = hFixed;
    if (L) {
      const zc = (T[o + 6] + T[o + 9] + T[o + 12]) / 3;
      let lo = 0, hi = L.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L[mid].z0 <= zc) lo = mid; else hi = mid - 1; }
      h = L[lo].h;
      if (h <= plan.targets.hMin + 1e-6) atMin += a;
    }
    sum += a * h * anz; area += a;
  }
  return { err: area ? sum / area : 0, slopeArea: area, atMinShare: area ? atMin / area : 0 };
}

// opts: wie computeLayerPlan + current (aktuelle Drehung R), onProgress(text)
// Alle sinnvollen Lagen bewerten: aktuelle, 6 Achsen, flächenstärkste Facetten-Richtungen
// (~10°-Kübel) nach unten. top = beste Lage, aber nur wenn sie spürbar besser ist als die aktuelle.
function orientationCandidates(pos, index, { current = MAT_I } = {}) {
  const tt = triTable(pos, index);
  if (!tt.m) return null;
  const buckets = new Map();
  for (let k = 0; k < tt.m; k++) {
    const o = k * 13, key = `${Math.round(tt.T[o] * 12)},${Math.round(tt.T[o + 1] * 12)},${Math.round(tt.T[o + 2] * 12)}`;
    const b = buckets.get(key);
    if (b) { b.a += tt.T[o + 3]; b.n[0] += tt.T[o] * tt.T[o + 3]; b.n[1] += tt.T[o + 1] * tt.T[o + 3]; b.n[2] += tt.T[o + 2] * tt.T[o + 3]; }
    else buckets.set(key, { a: tt.T[o + 3], n: [tt.T[o] * tt.T[o + 3], tt.T[o + 1] * tt.T[o + 3], tt.T[o + 2] * tt.T[o + 3]] });
  }
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const b of [...buckets.values()].sort((x, y) => y.a - x.a).slice(0, 14)) {
    const l = Math.hypot(...b.n); if (l > 1e-9) dirs.push(b.n.map(v => v / l));
  }
  const cands = [{ R: current, isCurrent: true }];
  for (const d of dirs) {
    const R = rotFromTo(d, [0, 0, -1]);
    if (cands.some(c => Math.abs(c.R[6] - R[6]) + Math.abs(c.R[7] - R[7]) + Math.abs(c.R[8] - R[8]) < 0.02)) continue;   // gleiche „unten"-Richtung
    cands.push({ R, isCurrent: false });
  }
  for (const c of cands) { c.M = orientMetrics(tt, c.R); c.score = orientScore(c.M, tt.atot); }
  const curC = cands[0];
  let top = curC;
  for (const c of cands) if (c.score < top.score) top = c;
  if (top !== curC && !(top.score < curC.score * 0.95 - 0.005)) top = curC;
  return { cands, current: curC, top, atot: tt.atot, tt };
}

// Bis zu `limit` UNTERSCHIEDLICHE Lagen (gleichwertige wie die 6 Würfelseiten zusammengefasst),
// beste zuerst; die aktuelle ist immer dabei. recommended = die zu empfehlende Lage.
function orientationSuggestions(pos, index, { current = MAT_I, limit = 3 } = {}) {
  const oc = orientationCandidates(pos, index, { current });
  if (!oc) return null;
  const sig = (c) => [Math.round(c.M.over / 20), Math.round(c.M.bed / 20), Math.round(c.M.height * 2), Math.round(c.M.stair * 200)].join('|');
  const sorted = [...oc.cands].sort((a, b) => a.score - b.score);
  const seen = new Map(), list = [];
  for (const c of sorted) {
    const k = sig(c);
    if (seen.has(k)) { if (c.isCurrent) { const j = list.indexOf(seen.get(k)); list[j] = c; seen.set(k, c); } continue; }
    seen.set(k, c); list.push(c);
  }
  let out = list.slice(0, limit);
  const curIn = out.find(c => c.isCurrent || sig(c) === sig(oc.current));
  if (!curIn) out.push(oc.current);
  const minStair = Math.min(...out.map(c => c.M.stair));
  return {
    recommended: oc.top.isCurrent || sig(oc.top) === sig(oc.current) ? null : oc.top,
    list: out.map(c => ({ R: c.R, M: c.M, score: c.score,
      isCurrent: c.isCurrent || sig(c) === sig(oc.current), isTop: sig(c) === sig(oc.top),
      lessStairs: c.M.stair <= minStair * 1.1 + 1e-4 })),
  };
}

function magicAnalyze(pos, index, opts) {
  const oc = orientationCandidates(pos, index, { current: opts.current || MAT_I });
  if (!oc) return null;
  const { tt, current: curC, top, cands } = oc;
  const best = opts.orient ? top : curC;

  // Qualitätsstufe in der gewählten Lage
  const rp = rotateToBed(pos, best.R);
  const ttR = triTable(rp, index);
  const qs = tt.m > 150000 ? [0.4, 0.6, 0.8, 1] : [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const runs = qs.map(q => {
    const plan = computeLayerPlan(rp, index, { ...opts, quality: q });
    return { q, plan, ...(plan ? stairError(ttR, plan) : { err: 0, slopeArea: 0, atMinShare: 0 }) };
  }).filter(r => r.plan);
  if (!runs.length) return null;
  const bestErr = Math.min(...runs.map(r => r.err));
  const slopeShare = runs[0].slopeArea / ttR.atot;
  const within = (f) => runs.find(r => r.err <= bestErr * f + 1e-4) || runs[runs.length - 1];
  // kaum Schrägen: der Stufenfehler sagt nichts → Wände sauber (0,7), ohne Übermaß
  const near = (q) => runs.reduce((a, r) => Math.abs(r.q - q) < Math.abs(a.q - q) ? r : a);
  const variants = slopeShare < 0.01
    ? { best: near(0.7), balanced: near(0.5), fast: runs[0] }
    : { best: within(1.1), balanced: within(1.35), fast: runs[0] };
  const pick = variants.best;
  const T0 = layerTargets(opts);
  const summarize = (r) => {
    const hs = r.plan.layers.slice(1).map(L => L.h);
    return { q: r.q, err: r.err, nLayers: r.plan.nLayers, hMin: Math.min(...hs), hMax: Math.max(...hs),
             hAvg: (r.plan.height - r.plan.layers[0].h) / Math.max(1, hs.length) };
  };
  const fixed = stairError(ttR, null, T0.hBase);

  // Hinweise
  const M = best.M, tips = [];
  if (M.over > 25 && M.overShare > 0.01)
    tips.push({ icon: '⚠️', text: `Stützen nötig: ~${Math.round(M.over / 100)} cm² Überhang steiler als 45°` });
  else tips.push({ icon: '✅', text: 'Ohne Stützen druckbar' });
  const foot = Math.sqrt(Math.max(M.bed, 1));
  if (M.bed < 50 || M.height / foot > 4) tips.push({ icon: '🧷', text: `Brim empfohlen — kleine Standfläche (${Math.round(M.bed)} mm²) für ${Math.round(M.height)} mm Höhe` });
  if (pick.plan.snaps.length) tips.push({ icon: '📏', text: `${pick.plan.snaps.length} waagerechte Kante${pick.plan.snaps.length > 1 ? 'n' : ''} (Schrift, Stufen) liegen exakt auf Schichtgrenzen` });
  if (pick.atMinShare > 0.3 && T0.hMin >= 0.07 && slopeShare > 0.05)
    tips.push({ icon: '🔬', text: `${Math.round(pick.atMinShare * 100)} % der Schrägen laufen schon mit Minimum ${T0.hMin.toFixed(2).replace('.', ',')} mm — noch feiner nur mit kleinerer Düse: 0,2-mm-Düse EINBAUEN und dann die Vorlage umstellen` });

  return {
    R: best.R, rotated: best !== curC, orientation: { chosen: M, before: curC.M, tested: cands.length },
    betterOrientation: !opts.orient && top !== curC ? { R: top.R, before: curC.M, after: top.M } : null,
    quality: pick.q, plan: pick.plan, err: pick.err, errBest: bestErr, errFixed: fixed.err,
    variants: { best: summarize(variants.best), balanced: summarize(variants.balanced), fast: summarize(variants.fast) },
    hFixed: T0.hBase, nUniform: pick.plan.nUniform, slopeShare, tips,
  };
}

// ---------------- 3MF mit Schichtprofil (Bambu Studio / OrcaSlicer / Prusa) --------------
// objects: [{ name, pos (xyz, Druck-Koordinaten), index?, profile? }]

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function deflateRaw(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const out = new Response(new Blob([u8]).stream().pipeThrough(cs));
    return new Uint8Array(await out.arrayBuffer());
  } catch { return null; }
}
async function zipFiles(files /* [{name, data: Uint8Array|string}] */) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(raw);
    const def = await deflateRaw(raw);
    const useDef = def && def.length < raw.length;
    const body = useDef ? def : raw;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, useDef ? 8 : 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, useDef ? 8 : 0, true); ch.setUint16(12, 0, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true);
    ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'model/3mf' });
}

const xmlEsc = (s) => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const num = (v) => { const s = v.toFixed(5); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };

// Doppelte Vertices zusammenlegen (nicht-indizierte Netze → geschlossene 3MF-Hülle)
function weld(pos, index) {
  const map = new Map(), verts = [], remap = new Int32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let id = map.get(k);
    if (id === undefined) { id = verts.length / 3; map.set(k, id); verts.push(x, y, z); }
    remap[i] = id;
  }
  const n = index ? index.length : pos.length / 3, tris = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const a = remap[index ? index[i] : i], b = remap[index ? index[i + 1] : i + 1], c = remap[index ? index[i + 2] : i + 2];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { verts, tris };
}

async function build3mf(objects, { title = 'V3D Slicer', settings = null } = {}) {
  let resources = '', build = '', profTxt = '';
  objects.forEach((o, i) => {
    const id = i + 1;
    const { verts, tris } = weld(o.pos, o.index);
    const vs = [], ts = [];
    for (let v = 0; v < verts.length; v += 3) vs.push(`<vertex x="${num(verts[v])}" y="${num(verts[v + 1])}" z="${num(verts[v + 2])}"/>`);
    for (let t = 0; t < tris.length; t += 3) ts.push(`<triangle v1="${tris[t]}" v2="${tris[t + 1]}" v3="${tris[t + 2]}"/>`);
    resources += `<object id="${id}" name="${xmlEsc(o.name || `Objekt ${id}`)}" type="model"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>\n`;
    build += `<item objectid="${id}"/>\n`;
    // Studio/Orca lesen object_id 1-basiert in Objekt-Reihenfolge, Werte mit %f
    if (o.profile && o.profile.length >= 6) profTxt += `object_id=${id}|${o.profile.map(v => v.toFixed(6)).join(';')}\n`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${settings ? ' xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"' : ''}>
<metadata name="Title">${xmlEsc(title)}</metadata>
${settings
    // Als Bambu-Studio-Projekt ausweisen, sonst übernehmen Studio/Orca nur die Geometrie
    ? `<metadata name="Application">BambuStudio-${xmlEsc(String(settings.version || '02.08.02.61'))}</metadata>\n<metadata name="BambuStudio:3mfVersion">1</metadata>`
    : '<metadata name="Application">V3D Slicer</metadata>'}
<resources>
${resources}</resources>
<build>
${build}</build>
</model>`;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="txt" ContentType="text/plain"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: '3D/3dmodel.model', data: model },
  ];
  if (settings) files.push({ name: 'Metadata/project_settings.config', data: JSON.stringify(settings, null, 4) });
  if (profTxt) {
    files.push({ name: 'Metadata/layer_heights_profile.txt', data: profTxt });               // Bambu Studio / OrcaSlicer
    files.push({ name: 'Metadata/Slic3r_PE_layer_heights_profile.txt', data: profTxt });    // PrusaSlicer
  }
  return zipFiles(files);
}

return { computeLayerPlan, layerTargets, REASON_NAMES };
})();
