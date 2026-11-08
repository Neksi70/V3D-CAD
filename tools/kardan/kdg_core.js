// Kardan-Kern (print-in-place, 45° gekippt) — reine Manifold-Funktion.
// Eingabe: Manifold in mm, Z oben, Unterseite auf der Platte. Glieder entlang +X.
// An jedem Schnitt: Gabel A (Glied davor) – Kreuz – Gabel B (Glied danach). Die beiden
// Kreuzachsen u/v liegen ±45° gekippt in der YZ-Ebene: alle Flächen haben 45° oder
// stehen senkrecht (druckt ohne Stützen), die unteren Gabelarme stehen auf der Platte.
// p: { n: Glieder, clr: Spiel (mm), grad: gewünschte Biegefreiheit je Gelenk (°), cuts: [x…] optional }
function _kdgBuild(w, M0, p) {
  const M = w.Manifold, S2 = Math.SQRT2;
  const bb = M0.boundingBox(), x0 = bb.min[0], x1 = bb.max[0], y0 = bb.min[1], y1 = bb.max[1], zmin = bb.min[2], zmax = bb.max[2];
  const L = x1 - x0, c = Math.max(0.2, p.clr ?? 0.4), grad = Math.max(10, Math.min(50, p.grad || 30));
  const cube = (ax, bx, ay, by, az, bz) => M.cube([bx - ax, by - ay, bz - az]).translate([ax, ay, az]);
  const n = Math.max(2, Math.round(p.n || 4));
  let cuts = Array.isArray(p.cuts) && p.cuts.length ? p.cuts.slice().sort((a, b) => a - b)
    : Array.from({ length: n - 1 }, (_, i) => x0 + L * (i + 1) / n);
  // Gelenkmaße je Schnitt aus dem Querschnitt
  const gel = []; let zuKlein = 0;
  for (const xk of cuts) {
    const q = M.intersection(M0, cube(xk - 0.05, xk + 0.05, y0 - 1, y1 + 1, zmin - 1, zmax + 1));
    if (q.isEmpty()) continue;
    const qb = q.boundingBox(), zb = qb.min[2];
    const R = Math.min(14, (qb.max[1] - qb.min[1]) / 2, (qb.max[2] - zb) / 2);
    if (R < 4.5) { zuKlein = Math.max(zuKlein, 2 * R); continue; }
    const D = R * S2, k = (D - c) / 2.75, a = 0.75 * k, rp = k - c - 0.8;   // 2k + a + c = D → untere Arme stehen auf der Platte
    const yc = (qb.min[1] + qb.max[1]) / 2, zj = zb + R - 0.25;
    const rho = Math.max(qb.max[1] - yc, yc - qb.min[1], qb.max[2] - zj, zj - zb);
    const e = Math.max(k * S2 + c + 0.3, rho * Math.tan(grad / 2 * Math.PI / 180) + c / 2);
    gel.push({ xk, R, k, a, rp, c, yc, zj, zb, e });
  }
  // zu enge Gelenke weglassen (jedes Glied braucht Platz für zwei Naben)
  const ok = []; let prevEnd = x0;
  for (const g of gel) if (g.xk - g.e - 3 >= prevEnd && x1 - g.xk >= g.e + 3) { ok.push(g); prevEnd = g.xk + g.e + 3; }
  if (!ok.length) throw new Error(zuKlein && !gel.length
    ? `Querschnitt zu klein (${zuKlein.toFixed(1)} mm) — ein Kardangelenk braucht mindestens 9 mm Breite UND Dicke`
    : 'Zu kurz für Kardangelenke — weniger Glieder wählen oder ein längeres Teil nehmen');
  const teile = [], kreuze = [];
  for (let i = 0; i <= ok.length; i++) {
    const lo = i === 0 ? x0 - 1 : ok[i - 1].xk + ok[i - 1].e, hi = i === ok.length ? x1 + 1 : ok[i].xk - ok[i].e;
    teile.push(M.intersection(M0, cube(lo, hi, y0 - 1, y1 + 1, zmin - 1, zmax + 1)));
  }
  ok.forEach((g, j) => {
    const { xk, R, k, a, rp, yc, zj, zb, e } = g, L2 = k + c + a;
    const place = m => m.rotate([45, 0, 0]).translate([xk, yc, zj]);
    const box = cube(xk - e - 3, xk + e + 3, yc - R, yc + R, zb, zj + R + 0.25);
    // Gabel A: zwei Platten quer zu u (lokal Y), Form in (x, v): Scheibe r=k ∪ Streifen zur Nabe
    const armA = s => { const u0 = s > 0 ? k + c : -L2;
      return M.union(M.cylinder(a, k, k, 48).rotate([-90, 0, 0]).translate([0, u0, 0]), cube(-(e + 2.5), 0, u0, u0 + a, -k, k)); };
    // Gabel B: zwei Platten quer zu v (lokal Z), Form in (x, u)
    const armB = s => { const v0 = s > 0 ? k + c : -L2;
      return M.union(M.cylinder(a, k, k, 48).translate([0, 0, v0]), cube(0, e + 2.5, -k, k, v0, v0 + a)); };
    const boreU = M.cylinder(2 * L2 + 2, rp + c, rp + c, 40).rotate([-90, 0, 0]).translate([0, -L2 - 1, 0]);
    const boreV = M.cylinder(2 * L2 + 2, rp + c, rp + c, 40).translate([0, 0, -L2 - 1]);
    const hubA = cube(xk - e - 2.5, xk - e + 0.01, yc - R, yc + R, zb, zj + R + 0.25);
    const hubB = cube(xk + e - 0.01, xk + e + 2.5, yc - R, yc + R, zb, zj + R + 0.25);
    const A = M.intersection(place(M.union(armA(1), armA(-1))), box), B = M.intersection(place(M.union(armB(1), armB(-1))), box);
    // Nabe (Vollblock) nur, wenn die Gabel sonst nicht am Glied hängt (z. B. Querschnitt dünner als der Block)
    const mit = (t, arm, hub, bore) => { let r = M.difference(M.union(t, arm), bore);
      if (r.decompose().length > t.decompose().length) r = M.difference(M.union([t, hub, arm]), bore); return r; };
    teile[j] = mit(teile[j], A, hubA, place(boreU));
    teile[j + 1] = mit(teile[j + 1], B, hubB, place(boreV));
    const kreuz = M.union([cube(-k, k, -k, k, -k, k),
      M.cylinder(2 * L2, rp, rp, 40).rotate([-90, 0, 0]).translate([0, -L2, 0]),
      M.cylinder(2 * L2, rp, rp, 40).translate([0, 0, -L2])]);
    kreuze.push(place(kreuz));
  });
  return { teile, kreuze, info: { gel: ok, cuts: ok.map(g => g.xk), c } };
}
// Gelenk j in Pose (nicken p°, seitlich s°): Kreuz um u, Glied B zusätzlich um v
function _kdgPose(m, g, uGrad, vGrad) {
  let r = m.translate([-g.xk, -g.yc, -g.zj]).rotate([-45, 0, 0]);
  if (vGrad) r = r.rotate([0, 0, vGrad]);
  return r.rotate([0, uGrad, 0]).rotate([45, 0, 0]).translate([g.xk, g.yc, g.zj]);
}
function _kdgUV(nick, seit) { return { a: (nick + seit) / Math.SQRT2, b: (seit - nick) / Math.SQRT2 }; }
// größter freier Winkel (2,5°-Schritte) für Gelenk j in Richtung (dn, ds)
function _kdgFrei(w, teile, kreuze, g, j, dn, ds) {
  const M = w.Manifold; let frei = 0;
  for (let t = 2.5; t <= 60; t += 2.5) {
    const { a, b } = _kdgUV(dn * t, ds * t);
    const kr = _kdgPose(kreuze[j], g, a, 0), B = _kdgPose(teile[j + 1], g, a, b);
    const ov = M.intersection(teile[j], kr).volume() + M.intersection(teile[j], B).volume() + M.intersection(kr, B).volume();
    if (ov > 0.05) break; frei = t;
  }
  return frei;
}
