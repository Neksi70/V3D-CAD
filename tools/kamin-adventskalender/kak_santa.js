// Kamin-Adventskalender — Aufsatz „Weihnachtsmann steckt kopfüber im Schornstein“ (nach Volkers Video, 13.11.).
// Nur der Unterkörper: weißer Pelzsaum auf dem Rand, schwarzer Gürtel mit goldener Schnalle, rote Hüfte, zwei Beine
// nach oben (links weit gespreizt, Knie leicht gebeugt), weiße Pelz-Stulpen, schwarze Stiefel mit Sohle oben.
// Manifold, mm, Z oben. kakSanta(w, s, opt) → { teile: [{ name, hex, mf }], lage, masse }
//   s = { in_w, in_d, out_w, out_d, steck }  Schacht innen, Turm außen, Stecktiefe (Standard 10)
//   Teile in DRUCKLAGE (Stopfen unten auf z = 0, stützfrei bis auf ~4 mm Überstand des Saums über dem Stopfen).
//   lage(mf): Drucklage → Einbaulage (Ursprung = Mitte der Schachtöffnung oben, z = 0 = Oberkante Rand).
//   opt.vorschau: gröberes Raster. Rote Figur als Distanzfeld (levelSet), Saum/Gürtel/Stulpen/Stiefel als Körper.
function kakSanta(w, s, opt) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  const o = opt || {}, fein = !o.vorschau;
  const steck = s.steck == null ? 10 : s.steck, spiel = 0.4;
  const W = Math.min(s.out_w, s.out_d), H = 1.2 * s.out_w;                  // Höhe über dem Rand ≈ 1,2 × Turmbreite
  const hF = Math.max(4, W * 0.05), hB = Math.max(6, W * 0.11);             // Pelzsaum, Gürtel (Band um die Hüfte)
  const bx = s.out_w - 9, by = s.out_d - 9, z0 = hF + hB, hx = bx - 3, hy = by - 3;   // Gürtel- / Hüftgrundriss, Hüfte ab z0 (Gürtel steht 1,5 mm über)
  const rl = W * 0.145, rc = rl * 1.3, rb = rl * 1.22, lc = rl * 0.75, lb = rl * 1.35;   // Bein, Stulpe, Stiefel (kräftig wie im Video)
  try {
    const rr = (bw, bd, r) => { r = Math.min(r, bw / 2 - 0.1, bd / 2 - 0.1);    // abgerundetes Rechteck um (0,0)
      return k(k(k(CS.square([bw - 2 * r, bd - 2 * r], true)).offset(r, 'Round', 2, fein ? 32 : 16))); };
    // Beine (x-z-Ebene, je etwas vor/zurück): Hüfte → Knie → Knöchel; Neigung ≤ 40° gegen die Senkrechte (stützfrei)
    const beine = [
      { y: 6, h: [bx * 0.2, 6, z0 + H * 0.2], kn: [bx * 0.27, 6, z0 + H * 0.42], a: [bx * 0.21, 6, z0 + H * 0.60] },      // rechts fast senkrecht
      { y: -6, h: [-bx * 0.18, -6, z0 + H * 0.18], kn: [-bx * 0.40, -6, z0 + H * 0.37], a: [-bx * 0.55, -6, z0 + H * 0.53] }   // links gespreizt
    ];
    for (const b of beine) { const d = [b.a[0] - b.kn[0], b.a[2] - b.kn[2]], L = Math.hypot(d[0], d[1]); b.dir = [d[0] / L, d[1] / L]; b.th = Math.atan2(d[0], d[1]) * 180 / Math.PI; }
    // ── Distanzfeld Rot: Hüfte (Ellipsoid ab Gürtel) + Beine (Kapseln), weich verschmolzen ──
    const cap = (x, y, z, a, b, r) => { const bxx = b[0] - a[0], byy = b[1] - a[1], bz = b[2] - a[2], px = x - a[0], py = y - a[1], pz = z - a[2];
      const t = Math.max(0, Math.min(1, (px * bxx + py * byy + pz * bz) / (bxx * bxx + byy * byy + bz * bz)));
      return Math.hypot(px - bxx * t, py - byy * t, pz - bz * t) - r; };
    const ell = (x, y, z, c, r) => { const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
      const k0 = Math.hypot(px, py, pz), k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]); return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(...r); };
    const smin = (a, b, kk) => { const h = Math.max(kk - Math.abs(a - b), 0) / kk; return Math.min(a, b) - h * h * kk * 0.25; };
    const rbox = (x, y, z, c, hs, r) => { const qx = Math.abs(x - c[0]) - hs[0] + r, qy = Math.abs(y - c[1]) - hs[1] + r, qz = Math.abs(z - c[2]) - hs[2] + r;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r; };
    const hz = H * 0.2, hrund = Math.min(hx, hy) * 0.32;                     // Hüfte: senkrechte Seiten im Gürtel, oben kräftig gerundet
    const rot = (x, y, z) => {
      let d = rbox(x, y, z, [0, 0, z0], [hx / 2, hy / 2, hz], hrund);
      d = smin(d, ell(x, y, z, [hx * 0.2, 0, z0 + hz * 0.75], [hx * 0.3, hy * 0.42, hz * 0.55]), 8);   // Pobacken
      d = smin(d, ell(x, y, z, [-hx * 0.2, 0, z0 + hz * 0.75], [hx * 0.3, hy * 0.42, hz * 0.55]), 8);
      for (const b of beine) { d = smin(d, cap(x, y, z, b.h, b.kn, rl * 1.1), rl * 1.0); d = smin(d, cap(x, y, z, b.kn, b.a, rl), rl * 0.6); }
      return d;
    };
    const e = fein ? Math.max(0.8, W / 85) : Math.max(1.5, W / 45);
    const bb = [-s.out_w, -s.out_d, z0 - 2 * hz, s.out_w, s.out_d, z0 + H + 10];
    let roh = k(M.levelSet(p => -rot(p[0], p[1], p[2]), { min: [bb[0], bb[1], bb[2]], max: [bb[3], bb[4], bb[5]] }, e, 0));
    { const st = roh.decompose(); if (st.length > 1) { const v = st.map(m => m.volume()), mx = Math.max(...v); roh = k(M.union(st.filter((m, i) => v[i] >= mx * 0.01))); } st.forEach(m => tmp.push(m)); }
    // ── Stulpen (weiß, unten 45° angesetzt) + Stiefel (schwarz, Sohle oben) entlang der Unterschenkelachse ──
    const langs = (mf, b, t0) => k(k(mf.rotate([0, b.th, 0])).translate([b.a[0] + b.dir[0] * t0, b.y, b.a[2] + b.dir[1] * t0]));
    const zyl = (l, r, r2) => k(M.cylinder(l, r, r2 == null ? r : r2, fein ? 48 : 24));
    const stulpen = [], stiefel = [];
    for (const b of beine) {
      const neig = Math.abs(b.th), kegel = (rc - rl * 1.02) / Math.tan(Math.max(12, 45 - neig) * Math.PI / 180);   // Unterkante: Kegel so flach, dass auch beim schrägen Bein ≤ 45° überhängt
      stulpen.push(langs(k(M.union([zyl(kegel, rl * 1.02, rc), k(zyl(lc, rc).translate([0, 0, kegel]))])), b, -kegel * 0.6));
      const st = k(M.union([zyl(lb - 3, rb), k(zyl(3, rb * 1.04, rb * 1.04).translate([0, 0, lb - 3]))]));   // Schaft + Sohle (minimal breiter, oben)
      stiefel.push(langs(st, b, -kegel * 0.6 + kegel + lc - 0.3));   // 0,3 mm in die Stulpe, unten abgezogen → exakt gemeinsame Fläche
    }
    const stulpe = k(M.union(stulpen)), stiefelU = k(k(M.union(stiefel)).subtract(stulpe));
    // ── Saum (weiß) mit Stopfen, Gürtel (schwarz), Schnalle (gold) ──
    const pw = s.in_w - 2 * spiel, pd = s.in_d - 2 * spiel;
    const stopfen = k(k(rr(pw, pd, 3).extrude(steck + 0.5)).translate([0, 0, -steck]));
    const saum = k(M.hull([k(k(rr(s.out_w - 2, s.out_d - 2, 6).extrude(hF - 1.5))), k(k(rr(s.out_w - 5, s.out_d - 5, 4.5).extrude(1.5)).translate([0, 0, hF - 1.5]))]));
    const weiss = k(M.union([stopfen, saum, stulpe]));
    const guertel = k(k(rr(bx, by, hrund * 0.6).extrude(hB)).translate([0, 0, hF]));
    const sw = Math.min(bx * 0.24, 24), sh = hB - 1.2, sp = 1.6;
    const schnalle = k(k(k(k(rr(sw, sh, 1.2).subtract(rr(sw * 0.5, sh * 0.42, 0.6))).extrude(sp)).rotate([90, 0, 0])).translate([bx * 0.16, -by / 2 + 0.02, hF + 0.6 + sh / 2]));   // vorn, etwas seitlich (wie im Video)
    const schwarz = k(M.union([guertel, stiefelU]));
    // Rot: nur über dem Gürtel, ohne Stulpen/Stiefel
    const oben = k(k(M.cube([4 * s.out_w, 4 * s.out_d, 2 * H + 50], true)).translate([0, 0, z0 + H + 25]));
    let rotK = k(k(roh.intersect(oben)).subtract(k(M.union([stulpe, stiefelU]))));
    { const st = rotK.decompose(); st.forEach(m => tmp.push(m)); const v = st.map(m => m.volume()), mx = Math.max(...v); if (st.length > 1) rotK = k(M.union(st.filter((m, i) => v[i] >= mx * 0.02))); }   // Randsplitter an Stulpen weg
    const gold = k(schnalle.subtract(guertel));
    const druck = mf => mf.translate([0, 0, steck]);
    const teile = [{ name: 'Weihnachtsmann Hose', hex: '#c8323a', mf: druck(rotK) }, { name: 'Weihnachtsmann Pelz', hex: '#f4f1ea', mf: druck(weiss) },
      { name: 'Weihnachtsmann Gürtel + Stiefel', hex: '#1f1f1f', mf: druck(schwarz) }, { name: 'Weihnachtsmann Schnalle', hex: '#e2b13c', mf: druck(gold) }];
    const box = M.union(teile.map(t => t.mf)), bbx = box.boundingBox(); box.delete();
    return { teile, lage: mf => mf.translate([0, 0, -steck]), masse: { hoehe_ueber_rand: bbx.max[2] - steck, gesamt: [bbx.max[0] - bbx.min[0], bbx.max[1] - bbx.min[1], bbx.max[2] - bbx.min[2]], steck, spiel, saum_h: hF, guertel_h: hB } };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
if (typeof module !== 'undefined') module.exports = { kakSanta };
if (typeof globalThis !== 'undefined') globalThis.kakSanta = kakSanta;
