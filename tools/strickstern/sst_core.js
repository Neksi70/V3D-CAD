// Strick-Stern-Kern — Höhenfeld über Polarraster (mm, Y oben, Boden y = 0).
// Ein dicker Rand-Strang läuft um den Stern (Mittellinie = abgerundeter Stern,
// Spitzen R − r), je Zacke ein Mittelzopf von der Mitte zur Spitze, dazwischen
// eine gewölbte Füllung. Jeder Strang trägt rechte Maschen (V) wie Grobstrick;
// die höchste Stelle gewinnt (weiches Maximum). Als Höhenfeld ist jede Säule
// voll: druckt flach ohne Stützen.
function _sstGeom(p) {
  const N = Math.max(4, Math.min(9, Math.round(p.zacken))), R = p.dia / 2;
  const r = Math.min(p.strang / 2, R * 0.3);
  const Rv0 = Math.max(r * 1.2, R * p.tiefe / 100 - r);                     // Tal der Rand-Mittellinie
  let P = [];
  for (let k = 0; k < 2 * N; k++) { const a = -Math.PI / 2 + k * Math.PI / N, rr = k & 1 ? Rv0 : R - r; P.push([rr * Math.cos(a), rr * Math.sin(a)]); }
  for (let it = 0; it < 3; it++) {                                          // Chaikin: Ecken runden (Spitzen + Täler)
    const Q = [];
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], f = 0.2;
      Q.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], [a[0] + (b[0] - a[0]) * (1 - f), a[1] + (b[1] - a[1]) * (1 - f)]); }
    P = Q;
  }
  let mx = 0; for (const q of P) mx = Math.max(mx, Math.hypot(q[0], q[1]));
  const sc = (R - r) / mx; P = P.map(q => [q[0] * sc, q[1] * sc]);
  const S = [0]; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; S.push(S[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  let rv = Infinity; for (const q of P) rv = Math.min(rv, Math.hypot(q[0], q[1]));
  const woelb = (p.woelb || 100) / 100;
  const hO = r * 1.3 * woelb, hC = Math.max(hO * 1.2, p.hoehe), hT = hO * 1.1;
  const Ls = R - r * 1.3;
  const tips = Array.from({ length: N }, (_, k) => { const a = -Math.PI / 2 + k * 2 * Math.PI / N; return [Math.cos(a), Math.sin(a)]; });
  return { N, R, r, P, S, L: S[S.length - 1], rv, hO, hC, hT, Ls, tips, Rtal: rv + r };
}
function _sstField(p, g) {
  const { r, P, S, L, hO, hC, Ls, tips, rv } = g, rs = r * 0.9, hS = r * 0.75;
  const T = p.haut === 'glatt' ? 0 : p.mascheT, ml = p.masche;
  const rowsO = Math.max(3, Math.round(L / ml));
  const zopf = p.stil !== 'rand';
  const C = Math.cos(30 * Math.PI / 180), Sn = Math.sin(30 * Math.PI / 180);
  // Grobstrick-Masche: je Reihe zwei schräge, gewölbte Beine (ein „V“, Spitze zur
  // Sternmitte). s in Reihen, u = −1…1 quer. Ergebnis 0 (Kerbe) … 1 (Beinkuppe).
  const chain = (sr, u) => {
    const k0 = Math.floor(sr); let best = 0;
    for (let k = k0 - 1; k <= k0 + 1; k++) for (let side = -1; side <= 1; side += 2) {
      const ds = sr - (k + 0.5), du = u - side * 0.5;
      const a = ds * C + du * side * Sn, b = -ds * side * Sn + du * C;
      const q = 1 - (a / 0.6) ** 2 - (b / 0.5) ** 2;
      if (q > best) best = q;
    }
    return best * (2 - best);                                              // weich auslaufend (√ gäbe senkrechte Kerben → Schattenflecken)
  };
  const inPoly = (x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const rand = (x, z) => {                                                  // nächster Punkt auf dem Rand-Strang: Abstand, Bogenlänge, Seite
    let best = Infinity, s = 0, sd = 1;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = a[0] + dx * t - x, qz = a[1] + dz * t - z, d2 = qx * qx + qz * qz;
      if (d2 < best) { best = d2; s = S[i] + t * (S[i + 1] - S[i]); sd = (dx * (z - a[1]) - dz * (x - a[0])) > 0 ? 1 : -1; }
    }
    return { d: Math.sqrt(best), s, sd };
  };
  const K = 1.2;
  const smax = (a, b) => { if (a < 0) return b; const q = Math.max(0, K - Math.abs(a - b)) / K; return Math.max(a, b) + q * q * K / 4; };
  // Strang: Hülle (1−u²)^0,55, Maschen schneiden bis zu T tief ein (an den Flanken weniger)
  const strang = (u, h, sr, base, fade) => {
    const u2 = u * u; if (u2 >= 1) return -1;
    const env = Math.pow(1 - u2, 0.55);
    let y = base + h * env;
    if (T > 0) y -= Math.min(T, h * 0.7) * (1 - chain(sr, u)) * Math.sqrt(1 - u2) * (fade ?? 1);
    return y;
  };
  // Kissen-Maschen: Bahnen strahlenförmig von der Mitte nach außen
  const nL = Math.max(2 * g.N, Math.round(2 * Math.PI * rv * 0.75 / (2 * rs)));
  const H = (x, z) => {
    let best = -1;
    const ro = rand(x, z), rho = Math.hypot(x, z);
    if (ro.d < r) best = smax(best, strang(ro.sd * ro.d / r, hO, ro.s / L * rowsO, 0));
    let dome = -1;
    if (inPoly(x, z)) {                                                     // Kissen: wölbt sich mit dem Abstand zum Rand → auch die Zacken sind rund
      const t = Math.min(1, ro.d / (rv * 0.9)), sm = 1 - (1 - t) * (1 - t);
      dome = hO * 0.7 + ((zopf ? hC - hS : hC) - hO * 0.7) * sm;
      let y = dome;
      if (T > 0) {
        const f = (Math.atan2(z, x) / (2 * Math.PI) + 1) * nL, u = (f - Math.floor(f)) * 2 - 1;
        y -= T * 0.8 * (1 - chain(rho / ml, u)) * Math.min(1, rho / (r * 2));
      }
      best = smax(best, y);
    }
    if (zopf) for (const t of tips) {                                       // Zopf liegt auf dem Kissen
      let s = x * t[0] + z * t[1]; s = s < 0 ? 0 : s > Ls ? Ls : s;
      const qx = x - t[0] * s, qz = z - t[1] * s, d = Math.hypot(qx, qz); if (d >= rs) continue;
      const sd = (t[0] * z - t[1] * x) > 0 ? 1 : -1;
      best = smax(best, strang(sd * d / rs, hS, s / ml, Math.max(dome, hO * 0.7), Math.min(1, s / (r * 1.5))));
    }
    return Math.max(0, best);
  };
  const covered = (x, z) => inPoly(x, z) || rand(x, z).d < r;
  return { H, covered };
}
// Indiziertes, geschlossenes Netz: Mitte oben + Ringe + Rand (y = 0) + Bodenfächer
function _sstMesh(p, g, nPhi, J) {
  const f = _sstField(p, g), R = g.R, nV = 2 + nPhi * J;
  const V = new Float32Array(nV * 3), T = new Uint32Array((nPhi * (2 * (J - 1) + 2)) * 3);
  V.set([0, f.H(0, 0), 0, 0, 0, 0], 0);
  const id = (i, j) => 2 + (i % nPhi) * J + (j - 1);
  for (let i = 0; i < nPhi; i++) {
    const ph = 2 * Math.PI * i / nPhi, c = Math.cos(ph), s = Math.sin(ph);
    let e = 0;                                                              // äußerste bedeckte Stelle auf dem Strahl
    for (let rho = 0.5; rho <= R + 1; rho += 0.5) if (f.covered(rho * c, rho * s)) e = rho;
    let lo = e, hi = e + 0.5;
    for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (f.covered(m * c, m * s)) lo = m; else hi = m; }
    e = lo;
    for (let j = 1; j <= J; j++) {
      const t = j / J, w = 0.55 * t + 0.45 * Math.sin(t * Math.PI / 2), rho = e * w, o = id(i, j) * 3;
      V[o] = rho * c; V[o + 2] = rho * s; V[o + 1] = j === J ? 0 : Math.max(0.4, f.H(rho * c, rho * s));
    }
  }
  let w = 0; const put = (a, b, c) => { T[w++] = a; T[w++] = b; T[w++] = c; };
  for (let i = 0; i < nPhi; i++) {
    const i1 = i + 1;
    put(0, id(i, 1), id(i1, 1));
    for (let j = 1; j < J; j++) { put(id(i, j), id(i, j + 1), id(i1, j + 1)); put(id(i, j), id(i1, j + 1), id(i1, j)); }
    put(1, id(i1, J), id(i, J));
  }
  return { V, T };
}
function _sstBuild(w, p, q) {
  const g = _sstGeom(p), fine = q === 'fein', M = w.Manifold;
  const nPhi = fine ? Math.max(720, Math.round(2 * Math.PI * g.R / 0.55)) : Math.max(360, Math.round(2 * Math.PI * g.R / 1.2));
  const J = fine ? Math.max(60, Math.round(g.R / 0.5)) : Math.max(36, Math.round(g.R / 1.1));
  const { V, T } = _sstMesh(p, g, nPhi, J);
  let m = new M(new w.Mesh({ numProp: 3, vertProperties: V, triVerts: T }));
  if (m.volume() < 0) { for (let i = 0; i < T.length; i += 3) { const t = T[i + 1]; T[i + 1] = T[i + 2]; T[i + 2] = t; }
    m.delete(); m = new M(new w.Mesh({ numProp: 3, vertProperties: V, triVerts: T })); }
  if (p.oese) {                                                             // senkrechtes Loch in Zacke 1 zum Aufhängen
    const rh = p.oeseD / 2, t = g.tips[0], rho = g.R - g.r;
    const c = M.cylinder(g.hC + 20, rh, rh, 32).rotate([-90, 0, 0]).translate([t[0] * rho, -5, t[1] * rho]);
    const m2 = M.difference(m, c); m.delete(); c.delete(); m = m2;
  }
  return { g, m };
}
