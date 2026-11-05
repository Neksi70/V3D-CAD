/*
 * Strebe → Spline — Rechenkern (V3D CAD)
 * Leitkurven für Leisten aus einem 3D-Scan (erste Anwendung: Kanzel Colani-Truck).
 *
 * Läuft unverändert im Browser-Hauptthread, im Web-Worker und in Node (Tests).
 * Alle Längen in mm. Eingabe: Dreiecke als Float32Array (9 Werte je Dreieck),
 * Z = oben. Das Netz darf offen sein, Löcher und viele Einzelteile haben –
 * es werden KEINE Netz-Booleans benutzt, Schnitte arbeiten Dreieck für Dreieck.
 *
 * Schritte:
 *  0 ausrichten()      Symmetrieebene per Spiegeln + ICP, Spitze → Ursprung
 *  1 strebenFinden()   beide Streben als eigene Bereiche (über Löcher hinweg)
 *  2 kammLinie()       Querschnitte ⟂ Strebe, Scheitel der Wulst, Ausreißer/Löcher
 *  3 ausgleichSpline() / stuetzpunkteVorschlagen() / interpolSpline()
 *  4 symmetrie()       links ↔ gespiegelt rechts, gemittelter Spline
 *  5 abweichung()      Spline ↔ Scan-Kamm (Beule +, Delle −)
 *  6 exportJSON/CSV/STEP/Polylinie
 */
