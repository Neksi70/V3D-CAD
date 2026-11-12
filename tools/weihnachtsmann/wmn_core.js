// Sitzender Weihnachtsmann — Distanzfelder, mm, Y oben, Gesicht +Z, Standfläche y = 0. Teile je Farbe:
// Rot (Körper, Mütze, Arme), Weiß (Bart, Umschlag, Bommel, Ärmelbündchen), Haut (Gesichtsband, Nase), Schwarz (Stiefel, Fäustlinge).
// Braucht: _dklH, _dklEll, _dklCone, _lgfSmin, _lgfLevel, _zwiPolyD (Zipfel-Wichtel).
function _wmnFelder(p) {
  const u = p.hoehe / 99;
  const kE = { c: [0, 31 * u, 0], r: [23 * u, 31 * u, 20 * u] };
  const koerperG = (x, y, z) => Math.max(_dklEll(x, y, z, kE.c, kE.r), -y);
  const hutY = 64 * u;                                                     // hoch genug, dass das Gesichtsband zwischen Bart und Umschlag sichtbar bleibt
  const hut = (x, y, z) => Math.max(_dklEll(x, y, z, [0, hutY, -1 * u], [18 * u, 26 * u, 16.5 * u]), hutY - y);
  const arm = (x, y, z) => { const ax = Math.abs(x); return _dklCone(ax, y, z, [17 * u, 40 * u, 0], [26 * u, 21 * u, 6 * u], 6 * u, 5.5 * u); };
  const rot = (x, y, z) => _lgfSmin(_lgfSmin(koerperG(x, y, z), hut(x, y, z), 2 * u), arm(x, y, z), 2.5 * u);
  const ring = (x, y, z, yc, r, h) => { const rr = _dklH(x, z), qx = Math.max(rr - (r - 1.5 * u), 0), qy = Math.max(Math.abs(y - yc) - (h / 2 - 1.5 * u), 0); return _dklH(qx, qy) - 1.5 * u; };
  const umschlag = (x, y, z) => ring(x, y, z, hutY + 1.5 * u, 19.6 * u, 7 * u);
  const bommel = (x, y, z) => _dklH(x, y - 91 * u, z + 1 * u) - 6 * u;
  const buendchen = (x, y, z) => { const ax = Math.abs(x), dx = ax - 25.4 * u, dy = y - 22.2 * u, dz = z - 5.6 * u; return Math.max(_dklH(dx, dy, dz) - 6.6 * u, Math.abs((dx * 9 - dy * 19 + dz * 6) / 21.9) - 1.6 * u); };
  const BP = [[-15, 55.5], [15, 55.5], [14, 42], [8, 26], [0, 15], [-8, 26], [-14, 42]].map(([x, y]) => [x * u, y * u]);
  const bart = (x, y, z) => { if (z < 0) return 10 * u; const d = koerperG(x, y, z), sh = Math.max(d - 1.8 * u, -d - 0.6 * u); return Math.max(sh, _zwiPolyD(BP, x, y)); };
  const weiss = (x, y, z) => Math.min(umschlag(x, y, z), bommel(x, y, z), buendchen(x, y, z), bart(x, y, z));
  const gesicht = (x, y, z) => { if (z < 0) return 10 * u; const d = koerperG(x, y, z), sh = Math.max(d - 0.05 * u, -d - 1.2 * u);
    return Math.max(sh, Math.abs(x) - 14 * u, Math.abs(y - 59 * u) - 4.5 * u); };
  const nY = 57.5 * u, nZ = 20 * u * Math.sqrt(Math.max(0, 1 - ((nY - kE.c[1]) / kE.r[1]) ** 2)) + 1.6 * u;
  const nase = (x, y, z) => _dklH(x, y - nY, z - nZ) - 4.2 * u;
  const haut = (x, y, z) => Math.min(gesicht(x, y, z), nase(x, y, z));
  const stiefel = (x, y, z) => { const ax = Math.abs(x); return Math.max(_dklCone(ax, y, z, [9.5 * u, 6.5 * u, 6 * u], [10.5 * u, 6.5 * u, 22 * u], 6.5 * u, 6.8 * u), -y); };
  const faust = (x, y, z) => _dklH(Math.abs(x) - 27.5 * u, y - 17.5 * u, z - 7.5 * u) - 5 * u;
  const schwarz = (x, y, z) => Math.min(stiefel(x, y, z), faust(x, y, z));
  const B = (x0, y0, z0, x1, y1, z1) => [x0 * u, y0 * u, z0 * u, x1 * u, y1 * u, z1 * u];
  return { u, teile: [['rot', rot, B(-34, 0, -22, 34, 92, 22)], ['weiss', weiss, B(-34, 12, -22, 34, 99, 24)], ['haut', haut, B(-16, 50, 4, 16, 66, 26)], ['schwarz', schwarz, B(-34, 0, -8, 34, 24, 30)]] };
}
function _wmnBuild(w, p, q) {
  const M = w.Manifold, tmp = [], keep = x => { tmp.push(x); return x; };
  try {
    const F = _wmnFelder(p), mf = {};
    for (const [n, f, bb] of F.teile) {
      const V = (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]), ziel = q === 'fein' ? (n === 'haut' ? 3e5 : 1.6e6) : 1.2e5;
      mf[n] = keep(_lgfLevel(w, f, bb, Math.max(0.3, Math.cbrt(V / ziel))));
    }
    // Vorrang: Schwarz > Haut > Weiß > Rot
    mf.haut = keep(M.difference(mf.haut, mf.schwarz));
    mf.weiss = keep(M.difference(keep(M.difference(mf.weiss, mf.schwarz)), mf.haut));
    mf.rot = keep(M.difference(keep(M.difference(keep(M.difference(mf.rot, mf.schwarz)), mf.haut)), mf.weiss));
    for (const n of Object.keys(mf)) { const st = mf[n].decompose(); if (st.length < 2) { st.forEach(x => x.delete()); continue; }
      const v = st.map(x => x.volume()), mx = Math.max(...v), gut = st.filter((x, i) => v[i] >= Math.max(2, mx * 0.005));
      mf[n] = keep(gut.length > 1 ? M.union(gut) : gut[0].translate([0, 0, 0])); st.forEach(x => x.delete()); }
    const out = { u: F.u }; for (const n of Object.keys(mf)) out[n] = mf[n].translate([0, 0, 0]);
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
