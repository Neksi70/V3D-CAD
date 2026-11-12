// Zipfel-Wichtel (Christmas Gnome) — Distanzfelder, mm, Y oben, Gesicht +Z, Standfläche y = 0. Teile je Farbe:
// Körper (Ei mit senkrechten Holzrillen), Mütze (rot), Weiß (Umschlag, Bommel, Bart als Auflage vorn), Nase (Holzkugel).
// Braucht aus der App: _dklH, _dklEll, _dklCone, _lgfSmin, _lgfLevel.
function _zwiPolyD(P, x, y) {                                               // vorzeichenbehafteter Abstand zu einem Polygon (innen < 0)
  let d = Infinity, inn = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, ay] = P[j], [bx, by] = P[i], ex = bx - ax, ey = by - ay, L = ex * ex + ey * ey;
    let t = L ? ((x - ax) * ex + (y - ay) * ey) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - ax - t * ex, dy = y - ay - t * ey; d = Math.min(d, dx * dx + dy * dy);
    if ((ay > y) !== (by > y) && x < ax + (y - ay) / (by - ay) * ex) inn = !inn;
  }
  return inn ? -Math.sqrt(d) : Math.sqrt(d);
}
function _zwiFelder(p) {
  const u = p.hoehe / 104.5, nR = Math.max(12, Math.round(p.rillen)), aR = 0.7 * u * p.rillenTief / 100;
  const rip = (x, z) => Math.sqrt(Math.abs(Math.cos(nR * Math.atan2(z, x) / 2)));
  const kE = { c: [0, 30 * u, 0], r: [17 * u, 34 * u, 17 * u] };
  const koerperGlatt = (x, y, z) => Math.max(_dklEll(x, y, z, kE.c, kE.r), -y);
  const koerper = (x, y, z) => { let d = koerperGlatt(x, y, z); if (aR > 0 && Math.abs(d) < 3 * aR && y > 1) d -= aR * (rip(x, z) - 0.6); return d; };
  const yU = 56 * u, hU = 7.5 * u, rU = 15.5 * u;
  const umschlag = (x, y, z) => { const r = _dklH(x, z), qx = Math.max(r - (rU - 2 * u), 0), qy = Math.max(Math.abs(y - (yU + hU / 2)) - (hU / 2 - 2 * u), 0); return _dklH(qx, qy) - 2 * u; };
  const muetze = (x, y, z) => Math.max(_dklCone(x, y, z, [0, yU + hU * 0.5, 0], [p.zipfel * u, 98 * u, 0], 14 * u, 1.8 * u), yU + 1 * u - y);
  const bommel = (x, y, z) => _dklH(x - p.zipfel * u * 1.02, y - 100 * u, z) - 4.6 * u;
  const B = [[-12.5, 58.5], [12.5, 58.5], [13.5, 42], [11, 28], [5, 17], [-3, 10], [-11, 5], [-8, 11], [-10.5, 24], [-13.5, 40]].map(([x, y]) => [x * u, y * u]);
  const bart = (x, y, z) => { if (z < 0) return 10 * u; const dB = koerperGlatt(x, y, z), sh = Math.max(dB - 1.8 * u, -dB - 0.6 * u); return Math.max(sh, _zwiPolyD(B, x, y)); };
  const weiss = (x, y, z) => Math.min(umschlag(x, y, z), bommel(x, y, z), bart(x, y, z));
  const nY = 52.5 * u, nZ = 17 * u * Math.sqrt(Math.max(0, 1 - ((nY - kE.c[1]) / kE.r[1]) ** 2)) + 2.2 * u;
  const nase = (x, y, z) => _dklH(x, y - nY, z - nZ) - 4.3 * u * p.nase / 100;
  const Bx = (x0, y0, z0, x1, y1, z1) => [x0 * u, y0 * u, z0 * u, x1 * u, y1 * u, z1 * u], zx = Math.max(0, p.zipfel);
  return { u, teile: [['koerper', koerper, Bx(-19, 0, -19, 19, 66, 19)], ['muetze', muetze, Bx(-16, 55, -16, 16 + zx, 100, 16)],
    ['weiss', weiss, Bx(-19, 3, -19, 19 + zx, 106, 21)], ['nase', nase, Bx(-6, 46, 8, 6, 59, 25)]] };
}
function _zwiBuild(w, p, q) {
  const M = w.Manifold, tmp = [], keep = x => { tmp.push(x); return x; };
  try {
    const F = _zwiFelder(p), mf = {};
    for (const [n, f, bb] of F.teile) {
      const V = (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]), ziel = q === 'fein' ? (n === 'nase' ? 2e5 : 1.6e6) : 1.2e5;
      mf[n] = keep(_lgfLevel(w, f, bb, Math.max(0.3, Math.cbrt(V / ziel))));
    }
    mf.weiss = keep(M.difference(mf.weiss, mf.nase));
    mf.muetze = keep(M.difference(mf.muetze, mf.weiss));
    mf.koerper = keep(M.difference(keep(M.difference(keep(M.difference(mf.koerper, mf.weiss)), mf.nase)), mf.muetze));
    for (const n of Object.keys(mf)) { const st = mf[n].decompose(); if (st.length < 2) { st.forEach(x => x.delete()); continue; }
      const v = st.map(x => x.volume()), mx = Math.max(...v), gut = st.filter((x, i) => v[i] >= Math.max(2, mx * 0.005));
      mf[n] = keep(gut.length > 1 ? M.union(gut) : gut[0].translate([0, 0, 0])); st.forEach(x => x.delete()); }
    const out = { u: F.u }; for (const n of Object.keys(mf)) out[n] = mf[n].translate([0, 0, 0]);
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