(function (root) {
  'use strict';

  // ── Standard-Parameter (zentral, alle in der Oberfläche einstellbar) ────────
  const PARAM_DEFAULT = {
    nickWinkel: 0,           // Grad: Drehung um die Querachse (X) nach der Symmetrie-Ausrichtung
    strebenStartZ: 400,      // ab dieser Höhe (ausgerichtet) beginnen die Streben, darunter Spitze
    schnittAbstand: 10,      // mm zwischen zwei Querschnitten
    suchRadius: 60,          // mm: halbe Breite des Querschnitt-Fensters um die Strebe
    kammHalbbreite: 8,       // mm: Bereich um den Scheitel (Loch-Prüfung, Parabel-Feinlage)
    kappenHoehe: 2.5,        // mm: Parabel nur über die oberste Kappe des Wulstes
    maxKammRadius: 60,       // mm: flacher gekrümmt = keine runde Kuppe (z. B. Flanke an Loch)
    minWulstHoehe: 3,        // mm: flacher als das = kein Wulst erkannt
    lueckenBruecke: 150,     // mm: so lange Lücken (Löcher) werden überbrückt
    ausreisserMm: 3,         // mm: Mindestabstand für "Ausreißer" (zusätzlich zu 3,5·MAD)
    kontrollpunkte: 16,      // Ausgleichsspline: Anzahl Kontrollpunkte (mehr = feiner auflösbar)
    glaettung: 5,            // 0 … 10 → Glättungslänge 20 … 2000 mm (5 = 200 mm)
    stuetzpunkte: 6,         // Vorschlag: Anzahl Stützpunkte
    farbSkalaMm: 0,          // 0 = automatisch (max |Abweichung|)
    symmetrieUebergang: 100, // mm: Überblendung am Ende des Vergleichsbereichs
  };

  // ── kleine Vektor-Helfer ────────────────────────────────────────────────────
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function median(arr) { if (!arr.length) return 0; const a = Float64Array.from(arr).sort(); const m = a.length >> 1; return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]); }
  function quantile(arr, q) { if (!arr.length) return 0; const a = Float64Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))]; }

  // Symmetrische 3×3: größter Eigenvektor (Potenz-Iteration mit Shift) bzw. alle (Jacobi)
  function eigSym3(m) {
    const a = [[m[0][0], m[0][1], m[0][2]], [m[1][0], m[1][1], m[1][2]], [m[2][0], m[2][1], m[2][2]]];
    const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
      if (off < 1e-14) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
        const c = Math.cos(th), s = Math.sin(th);
        for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
      }
    }
    const vals = [a[0][0], a[1][1], a[2][2]];
    const vecs = [0, 1, 2].map(j => [v[0][j], v[1][j], v[2][j]]);
    const idx = [0, 1, 2].sort((i, j) => vals[j] - vals[i]);   // absteigend
    return { values: idx.map(i => vals[i]), vectors: idx.map(i => vecs[i]) };
  }
  function pca(points) {   // points: Array von [x,y,z]
    const n = points.length; const c = [0, 0, 0];
    for (const p of points) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= n; c[1] /= n; c[2] /= n;
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of points) { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
    const e = eigSym3(C);
    return { center: c, axes: e.vectors, values: e.values.map(v => v / n) };
  }

  // Lineares Gleichungssystem (dicht, Gauß mit Pivot). A: Array von Zeilen, b: Array von Spalten-Vektoren
  function solveDense(A, Bcols) {
    const n = A.length, m = Bcols.length;
    const M = A.map((r, i) => r.slice().concat(Bcols.map(b => b[i])));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-300) throw new Error('Gleichungssystem singulär');
      if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c]; if (!f) continue;
        for (let k = c; k < n + m; k++) M[r][k] -= f * M[c][k];
      }
    }
    const X = Bcols.map(() => new Float64Array(n));
    for (let j = 0; j < m; j++) for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n + j]; for (let k = r + 1; k < n; k++) s -= M[r][k] * X[j][k];
      X[j][r] = s / M[r][r];
    }
    return X;
  }

  // 4×4-Matrizen (Zeilen-Hauptordnung, Array 16) — p' = M·p
  const M4 = {
    ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b) { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]; return r; },
    apply(m, p) { return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]]; },
    applyDir(m, p) { return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[4] * p[0] + m[5] * p[1] + m[6] * p[2], m[8] * p[0] + m[9] * p[1] + m[10] * p[2]]; },
    invRigid(m) {   // nur Rotation + Verschiebung
      const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
      const t = M4.applyDir(r, [m[3], m[7], m[11]]);
      r[3] = -t[0]; r[7] = -t[1]; r[11] = -t[2]; return r;
    },
    fromAxes(x, y, z, o) {   // Welt → lokales System (Achsen als Zeilen), Ursprung o
      const r = [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1];
      const t = M4.applyDir(r, o); r[3] = -t[0]; r[7] = -t[1]; r[11] = -t[2]; return r;
    },
  };

  // ── Netz-Daten + Raster ─────────────────────────────────────────────────────
  // Hält Dreiecke + Schwerpunkte und ein gleichmäßiges Raster über die Schwerpunkte
  // (CSR, ohne Map) → schnelle Nachbarsuche auch bei >1 Mio Dreiecken.
  function transformTris(pos, m) {
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      out[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
      out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
      out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    }
    return out;
  }

  function buildGrid(pts, n, cell) {   // pts: Float32Array 3n
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = pts[3 * i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
    const dim = [0, 1, 2].map(a => Math.max(1, Math.ceil((mx[a] - mn[a]) / cell) + 1));
    const nc = dim[0] * dim[1] * dim[2];
    const cellOf = new Int32Array(n), start = new Int32Array(nc + 1);
    for (let i = 0; i < n; i++) {
      const ix = Math.floor((pts[3 * i] - mn[0]) / cell), iy = Math.floor((pts[3 * i + 1] - mn[1]) / cell), iz = Math.floor((pts[3 * i + 2] - mn[2]) / cell);
      const c = ix + dim[0] * (iy + dim[1] * iz); cellOf[i] = c; start[c + 1]++;
    }
    for (let c = 0; c < nc; c++) start[c + 1] += start[c];
    const fill = start.slice(0, nc), items = new Int32Array(n);
    for (let i = 0; i < n; i++) items[fill[cellOf[i]]++] = i;
    return { pts, n, cell, mn, dim, start, items };
  }
  // alle Indizes im Würfel um p mit Radius r (Kandidaten; Abstand prüft der Aufrufer)
  function gridQuery(g, p, r, cb) {
    const lo = [0, 1, 2].map(a => Math.max(0, Math.floor((p[a] - r - g.mn[a]) / g.cell)));
    const hi = [0, 1, 2].map(a => Math.min(g.dim[a] - 1, Math.floor((p[a] + r - g.mn[a]) / g.cell)));
    for (let iz = lo[2]; iz <= hi[2]; iz++) for (let iy = lo[1]; iy <= hi[1]; iy++) {
      const base = g.dim[0] * (iy + g.dim[1] * iz);
      for (let ix = lo[0]; ix <= hi[0]; ix++) {
        const c = base + ix;
        for (let k = g.start[c]; k < g.start[c + 1]; k++) cb(g.items[k]);
      }
    }
  }
  function gridNearest(g, p, rMax) {
    let best = -1, bd = rMax * rMax; const P = g.pts;
    gridQuery(g, p, rMax, i => {
      const dx = P[3 * i] - p[0], dy = P[3 * i + 1] - p[1], dz = P[3 * i + 2] - p[2], d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i; }
    });
    return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
  }

  function makeMesh(pos) {
    const nTri = pos.length / 9 | 0;
    const cen = new Float32Array(nTri * 3);
    let maxEdge = 0;
    for (let t = 0; t < nTri; t++) {
      const o = 9 * t;
      for (let a = 0; a < 3; a++) cen[3 * t + a] = (pos[o + a] + pos[o + 3 + a] + pos[o + 6 + a]) / 3;
      if (t % 7 === 0) {   // grobe Kantenlänge (für Such-Zugaben)
        const e = Math.max(Math.hypot(pos[o] - pos[o + 3], pos[o + 1] - pos[o + 4], pos[o + 2] - pos[o + 5]), Math.hypot(pos[o] - pos[o + 6], pos[o + 1] - pos[o + 7], pos[o + 2] - pos[o + 8]));
        if (e > maxEdge && e < 200) maxEdge = e;
      }
    }
    return { pos, nTri, cen, grid: buildGrid(cen, nTri, 15), maxEdge };
  }

  // ── Schritt 0: Ausrichtung über Symmetrieebene ──────────────────────────────
  // Spiegel-ICP: Punkte p an der aktuellen Ebene spiegeln, nächsten Scanpunkt q
  // zum Spiegelbild suchen → (p,q) sind Partner. Neue Ebene: Normale = Haupt-
  // richtung der Differenzen p−q, Lage = Mitte der Partner. Getrimmt (beste 70 %),
  // weil der Scan nicht symmetrisch vollständig ist (rechte Strebe kürzer, Löcher).
  function mirrorPt(p, n, d) { const s = 2 * (dot(p, n) - d); return [p[0] - s * n[0], p[1] - s * n[1], p[2] - s * n[2]]; }

  function ausrichten(mesh, opt = {}) {
    const P = mesh.cen, N = mesh.nTri, r = rng(opt.seed || 1);
    const nS = Math.min(N, opt.stichprobe || 12000);
    const sample = []; for (let k = 0; k < nS; k++) { const i = Math.floor(r() * N); sample.push([P[3 * i], P[3 * i + 1], P[3 * i + 2]]); }
    const pc = pca(sample);
    const c0 = pc.center;
    // Grobsuche auf ausgedünntem Raster: Score = getrimmter mittlerer Abstand Spiegelbild ↔ Scan.
    // Lage UND Winkel werden gesucht — der Schwerpunkt liegt nicht auf der Mitte,
    // weil der Scan unsymmetrisch vollständig ist (rechte Strebe kürzer).
    const nG = Math.min(N, 40000), gp = new Float32Array(3 * nG);
    for (let k = 0; k < nG; k++) { const i = Math.floor(r() * N); gp[3 * k] = P[3 * i]; gp[3 * k + 1] = P[3 * i + 1]; gp[3 * k + 2] = P[3 * i + 2]; }
    const gG = buildGrid(gp, nG, 30);
    const grobS = sample.slice(0, 1200);
    function score(n, d, rad, trim) {
      const ds = [];
      for (const p of grobS) { const m = mirrorPt(p, n, d); const h = gridNearest(gG, m, rad); ds.push(h ? h.d : rad); }
      ds.sort((a, b) => a - b); const kk = Math.max(1, Math.floor(ds.length * trim));
      let s = 0; for (let i = 0; i < kk; i++) s += ds[i]; return s / kk;
    }
    const nAz = az => [Math.cos(az * Math.PI / 180), Math.sin(az * Math.PI / 180), 0];   // Ebene senkrecht (Scan-Z ≈ oben)
    let best = null;
    for (let az = 0; az < 180; az += 5) {
      const n = nAz(az), dm = median(grobS.map(p => dot(p, n)));
      for (let k = -15; k <= 15; k++) { const d = dm + 20 * k; const s = score(n, d, 60, 0.5); if (!best || s < best.s) best = { n, d, s, az }; }
    }
    // 2. Stufe: Neigung (Scan nicht senkrecht) + Winkel + Lage gemeinsam, dann feiner
    const nAzTi = (az, ti) => { const c = Math.cos(ti * Math.PI / 180); return [c * Math.cos(az * Math.PI / 180), c * Math.sin(az * Math.PI / 180), Math.sin(ti * Math.PI / 180)]; };
    best.ti = 0;
    for (const [dA, dT, dD, nA, nT, nD, rad] of [[2, 2, 10, 3, 6, 6, 50], [0.5, 0.5, 3, 3, 3, 4, 30]]) {
      const b0 = best; best = Object.assign({}, b0, { s: Infinity });
      for (let ia = -nA; ia <= nA; ia++) for (let it = -nT; it <= nT; it++) {
        const az = b0.az + ia * dA, ti = b0.ti + it * dT, n = nAzTi(az, ti);
        const dm = b0.d + dot(sub(n, b0.n), c0);   // Ebene um den Schwerpunkt drehen
        for (let k = -nD; k <= nD; k++) { const d = dm + k * dD; const s = score(n, d, rad, 0.5); if (s < best.s) best = { n, d, s, az, ti }; }
      }
    }
    let n = best.n, d = best.d;
    // Feinlage: Spiegel-ICP mit fallendem Suchradius
    const radii = [30, 20, 15, 12, 10, 8, 8, 6, 6, 5, 5, 5];
    let rms = 0, inl = 0;
    for (const rad of radii) {
      const pairs = [];
      for (const p of sample) { const m = mirrorPt(p, n, d); const h = gridNearest(mesh.grid, m, rad); if (h) pairs.push({ p, q: [P[3 * h.i], P[3 * h.i + 1], P[3 * h.i + 2]], e: h.d }); }
      if (pairs.length < 50) break;
      pairs.sort((a, b) => a.e - b.e);
      const use = pairs.slice(0, Math.floor(pairs.length * 0.7));
      const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let w = 0;
      for (const { p, q } of use) { const v = sub(p, q); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += v[i] * v[j]; w++; }
      let nn = eigSym3(C).vectors[0]; if (dot(nn, n) < 0) nn = mul(nn, -1);
      const ds = use.map(({ p, q }) => dot(nn, mul(add(p, q), 0.5)));
      n = nn; d = median(ds);
      rms = Math.sqrt(use.reduce((s, u) => s + u.e * u.e, 0) / use.length); inl = pairs.length / sample.length;
    }
    // Feinlage Punkt-zu-Fläche (Gauß-Newton auf Winkel + Lage): Spiegelbild soll auf der
    // Tangentialebene des Partner-Dreiecks liegen → rutscht nicht entlang der Fläche.
    {
      const pos = mesh.pos, triN = i => { const o = 9 * i; return norm(cross([pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2]], [pos[o + 6] - pos[o], pos[o + 7] - pos[o + 1], pos[o + 8] - pos[o + 2]])); };
      let az = Math.atan2(n[1], n[0]), ti = Math.asin(Math.max(-1, Math.min(1, n[2])));
      const nOf = (a, t) => [Math.cos(t) * Math.cos(a), Math.cos(t) * Math.sin(a), Math.sin(t)];
      for (let it = 0; it < 8; it++) {
        const nn = nOf(az, ti), pairs = [];
        for (const p of sample) { const m = mirrorPt(p, nn, d); const h = gridNearest(mesh.grid, m, 6); if (h) pairs.push({ p, q: [P[3 * h.i], P[3 * h.i + 1], P[3 * h.i + 2]], nq: triN(h.i), e: h.d }); }
        if (pairs.length < 100) break;
        pairs.sort((a, b) => a.e - b.e);
        const use = pairs.slice(0, Math.floor(pairs.length * 0.8));
        const res = (a, t, dd) => { const n2 = nOf(a, t); return use.map(u => dot(u.nq, sub(mirrorPt(u.p, n2, dd), u.q))); };
        const r0 = res(az, ti, d), ea = 1e-5, ed = 1e-3;
        const ja = res(az + ea, ti, d).map((v, i) => (v - r0[i]) / ea), jt = res(az, ti + ea, d).map((v, i) => (v - r0[i]) / ea), jd = res(az, ti, d + ed).map((v, i) => (v - r0[i]) / ed);
        // robuste Gewichte (Huber 1 mm)
        const w = r0.map(v => Math.abs(v) < 1 ? 1 : 1 / Math.abs(v));
        const J = [ja, jt, jd], A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
        for (let i = 0; i < r0.length; i++) for (let x = 0; x < 3; x++) { b[x] -= w[i] * J[x][i] * r0[i]; for (let y = 0; y < 3; y++) A[x][y] += w[i] * J[x][i] * J[y][i]; }
        let X; try { X = solveDense(A, [b])[0]; } catch (e) { break; }
        az += X[0]; ti += X[1]; d += X[2];
        rms = Math.sqrt(r0.reduce((s2, v) => s2 + v * v, 0) / r0.length);
        if (opt.debug) console.log('p2pl', nOf(az, ti).map(v => v.toFixed(5)).join(','), d.toFixed(3), rms.toFixed(3));
        if (Math.abs(X[2]) < 0.005 && Math.abs(X[0]) < 1e-6 && Math.abs(X[1]) < 1e-6) break;
      }
      n = nOf(az, ti);
    }
    // Achsen: X = Normale (Vorzeichen wie Scan-X), Z = Scan-Z in die Ebene projiziert
    if (n[0] < 0) { n = mul(n, -1); d = -d; }
    let zAx = sub([0, 0, 1], mul(n, n[2])); zAx = norm(zAx);
    let yAx = norm(cross(zAx, n));
    // Nicken: die Symmetrie legt die Drehung IN der Ebene nicht fest → Scan-Z + Korrekturwinkel
    const nw = (opt.nickWinkel || 0) * Math.PI / 180;
    if (nw) { const c = Math.cos(nw), s2 = Math.sin(nw); const z2 = add(mul(zAx, c), mul(yAx, s2)); yAx = add(mul(yAx, c), mul(zAx, -s2)); zAx = z2; }
    // Spitze: tiefster Punkt nahe der Ebene (robust: 0,1-%-Quantil)
    const band = opt.spitzenBand || 25, near = [];
    for (let i = 0; i < N; i++) {
      const p = [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
      if (Math.abs(dot(p, n) - d) < band) near.push(p);
    }
    let tip;
    if (near.length) {
      const zs = near.map(p => dot(p, zAx)); const zq = quantile(zs, 0.001);
      const low = near.filter((p, k) => zs[k] <= zq + 2);
      tip = [0, 0, 0]; low.forEach(p => { tip = add(tip, p); }); tip = mul(tip, 1 / low.length);
    } else tip = c0;
    tip = sub(tip, mul(n, dot(tip, n) - d));   // auf die Ebene
    const A = M4.fromAxes(n, yAx, zAx, tip);
    return { matrix: A, ebene: { n, d }, spitze: tip, rms, anteil: inl, grobScore: best.s };
  }

  // ── Schritt 1: Streben finden ───────────────────────────────────────────────
  // Im ausgerichteten System: alles oberhalb strebenStartZ, nach Vorzeichen von X
  // getrennt. Je Seite Voxel-Zusammenhang mit Lückenbrücke → größter Bereich.
  // Danach eine grobe Mittellinie (Kugel-Verfolgung) als Leitlinie für die Schnitte.
  function strebenFinden(mesh, prm) {
    const P = mesh.cen, N = mesh.nTri, z0 = prm.strebenStartZ;
    const vox = Math.max(8, prm.lueckenBruecke / 6), reach = Math.max(1, Math.round(prm.lueckenBruecke / 2 / vox));
    const seiten = [];
    for (const sgn of [-1, 1]) {
      const idx = [];
      for (let i = 0; i < N; i++) if (P[3 * i + 2] > z0 && sgn * P[3 * i] > 0) idx.push(i);
      if (idx.length < 50) { seiten.push(null); continue; }
      // Voxel belegen
      const key = (x, y, z) => x + ',' + y + ',' + z;
      const vmap = new Map();
      for (const i of idx) { const k = key(Math.floor(P[3 * i] / vox), Math.floor(P[3 * i + 1] / vox), Math.floor(P[3 * i + 2] / vox)); let e = vmap.get(k); if (!e) vmap.set(k, e = { n: 0, comp: -1 }); e.n++; }
      // Komponenten (Nachbarschaft = reach Voxel → überbrückt Löcher)
      let comp = 0; const sizes = [];
      for (const [k, e] of vmap) {
        if (e.comp >= 0) continue;
        e.comp = comp; let size = 0; const stack = [k];
        while (stack.length) {
          const kk = stack.pop(); const ee = vmap.get(kk); size += ee.n;
          const [x, y, z] = kk.split(',').map(Number);
          for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
            const k2 = key(x + dx, y + dy, z + dz); const e2 = vmap.get(k2);
            if (e2 && e2.comp < 0) { e2.comp = comp; stack.push(k2); }
          }
        }
        sizes.push(size); comp++;
      }
      let bestC = 0; sizes.forEach((s, c) => { if (s > sizes[bestC]) bestC = c; });
      const tri = idx.filter(i => vmap.get(key(Math.floor(P[3 * i] / vox), Math.floor(P[3 * i + 1] / vox), Math.floor(P[3 * i + 2] / vox))).comp === bestC);
      const pfad = grobPfad(P, tri, z0, prm);
      let zMin = Infinity, zMax = -Infinity; for (const i of tri) { const z = P[3 * i + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
      seiten.push({ vorzeichen: sgn, tri: Int32Array.from(tri), pfad, zMin, zMax, laenge: pfadLaenge(pfad), verworfen: idx.length - tri.length, teile: comp });
    }
    // Die längere Strebe ist laut Vorgabe "links" (links bis Z ~2100, rechts bis ~1600)
    let links = 0;
    if (seiten[0] && seiten[1]) links = seiten[0].laenge >= seiten[1].laenge ? 0 : 1; else links = seiten[0] ? 0 : 1;
    return { links: seiten[links], rechts: seiten[1 - links] };
  }
  function pfadLaenge(p) { let L = 0; for (let i = 1; i < p.length; i++) L += dist(p[i], p[i - 1]); return L; }

  function grobPfad(P, tri, z0, prm) {
    const n = tri.length, pts = new Float32Array(3 * n);
    for (let k = 0; k < n; k++) { const i = tri[k]; pts[3 * k] = P[3 * i]; pts[3 * k + 1] = P[3 * i + 1]; pts[3 * k + 2] = P[3 * i + 2]; }
    const g = buildGrid(pts, n, 20);
    const R = Math.max(40, prm.suchRadius), step = 20;
    const ball = (c, rad) => { const out = []; gridQuery(g, c, rad, k => { const q = [pts[3 * k], pts[3 * k + 1], pts[3 * k + 2]]; if (dist(q, c) <= rad) out.push(q); }); return out; };
    // Start: unterster Bereich der Strebe
    let zs = []; for (let k = 0; k < n; k++) zs.push(pts[3 * k + 2]);
    const zLo = quantile(zs, 0.002);
    let st = []; for (let k = 0; k < n; k++) if (pts[3 * k + 2] < zLo + 40) st.push([pts[3 * k], pts[3 * k + 1], pts[3 * k + 2]]);
    let c = pca(st).center;
    let b0 = ball(c, R * 1.5); if (b0.length < 10) return [c];
    let dir = pca(b0).axes[0]; if (dir[2] < 0) dir = mul(dir, -1);
    const path = [c]; let gap = 0;
    for (let it = 0; it < 2000; it++) {
      const pred = add(c, mul(dir, step));
      const pts2 = ball(pred, R).filter(q => Math.abs(dot(sub(q, pred), dir)) < step);
      let cn;
      if (pts2.length >= 6) {
        cn = pca(pts2).center; cn = sub(cn, mul(dir, dot(sub(cn, pred), dir)));   // nur quer verschieben
        gap = 0;
      } else { cn = pred; gap += step; if (gap > prm.lueckenBruecke) break; }
      // Selbstberührung (Pfad läuft zurück) → Ende
      let zurueck = false;
      for (let j = 0; j < path.length - 6; j++) if (dist(path[j], cn) < step * 0.8) { zurueck = true; break; }
      if (zurueck) break;
      const bb = ball(cn, R * 1.5);
      if (bb.length >= 10 && gap === 0) {
        const pc2 = pca(bb);
        let d2 = pc2.axes[0]; if (dot(d2, dir) < 0) d2 = mul(d2, -1);
        // nur eindeutig längliche Bereiche und höchstens 25° Abweichung (am Ende ist die Kugel breiter als lang)
        if (pc2.values[0] > 2.5 * pc2.values[1] && dot(d2, dir) > Math.cos(25 * Math.PI / 180)) dir = norm(add(mul(dir, 0.6), mul(d2, 0.4)));
        else if (path.length > 4) { const h = norm(sub(cn, path[path.length - 4])); if (dot(h, dir) > 0.8) dir = norm(add(mul(dir, 0.7), mul(h, 0.3))); }
      }
      path.push(cn); c = cn;
    }
    while (path.length > 1 && gap > 0) { path.pop(); gap -= step; }   // Lücken-Überhang am Ende weg
    return glattPolylinie(path, 2);
  }
  function glattPolylinie(p, it) {
    let q = p.map(v => v.slice());
    for (let k = 0; k < it; k++) q = q.map((v, i) => (i === 0 || i === q.length - 1) ? v : mul(add(add(q[i - 1], mul(v, 2)), q[i + 1]), 0.25));
    return q;
  }
  // Polylinie nach Bogenlänge neu abtasten → Punkte + Tangenten
  function abtasten(path, step) {
    const s = [0]; for (let i = 1; i < path.length; i++) s.push(s[i - 1] + dist(path[i], path[i - 1]));
    const L = s[s.length - 1], out = [];
    if (path.length < 2) return out;
    let j = 0;
    for (let t = 0; t <= L + 1e-6; t += step) {
      while (j < path.length - 2 && s[j + 1] < t) j++;
      const f = (t - s[j]) / ((s[j + 1] - s[j]) || 1);
      const p = add(path[j], mul(sub(path[j + 1], path[j]), f));
      const a = path[Math.max(0, j - 2)], b = path[Math.min(path.length - 1, j + 3)];
      out.push({ s: t, p, t: norm(sub(b, a)) });
    }
    return out;
  }

  // ── Schritt 2: Querschnitt + Kammpunkt ──────────────────────────────────────
  // Dreiecke der Strebe mit der Ebene (Punkt c, Normale T) schneiden → Profilpunkte
  function schnittProfil(mesh, triSet, c, T, rad) {
    const pos = mesh.pos, out = [], rr = rad + (mesh.maxEdge || 10);
    gridQuery(mesh.grid, c, rr, t => {
      if (triSet && !triSet[t]) return;
      const o = 9 * t;
      const v = [[pos[o], pos[o + 1], pos[o + 2]], [pos[o + 3], pos[o + 4], pos[o + 5]], [pos[o + 6], pos[o + 7], pos[o + 8]]];
      const sd = v.map(p => dot(sub(p, c), T));
      for (let a = 0; a < 3; a++) {
        const b = (a + 1) % 3;
        if ((sd[a] < 0) !== (sd[b] < 0)) {
          const f = sd[a] / (sd[a] - sd[b]);
          const q = add(v[a], mul(sub(v[b], v[a]), f));
          if (dist(q, c) <= rad) out.push(q);
        }
      }
    });
    return out;
  }

  // Kammpunkt eines Profils. vorB = Wulstrichtung des Nachbarschnitts (für stetiges Vorzeichen)
  function kammPunkt(prof, c, T, prm, vorB) {
    const res = { ok: false, grund: '', n: prof.length };
    if (prof.length < 8) { res.grund = 'loch'; return res; }
    // 2D-System in der Schnittebene: e1 = Profil-Hauptrichtung
    let e1 = pca(prof).axes[0]; e1 = norm(sub(e1, mul(T, dot(e1, T))));
    let e2 = cross(T, e1);
    let pts = prof.map(q => { const d = sub(q, c); return [dot(d, e1), dot(d, e2)]; });
    pts.sort((a, b) => a[0] - b[0]);
    // Profil-Enden (robust: äußere 3 %) → Sehne; Wulst = größter Abstand zur Sehne
    const k = Math.max(1, Math.floor(pts.length * 0.03));
    const A = avg2(pts.slice(0, k)), B = avg2(pts.slice(-k));
    const span = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (span < 15) { res.grund = 'unvollstaendig'; return res; }
    const u = [(B[0] - A[0]) / span, (B[1] - A[1]) / span], v = [-u[1], u[0]];
    let loc = pts.map(p => [(p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1], (p[0] - A[0]) * v[0] + (p[1] - A[1]) * v[1]]);
    // Vorzeichen: Seite mit größerem Ausschlag, beim Nachbarschnitt dessen Richtung bevorzugen
    let vmax = -Infinity, vmin = Infinity; for (const q of loc) { if (q[1] > vmax) vmax = q[1]; if (q[1] < vmin) vmin = q[1]; }
    let sgn = vmax >= -vmin ? 1 : -1;
    const bdir3 = s => norm(add(mul(e1, s * v[0]), mul(e2, s * v[1])));
    if (vorB) {   // Nachbar-Richtung behalten, außer die Gegenseite schlägt mehr als doppelt so weit aus
      const s2 = dot(bdir3(1), vorB) >= 0 ? 1 : -1;
      const aus = s => s > 0 ? vmax : -vmin;
      if (s2 !== sgn && aus(sgn) < 2 * Math.max(aus(s2), 0.5)) sgn = s2;
    }
    if (sgn < 0) loc = loc.map(q => [q[0], -q[1]]);
    let im = 0; loc.forEach((q, i) => { if (q[1] > loc[im][1]) im = i; });
    const hoehe = loc[im][1];
    if (hoehe < prm.minWulstHoehe) { res.grund = 'flach'; res.hoehe = hoehe; return res; }
    // Parabel-Feinlage um den Scheitel
    const u0 = loc[im][0], hw = prm.kammHalbbreite;
    // Scheitel am Profilende = Profil bricht dort ab (Loch quer über den Kamm)
    if (u0 < hw || u0 > span - hw) { res.grund = 'loch'; return res; }
    const near = loc.filter(q => Math.abs(q[0] - u0) <= hw);
    const links = near.some(q => q[0] < u0 - hw * 0.4), rechts = near.some(q => q[0] > u0 + hw * 0.4);
    if (!links || !rechts) { res.grund = 'loch'; return res; }   // Loch direkt am Kamm
    // Lücke im Profil direkt am Scheitel?
    const us = near.map(q => q[0]).sort((a, b) => a - b);
    for (let i = 1; i < us.length; i++) if (us[i] - us[i - 1] > hw * 0.5) { res.grund = 'loch'; return res; }
    // Feinlage nur über die oberste Kappe (sonst flacht die Parabel die runde Kuppe ab → Kamm zu tief)
    let kap = near.filter(q => q[1] >= hoehe - prm.kappenHoehe);
    if (kap.length < 6 || !kap.some(q => q[0] < u0) || !kap.some(q => q[0] > u0)) kap = near;
    const fit = parabel(kap.map(q => [q[0] - u0, q[1]]));
    let uS = u0, vS = hoehe, kr = 0;
    if (fit && fit[2] < 0) { const x = -fit[1] / (2 * fit[2]); if (Math.abs(x) <= hw) { uS = u0 + x; vS = fit[0] + fit[1] * x + fit[2] * x * x; } kr = -2 * fit[2]; }
    else { res.grund = 'fehlform'; return res; }
    // Runde Kuppe? Krümmung 1/R muss zu einem Wulst passen (Flanke/Fläche = fast gerade)
    if (kr < 1 / prm.maxKammRadius) { res.grund = 'fehlform'; res.hoehe = vS; return res; }
    // zurück nach 3D
    const s = sgn;
    const p2 = [A[0] + uS * u[0] + s * vS * v[0], A[1] + uS * u[1] + s * vS * v[1]];
    const P3 = add(c, add(mul(e1, p2[0]), mul(e2, p2[1])));
    const b3 = bdir3(s);
    // Breite des Wulstes auf halber Höhe (nur Info)
    const half = vS / 2; let ul = uS, ur = uS;
    for (const q of loc) if (q[1] >= half) { if (q[0] < ul) ul = q[0]; if (q[0] > ur) ur = q[0]; }
    return { ok: true, p: P3, b: b3, hoehe: vS, kruemmung: kr, breite: ur - ul, span, n: prof.length, quer: norm(add(mul(e1, u[0]), mul(e2, u[1]))) };
  }
  function avg2(a) { let x = 0, y = 0; for (const p of a) { x += p[0]; y += p[1]; } return [x / a.length, y / a.length]; }
  function parabel(pts) {   // y = a + b x + c x²  (kleinste Quadrate)
    if (pts.length < 4) return null;
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0];
    for (const [x, y] of pts) { const f = [1, x, x * x]; for (let i = 0; i < 3; i++) { R[i] += f[i] * y; for (let j = 0; j < 3; j++) S[i][j] += f[i] * f[j]; } }
    try { const X = solveDense(S, [R]); return [X[0][0], X[0][1], X[0][2]]; } catch (e) { return null; }
  }

  // Alle Schnitte entlang einer Leitlinie (Array {s,p,t}) → Kammpunkte
  function kammLinie(mesh, seite, leit, prm) {
    const triSet = new Uint8Array(mesh.nTri); for (const t of seite.tri) triSet[t] = 1;
    const out = [], hoehen = [], spans = []; let vorB = null;
    for (const L of leit) {
      const prof = schnittProfil(mesh, triSet, L.p, L.t, prm.suchRadius);
      const k = kammPunkt(prof, L.p, L.t, prm, vorB);
      k.s = L.s; k.leit = L.p; k.tan = L.t;
      if (k.ok && hoehen.length >= 5) {
        // passt der Schnitt zu den Nachbarn? (halbes Loch → nur Flansch + eine Flanke übrig)
        const mH = median(hoehen.slice(-12)), mS = median(spans.slice(-12));
        if (k.hoehe < 0.55 * mH || k.hoehe > 1.8 * mH) { k.ok = false; k.grund = 'unvollstaendig'; }
        else if (k.span < 0.7 * mS) { k.ok = false; k.grund = 'unvollstaendig'; }
        else if (vorB && dot(k.b, vorB) < 0.6) { k.ok = false; k.grund = 'fehlform'; }
      }
      if (k.ok) { vorB = k.b; hoehen.push(k.hoehe); spans.push(k.span); }
      out.push(k);
    }
    ausreisserMarkieren(out, prm);
    return out;
  }
  // Ausreißer: je Kammpunkt eine robuste lokale Parabel (x,y,z über s, ±100 mm, Tukey-gewichtet)
  // durch die Nachbarn legen; Abstand des Punktes dazu (quer zur Strebe). Folgt der Biegung der
  // Strebe, lässt sich aber von einigen falschen Schnitten hintereinander (Lochrand) nicht wegziehen.
  function ausreisserMarkieren(k, prm) {
    const ok = k.filter(q => q.ok);
    if (ok.length < 8) return;
    const W = 100, res = new Array(ok.length).fill(0);
    ok.forEach((q, i) => {
      const nb = ok.filter(o => Math.abs(o.s - q.s) <= W);
      if (nb.length < 6) return;
      let w = nb.map(() => 1), f = null;
      for (let it = 0; it < 6; it++) {
        f = [0, 1, 2].map(ax => wParabel(nb.map(o => [o.s - q.s, o.p[ax]]), w));
        if (f.some(x => !x)) return;
        const r = nb.map(o => { const ds = o.s - q.s; const c = f.map(x => x[0] + x[1] * ds + x[2] * ds * ds); const d = sub(o.p, c), T = o.tan || [0, 0, 1]; return len(sub(d, mul(T, dot(d, T)))); });
        const sc = 4.685 * Math.max(1, 1.4826 * median(r));
        w = r.map(v => { const z = v / sc; return z < 1 ? (1 - z * z) ** 2 : 0; });
      }
      const c = f.map(x => x[0]), d = sub(q.p, c), T = q.tan || [0, 0, 1];
      res[i] = len(sub(d, mul(T, dot(d, T))));
    });
    const med = median(res), mad = median(res.map(v => Math.abs(v - med))) * 1.4826;
    const thr = Math.max(prm.ausreisserMm, med + 3.5 * mad);
    ok.forEach((q, i) => { if (res[i] > thr) { q.ok = false; q.grund = 'ausreisser'; q.abw = res[i]; } });
  }
  function wParabel(pts, w) {   // gewichtete Parabel y = a + b x + c x²
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0]; let n = 0;
    pts.forEach(([x, y], i) => { if (!w[i]) return; n++; const f = [1, x, x * x]; for (let a = 0; a < 3; a++) { R[a] += w[i] * f[a] * y; for (let b = 0; b < 3; b++) S[a][b] += w[i] * f[a] * f[b]; } });
    if (n < 4) return null;
    try { const X = solveDense(S, [R]); return [X[0][0], X[0][1], X[0][2]]; } catch (e) { return null; }
  }

  // ── Schritt 3: Splines (kubische B-Splines, offen-geklemmt) ─────────────────
  function knotenUniform(nCtrl, deg = 3) {
    const nk = nCtrl + deg + 1, U = new Float64Array(nk), inner = nCtrl - deg;
    for (let i = 0; i < nk; i++) U[i] = i <= deg ? 0 : i >= nCtrl ? 1 : (i - deg) / inner;
    return U;
  }
  function findSpan(U, n, deg, u) {   // n = nCtrl-1
    if (u >= U[n + 1]) return n;
    if (u <= U[deg]) return deg;
    let lo = deg, hi = n + 1, mid = (lo + hi) >> 1;
    while (u < U[mid] || u >= U[mid + 1]) { if (u < U[mid]) hi = mid; else lo = mid; mid = (lo + hi) >> 1; }
    return mid;
  }
  function basisFuns(U, span, u, deg) {
    const N = new Float64Array(deg + 1), L = new Float64Array(deg + 1), R = new Float64Array(deg + 1);
    N[0] = 1;
    for (let j = 1; j <= deg; j++) {
      L[j] = u - U[span + 1 - j]; R[j] = U[span + j] - u; let saved = 0;
      for (let r = 0; r < j; r++) { const tmp = N[r] / ((R[r + 1] + L[j - r]) || 1e-300); N[r] = saved + R[r + 1] * tmp; saved = L[j - r] * tmp; }
      N[j] = saved;
    }
    return N;
  }
  function bsEval(sp, u) {
    const { ctrl, knots, deg } = sp, n = ctrl.length - 1;
    const span = findSpan(knots, n, deg, u), N = basisFuns(knots, span, u, deg);
    const p = [0, 0, 0];
    for (let j = 0; j <= deg; j++) { const c = ctrl[span - deg + j]; p[0] += N[j] * c[0]; p[1] += N[j] * c[1]; p[2] += N[j] * c[2]; }
    return p;
  }
  function bsSample(sp, n = 400) { const out = []; for (let i = 0; i <= n; i++) out.push(bsEval(sp, i / n)); return out; }

  // Parameter der Messpunkte: Bogenlänge entlang der Kammpunkte, normiert 0…1
  function sehnenParam(pts) {
    const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i], pts[i - 1]));
    const L = s[s.length - 1] || 1; return { u: s.map(v => v / L), L };
  }

  // Ausgleichsspline (P-Spline): min Σ w_i |B(u_i)c − y_i|² + λ Σ |Δ² c|²
  // λ aus dem Regler (0…10, logarithmisch). Robust: 3× Tukey-Neugewichtung.
  function ausgleichSpline(pts, prm, gew) {
    const nC = Math.max(4, Math.min(prm.kontrollpunkte | 0, pts.length));
    const { u, L } = sehnenParam(pts), deg = 3, U = knotenUniform(nC, deg);
    // Regler 0…10 → Glättungslänge 20…2000 mm (log.): kürzere Unebenheiten (Buckel/Dellen)
    // werden ausgeglichen, längere Formen (der Bogen der Strebe) bleiben.
    // 2.-Differenzen-Strafe dämpft Wellenlänge W um λ·(2πh/W)⁴ gegen n/nC Messpunkte je Kontrollpunkt.
    const Lc = glaettungsLaenge(prm.glaettung), h = L / Math.max(1, nC - deg);
    const lam = Lc <= 0 ? 0 : (pts.length / nC) * Math.pow(Lc / (2 * Math.PI * h), 4);
    let w = pts.map((_, i) => gew ? gew[i] : 1);
    let ctrl = null;
    const rows = u.map(ui => { const sp = findSpan(U, nC - 1, deg, ui); return { sp, N: basisFuns(U, sp, ui, deg) }; });
    for (let it = 0; it < 4; it++) {
      const A = Array.from({ length: nC }, () => new Float64Array(nC)), B = [new Float64Array(nC), new Float64Array(nC), new Float64Array(nC)];
      rows.forEach(({ sp, N }, i) => {
        for (let a = 0; a <= deg; a++) {
          const ia = sp - deg + a; for (let ax = 0; ax < 3; ax++) B[ax][ia] += w[i] * N[a] * pts[i][ax];
          for (let b = 0; b <= deg; b++) A[ia][sp - deg + b] += w[i] * N[a] * N[b];
        }
      });
      for (let i = 0; i + 2 < nC; i++) {   // Strafe auf 2. Differenzen
        const d = [1, -2, 1];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) A[i + a][i + b] += lam * d[a] * d[b];
      }
      for (let i = 0; i < nC; i++) A[i][i] += 1e-9;
      const X = solveDense(A.map(r => Array.from(r)), B.map(b => Array.from(b)));
      ctrl = Array.from({ length: nC }, (_, i) => [X[0][i], X[1][i], X[2][i]]);
      if (it === 3) break;
      const sp = { ctrl, knots: U, deg };
      const res = pts.map((p, i) => dist(p, bsEval(sp, u[i])));
      const sc = Math.max(1.0, 1.4826 * median(res)) * 4.685;
      w = res.map((r, i) => { const z = r / sc; const t = z < 1 ? (1 - z * z) ** 2 : 0; return (gew ? gew[i] : 1) * Math.max(t, 1e-3); });
    }
    return { art: 'ausgleich', ctrl, knots: Array.from(U), deg, lambda: lam };
  }

  function glaettungsLaenge(g) { return g <= 0 ? 0 : 20 * Math.pow(10, g * 0.2); }

  // Interpolierender kubischer B-Spline durch Stützpunkte (Piegl/Tiller A9.1)
  function interpolSpline(stuetz) {
    const n = stuetz.length;
    if (n < 2) throw new Error('mind. 2 Stützpunkte');
    const deg = Math.min(3, n - 1);
    const { u } = sehnenParam(stuetz);
    const m = n + deg + 1, U = new Float64Array(m);
    for (let i = 0; i <= deg; i++) { U[i] = 0; U[m - 1 - i] = 1; }
    for (let j = 1; j < n - deg; j++) { let s = 0; for (let i = j; i < j + deg; i++) s += u[i]; U[j + deg] = s / deg; }
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) { const sp = findSpan(U, n - 1, deg, u[i]); const N = basisFuns(U, sp, u[i], deg); for (let j = 0; j <= deg; j++) A[i][sp - deg + j] = N[j]; }
    const X = solveDense(A, [0, 1, 2].map(ax => stuetz.map(p => p[ax])));
    return { art: 'stuetzpunkte', ctrl: Array.from({ length: n }, (_, i) => [X[0][i], X[1][i], X[2][i]]), knots: Array.from(U), deg, stuetz: stuetz.map(p => p.slice()) };
  }

  // Stützpunkte an den "ungestörtesten" Stellen vorschlagen
  // Störung = |Kamm − Ausgleichsspline| + Rauigkeit (2. Differenz) + Nähe zu Loch/Ausreißer
  function stuetzpunkteVorschlagen(kamm, prm, glatt) {
    const N = Math.max(2, prm.stuetzpunkte | 0);
    const ok = kamm.filter(k => k.ok);
    if (ok.length < N) throw new Error('zu wenige gültige Kammpunkte');
    const ref = glatt || ausgleichSpline(ok.map(k => k.p), Object.assign({}, prm, { glaettung: Math.max(prm.glaettung, 6) }));
    const poly = bsSample(ref, 600);
    const bad = kamm.filter(k => !k.ok).map(k => k.s);
    const L = ok[ok.length - 1].s - ok[0].s;
    const stoer = ok.map((k, i) => {
      const r = naechsterPunkt(poly, k.p).d;
      const a = ok[Math.max(0, i - 2)].p, b = ok[Math.min(ok.length - 1, i + 2)].p;
      const rau = len(sub(add(a, b), mul(k.p, 2))) / 2;
      let nahe = Infinity; for (const s of bad) nahe = Math.min(nahe, Math.abs(s - k.s));
      const lochStrafe = nahe < 30 ? (30 - nahe) / 10 : 0;
      return r + rau + lochStrafe;
    });
    const wahl = [];
    for (let j = 0; j < N; j++) {
      const ziel = ok[0].s + L * j / (N - 1), fenster = (L / (N - 1)) * (j === 0 || j === N - 1 ? 0.12 : 0.3);
      let best = -1;
      ok.forEach((k, i) => { if (Math.abs(k.s - ziel) <= fenster && (best < 0 || stoer[i] < stoer[best])) best = i; });
      if (best < 0) { let bd = Infinity; ok.forEach((k, i) => { const d = Math.abs(k.s - ziel); if (d < bd) { bd = d; best = i; } }); }
      if (!wahl.includes(best)) wahl.push(best);
    }
    wahl.sort((a, b) => a - b);
    return wahl.map(i => ({ p: ok[i].p.slice(), s: ok[i].s, stoerung: stoer[i] }));
  }

  // nächster Punkt auf einer Polylinie
  function naechsterPunkt(poly, p) {
    let best = { d: Infinity, q: null, i: 0, f: 0 };
    for (let i = 0; i + 1 < poly.length; i++) {
      const a = poly[i], ab = sub(poly[i + 1], a), l2 = dot(ab, ab) || 1e-12;
      let f = dot(sub(p, a), ab) / l2; f = f < 0 ? 0 : f > 1 ? 1 : f;
      const q = add(a, mul(ab, f)), d = dist(p, q);
      if (d < best.d) best = { d, q, i, f };
    }
    best.t = (best.i + best.f) / Math.max(1, poly.length - 1);
    best.amEnde = (best.i === 0 && best.f === 0) || (best.i === poly.length - 2 && best.f === 1);
    return best;
  }
  function bogenlaengen(poly) { const s = [0]; for (let i = 1; i < poly.length; i++) s.push(s[i - 1] + dist(poly[i], poly[i - 1])); return s; }

  // ── Schritt 4: Symmetrie ────────────────────────────────────────────────────
  const spiegelX = p => [-p[0], p[1], p[2]];
  function splineSpiegeln(sp) {
    const r = { art: sp.art, ctrl: sp.ctrl.map(spiegelX), knots: sp.knots.slice(), deg: sp.deg };
    if (sp.stuetz) r.stuetz = sp.stuetz.map(spiegelX);
    if (sp.lambda !== undefined) r.lambda = sp.lambda;
    return r;
  }
  function symmetrie(spL, spR, prm) {
    const pl = bsSample(spL, 800), prM = bsSample(splineSpiegeln(spR), 800);
    const sL = bogenlaengen(pl);
    const proben = pl.map((p, i) => { const h = naechsterPunkt(prM, p); return { s: sL[i], p, q: h.q, d: h.d, innen: !h.amEnde }; });
    // Vergleichsbereich = zusammenhängend dort, wo der kürzere Spline noch "gegenüber" liegt
    const innen = proben.filter(x => x.innen);
    const ds = innen.map(x => x.d);
    const stat = ds.length ? { max: Math.max(...ds), mittel: ds.reduce((a, b) => a + b, 0) / ds.length, rms: Math.sqrt(ds.reduce((a, b) => a + b * b, 0) / ds.length), von: innen[0].s, bis: innen[innen.length - 1].s, laengeL: sL[sL.length - 1], laengeR: pfadLaenge(prM) } : null;
    let maxAt = null; if (ds.length) { const i = ds.indexOf(stat.max); maxAt = innen[i]; }
    return { proben, stat, maxAt };
  }
  // Gemittelter Spline: im Vergleichsbereich Mitte aus links und gespiegelt rechts,
  // danach (nur die längere Seite hat Daten) die längere Seite, weich übergeblendet.
  // Ergebnis gilt für links; rechts = gespiegelt.
  function gemittelt(spL, spR, prm) {
    const sym = symmetrie(spL, spR, prm);
    if (!sym.stat) throw new Error('kein gemeinsamer Bereich');
    const ue = prm.symmetrieUebergang, bis = sym.stat.bis;
    const pts = sym.proben.map(x => {
      let w = 0.5;
      if (!x.innen && x.s > bis) w = 0;
      else if (x.s > bis - ue) w = 0.5 * Math.max(0, (bis - x.s) / ue);
      if (!x.innen && x.s < sym.stat.von) w = 0;
      return add(mul(x.p, 1 - w), mul(x.q, w));
    });
    const sp = ausgleichSpline(pts, Object.assign({}, prm, { glaettung: Math.min(prm.glaettung, 2) }));
    sp.art = 'gemittelt';
    return { links: sp, rechts: splineSpiegeln(sp), stat: sym.stat };
  }

  // ── Schritt 5: Abweichung Spline ↔ Scan-Kamm ────────────────────────────────
  // + = Kamm liegt über dem Spline (Beule), − = darunter (Delle); gemessen in Wulstrichtung
  function abweichung(sp, kamm) {
    const poly = bsSample(sp, 1000), sP = bogenlaengen(poly);
    const werte = [];
    for (const k of kamm) {
      if (!k.ok) continue;
      const h = naechsterPunkt(poly, k.p);
      const d = sub(k.p, h.q);
      const s = sP[h.i] + h.f * (sP[Math.min(h.i + 1, sP.length - 1)] - sP[h.i]);
      werte.push({ sKamm: k.s, sSpline: s, t: h.t, wert: dot(d, k.b), quer: h.d, p: k.p, q: h.q });
    }
    let max = null, min = null;
    for (const w of werte) { if (!max || w.wert > max.wert) max = w; if (!min || w.wert < min.wert) min = w; }
    const rms = werte.length ? Math.sqrt(werte.reduce((a, w) => a + w.wert * w.wert, 0) / werte.length) : 0;
    return { werte, max, min, rms, laenge: sP[sP.length - 1] };
  }
  // Farbe (blau = Delle, weiß = 0, rot = Beule)
  function farbe(v, skala) {
    const t = Math.max(-1, Math.min(1, v / (skala || 1)));
    if (t >= 0) return [1, 1 - 0.85 * t, 1 - 0.85 * t];
    return [1 + 0.85 * t, 1 + 0.55 * t, 1];
  }

  // ── Schritt 6: Export ───────────────────────────────────────────────────────
  function inSystem(sp, M) {   // Spline in anderes Koordinatensystem (starr) umrechnen
    const r = Object.assign({}, sp, { ctrl: sp.ctrl.map(p => M4.apply(M, p)) });
    if (sp.stuetz) r.stuetz = sp.stuetz.map(p => M4.apply(M, p));
    return r;
  }
  const f3 = v => (Math.round(v * 1000) / 1000);
  function exportJSON(daten) { return JSON.stringify(daten, (k, v) => typeof v === 'number' ? f3(v) : v, 1); }
  function exportCSV(splines) {   // Stützpunkte bzw. Kontrollpunkte
    const z = ['seite;art;nr;x_mm;y_mm;z_mm'];
    for (const [name, sp] of Object.entries(splines)) {
      if (!sp) continue;
      const pts = sp.stuetz || sp.ctrl, art = sp.stuetz ? 'stuetzpunkt' : 'kontrollpunkt';
      pts.forEach((p, i) => z.push([name, art, i + 1, ...p.map(v => f3(v).toFixed(3).replace('.', ','))].join(';')));
    }
    return z.join('\r\n') + '\r\n';
  }
  function exportPolylinie(splines, schritt = 2) {
    const z = ['seite;s_mm;x_mm;y_mm;z_mm'];
    for (const [name, sp] of Object.entries(splines)) {
      if (!sp) continue;
      const poly = bsSample(sp, 2000), s = bogenlaengen(poly);
      let next = 0;
      poly.forEach((p, i) => { if (s[i] >= next || i === poly.length - 1) { z.push([name, f3(s[i]).toFixed(3), ...p.map(v => f3(v).toFixed(3))].join(';').replace(/\./g, ',')); next += schritt; } });
    }
    return z.join('\r\n') + '\r\n';
  }
  // STEP AP214: je Spline ein B_SPLINE_CURVE_WITH_KNOTS (exakt, kein Polygonzug)
  function exportSTEP(splines, info = {}) {
    let id = 0; const L = []; const e = s => { id++; L.push('#' + id + '=' + s + ';'); return '#' + id; };
    const num = v => { const s = (Math.round(v * 1e6) / 1e6).toString(); return /[.eE]/.test(s) ? s : s + '.'; };
    const ctx = e("( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#UNC)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#LEN,#ANG,#SOL)) REPRESENTATION_CONTEXT('Context3D','3D Context with UNIT and UNCERTAINTY') )");
    const len = e('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
    const ang = e('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
    const sol = e('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
    const unc = e("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-03)," + len + ",'distance_accuracy_value','confusion accuracy')");
    L[ctx.slice(1) - 1] = L[ctx.slice(1) - 1].replace('#UNC', unc).replace('#LEN', len).replace('#ANG', ang).replace('#SOL', sol);
    const appCtx = e("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    e("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000," + appCtx + ')');
    const prodCtx = e("PRODUCT_CONTEXT(''," + appCtx + ",'mechanical')");
    const prod = e("PRODUCT('Leitkurven','Leitkurven','',(" + prodCtx + '))');
    const pdf = e("PRODUCT_DEFINITION_FORMATION(''," + "''," + prod + ')');
    const pdCtx = e("PRODUCT_DEFINITION_CONTEXT('part definition'," + appCtx + ",'design')");
    const pd = e("PRODUCT_DEFINITION('design',''," + pdf + ',' + pdCtx + ')');
    const pds = e("PRODUCT_DEFINITION_SHAPE(''," + "''," + pd + ')');
    const curves = [];
    for (const [name, sp] of Object.entries(splines)) {
      if (!sp) continue;
      const cps = sp.ctrl.map(p => e("CARTESIAN_POINT('',(" + p.map(num).join(',') + '))'));
      // Knoten mit Vielfachheiten
      const kn = [], mult = [];
      sp.knots.forEach(k => { if (kn.length && Math.abs(kn[kn.length - 1] - k) < 1e-12) mult[mult.length - 1]++; else { kn.push(k); mult.push(1); } });
      curves.push(e("B_SPLINE_CURVE_WITH_KNOTS('" + name + "'," + sp.deg + ',(' + cps.join(',') + '),.UNSPECIFIED.,.F.,.F.,(' + mult.join(',') + '),(' + kn.map(num).join(',') + '),.UNSPECIFIED.)'));
    }
    const gcs = e("GEOMETRIC_CURVE_SET('Leitkurven',(" + curves.join(',') + '))');
    const rep = e("GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('Leitkurven',(" + gcs + '),' + ctx + ')');
    e('SHAPE_DEFINITION_REPRESENTATION(' + pds + ',' + rep + ')');
    const now = new Date().toISOString().slice(0, 19);
    return 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'' + (info.beschreibung || 'Strebe-Leitkurven') + '\'),\'2;1\');\nFILE_NAME(\'' + (info.name || 'leitkurven.step') + "','" + now + "',('V3D CAD'),(''),'V3D CAD Strebe-Spline','V3D CAD','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n" + L.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n';
  }

  const K = {
    PARAM_DEFAULT, M4, glaettungsLaenge, makeMesh, transformTris, ausrichten, strebenFinden, abtasten, kammLinie, schnittProfil, kammPunkt,
    ausgleichSpline, interpolSpline, stuetzpunkteVorschlagen, bsEval, bsSample, bogenlaengen, naechsterPunkt,
    symmetrie, gemittelt, splineSpiegeln, abweichung, farbe, inSystem, exportJSON, exportCSV, exportPolylinie, exportSTEP,
    _intern: { pca, eigSym3, solveDense, gridNearest, buildGrid },
  };
  // Zweiter Durchgang: Leitlinie = Spline (Schnitte exakt ⟂ zur geglätteten Kammlinie)
  K.leitAusSpline = function (sp, step, versatz) {
    const poly = bsSample(sp, 1500);
    const lin = versatz ? poly : poly;
    return abtasten(lin, step);
  };
  // Komplett-Ablauf für eine Seite: grob → Kamm → Spline → feine Schnitte ⟂ Spline → Kamm
  K.kammZweiPass = function (mesh, seite, prm) {
    const leit1 = abtasten(seite.pfad, prm.schnittAbstand);
    const k1 = kammLinie(mesh, seite, leit1, prm);
    const ok1 = k1.filter(k => k.ok);
    if (ok1.length < 6) return k1;
    const sp = ausgleichSpline(ok1.map(k => k.p), Object.assign({}, prm, { glaettung: Math.max(prm.glaettung, 6), kontrollpunkte: Math.max(prm.kontrollpunkte, 16) }));
    // Leitlinie: Spline um die mittlere Wulsthöhe zurück (Schnittmitte im Profil, nicht am Kamm)
    const leit2 = abtasten(bsSample(sp, 1500), prm.schnittAbstand);
    // mittlere Wulstrichtung je Leitpunkt aus Pass 1 übernehmen
    leit2.forEach(L => {
      let best = null, bd = Infinity; for (const k of ok1) { const d = dist(k.p, L.p); if (d < bd) { bd = d; best = k; } }
      if (best) L.p = sub(L.p, mul(best.b, best.hoehe * 0.5));
    });
    return kammLinie(mesh, seite, leit2, prm);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = K;
  root.StrebenKern = K;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
