// Hirsch-Deckel — Aufsatz für den Schraubdeckel eines Glases + Hirsch-Topper. mm, Y oben, Vorderseite +Z.
// Deckel: Scheibe mit Fase oben, optional Schürze über den Originaldeckel (wird aufgeklebt), Steckaufnahme durch die Platte.
// Topper: „tupfen“ / „schlicht“ = flache Silhouette (schwarzer Kern, weißer Rand, bei „tupfen“ weiße Pünktchen, je Farbe
// ein Teil, durchgehend), „plastisch“ = Hirschkopf als Distanzfeld auf quadratischem Sockel (Sockel = Steckzapfen).
// Einbaulage: Deckel steht auf y = 0, Topper ab Deckeloberkante. Braucht: _lgfLevel, _lgfSmin, _dklCone, _dklEll.
function _hidStrich(CS, k, pts) {                                            // Kapselkette [[x, y, r] …] (2D)
  const L = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, ar] = pts[i], [bx, by, br] = pts[i + 1];
    L.push(k(CS.hull([k(k(CS.circle(ar, 24)).translate([ax, ay])), k(k(CS.circle(br, 24)).translate([bx, by]))])));
  }
  return k(CS.union(L));
}
// Silhouette (Einheiten: Kinn y = 0, Geweihspitzen y ≈ 100) — rechte Hälfte, gespiegelt
const _HID_FORM = {
  tupfen: { kopf: [[0, 7, 6.5], [-11, 33, 9.5], [11, 33, 9.5]], ohr: [25, 36, 10, 4.6, 18],
    stange: [[7, 40, 3.4], [16, 51, 3.1], [28, 57, 2.9], [38, 65, 2.7], [44, 77, 2.4], [45, 89, 2.0], [41, 99, 1.6]],
    enden: [[[16, 51, 3.0], [13, 63, 2.0], [12, 70, 1.5]], [[28, 57, 2.8], [25, 72, 1.9], [23, 81, 1.5]], [[38, 65, 2.6], [34, 80, 1.8], [32, 89, 1.4]], [[44, 77, 2.3], [52, 85, 1.5]]] },
  schlicht: { kopf: [[0, 7, 7], [-12, 32, 10.5], [12, 32, 10.5]], ohr: [27, 35, 11, 5, 12],
    stange: [[7, 40, 3.6], [14, 50, 3.3], [26, 55, 3.0], [37, 62, 2.8], [45, 72, 2.5], [48, 84, 2.1], [46, 95, 1.7]],
    enden: [[[14, 50, 3.2], [9, 60, 2.1], [8, 67, 1.6]], [[26, 55, 2.9], [23, 70, 2.0], [25, 80, 1.5]], [[37, 62, 2.7], [35, 78, 1.9], [38, 88, 1.5]], [[45, 72, 2.4], [53, 80, 1.6]]] }
};
function _hidSilhouette(CS, k, form) {
  const F = _HID_FORM[form] || _HID_FORM.tupfen, T = [];
  T.push(k(CS.hull(F.kopf.map(([x, y, r]) => k(k(CS.circle(r, 32)).translate([x, y]))))));
  for (const sx of [-1, 1]) {
    const [ox, oy, rx, ry, wink] = F.ohr;
    T.push(k(k(k(k(CS.circle(1, 32)).scale([rx, ry])).rotate(sx * wink)).translate([sx * ox, oy])));
    const sp = pts => pts.map(([x, y, r]) => [sx * x, y, r]);
    T.push(_hidStrich(CS, k, sp(F.stange)));
    for (const e of F.enden) T.push(_hidStrich(CS, k, sp(e)));
  }
  return k(CS.union(T));
}
function _hidPip(polys, x, y) {                                              // gerade/ungerade über alle Ringe
  let inn = false;
  for (const P of polys) for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inn = !inn;
  }
  return inn;
}
function _hidBuild(w, p, q) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  const fein = q !== 'vorschau';
  try {
    const info = {};
    // ── Deckel-Aufsatz ──
    const sch = Math.max(0, p.schuerze), Ri = p.deckelD / 2 + p.spiel, Ra = p.deckelD / 2 + p.rand, H = sch + p.platte, f = Math.min(p.fase, p.platte - 1, Ra - Ri - 0.4);
    const seg = fein ? 128 : 64;
    let deckel = k(M.union([k(M.cylinder(H - f, Ra, Ra, seg)), k(k(M.cylinder(f, Ra, Ra - f, seg)).translate([0, 0, H - f]))]));
    if (sch > 0) deckel = k(deckel.subtract(k(k(M.cylinder(sch + 0.01, Ri, Ri, seg)).translate([0, 0, -0.01]))));
    const plast = p.modell === 'plastisch', zap = p.platte - 0.3;
    const aufn = plast ? [p.sockel + 2 * p.spiel, p.sockel + 2 * p.spiel] : [p.zapfenB + 2 * p.spiel, p.dicke + 2 * p.spiel];
    deckel = k(deckel.subtract(k(M.cube([aufn[0], aufn[1], p.platte + 0.02], true).translate([0, 0, H - p.platte / 2]))));
    deckel = k(deckel.rotate([-90, 0, 0]));                                  // Z oben → Y oben
    info.deckelD = 2 * Ra; info.deckelH = H; info.innen = sch > 0 ? 2 * Ri : 0;
    // ── Topper (Ursprung = Deckeloberkante) ──
    const out = { info };
    if (!plast) {
      let sil = _hidSilhouette(CS, k, p.modell);
      const b0 = sil.bounds(), s = p.groesse / (b0.max[1] - b0.min[1]);
      sil = k(k(sil.scale([s, s])).translate([0, p.rand2 - b0.min[1] * s]));   // Kinn des weißen Rands auf dem Deckel
      const ring0 = k(k(sil.offset(p.rand2, 'Round', 2, 24)).subtract(sil));
      const zapfen = k(CS.square([p.zapfenB, zap + p.rand2 + 3], false).translate([-p.zapfenB / 2, -zap]));
      const fuss = k(CS.square([p.zapfenB + 5, p.rand2 + 1.5], false).translate([-(p.zapfenB + 5) / 2, 0]));   // Schulter: liegt auf dem Deckel auf
      const halter = k(zapfen.add(fuss));
      let schwarz = k(sil.add(halter)), weiss = k(ring0.subtract(halter));
      if (p.modell === 'tupfen' && p.tupfen > 0) {
        const r = p.tupfenR, a = p.tupfen, inn = k(sil.offset(-(r + 1.1), 'Round', 2, 16)), polys = inn.toPolygons(), bb = inn.bounds(), D = [];
        for (let j = 0, y = bb.min[1]; y <= bb.max[1]; y += a * 0.866, j++) for (let x = (j % 2 ? a / 2 : 0) - Math.ceil(-bb.min[0] / a) * a; x <= bb.max[0]; x += a)
          if (y > p.rand2 + zap * 0 + 2 && _hidPip(polys, x, y)) D.push(k(k(CS.circle(r, 16)).translate([x, y])));
        if (D.length) { const dots = k(CS.union(D)); schwarz = k(schwarz.subtract(dots)); weiss = k(weiss.add(dots)); }
        info.tupfen = D.length;
      }
      const ex = cs => k(k(cs.extrude(p.dicke)).translate([0, 0, -p.dicke / 2]));
      out.schwarz = ex(schwarz); out.weiss = ex(weiss);
      const bb = out.schwarz.boundingBox(), bw = out.weiss.boundingBox();
      info.breite = Math.max(bb.max[0], bw.max[0]) - Math.min(bb.min[0], bw.min[0]); info.hoehe = Math.max(bb.max[1], bw.max[1]);
    } else {
      // plastischer Kopf: Einheiten wie Skizze (Höhe ≈ 88), Sockel mm-genau
      const s = p.groesse / 88, so = p.sockel / 2, sh = 6;
      const P = (x, y, z) => [x * s, y * s, z * s], C = (a, b, ra, rb) => [P(...a), P(...b), ra * s, rb * s];
      const kegel = [C([0, 6, -1], [0, 26, -1], 5.5, 7), C([0, 28, 3], [0, 15, 8], 7, 4.6)];
      for (const sx of [-1, 1]) {
        kegel.push(C([sx * 8, 33, -1], [sx * 19, 42, -1], 3.6, 1.3));       // Ohren 45° schräg nach oben (stützfrei)
        const st = [[6, 37, -2, 2.6], [12, 48, -2, 2.4], [20, 56, -3, 2.2], [26, 66, -3, 2.0], [28, 76, -2, 1.8], [25, 86, -1, 1.4]];
        for (let i = 0; i + 1 < st.length; i++) kegel.push(C([sx * st[i][0], st[i][1], st[i][2]], [sx * st[i + 1][0], st[i + 1][1], st[i + 1][2]], st[i][3], st[i + 1][3]));
        for (const [a, b] of [[[12, 48, -2], [9, 59, -1]], [[20, 56, -3], [16, 68, -2]], [[26, 66, -3], [21, 78, -2]]]) kegel.push(C([sx * a[0], a[1], a[2]], [sx * b[0], b[1], b[2]], 1.9, 1.1));
      }
      const elli = [[P(0, 30, 0), [10 * s, 11 * s, 9 * s]], [P(0, 14, 8.5), [4.6 * s, 3.6 * s, 3.8 * s]]];
      const kw = 2.2 * s;
      const fKopf = (x, y, z) => {
        let d = 1e9;
        for (const [c, r] of elli) d = _lgfSmin(d, _dklEll(x, y, z, c, r), kw);
        for (const [a, b, ra, rb] of kegel) d = _lgfSmin(d, _dklCone(x, y, z, a, b, ra, rb), kw);
        const zb = Math.max(Math.abs(x) - so, Math.abs(z) - so, -zap - y, y - 0.5), sb = so + 1.5;    // Zapfen [−zap, 0] in der Aufnahme
        const box = Math.min(zb, Math.max(Math.abs(x) - sb, Math.abs(z) - sb, 0.15 - y, y - sh));    // Sockel breiter = Anschlag (0,15 mm Luft gegen Rasterrundung)
        return Math.min(Math.max(d, -y + 0.5), box);                           // Kopf nur oberhalb des Sockels (kein Einsinken in den Zapfen)
      };
      const edge = fein ? 0.45 : 1.0, bbk = [-32 * s, -zap, -14 * s, 32 * s, 90 * s, 16 * s];
      out.kopf = k(_lgfLevel(w, fKopf, bbk, edge));
      const bb = out.kopf.boundingBox(); info.breite = bb.max[0] - bb.min[0]; info.hoehe = bb.max[1]; info.teile = out.kopf.decompose().length;
    }
    out.deckel = deckel;
    for (const key of ['deckel', 'schwarz', 'weiss', 'kopf']) if (out[key]) out[key] = out[key].translate([0, 0, 0]);   // aus der Aufräumliste lösen
    out.H = H; out.zap = zap;
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
