// Zipfel-Wichtel (Christmas Gnome) — Distanzfelder, mm, Y oben, Gesicht +Z, Standfläche y = 0. Teile je Farbe:
// Körper (Ei mit senkrechten Holzrillen), Mütze (rot), Weiß (Umschlag, Bommel, Bart als Auflage vorn), Nase (Holzkugel).
// Braucht aus der App: _dklH, _dklEll, _dklCone, _lgfSmin, _lgfLevel.
// Seit 1.18.420 auch Stil „skandi“ (_zwiFelderSkandi, nach Foto).
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
// Stil „Skandi" (nach Foto 16.11.): weißer Rillenkörper als Rotationsprofil, große glatte Mütze ohne Umschlag
// mit gebogener Spitze (stützfrei aufgestapelt), Bart als eigenes Teil mit Hammerschlag-Struktur, ovale Nase.
// Einheiten: Gesamthöhe 100 u. Mützenkante bei 44 u.
const _ZWI_SK_PROF = [[24, 0], [25.2, 1.5], [26.5, 4.5], [27.5, 10], [28, 17], [27.6, 25], [26, 32], [23.5, 38], [20, 43.5], [15, 49], [8, 53], [0, 55]];
function _zwiSkR(y){                                                       // Körperradius (u) in Höhe y (u)
  const P = _ZWI_SK_PROF; if (y <= 0) return P[0][0]; if (y >= P[P.length - 1][1]) return 0;
  for (let i = 1; i < P.length; i++) if (y <= P[i][1]) { const [r0, y0] = P[i - 1], [r1, y1] = P[i]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); }
  return 0;
}
function _zwiFelderSkandi(p) {
  const u = p.hoehe / 100, nR = Math.max(12, Math.round(p.rillen)), aR = 0.85 * u * p.rillenTief / 100;
  const rip = (x, z) => Math.sqrt(Math.abs(Math.cos(nR * Math.atan2(z, x) / 2)));
  const PR = _ZWI_SK_PROF.map(([r, y]) => [r * u, y * u]), SIL = [...PR, ...PR.slice(0, -1).reverse().map(([r, y]) => [-r, y])];   // volle Silhouette (keine Achsenkante)
  const koerperGlatt = (x, y, z) => _zwiPolyD(SIL, _dklH(x, z), y);
  // Rillen über die ersten 4 u weich einblenden (sonst Kante über dem Fuß)
  const koerper = (x, y, z) => { let d = koerperGlatt(x, y, z); const f = Math.min(1, Math.max(0, (y - 0.8 * u) / (3.2 * u)));
    if (aR > 0 && f > 0 && Math.abs(d) < 3 * aR) d -= aR * f * f * (3 - 2 * f) * (rip(x, z) - 0.6); return d; };
  // Mütze: Kegel mit gekrümmter Achse (Versatz ~ t²), leicht bauchig, runde Spitze; Kante 1 u über den Körper hinaus
  const yB = 44 * u, yT = 98.1 * u, L = yT - yB, rB = (_zwiSkR(44) + 1.1) * u, rS = 1.9 * u,   // yT + rS = 100 u = Höhe
        bend = (p.zipfel || 0) * u, dX = -0.88, dZ = 0.47;   // Spitze kippt nach links vorn (wie Foto)
  const muetze = (x, y, z) => {
    const t = Math.min(1, Math.max(0, (y - yB) / L)), o = bend * t * t, cx = o * dX, cz = o * dZ;
    let d;
    if (y > yT) d = _dklH(x - bend * dX, y - yT, z - bend * dZ) - rS;
    else d = (_dklH(x - cx, z - cz) - (rS + (rB - rS) * Math.pow(1 - t, 0.66))) / 1.08;
    return Math.max(d, yB - y);
  };
  // Bart: Schild vorn, Schicht auf dem glatten Körper; Dicke mit Knubbel-Struktur (Periode ≈ 2,3 mm)
  const B = [[-16.5, 44], [16.5, 44], [18.8, 36], [18, 27], [14, 17.5], [7.5, 10.5], [0, 7.5], [-7.5, 10.5], [-14, 17.5], [-18, 27], [-18.8, 36]].map(([x, y]) => [x * u, y * u]);
  const k = 2.7, amp = 0.75 * u * (p.bart == null ? 100 : p.bart) / 100;
  const knubbel = (x, y, z) => Math.abs(Math.sin(k * x + 1.7 * Math.sin(0.73 * k * y)) * Math.sin(1.13 * k * y + 1.3 * Math.sin(0.61 * k * z)) * Math.sin(0.89 * k * z + 1.1 * Math.sin(0.57 * k * x)));
  // Rand unter 45° abgeschrägt (Dicke wächst mit dem Abstand zum Umriss) → kein Überhang am unteren Bartrand
  const bart = (x, y, z) => { if (z < 0) return 10 * u; const dB = koerperGlatt(x, y, z), dP = _zwiPolyD(B, x, y);
    const th = Math.min(1.15 * u + amp * knubbel(x, y, z), 0.15 * u - dP);
    return Math.max(Math.max(dB - th, -dB - 0.6 * u), dP); };
  // Nase: liegendes Oval oben auf dem Bart, knapp unter der Mützenkante
  const nk = (p.nase || 100) / 100, nY = 40.5 * u, nZ = (_zwiSkR(40.5) + 1.15 + 2.6 * nk) * u;
  // stützfrei: das Oval wird unter 45° schräg nach hinten unten in den Körper gezogen (Unterseite ≤ 45°)
  const nase = (x, y, z) => { const rx = 6.6 * u * nk, ry = 4.4 * u * nk, rz = 4.2 * u * nk, sw = 8 * u * nk;
    let d = Infinity; for (let i = 0; i <= 28; i++){ const t = sw * i / 28; d = Math.min(d, _dklEll(x, y, z, [0, nY - t, nZ - t], [rx, ry, rz])); } return d; };
  const Bx = (x0, y0, z0, x1, y1, z1) => [x0 * u, y0 * u, z0 * u, x1 * u, y1 * u, z1 * u], bx = Math.max(0, p.zipfel || 0);
  return { u, stil: 'skandi', nasePrio: 'muetze', teile: [['koerper', koerper, Bx(-30, 0, -30, 30, 56, 30)], ['muetze', muetze, Bx(-23 - bx * 0.88, 43.5, -23, 23, 101.5, 23 + bx * dZ)],
    ['weiss', bart, Bx(-21, 6, 0, 21, 45, 32)], ['nase', nase, Bx(-8, 26, 8, 8, 47, 36)]] };
}
function _zwiFelder(p) {
  if (p.stil === 'skandi') return _zwiFelderSkandi(p);
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
    if (F.nasePrio === 'muetze') mf.nase = keep(M.difference(mf.nase, mf.muetze));   // Nase steckt unter der Mützenkante
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

