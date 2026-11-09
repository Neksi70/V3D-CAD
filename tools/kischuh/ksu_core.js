// Schuh-Kern — Leisten (Fußform) + KI-Schuh tragbar machen. Manifold, mm, Z oben.
// Fußlänge aus EU-Größe (Pariser Stich 2/3 cm, Zugabe 15 mm): Lf = EU·20/3 − 15.
function _ksuFuss(p) {
  const eu = p.eu || 42, Lf = eu * 20 / 3 - 15;
  const W = Lf * ({ schmal: 0.36, normal: 0.385, weit: 0.41 }[p.weite] || 0.385);
  return { eu, Lf, W };
}
// Kurven über t = 0 (Ferse) … 1 (Zehe): Breite (× W) und Höhe (× Lf)
const _KSU_BREITE = [[0, 0.02], [0.12, 0.64], [0.3, 0.66], [0.5, 0.79], [0.68, 1], [0.78, 0.98], [0.88, 0.86], [0.95, 0.64], [0.985, 0.4], [1, 0.12]];
const _KSU_HOEHE = [[0, 0.13], [0.15, 0.2], [0.35, 0.235], [0.5, 0.22], [0.62, 0.16], [0.75, 0.12], [0.88, 0.098], [1, 0.07]];
function _ksuKurve(K, t) { for (let i = 1; i < K.length; i++) if (t <= K[i][0]) { const a = K[i - 1], b = K[i], f = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * f; } return K[K.length - 1][1]; }
// Leisten: Ferse bei x = 0, Fußsohle auf z = 0, Mitte y = 0. extra = rundum aufgedickt (mm),
// schacht = Einstiegsschacht nach oben (Anteil der Fußlänge ab Ferse, 0 = keiner).
function _ksuLeisten(w, p, extra, schacht) {
  const M = w.Manifold, { Lf, W } = _ksuFuss(p), e = extra || 0, nA = 20;
  const TS = [0, 0.003, 0.012, 0.03, 0.055, 0.085, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.68, 0.75, 0.82, 0.87, 0.91, 0.94, 0.965, 0.983, 0.995, 1], nT = TS.length - 1;
  const rund = (t, t0, len) => Math.sqrt(Math.max(0, 1 - ((t0 - t) / len) ** 2));   // Viertelkreis-Auslauf
  const sek = [];
  for (let i = 0; i <= nT; i++) {
    const t = TS[i], ende = i === 0 || i === nT, x = t * Lf + (i === 0 ? -e * 0.85 : i === nT ? e * 0.85 : 0);   // Enden nur teilweise vorziehen, sonst „Nase“
    let bf = _ksuKurve(_KSU_BREITE, t);
    if (t < 0.12) bf = 0.64 * rund(t, 0.12, 0.12) * 0.97 + 0.02;                  // runde Ferse
    if (t > 0.87) bf = _ksuKurve(_KSU_BREITE, 0.87) * rund(t, 0.87, -0.13) * 0.95 + 0.04;   // runde Zehenkappe
    const b = bf * W / 2 + (ende ? e * 0.5 : e), h = _ksuKurve(_KSU_HOEHE, t) * Lf * (t > 0.87 ? 0.25 + 0.75 * rund(t, 0.87, -0.13) : 1) + (ende ? e * 0.5 : e);   // Zehenkappe auch in der Höhe rund
    const pts = [];
    for (let k = 0; k <= nA; k++) {                                         // Querschnitt: flache Sohle, runde Flanken und Rist
      const a = Math.PI * k / nA, y = -Math.cos(a) * b, s = Math.sin(a);
      pts.push([x, y * (k === 0 || k === nA ? 0.86 : 1), -e], [x, y, h * 0.35 * Math.min(1, s * 3)], [x, y * 0.92, h * (0.35 + 0.65 * Math.pow(s, 0.8))]);
    }
    sek.push(pts);
  }
  const teile = [];
  for (let i = 0; i < nT; i++) teile.push(M.hull([...sek[i], ...sek[i + 1]]));
  let L = M.union(teile); teile.forEach(t => t.delete());
  if (schacht > 0) {                                                      // Einstieg: Ellipse über Ferse/Rist, nach oben offen
    const a = schacht * Lf / 2 + e, cx = schacht * Lf / 2 - 0.02 * Lf;
    const s = w.CrossSection.circle(1, 64).scale([a, 0.62 * W / 2 + e]).translate([cx, 0]).extrude(800).translate([0, 0, 0.1 * Lf]);
    const L2 = M.union(L, s); L.delete(); s.delete(); L = L2;
  }
  return L;
}
// KI-Netz (Y oben, beliebig gedreht/skaliert) → Z oben, Länge entlang +X, Spitze bei +X, Boden z = 0
function _ksuAusrichten(w, M0, zOben) {
  let m = zOben ? M0.translate([0, 0, 0]) : M0.rotate([90, 0, 0]);
  const mesh = m.getMesh(), v = mesh.vertProperties, np = mesh.numProp, n = v.length / np;
  let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += v[i * np]; cy += v[i * np + 1]; } cx /= n; cy /= n;
  let sxx = 0, sxy = 0, syy = 0; for (let i = 0; i < n; i++) { const x = v[i * np] - cx, y = v[i * np + 1] - cy; sxx += x * x; sxy += x * y; syy += y * y; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy) * 180 / Math.PI;   // Hauptachse in XY
  m = m.translate([-cx, -cy, 0]).rotate([0, 0, -ang]);
  // Spitze = Ende mit der niedrigeren Oberkante (Ferse hat den hohen Kragen)
  const bb = m.boundingBox(), L = bb.max[0] - bb.min[0];
  const top = (x0, x1) => { const s = m.trimByPlane([1, 0, 0], x0).trimByPlane([-1, 0, 0], -x1); const z = s.isEmpty() ? 0 : s.boundingBox().max[2]; s.delete(); return z; };
  if (top(bb.max[0] - L * 0.2, bb.max[0]) > top(bb.min[0], bb.min[0] + L * 0.2)) m = m.rotate([0, 0, 180]);
  const b2 = m.boundingBox();
  return m.translate([-b2.min[0], -(b2.min[1] + b2.max[1]) / 2, -b2.min[2]]);
}
// KI-Schuhe haben oft schon einen Hohlraum unter dem Kragen (krumm, Wände zufällig).
// Schichtweise füllen: in jedem Schnitt die Löcher (= Hohlraum) zumachen, die Außenhaut
// bleibt die originale. Danach schneiden wir unseren eigenen Fußraum mit fester Wand.
function _ksuFuellen(w, m, dz) {
  const M = w.Manifold, CS = w.CrossSection, bb = m.boundingBox(), parts = [];
  const flaeche = q => { let a = 0; for (let i = 0; i < q.length; i++) { const u = q[i], v = q[(i + 1) % q.length]; a += u[0] * v[1] - v[0] * u[1]; } return a / 2; };
  for (let z = bb.min[2] + dz; z < bb.max[2] - dz * 0.5; z += dz) {
    const cs = m.slice(z), polys = cs.toPolygons();
    const aussen = polys.filter(q => flaeche(q) > 0);
    if (aussen.length && aussen.length < polys.length) {
      const voll = new CS(aussen), loch = voll.subtract(cs), stuecke = loch.decompose();
      for (const st of stuecke) { if (st.area() > 40) parts.push(st.offset(0.4, 'Round').extrude(dz * 1.05).translate([0, 0, z - dz * 0.5])); st.delete(); }
      voll.delete(); loch.delete();
    }
    cs.delete();
  }
  if (!parts.length) return m;
  const f = M.union([m, ...parts]); parts.forEach(q => q.delete());
  return f;
}
// Schuh auf Größe bringen + Fußraum herausziehen.
// p: { eu, weite, wand (mm), einstieg (Anteil Fußlänge), sohle (mm, 0 = automatisch) }
function _ksuTragbar(w, M0, p, zOben) {
  const M = w.Manifold, { Lf, W } = _ksuFuss(p), wand = p.wand || 3, einst = p.einstieg || 0.45;
  const ausg = _ksuAusrichten(w, M0, zOben), s0 = (Lf + 2 * wand + 16) / ausg.boundingBox().max[0];
  const roh0 = ausg.scale([s0, s0, s0]); ausg.delete();                    // ab hier mm
  const roh = _ksuFuellen(w, roh0, 1.2);
  const breiteBei = (m, x) => { const sl = m.trimByPlane([1, 0, 0], x - 3).trimByPlane([-1, 0, 0], -(x + 3)); const b = sl.isEmpty() ? 0 : sl.boundingBox().max[1] - sl.boundingBox().min[1]; sl.delete(); return b; };
  const obenBei = (m, x) => { const sl = m.trimByPlane([1, 0, 0], x - 1.5).trimByPlane([-1, 0, 0], -(x + 1.5)); const z = sl.isEmpty() ? 0 : sl.boundingBox().max[2]; sl.delete(); return z; };
  // Breite direkt auf Fuß + Wand (KI-Sneaker sind schlanker als ein Fuß plus Wand)
  const rb = roh.boundingBox(), xBall = rb.max[0] - wand - 8 - 0.32 * Lf;
  let s = 1, sy = Math.max(1, (W + 2 * wand + 4) / Math.max(1, breiteBei(roh, xBall)));
  const dick0 = _ksuLeisten(w, p, wand, 0), schacht = _ksuLeisten(w, p, wand + 1, einst);
  let best = null;
  for (let it = 0; it < 7; it++) {
    const schuh = roh.scale([s, s * sy, s]), sb = schuh.boundingBox(), H = sb.max[2];
    // Ferse an die Rückwand, gemessen in einem Drittel der Höhe
    const ring = schuh.slice(H * 0.3), rbx = ring.bounds(); ring.delete();
    const x0 = Math.max(rbx.min[0] + wand + 1, sb.max[0] - Lf - wand - 22);
    // Sohle: so hoch, dass der aufgedickte Leisten im Vorfuß unter die Schuh-Oberkante passt
    let sohle = p.sohle > 0 ? p.sohle : Infinity;
    if (!(p.sohle > 0)) for (const t of [0.62, 0.72, 0.82, 0.9]) sohle = Math.min(sohle, obenBei(schuh, x0 + t * Lf) - (_ksuKurve(_KSU_HOEHE, t) * Lf + wand));
    sohle = Math.max(wand + 2, Math.min(sohle, H * 0.4));
    const dick = dick0.translate([x0, 0, sohle]), sch = schacht.translate([x0, 0, sohle]);
    const l1 = M.difference(dick, schuh), leck = M.difference(l1, sch), lv = leck.volume();
    [dick, sch, l1, leck].forEach(q => q.delete());
    if (best) best.schuh.delete();
    best = { s, sy, sohle, x0, H, leck: lv, schuh };
    if (lv < 200) break;
    if (breiteBei(schuh, x0 + 0.68 * Lf) < W + 2 * wand + 3) sy *= 1.04; else s *= 1.04;
  }
  dick0.delete(); schacht.delete();
  const leisten = _ksuLeisten(w, p, 0, einst).translate([best.x0, 0, best.sohle]);
  let fertig = M.difference(best.schuh, leisten);
  const st = fertig.decompose();                                          // Splitter (Füll-Reste, abgetrennte Lasche) weg
  if (st.length > 1) { const vmax = Math.max(...st.map(q => q.volume())); const keep = st.filter(q => q.volume() > vmax * 0.02);
    fertig.delete(); fertig = M.union(keep); st.forEach(q => q.delete()); } else st.forEach(q => q.delete());
  const fb = fertig.boundingBox();
  const info = { Lf, W, eu: p.eu, sohle: best.sohle, laenge: fb.max[0] - fb.min[0], breite: fb.max[1] - fb.min[1], hoehe: fb.max[2],
    leck: best.leck, groesser: best.s, quer: best.sy };
  best.schuh.delete(); if (roh !== roh0) roh.delete(); roh0.delete();
  return { schuh: fertig, leisten, info };
}
