// Dala-Pferd-Lampe — Manifold, mm, Z oben. Pferd schaut nach +X, Dicke entlang Y.
// Teile: Pferd (Steckloch im Rücken), Stab, Aufsatz (Lampen-Kranz mit LED-Mulde oder
// Kerzenteller), Schirm (Zylinder/Kegel, Querstreifen in zwei Farben).
// Jedes Teil wird in Gebrauchslage gebaut; _dlpDrucklage legt es druckfertig hin.
// Dala-Umriss (Höhe 1, schaut nach rechts) — Kontrollpunkte, danach Chaikin-gerundet.
const _DLP_UMRISS = [
  [0.08, 0], [0.30, 0], [0.31, 0.22], [0.40, 0.30], [0.54, 0.30], [0.62, 0.22], [0.63, 0], [0.86, 0],      // Hinterbein, Bauchbogen, Vorderbein
  [0.87, 0.30], [0.90, 0.46], [0.95, 0.60], [1.00, 0.70],                                                 // Brust, Hals vorn
  [1.10, 0.71], [1.19, 0.73], [1.23, 0.80], [1.18, 0.87],                                                 // Unterkiefer, Maul
  [1.06, 0.95], [0.94, 1.01], [0.88, 1.13], [0.82, 1.02],                                                 // Nasenrücken, Stirn, Ohr
  [0.74, 0.90], [0.64, 0.74], [0.50, 0.68], [0.30, 0.68], [0.14, 0.70],                                   // Mähne, Widerrist, Rücken
  [0.05, 0.64], [-0.03, 0.62], [-0.03, 0.54], [0.04, 0.52], [0.07, 0.38], [0.075, 0.18]                   // Kruppe, Schweif, Hinterbein
];
function _dlpUmriss(H) {
  const ecke = new Set([0, 1, 6, 7, 18]);                              // Fußkanten (Standfläche) + Ohrspitze bleiben eckig                                      // Fußkanten bleiben eckig (Standfläche)
  let P = _DLP_UMRISS.map((q, i) => ({ x: q[0], y: q[1], fest: ecke.has(i) }));
  for (let it = 0; it < 3; it++) {
    const Q = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if (a.fest) Q.push(a);
      else Q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      if (!(a.fest && b.fest)) { const c = a.fest ? a : null; Q.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, fest: false });
        if (c) {} }
    }
    P = Q;
  }
  return P.map(q => [q.x * H, q.y * H]);
}
// Oberkante des Umrisses bei x (für das Steckloch im Rücken)
function _dlpOben(U, x) {
  let best = -Infinity;
  for (let i = 0; i < U.length; i++) { const a = U[i], b = U[(i + 1) % U.length];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) { const t = (x - a[0]) / (b[0] - a[0]); best = Math.max(best, a[1] + t * (b[1] - a[1])); } }
  return best;
}
// Stufig gerundete Kanten: Umriss je Lage um r−√(r²−(r−z)²) eingezogen
function _dlpRundExtrude(w, cs, T, r) {
  const M = w.Manifold, teile = [], n = Math.max(2, Math.round(r / 0.4));
  r = Math.min(r, T / 2 - 0.5);
  const lage = (z0, z1, ins) => { const c = ins > 0.01 ? cs.offset(-ins, 'Round') : cs; teile.push(c.extrude(z1 - z0).translate([0, 0, z0])); if (c !== cs) c.delete(); };
  for (let i = 0; i < n; i++) {
    const z0 = r * i / n, z1 = r * (i + 1) / n, zm = (z0 + z1) / 2, ins = r - Math.sqrt(Math.max(0, r * r - (r - zm) ** 2));
    lage(z0, z1 + 0.01, ins); lage(T - z1 - 0.01, T - z0, ins);
  }
  lage(r, T - r, 0);
  const m = M.union(teile); teile.forEach(t => t.delete());
  return m;
}
function _dlpMasse(p) {
  const H = p.pferdH, T = p.pferdT, ds = p.stabD, sp = p.spiel;
  const U = _dlpUmriss(H), xL = 0.42 * H, ruecken = _dlpOben(U, xL);
  const lochT = Math.min(0.32 * H, ruecken - 0.3 * H);
  const stabL = lochT + p.stabFrei + 14;                                   // 14 mm stecken im Aufsatz
  const zStabOben = ruecken - lochT + stabL;
  return { H, T, ds, sp, U, xL, ruecken, lochT, stabL, zStabOben };
}
const _DLP_LED = { teelicht: { d: 38, h: 16 }, puck: { d: 30, h: 21 }, schrank: { d: 60, h: 12 }, bambu: { d: 60, h: 9 } };
function _dlpBuild(w, p) {
  const M = w.Manifold, CS = w.CrossSection, m = _dlpMasse(p), out = {};
  const { H, T, ds, sp, U, xL, ruecken, lochT, stabL, zStabOben } = m;
  // ── Pferd (Gebrauchslage: Profil in XZ, Dicke Y um 0) ──
  const cs = new CS([U], 'NonZero');
  let pf = _dlpRundExtrude(w, cs, T, Math.min(p.rund, T / 3)); cs.delete();
  pf = pf.rotate([90, 0, 0]).translate([0, T / 2, 0]);                     // y (Profil oben) → z
  const loch = M.cylinder(lochT + 5, (ds + sp) / 2, (ds + sp) / 2, 40).translate([xL, 0, ruecken - lochT]);
  out.pferd = M.difference(pf, loch); pf.delete(); loch.delete();
  // ── Stab ──
  out.stab = M.cylinder(stabL, ds / 2, ds / 2, 40).translate([xL, 0, ruecken - lochT]);
  // ── Aufsatz ──
  const nab = ds + 7, zA = zStabOben - 14;                                 // Unterkante der Stab-Nabe
  if (p.aufsatz === 'kerze') {
    const R = p.tellerD / 2, top = zA + 14 + Math.max(0, R - nab / 2);       // 45°-Kegel von der Nabe zum Rand
    const kegel = M.cylinder(top - (zA + 14), nab / 2, R, 72).translate([xL, 0, zA + 14]);
    const nabe = M.cylinder(14, nab / 2, nab / 2, 40).translate([xL, 0, zA]);
    const teller = M.cylinder(3, R, R, 72).translate([xL, 0, top]);
    const rand = M.difference(M.cylinder(6, R, R, 72), M.cylinder(6, R - 2.5, R - 2.5, 72)).translate([xL, 0, top + 3]);
    const dorn = M.cylinder(10, 1.5, 0.4, 16).translate([xL, 0, top + 3]);   // kleiner Dorn hält die Kerze
    let a = M.union([kegel, nabe, teller, rand, dorn]);
    a = M.difference(a, M.cylinder(14.5, (ds + 0.3) / 2, (ds + 0.3) / 2, 40).translate([xL, 0, zA - 0.5]));
    out.aufsatz = a; out.zAuflage = top + 3;
  } else {
    const led = p.ledD + p.ledSpiel, hub = led / 2 + 2.5, ledH = p.ledH;
    const Rs = p.schirmU / 2 - p.wand - 0.5;                               // Kranz passt in den Schirm
    const zTop = zA + 14 + ledH + 2;                                       // Oberebene (Druck: unten auf der Platte)
    const dk = 3;                                                          // Ring-/Speichendicke
    const ring = M.difference(M.cylinder(dk, Rs, Rs, 96), M.cylinder(dk, Rs - 6, Rs - 6, 96)).translate([xL, 0, zTop - dk]);
    const speichen = [];
    for (let i = 0; i < p.speichen; i++) speichen.push(M.cube([Rs - 3, 6, dk]).translate([0, -3, 0]).rotate([0, 0, 360 * i / p.speichen + 45]).translate([xL, 0, zTop - dk]));
    const napf = M.cylinder(ledH + 2, hub, hub, 64).translate([xL, 0, zTop - ledH - 2]);
    const nabe = M.cylinder(14, nab / 2, nab / 2, 40).translate([xL, 0, zA]);
    let a = M.union([ring, ...speichen, napf, nabe]);
    a = M.difference(a, M.cylinder(ledH + 1, led / 2, led / 2, 64).translate([xL, 0, zTop - ledH]));
    a = M.difference(a, M.cylinder(14.5, (ds + 0.3) / 2, (ds + 0.3) / 2, 40).translate([xL, 0, zA - 0.5]));
    if (p.kabel) a = M.difference(a, M.cube([hub + 2, 6, ledH + 0.5]).translate([xL, -3, zTop - ledH]));   // Kabelschlitz
    out.aufsatz = a; out.zAuflage = zTop;
    // ── Schirm (Innenrand liegt auf dem Kranz) ──
    const Ru = p.schirmU / 2, Ro = (p.form === 'kegel' ? p.schirmO : p.schirmU) / 2, Hs = p.schirmH, wd = p.wand;
    const aussen = M.cylinder(Hs, Ru, Ro, 128), innen = M.cylinder(Hs + 0.2, Ru - wd, Ro - wd, 128).translate([0, 0, -0.1]);
    const lippe = M.difference(M.cylinder(2, Ru - wd + 0.1, Ru - wd + 0.1 - 0, 128), M.cylinder(2, Rs - 5, Rs - 5, 128));
    let schirm = M.union(M.difference(aussen, innen), lippe);
    const n = Math.max(1, Math.round(p.streifen)), teile = [[], []];
    for (let i = 0; i < n; i++) {
      const sl = M.cube([4 * Ru, 4 * Ru, Hs / n + (i === n - 1 ? 1 : 0)]).translate([-2 * Ru, -2 * Ru, Hs * i / n - (i === 0 ? 1 : 0)]);
      teile[i % 2].push(M.intersection(schirm, sl)); sl.delete();
    }
    const z0 = zTop;
    out.schirmA = M.union(teile[0]).translate([xL, 0, z0]); out.schirmB = teile[1].length ? M.union(teile[1]).translate([xL, 0, z0]) : null;
    out.farbHoehen = Array.from({ length: n - 1 }, (_, i) => Hs * (i + 1) / n);
    schirm.delete(); aussen.delete(); innen.delete(); lippe.delete();
  }
  return { ...out, m };
}
