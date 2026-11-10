// Lichtbox / Krippen-Lichthaus — Manifold, mm. Frontansicht in XY (y oben), Tiefe Z:
// Front liegt oben (z = D), Rückseite offen bei z = 0. Druck: kopfüber (Front auf der Platte).
// Teile: Kasten (mit dünner Front), Dunkel (Strichbild/Text als Einlage in den vordersten 0,4 mm,
// nur Stil 'farbe'), Deckel (Rückwand zum Einstecken mit LED-Mulde).
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs, h} (App: _lttText) — in Node null.
// Glücksschwein (schaut nach links), Breite 1 — Höhe ≈ 0,64; Fußkanten bleiben eckig
const _LBX_SCHWEIN = [[0.00, 0.30], [0.00, 0.43], [0.07, 0.47], [0.16, 0.55], [0.21, 0.67], [0.27, 0.56], [0.40, 0.61], [0.70, 0.61], [0.86, 0.56],
  [0.94, 0.47], [0.985, 0.52], [1.0, 0.46], [0.97, 0.40], [0.97, 0.28], [0.935, 0.17], [0.935, 0], [0.79, 0], [0.775, 0.10], [0.31, 0.10], [0.295, 0], [0.15, 0], [0.15, 0.14], [0.08, 0.22]];
