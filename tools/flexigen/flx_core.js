// FlexiGen-Kern (Fass-Scharnier, print-in-place) — reine Manifold-Funktion.
// Eingabe: Manifold in mm, Z oben, Unterseite auf z=zmin. Glieder entlang +X.
// p: { n: Anzahl Glieder, clr: Spiel (mm), pin: Stift-Ø (mm, 0 = auto), band: Knöchelbreite (mm, 0 = auto), cuts: [x…] optional }
// Rückgabe: { teile: [Manifold…], info: {…} }  oder wirft Error mit verständlicher Meldung.
function _flxBuild(w, M0, p) {
  const M = w.Manifold;
  const bb = M0.boundingBox(), x0 = bb.min[0], x1 = bb.max[0], y0 = bb.min[1], y1 = bb.max[1], zmin = bb.min[2];
  const T = bb.max[2] - zmin, L = x1 - x0;
  if (T < 2.5) throw new Error(`Zu dünn (${T.toFixed(1)} mm) — das Fass-Scharnier braucht mindestens 2,5 mm Dicke`);
  if (T > 30) throw new Error(`Zu dick (${T.toFixed(1)} mm) — das Fass-Scharnier ist für flache Teile bis 30 mm gedacht`);
  const c = Math.max(0.15, p.clr ?? 0.4);
  const r = T / 2;                                   // Knöchel = volle Dicke
  const rp = Math.max(0.6, Math.min(r - 0.8 - c, (p.pin > 0 ? p.pin : Math.max(1.6, Math.min(4, T * 0.4))) / 2));
  const zc = zmin + r;
  const Lmin = 2 * (r + c) + 2;                     // kürzestes Glied (Knöchel beider Seiten + Steg)
  let cuts = Array.isArray(p.cuts) && p.cuts.length ? p.cuts.slice().sort((a, b) => a - b)
    : Array.from({ length: Math.max(1, (p.n || 6) - 1) }, (_, i) => x0 + L * (i + 1) / (p.n || 6));
  // zu enge Schnitte zusammenziehen
  const ok = []; let prev = x0;
  for (const x of cuts) if (x - prev >= Lmin && x1 - x >= Lmin / 2 + r) { ok.push(x); prev = x; }
  cuts = ok;
  if (!cuts.length) throw new Error(`Zu kurz für Gelenke — jedes Glied braucht mindestens ${Lmin.toFixed(1)} mm`);
  const big = Math.max(L, y1 - y0, T) * 4 + 50;
  const cube = (ax, bx, ay, by, az, bz) => M.cube([bx - ax, by - ay, bz - az]).translate([ax, ay, az]);
  // Zylinder entlang Y durch (x, zc)
  const cylY = (x, rad, ya, yb, seg) => M.cylinder(yb - ya, rad, rad, seg || 64).rotate([-90, 0, 0]).translate([x, ya, zc]);
  const teile = [], info = { T, r, rp, c, cuts: cuts.slice(), bands: [] };
  // Grundstücke zwischen den Schnitten (mit Spalt c um jeden Schnitt)
  const grenzen = [x0 - 1, ...cuts, x1 + 1];
  for (let i = 0; i + 1 < grenzen.length; i++) {
    const a = i === 0 ? x0 - 1 : grenzen[i] + c / 2, b = i + 2 === grenzen.length ? x1 + 1 : grenzen[i + 1] - c / 2;
    teile.push(M.intersection(M0, cube(a, b, y0 - 1, y1 + 1, zmin - 1, zmin + T + 1)));
  }
  cuts.forEach((xk, k) => {
    // Breite des Teils am Schnitt (Querschnitt)
    const q = M.intersection(M0, cube(xk - 0.05, xk + 0.05, y0 - 1, y1 + 1, zmin - 1, zmin + T + 1));
    if (q.isEmpty()) return;
    const qb = q.boundingBox(), ya = qb.min[1], yb = qb.max[1], W = yb - ya;
    const bw = p.band > 0 ? p.band : Math.max(3.5, Math.min(12, T * 1.6));
    let nb = Math.max(3, Math.round(W / bw)); if (nb % 2 === 0) nb++;      // ungerade: außen A
    const step = W / nb;
    const A = [], B = [];
    for (let j = 0; j < nb; j++) {
      const s0 = ya + j * step, s1 = ya + (j + 1) * step;
      // äußere Bänder bis über das ganze Teil hinaus (Kerben/Lappen neben dem Schnitt)
      const band = cube(xk - r - c - 1, xk + r + c + 1, j === 0 ? y0 - 2 : s0 + c / 2, j === nb - 1 ? y1 + 2 : s1 - c / 2, zmin - 1, zmin + T + 1);
      (j % 2 === 0 ? A : B).push(band);
    }
    info.bands.push(nb);
    const Kr = cylY(xk, r, y0 - 3, y1 + 3), Krc = cylY(xk, r + c, y0 - 3, y1 + 3);
    const Au = M.union(A), Bu = M.union(B);
    const kA = M.intersection(M.intersection(M0, Kr), Au);          // Knöchel A (volle Scheibe)
    const kB = M.intersection(M.intersection(M0, Kr), Bu);
    // Aussparung: im Zylinder r+c bleibt nur das eigene Band übrig
    const cavA = M.difference(Krc, Au), cavB = M.difference(Krc, Bu);
    const pin = M.intersection(cylY(xk, rp, y0 - 3, y1 + 3, 40), M.intersection(M0, Kr));
    const bore = cylY(xk, rp + c, y0 - 3, y1 + 3, 40);
    teile[k] = M.union([M.difference(teile[k], cavA), kA, pin]);
    teile[k + 1] = M.difference(M.union([M.difference(teile[k + 1], cavB), kB]), bore);   // Bohrung durch ALLES vom Nachbarn
  });
  return { teile, info };
}
