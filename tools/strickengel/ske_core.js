// Strick-Engel — Distanzfelder (mm, Y oben, Gesicht nach +Z, Standfläche y = 0), Teile je Farbe:
// Kleid + Flügel (Strick, weiß), Haare (Strick-Haube mit Gesichtsfenster), Kopf (Haut, glatt), Augen, Hände, Heiligenschein.
// Braucht aus der App: _dklH, _dklCone, _dklEll, _dklKnit, _lgfSmin, _lgfLevel. Maße in u = Höhe/100.
function _skeMasse(p) {
  const u = p.hoehe / 100;
  return {
    u, kopf: { c: [0, 64 * u, 2 * u], r: [21 * u, 19.5 * u, 18.5 * u] },
    haar: { c: [0, 66 * u, -1 * u], r: [24 * u, 22.5 * u, 21.5 * u] },
    gesicht: { c: [0, 59.5 * u], r: [15.5 * u, 14 * u] },                        // Fenster in der Haube (Vorderansicht)
    halo: { c: [0, 93 * u, -3 * u], R: 12.5 * u, r: 2.2 * u, kipp: 14 * Math.PI / 180 }
  };
}
// Kopf-Vorderfläche bei (x, y) → z (für Augen)
function _skeKopfZ(m, x, y) { const k = m.kopf, a = (x - k.c[0]) / k.r[0], b = (y - k.c[1]) / k.r[1]; return k.c[2] + k.r[2] * Math.sqrt(Math.max(0, 1 - a * a - b * b)); }
function _skeFelder(p) {
  const m = _skeMasse(p), u = m.u, A = 1.1 * u * p.strick / 100, wK = 5.5 * u * p.masche / 100, PK = 4.6 * u * p.masche / 100, fl = p.fluegel / 100;
  // Kleid: Glocke (Kegel) + runde Schultern, Strick um die senkrechte Achse; Saum etwas ausgestellt
  const kleid = (x, y, z) => {
    const zz = z / 0.86;                                                       // vorn/hinten etwas flacher
    let d = _dklCone(x, y, zz, [0, 2 * u, 0], [0, 44 * u, 0], 31 * u, 16 * u);
    d = _lgfSmin(d, _dklEll(x, y, zz, [0, 43 * u, 0], [20 * u, 10 * u, 17 * u]), 4 * u);
    if (A > 0 && Math.abs(d) < 2.5 * A) d -= A * (_dklKnit(Math.atan2(zz, x), y, 24 * u, wK, PK) - 0.35);
    return Math.max(d, -y);
  };
  // Flügel: je Seite drei Lappen (flache Ellipsoide) hinter den Schultern, Maschen in senkrechten Spalten
  const fluegel = (x, y, z) => {
    const ax = Math.abs(x), L = [[21, 52, 14, 10], [30, 45, 13, 9.5], [28, 35.5, 12, 8.5]];   // breit nach außen, wie auf dem Bild
    let d = Infinity;
    for (const [lx, ly, rx, ry] of L) { const e = _dklEll(ax, y, z, [lx * u * fl + (1 - fl) * 14 * u, ly * u, -7 * u], [rx * u * fl, ry * u * fl, 4.5 * u]); d = d === Infinity ? e : _lgfSmin(d, e, 2.5 * u); }
    if (A > 0 && Math.abs(d) < 2.5 * A) d -= 0.8 * A * (_dklKnit(ax / (30 * u), y, 30 * u, wK, PK) - 0.35);
    return d;
  };
  const weiss = (x, y, z) => _lgfSmin(kleid(x, y, z), fluegel(x, y, z), 2 * u);
  // Haare: Haube um den Kopf, vorn ein ovales Gesichtsfenster; Pony mit Mittelscheitel = Fenster oben eingekerbt
  const haar = (x, y, z) => {
    const h = m.haar; let d = _dklEll(x, y, z, h.c, h.r);
    const g = m.gesicht, ex = x / g.r[0], ey = (y - g.c[1]) / g.r[1];
    let fen = (Math.sqrt(ex * ex + ey * ey) - 1) * Math.min(g.r[0], g.r[1]);    // < 0 im Fenster
    fen = Math.max(fen, -(Math.abs(x) * 0.55 + (g.c[1] + g.r[1] * 0.92) - y));   // Scheitel: Fenster oben spitz zusammenlaufen
    if (z > m.kopf.c[2]) d = Math.max(d, -fen);
    if (A > 0 && Math.abs(d) < 2.5 * A) d -= A * (_dklKnit(Math.atan2(z - h.c[2], x), y - h.c[1], h.r[0], wK * 0.9, PK * 0.9) - 0.35);
    return d;
  };
  const kopf = (x, y, z) => _dklEll(x, y, z, m.kopf.c, m.kopf.r);
  const ay = 58 * u, ax = 7.2 * u, rA = 3.1 * u * p.augen / 100;
  const augen = (x, y, z) => _dklH(Math.abs(x) - ax, y - ay, z - (_skeKopfZ(m, ax, ay) - 0.9 * rA)) - rA;
  // Hände: zwei flache Ellipsoide, zusammengelegt, vor der Brust (Fingerspitzen nach oben)
  const haende = (x, y, z) => {
    const hz = 17.5 * u, hy = 41 * u;
    const e = s => { const xr = x - s * 2.6 * u, yr = y - hy; const c = Math.cos(s * 0.12), sn = Math.sin(s * 0.12);
      return _dklEll(xr * c - yr * sn, xr * sn + yr * c + hy, z, [0, hy, hz], [2.9 * u, 6.8 * u, 4.2 * u]); };
    return _lgfSmin(e(-1), e(1), 1.2 * u);
  };
  // Heiligenschein: Ring, leicht nach vorn gekippt, Steg zum Hinterkopf
  const halo = (x, y, z) => {
    const h = m.halo, c = Math.cos(h.kipp), s = Math.sin(h.kipp), py = y - h.c[1], pz = z - h.c[2];
    const ry = py * c - pz * s, rz = py * s + pz * c, q = _dklH(x, rz) - h.R;
    const ring = _dklH(q, ry) - h.r;
    const top = [0, m.haar.c[1] + m.haar.r[1] * 0.78, m.haar.c[2] - m.haar.r[2] * 0.55], pin = [0, h.c[1] - h.R * s, h.c[2] - h.R * c];
    return _lgfSmin(ring, _dklCone(x, y, z, top, pin, 1.9 * u, 1.6 * u), 0.8 * u);
  };
  const B = (x0, y0, z0, x1, y1, z1) => [x0 * u, y0 * u, z0 * u, x1 * u, y1 * u, z1 * u];
  return {
    m, u,
    teile: [
      ['weiss', weiss, B(-50, 0, -30, 50, 64, 30)],
      ['haar', haar, B(-27, 41, -25, 27, 91, 23)],
      ['kopf', kopf, B(-23, 42, -19, 23, 86, 23)],
      ['augen', augen, B(-13, 51, 8, 13, 65, 24)],
      ['haende', haende, B(-8, 32, 11, 8, 50, 24)],
      ...(p.halo ? [['halo', halo, B(-17, 80, -20, 17, 100, 13)]] : [])
    ]
  };
}
function _skeBuild(w, p, q) {
  const M = w.Manifold, tmp = [], keep = x => { tmp.push(x); return x; };
  try {
    const F = _skeFelder(p), u = F.u, mf = {};
    for (const [n, f, bb] of F.teile) {
      const V = (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]), ziel = q === 'fein' ? (n === 'weiss' || n === 'haar' ? 1.6e6 : 4e5) : 1.2e5;
      const edge = Math.max(0.3, Math.cbrt(V / ziel));
      mf[n] = keep(_lgfLevel(w, f, bb, edge));
    }
    // Überlappungen auflösen (Vorrang: Augen > Kopf > Hände > Haare > Kleid; Schein über Haaren)
    mf.kopf = keep(M.difference(mf.kopf, mf.augen));
    mf.haar = keep(M.difference(keep(M.difference(mf.haar, mf.kopf)), mf.augen));
    mf.weiss = keep(M.difference(keep(M.difference(keep(M.difference(mf.weiss, mf.kopf)), mf.haende)), mf.haar));
    mf.haar = keep(M.difference(mf.haar, mf.haende));
    if (mf.halo) mf.halo = keep(M.difference(mf.halo, mf.haar));
    // Splitter aus dem Abziehen weg: nur Stücke ≥ 0,5 % des größten (Augen sind zwei gleich große Stücke)
    for (const n of Object.keys(mf)) { const st = mf[n].decompose(); if (st.length < 2) { st.forEach(x => x.delete()); continue; }
      const v = st.map(x => x.volume()), mx = Math.max(...v), gut = st.filter((x, i) => v[i] >= Math.max(2, mx * 0.005));
      mf[n] = keep(gut.length > 1 ? M.union(gut) : gut[0].translate([0, 0, 0])); st.forEach(x => x.delete()); }
    const out = {};
    for (const n of Object.keys(mf)) out[n] = mf[n].translate([0, 0, 0]);
    out.u = u; return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