function _lbxSchwein(p) {
  const W = p.breite, ecke = new Set([0, 1, 5, 15, 16, 19, 20]);
  let P = _LBX_SCHWEIN.map((q, i) => ({ x: q[0], y: q[1], f: ecke.has(i) }));
  for (let it = 0; it < 2; it++) { const Q = []; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length];
    if (a.f) Q.push(a); else Q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    if (!(a.f && b.f)) Q.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }); } P = Q; }
  return P.map(q => [(q.x - 0.5) * W, q.y * W]);
}
// Wichtel (Breite 1, Höhe 1), Spitze leicht nach rechts geneigt; Bodenecken bleiben eckig
const _LBX_WICHTEL = [[-0.42, 0], [0.42, 0], [0.47, 0.2], [0.48, 0.42], [0.40, 0.62], [0.24, 0.84], [0.10, 0.97], [0.06, 1.0], [0.0, 0.985], [-0.18, 0.84], [-0.38, 0.62], [-0.48, 0.42], [-0.47, 0.2]];
function _lbxUmriss(CS, p) {
  const W = p.breite, H = p.hoehe, r = Math.min(4, W / 10);
  let pts;
  if (p.form === 'wichtel') {
    const roh = new CS([_LBX_WICHTEL.map(([x, y]) => [x * W, y * H])], 'NonZero'), a2 = roh.offset(-2, 'Round', 2, 32), b2 = a2.offset(2, 'Round', 2, 32);
    roh.delete(); a2.delete(); return b2;
  }
  if (p.form === 'schwein') {
    const roh = new CS([_lbxSchwein(p)], 'NonZero');
    if (!p.kerze) return roh;
    const kx = 0.12 * W, kb = 0.1 * W, ky = 0.58 * W, kh = 0.36 * W;     // Kerze auf dem Rücken (Teil der Box)
    const kerze = new CS([[[kx - kb / 2, ky], [kx + kb / 2, ky], [kx + kb / 2, ky + kh], [kx + kb * 0.15, ky + kh + kb * 1.3], [kx, ky + kh + kb * 2.1], [kx - kb * 0.15, ky + kh + kb * 1.3], [kx - kb / 2, ky + kh]]]);
    const u = roh.add(kerze); roh.delete(); kerze.delete();
    const a2 = u.offset(1.5, 'Round', 2, 32), b2 = a2.offset(-1.5, 'Round', 2, 32); u.delete(); a2.delete(); return b2;
  }
  if (p.form === 'haus') { const hw = H * p.wandH / 100; pts = [[-W / 2, 0], [W / 2, 0], [W / 2, hw], [0, H], [-W / 2, hw]]; }
  else pts = [[-W / 2, 0], [W / 2, 0], [W / 2, H], [-W / 2, H]];
  const roh = new CS([pts]), a = roh.offset(-r, 'Round', 2, 48), b = a.offset(r, 'Round', 2, 48); roh.delete(); a.delete();
  return b;
}
// Strich durch Punkte (Breite b), optional geschlossen
function _lbxStrich(CS, pts, b, zu) {
  const teile = [], n = pts.length;
  for (let i = 0; i < (zu ? n : n - 1); i++) {
    const a = pts[i], c = pts[(i + 1) % n], dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-6) continue;
    const nx = -dy / l * b / 2, ny = dx / l * b / 2;
    teile.push(new CS([[[a[0] + nx, a[1] + ny], [a[0] - nx, a[1] - ny], [c[0] - nx, c[1] - ny], [c[0] + nx, c[1] + ny]]], 'NonZero'));
  }
  for (const q of pts) teile.push(CS.circle(b / 2, 16).translate(q));
  const u = CS.union(teile); teile.forEach(t => t.delete()); return u;
}
function _lbxKreis(CS, cx, cy, r, b) { const a = CS.circle(r + b / 2, 64), i = CS.circle(Math.max(0.01, r - b / 2), 64); const u = a.subtract(i); a.delete(); i.delete(); return u.translate([cx, cy]); }
function _lbxStern(CS, cx, cy, R, rel) { const pts = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * (rel || 0.42) : R; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return new CS([pts]); }
// Krippe als Strichbild in einem Feld (x0, y0, Breite s·1, Höhe s·0,9): Maria, Krippe mit Kind, Josef
function _lbxKrippe(CS, x0, y0, s, b, sx) {
  sx = sx || s; const P = q => q.map(([x, y]) => [x0 + x * sx, y0 + y * s]), T = [];
  T.push(_lbxStrich(CS, P([[0.04, 0], [0.07, 0.25], [0.11, 0.48], [0.16, 0.63], [0.23, 0.69], [0.30, 0.63], [0.32, 0.45], [0.34, 0]]), b, true));   // Maria (Umhang)
  T.push(_lbxKreis(CS, x0 + 0.235 * sx, y0 + 0.555 * s, 0.052 * s, b));                                             // Gesicht
  T.push(_lbxStrich(CS, P([[0.40, 0.30], [0.60, 0.30]]), b), _lbxStrich(CS, P([[0.41, 0.30], [0.56, 0]]), b), _lbxStrich(CS, P([[0.59, 0.30], [0.44, 0]]), b));   // Krippe
  T.push(_lbxKreis(CS, x0 + 0.465 * sx, y0 + 0.37 * s, 0.035 * s, b));                                              // Kind
  T.push(_lbxStrich(CS, P([[0.50, 0.37], [0.55, 0.40], [0.585, 0.33]]), b));
  const J = []; for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; J.push([0.77 + 0.09 * Math.cos(a), 0.60 + 0.09 * Math.sin(a)]); }
  T.push(_lbxStrich(CS, P([[0.86, 0], ...J, [0.68, 0]]), b, true));                                                 // Josef
  T.push(_lbxKreis(CS, x0 + 0.77 * sx, y0 + 0.80 * s, 0.065 * s, b));
  const u = CS.union(T); T.forEach(t => t.delete()); return u;
}
let _lbxLedOk = true;
function _lbxBuild(w, p, textFn) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { if (x) tmp.push(x); return x; };
  try {
    const W = p.breite, H = p.hoehe, D = p.tiefe, wd = p.wand, fd = p.front, b = p.strich;
    const U = k(_lbxUmriss(CS, p)), innen = k(U.offset(-wd, 'Round'));
    let kasten = k(M.difference(k(U.extrude(D)), k(k(innen.extrude(D - fd + 1)).translate([0, 0, -1]))));
    // ── Motiv-Flächen (Frontansicht) ──
    const motiv = [], durch = [];
    const schwein = p.form === 'schwein', ins = (schwein ? 3 : 4) + wd, hw = schwein ? 0.6 * W : p.form === 'haus' ? H * p.wandH / 100 : H;
    if (p.form === 'wichtel') {                                             // Krempe, Nase, Bart, Punkte, Streifen, Herz
      const yk = 0.56 * H, bk = 0.40 * W, nr = 0.085 * W;
      const krempe = []; for (let i = 0; i <= 12; i++) { const t = i / 12; krempe.push([(-bk + 2 * bk * t), yk + 0.012 * H * Math.sin(Math.PI * t)]); }
      motiv.push(k(_lbxStrich(CS, krempe, b)), k(_lbxKreis(CS, 0, yk - nr * 0.2, nr, b)));
      const bart = []; for (let i = 0; i <= 16; i++) { const t = i / 16, x = -bk * 0.95 + 1.9 * bk * t, yy = yk - 0.02 * H - (0.42 * H) * Math.pow(1 - Math.abs(2 * t - 1), 0.85); bart.push([x, yy]); }
      motiv.push(k(_lbxStrich(CS, bart, b)));
      if (p.punkte) for (const [fx, fy] of [[0.0, 0.88], [-0.06, 0.8], [0.08, 0.79], [-0.12, 0.71], [0.02, 0.72], [0.15, 0.7], [-0.18, 0.63], [-0.04, 0.64], [0.1, 0.63], [0.22, 0.62]])
        motiv.push(k(CS.circle(0.032 * W, 24).translate([fx * W, fy * H])));
      if (p.wimpel) for (let i = 0; i < 4; i++) { const yy = 0.035 * H + i * 0.022 * H; motiv.push(k(_lbxStrich(CS, [[-0.36 * W, yy], [0.36 * W, yy + 0.004 * H]], b))); }   // Streifen unten
      if (p.herz) { const hx = 0, hy = 0.08 * H, s2 = 0.07 * W;
        motiv.push(k(CS.union([k(CS.circle(s2 * 0.6, 32).translate([hx - s2 * 0.5, hy + s2 * 0.2])), k(CS.circle(s2 * 0.6, 32).translate([hx + s2 * 0.5, hy + s2 * 0.2])),
          k(new CS([[[hx - s2 * 1.05, hy], [hx + s2 * 1.05, hy], [hx, hy - s2 * 1.15]]], 'NonZero'))]))); }
    }
    if (schwein) {                                                          // Auge, Ohr-Linie, Herz, Pünktchen, Wimpel
      motiv.push(k(CS.circle(0.022 * W, 32).translate([-0.39 * W, 0.40 * W])));
      motiv.push(k(_lbxStrich(CS, [[-0.31 * W, 0.47 * W], [-0.285 * W, 0.6 * W], [-0.24 * W, 0.49 * W]], b)));
      if (p.herz) { const hx = 0.24 * W, hy = 0.33 * W, s2 = 0.06 * W;
        motiv.push(k(CS.union([k(CS.circle(s2 * 0.6, 32).translate([hx - s2 * 0.5, hy + s2 * 0.2])), k(CS.circle(s2 * 0.6, 32).translate([hx + s2 * 0.5, hy + s2 * 0.2])),
          k(new CS([[[hx - s2 * 1.05, hy], [hx + s2 * 1.05, hy], [hx, hy - s2 * 1.15]]], 'NonZero'))]))); }
      if (p.punkte) for (const [fx, fy] of [[-0.15, 0.48], [-0.02, 0.52], [0.12, 0.49], [0.27, 0.5], [-0.2, 0.3], [-0.06, 0.36], [0.07, 0.28], [0.36, 0.38], [-0.12, 0.18], [0.02, 0.17], [0.15, 0.2], [0.33, 0.22]])
        if (!(p.herz && Math.hypot(fx - 0.24, fy - 0.33) < 0.1)) motiv.push(k(CS.circle(0.014 * W, 24).translate([fx * W, fy * W])));
      if (p.wimpel) { const y0 = 0.5 * W, pts = []; for (let i = 0; i < 6; i++) { const x = (0.0 + i * 0.065) * W; pts.push(k(new CS([[[x, y0], [x + 0.055 * W, y0], [x + 0.0275 * W, y0 - 0.05 * W]]]))); }
        motiv.push(k(_lbxStrich(CS, [[-0.01 * W, y0 + 0.01 * W], [0.4 * W, y0 + 0.01 * W]], b * 0.7)), ...pts); }
      if (p.kerze) { const kx = 0.12 * W, kb = 0.1 * W, ky = 0.58 * W, kh = 0.36 * W;
        motiv.push(k(_lbxStrich(CS, [[kx - kb * 0.22, ky + kh - 2], [kx, ky + kh + kb * 1.5], [kx + kb * 0.22, ky + kh - 2]], b * 0.8, true))); }
    }
    if (p.rahmen) motiv.push(k(k(U.offset(-ins, 'Round')).subtract(k(U.offset(-ins - b, 'Round')))));
    const feldX = W - 2 * (ins + 5), feldY0 = ins + 6;
    let yOben = hw - ins - 6;                                               // Oberkante des Motivfelds im Kasten-/Wandteil
    if (p.motiv === 'krippe' || p.motiv === 'beides') {
      const oben = p.form === 'haus' && p.motiv === 'krippe' ? hw + (H - hw) * 0.12 : yOben;   // Josef darf in den Giebelansatz
      const s = Math.min(feldX / 0.95, (p.motiv === 'beides' ? 0.55 : 1) * (oben - feldY0) / 0.87), sx = Math.min(feldX / 0.92, s * 1.3);
      motiv.push(k(_lbxKrippe(CS, -sx * 0.45, feldY0, s, b, sx)));
      if (p.motiv === 'beides') yOben = yOben; 
    }
    // Stern: im Giebel (Haus) bzw. oben mittig
    if (p.stern !== 'aus' && !schwein && p.form !== 'wichtel') {
      const sy = p.form === 'haus' ? hw + (H - hw) * 0.38 : H - ins - Math.min(W, H) * 0.12, sR = Math.min(W, H) * 0.075;
      const st = k(_lbxStern(CS, 0, sy, sR));
      if (p.stern === 'durch') durch.push(st); else motiv.push(st);
    }
    if (p.sterne && !schwein && p.form !== 'wichtel') { const R = Math.min(W, H) * 0.028;
      for (const [fx, fy, f] of [[0.30, 0.78, 1], [0.38, 0.71, 0.6], [-0.36, 0.20, 0.8], [0.33, 0.12, 0.6]]) motiv.push(k(_lbxStern(CS, fx * W, fy * hw, R * f))); }
    // Text: Zeilen von oben nach unten im Feld zentriert
    if (textFn && p.motiv !== 'krippe') {
      const Z = [[p.text1, p.font1, p.h1], [p.text2, p.font2, p.h2], [p.text3, p.font3, p.h3]].filter(z => z[0] && z[2] > 0);
      const yTop = p.motiv === 'beides' ? yOben : yOben, yBot = p.motiv === 'beides' ? feldY0 + (yOben - feldY0) * 0.55 : feldY0;
      const ges = Z.reduce((s, z) => s + z[2] * 1.35, 0); let yb = (yTop + yBot) / 2 + ges / 2;
      for (const [t, f, h] of Z) { yb -= h * 1.35; const r = textFn(CS, k, t, f, h, 0, yb + h * 0.2, feldX); if (r && r.cs) motiv.push(r.cs); }
    }
    let dunkel = null;
    if (motiv.length) {
      const mu = k(k(CS.union(motiv)).intersect(k(U.offset(-wd - 1, 'Round'))));
      if (p.stil === 'farbe') { dunkel = k(mu.extrude(0.4).translate([0, 0, D - 0.4])); kasten = k(M.difference(kasten, dunkel)); }
      else kasten = k(M.difference(kasten, k(mu.extrude(fd - 0.45 + 0.01).translate([0, 0, D - fd - 0.01]))));   // von innen verdünnt → Linien leuchten heller
    }
    if (durch.length) kasten = k(M.difference(kasten, k(k(CS.union(durch)).extrude(fd + 2).translate([0, 0, D - fd - 1]))));
    // ── Deckel (Rückwand zum Einstecken) mit LED-Mulde ──
    let deckel = null;
    if (p.deckel) {
      const stopf = k(innen.offset(-p.spiel, 'Round')), plat = k(U.extrude(1.6).translate([0, 0, -1.6 - 0.03]));
      let dk = k(M.union(plat, k(k(stopf.subtract(k(stopf.offset(-1.6, 'Round')))).extrude(5.5).translate([0, 0, -0.5]))));   // Rand-Kragen statt Vollplatte (überlappt die Platte)
      const led = p.ledD + 1, raum = k(innen.offset(-p.spiel - 1.8, 'Round'));
      // Mulden-Platz: Ring (led/2 + 1,6) muss ganz in den Innenraum passen — Raster absuchen, nächster Punkt zur Mitte
      let lx = 0, ly = null; const ib = raum.bounds(), zx = (ib.min[0] + ib.max[0]) / 2, zy = ib.min[1] + (ib.max[1] - ib.min[1]) * 0.4;
      if (p.ledD > 0) { let best = Infinity; const rr = led / 2 + 1.6;
        for (let y = ib.min[1] + rr; y <= ib.max[1] - rr; y += 2) for (let x = ib.min[0] + rr; x <= ib.max[0] - rr; x += 2) {
          const d = (x - zx) ** 2 + (y - zy) ** 2; if (d >= best) continue;
          const c = CS.circle(rr, 32).translate([x, y]), rest = c.subtract(raum), a2 = rest.area(); c.delete(); rest.delete();
          if (a2 < 0.01) { best = d; lx = x; ly = y; } } }
      if (p.ledD > 0 && ly !== null) {
        const ring = k(M.difference(k(M.cylinder(5.5, led / 2 + 1.6, led / 2 + 1.6, 64)), k(M.cylinder(5.7, led / 2, led / 2, 64).translate([0, 0, -0.1]))).translate([lx, ly, -0.5]));
        dk = k(M.union(dk, ring));
        dk = k(M.difference(dk, k(M.cylinder(4, 6, 6, 32).translate([lx, ly, -2]))));   // Loch zum Ein-/Ausschalten von hinten
      }
      if (p.kabel) dk = k(M.difference(dk, k(M.cube([8, 6, 10]).translate([-4, wd - 1, -3]))));   // Kabelkerbe unten
      deckel = dk; _lbxLedOk = !(p.ledD > 0) || ly !== null;
    }
    return { kasten: kasten.translate([0, 0, 0]), dunkel: dunkel ? dunkel.translate([0, 0, 0]) : null, deckel: deckel ? deckel.translate([0, 0, 0]) : null, hw, ledPasst: !(p.deckel && p.ledD > 0) || _lbxLedOk };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
