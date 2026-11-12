// Schneemann (Rillen-Körper, glatter Kopf, Karotten-Nase, Rippen-Mütze mit Umschlag, Bommel) — Distanzfelder,
// mm, Y oben, Gesicht nach +Z, Standfläche y = 0. Teile je Farbe. Braucht aus der App: _dklH, _dklEll, _dklCone, _lgfSmin, _lgfLevel.
function _snmFelder(p) {
  const u = p.hoehe / 106.3,                                               // Gesamthöhe inkl. Bommel = 107,5 u − 1,2 u Standfläche
   nR = Math.max(8, Math.round(p.rillen)), aR = p.rillenTief * u / 100 * 1.2;
  const rip = (x, z, n) => { const t = Math.atan2(z, x); return Math.sqrt(Math.abs(Math.cos(n * t / 2))); };   // 1 auf dem Wulst, 0 in der Rille
  const kopfC = [0, 63 * u, 0], kopfR = 17 * u;
  const koerper = (x, y, z) => {
    let d = _dklEll(x, y, z, [0, 29 * u, 0], [30 * u, 29.5 * u, 30 * u]);
    if (aR > 0 && Math.abs(d) < 3 * aR && y > 1.5 * u) d -= aR * (rip(x, z, nR) - 0.6) * Math.min(1, (y - 1.5 * u) / (3 * u));
    d = _lgfSmin(d, _dklH(x - kopfC[0], y - kopfC[1], z - kopfC[2]) - kopfR, 3 * u);
    return Math.max(d, 1.2 * u - y);                                         // Standfläche
  };
  const mY0 = 68 * u, mR = 19.5 * u;                                         // Umschlag sitzt über der Kopfmitte → Gesicht bleibt frei
  const muetze = (x, y, z) => {
    const r = _dklH(x, z);
    // Krone: oben gerundet (Ellipsoid ab mY0), Rippen senkrecht
    let d = _dklEll(x, y, z, [0, mY0 + 6 * u, 0], [mR, 22 * u, mR]); d = Math.max(d, mY0 - y);
    d -= 0.55 * u * (rip(x, z, 44) - 0.6);
    // Umschlag: dickerer Ring mit Rippen, unten 45° nach innen (druckt ohne Stütze)
    let um = Math.max(r - (mR + 1.6 * u) - 0.7 * u * (rip(x, z, 44) - 0.6), y - (mY0 + 9 * u), (mY0 - 2 * u) - y);
    um = Math.max(um, (r - (mR - 3 * u) - (y - (mY0 - 2 * u))) * 0.7071);   // Unterseite: Kegel 45° von innen (im Kopf) nach außen
    return _lgfSmin(d, um, 1.2 * u);
  };
  const nase = (x, y, z) => _dklCone(x, y, z, [0, 60.5 * u, kopfR * 0.78], [0, 59.5 * u, kopfR + 9 * u * p.nase / 100], 3.2 * u, 0.7 * u);   // direkt unter dem Umschlag
  const bommelC = [0, mY0 + 6 * u + 22 * u + 4 * u, 0], bR = 7.5 * u * p.bommel / 100;
  const bommel = (x, y, z) => _dklH(x - bommelC[0], y - bommelC[1], z - bommelC[2]) - bR;
  const B = (x0, y0, z0, x1, y1, z1) => [x0 * u, y0 * u, z0 * u, x1 * u, y1 * u, z1 * u];
  return { u, teile: [['koerper', koerper, B(-32, 0, -32, 32, 81, 32)], ['muetze', muetze, B(-24, 62, -24, 24, 98, 24)],
    ['nase', nase, B(-5, 55, 10, 5, 65, 29 + 9 * p.nase / 100)], ...(p.bommel > 0 ? [['bommel', bommel, [-bR - u, bommelC[1] - bR - u, -bR - u, bR + u, bommelC[1] + bR + u, bR + u]]] : [])] };
}
function _snmBuild(w, p, q) {
  const M = w.Manifold, tmp = [], keep = x => { tmp.push(x); return x; };
  try {
    const F = _snmFelder(p), mf = {};
    for (const [n, f, bb] of F.teile) {
      const V = (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]), ziel = q === 'fein' ? (n === 'koerper' || n === 'muetze' ? 1.8e6 : 3e5) : 1.2e5;
      mf[n] = keep(_lgfLevel(w, f, bb, Math.max(0.3, Math.cbrt(V / ziel))));
    }
    // Vorrang: Mütze > Kopf/Körper, Nase vor dem Körper, Bommel auf der Mütze
    mf.koerper = keep(M.difference(keep(M.difference(mf.koerper, mf.muetze)), mf.nase));
    mf.nase = keep(M.difference(mf.nase, mf.muetze));
    if (mf.bommel) mf.bommel = keep(M.difference(mf.bommel, mf.muetze));
    for (const n of Object.keys(mf)) { const st = mf[n].decompose(); if (st.length < 2) { st.forEach(x => x.delete()); continue; }
      const v = st.map(x => x.volume()), mx = Math.max(...v), gut = st.filter((x, i) => v[i] >= Math.max(2, mx * 0.005));
      mf[n] = keep(gut.length > 1 ? M.union(gut) : gut[0].translate([0, 0, 0])); st.forEach(x => x.delete()); }
    const out = { u: F.u }; for (const n of Object.keys(mf)) out[n] = mf[n].translate([0, -1.2 * F.u, 0]);   // Standfläche auf y = 0
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
