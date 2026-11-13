// Schutzengel-Anhänger — Manifold, mm, Platte in XY (y oben), Dicke entlang Z, liegt auf z = 0.
// Teile: Körper (Kopf + Kegel, Aufhängeloch, Pünktchen/Stern), Flügel (Fähnchen mit Herz,
// eigene Farbe), Dunkel (Streifen + Text, erhaben oben drauf → Farbwechsel nur bei z = Dicke).
// p.druck 'glatt': Text/Streifen/Punkte bündig eingelegt (Tiefe p.tiefe), Schauseite wird auf die Platte gelegt (App dreht).
// p.gravur 'holz' (Volker 13.11., Foto Holz-Anhänger): einfarbig – Flügel gehören zum Körper, Text + Streifen graviert,
// Stern/Herz auf der Brust ausgeschnitten (durchgehend). p.herzB = Herz auf der Brust (farbig: erhaben).
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs} (App: _lttText) — in Node null.
function _sgeZufall(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function _sgeMasse(p) {
  const H = p.hoehe, rk = 0.15 * H, yK = H - rk, B = H * p.breite / 100;
  const yHals = yK - rk * 0.75, hHals = rk * 0.5;                          // Körper beginnt unter dem Kopf (Hals)
  const halbB = y => hHals + (B / 2 - hHals) * Math.min(1, Math.max(0, (yHals - y) / yHals));   // halbe Körperbreite bei y
  return { H, rk, yK, B, yHals, hHals, halbB };
}
function _sgeBuild(w, p, textFn) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  try {
    const m = _sgeMasse(p), { H, rk, yK, B, yHals, hHals, halbB } = m, d = p.dicke, rnd = _sgeZufall(p.seed || 7);
    // ── Umriss: Kopf ∪ Kegel, Ecken gerundet (öffnen = konvexe Ecken, schließen = Hals-Kehle) ──
    const kopf = k(CS.circle(rk, 72).translate([0, yK]));
    const kegel = k(new CS([[[-B / 2, 0], [B / 2, 0], [hHals, yHals], [hHals * 0.9, yK], [-hHals * 0.9, yK], [-hHals, yHals]]]));
    let u = k(CS.union(kopf, kegel));
    const rE = Math.min(6, B * 0.08);
    u = k(k(k(u.offset(-rE, 'Round', 2, 48)).offset(rE, 'Round', 2, 48)).offset(rE * 0.6, 'Round', 2, 48)).offset(-rE * 0.6, 'Round', 2, 48); k(u);
    // ── Körper + Aufhängeloch ──
    let koerper = k(u.extrude(d));
    const lochY = yK + rk * 0.5, oeseR = p.oese / 2;
    if (p.oese > 0) koerper = k(M.difference(koerper, k(M.cylinder(d + 2, oeseR, oeseR, 32).translate([0, lochY, -1]))));
    // ── Flügel-Fähnchen mit V-Kerbe und Herz ──
    const fluegel = [];
    const fY = H * 0.2, fH = H * 0.13, fL = H * 0.26;
    const fahne = seite => {
      const xe = seite * halbB(fY + fH / 2), x0 = xe - seite * 8, x1 = xe + seite * fL, kerbe = fH * 0.45;
      const P = [[x0, fY], [x1, fY], [x1 - seite * kerbe, fY + fH / 2], [x1, fY + fH], [x0, fY + fH]];
      let f = k(new CS([seite > 0 ? P : P.slice().reverse()], 'NonZero'));
      f = k(k(f.offset(-0.8, 'Round')).offset(0.8, 'Round'));
      if (p.herz) {                                                         // Herz aus zwei Kreisen + Dreieck
        const hx = xe + seite * fL * 0.45, hy = fY + fH * 0.5, s = fH * 0.27;
        const herz = k(CS.union([k(CS.circle(s * 0.62, 32).translate([hx - s * 0.5, hy + s * 0.25])), k(CS.circle(s * 0.62, 32).translate([hx + s * 0.5, hy + s * 0.25])),
          k(new CS([[[hx - s * 1.08, hy + s * 0.05], [hx + s * 1.08, hy + s * 0.05], [hx, hy - s * 1.15]]], 'NonZero'))]));   // Dreieck im Uhrzeigersinn → NonZero, sonst fehlt die Herzspitze
        f = k(f.subtract(herz));
      }
      return k(f.extrude(d));
    };
    // Engelsflügel (p.engel): Schwinge oben am Rücken = Band (Hülle Wurzel→Spitze) + Federn als Ellipsen,
    // innen senkrecht hängend, zur Spitze hin nach außen gedreht und länger; Rillen zwischen den Federn (Volker 11.11.)
    const engel = seite => {
      const yS = yHals - 0.1 * H, xS = seite * (halbB(yS) - 1.5);
      const R = [xS + seite * 0.04 * H, yS + 0.03 * H], T = [xS + seite * 0.3 * H, yS + 0.17 * H], rR = 0.08 * H, rT = 0.035 * H;
      const teile = [k(CS.hull([k(CS.circle(rR, 48).translate(R)), k(CS.circle(rT, 32).translate(T))]))], spitzen = [], wurzeln = [], n = 7;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), P = [R[0] + (T[0] - R[0]) * t, R[1] + (T[1] - R[1]) * t - (rR + (rT - rR) * t) * 0.55];
        const L = H * (0.13 + 0.09 * t), wB = H * (0.09 - 0.025 * t), a = (-100 + 75 * t) * Math.PI / 180, dx = seite * Math.cos(a), dy = Math.sin(a);
        const c = [P[0] + dx * L * 0.42, P[1] + dy * L * 0.42];
        teile.push(k(k(k(CS.circle(1, 40).scale([L / 2, wB / 2])).rotate(Math.atan2(dy, dx) * 180 / Math.PI)).translate(c)));
        spitzen.push([P[0] + dx * L * 0.85, P[1] + dy * L * 0.85]); wurzeln.push(P);
      }
      let f = k(CS.union(teile));
      f = k(k(f.offset(-0.6, 'Round')).offset(0.6, 'Round'));
      let fl3 = k(f.extrude(d));
      const rille = (a, b) => k(CS.hull([k(CS.circle(0.35, 12).translate(a)), k(CS.circle(0.35, 12).translate(b))]));
      const rl = [];
      for (let i = 0; i + 1 < n; i++) {                                     // Linie zwischen zwei Federn: von der Wurzel bis kurz vor die Spitzen-Mitte
        const w0 = [(wurzeln[i][0] + wurzeln[i + 1][0]) / 2, (wurzeln[i][1] + wurzeln[i + 1][1]) / 2], s0 = [(spitzen[i][0] + spitzen[i + 1][0]) / 2, (spitzen[i][1] + spitzen[i + 1][1]) / 2];
        rl.push(rille(w0, [w0[0] + (s0[0] - w0[0]) * 0.8, w0[1] + (s0[1] - w0[1]) * 0.8]));
      }
      const tR = Math.min(0.6, d * 0.25);
      if (rl.length) {
        const rz = k(k(CS.union(rl)).intersect(k(f.offset(-0.8, 'Round'))));
        fl3 = k(M.difference(fl3, k(k(rz.extrude(tR + 0.01)).translate([0, 0, d - tR]))));
      }
      return fl3;
    };
    // Weitere Flügelstile nach Vorlagen (Volker 11.11.): Umriss in lokalen Einheiten (x nach außen, y nach oben, Wurzel = 0,0),
    // S = Größe; rechts gebaut, links gespiegelt (Füllregel NonZero → Drehsinn egal). Rillen als Linienzüge.
    const bz = (a, b, c, e, n) => { const o = []; for (let i = 0; i < n; i++) { const t = i / n, u = 1 - t;
      o.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * e[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * e[1]]); } return o; };
    const qz = (a, c, e, n) => bz(a, [a[0] + (c[0] - a[0]) * 2 / 3, a[1] + (c[1] - a[1]) * 2 / 3], [e[0] + (c[0] - e[0]) * 2 / 3, e[1] + (c[1] - e[1]) * 2 / 3], e, n);
    const stilFl = (stil, seite) => {
      let S = 0.3 * H, yS = yHals - 0.1 * H, phi = 0;
      const teile = [], linien = [], kreise = [];
      if (stil === 'rund') {                                                // Bild 1: großer Bogen nach außen oben, unten drei runde Bögen
        teile.push([[-0.3, 0.1], ...bz([0, 0.12], [0.3, 0.24], [0.62, 0.48], [0.92, 0.82], 24), ...bz([0.92, 0.82], [1.05, 0.55], [1.03, 0.25], [0.86, 0.02], 16), ...bz([0.86, 0.02], [0.6, -0.12], [0.3, -0.2], [0, -0.24], 16), [-0.3, -0.24]]);
        for (const [x, y, r] of [[0.78, -0.02, 0.165], [0.5, -0.15, 0.18], [0.21, -0.23, 0.17]]) kreise.push([x, y, r]);
        linien.push([[0.64, -0.1], [0.6, 0.1]], [[0.36, -0.2], [0.32, 0.02]], [[0.1, 0.1], [0.45, 0.25], [0.8, 0.58]]);
      } else if (stil === 'lang') {                                         // Bild 2: hoch neben dem Kopf, außen bauchig, unten schmal auslaufend
        S = 0.3 * H; yS = yHals - 0.05 * H;
        const AU = [[0.14, 1.0], [0.62, 0.78], [0.55, -0.1], [0.2, -0.72]];
        teile.push([...bz(...AU, 30), ...bz([0.2, -0.72], [0.1, -0.35], [-0.3, 0.0], [-0.3, 0.4], 18), ...bz([-0.3, 0.4], [-0.25, 0.85], [-0.05, 1.02], [0.14, 1.0], 14)]);
        const pk = t => { const u = 1 - t; return [0, 1].map(d => u*u*u*AU[0][d] + 3*u*u*t*AU[1][d] + 3*u*t*t*AU[2][d] + t*t*t*AU[3][d]); };
        for (const f of [0.18, 0.36, 0.54]) { const L = []; for (let t = 0.06; t <= 0.85; t += 0.03) { const a = pk(t); L.push([a[0] - f * 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.1)), a[1] + f * 0.05]); } linien.push(L); }
      } else if (stil === 'holz') {                                         // Holz-Anhänger: runder Flügel an der Schulter, unten schräg zum Körper
        S = 0.27 * H; yS = yHals - 0.2 * H;
        teile.push([[-0.4, 0.3], ...bz([-0.1, 0.4], [0.3, 0.52], [0.66, 0.42], [0.72, 0.08], 26), ...bz([0.72, 0.08], [0.76, -0.24], [0.5, -0.5], [0.1, -0.62], 22), [-0.4, -0.55]]);
      } else if (stil === 'schwung') {                                      // Bild 3: drei Sichel-Striche, spitz nach außen oben
        S = 0.32 * H;
        for (const [o0, o1, u0, u1, T] of [[[-0.3, 0.16], [0.55, 0.34], [-0.3, -0.02], [0.6, 0.06], [1.0, 0.58]], [[-0.3, -0.08], [0.45, 0.05], [-0.3, -0.21], [0.5, -0.15], [0.8, 0.22]], [[-0.3, -0.27], [0.35, -0.17], [-0.3, -0.38], [0.4, -0.35], [0.6, -0.05]]])
          teile.push([...qz(o0, o1, T, 24), ...qz(T, u1, u0, 24)]);
      }
      const xS = seite * (halbB(yS) - 1.5);
      const W = q => { const x = q[0] * Math.cos(phi) - q[1] * Math.sin(phi), y = q[0] * Math.sin(phi) + q[1] * Math.cos(phi); return [xS + seite * x * S, yS + y * S]; };
      const cs = teile.map(t => k(new CS([t.map(W)], 'NonZero')));
      for (const [x, y, r] of kreise) cs.push(k(k(CS.circle(r * S, 40)).translate(W([x, y]))));
      let f = k(CS.union(cs));
      f = k(k(f.offset(-0.6, 'Round')).offset(0.6, 'Round'));              // Spitzen dünner als 1,2 mm fallen weg (druckt sonst nicht)
      let fl3 = k(f.extrude(d));
      if (linien.length) {
        const rl = []; for (const L of linien) for (let i = 0; i + 1 < L.length; i++) { const a = W(L[i]), b = W(L[i + 1]); rl.push(k(CS.hull([k(CS.circle(0.35, 12).translate(a)), k(CS.circle(0.35, 12).translate(b))]))); }
        const tR = Math.min(0.6, d * 0.25), rz = k(k(CS.union(rl)).intersect(k(f.offset(-0.8, 'Round'))));
        if (rz.area() > 0.1) fl3 = k(M.difference(fl3, k(k(rz.extrude(tR + 0.01)).translate([0, 0, d - tR]))));
      }
      return fl3;
    };
    const herz2D = (hx, hy, s) => k(CS.union([k(CS.circle(s * 0.62, 32).translate([hx - s * 0.5, hy + s * 0.25])), k(CS.circle(s * 0.62, 32).translate([hx + s * 0.5, hy + s * 0.25])),
      k(new CS([[[hx - s * 1.08, hy + s * 0.05], [hx + s * 1.08, hy + s * 0.05], [hx, hy - s * 1.15]]], 'NonZero'))]));
    const holz = p.gravur === 'holz';
    const eStil = p.engel === 1 || p.engel === true ? 'federn' : p.engel;
    if (eStil === 'federn') { fluegel.push(k(engel(1))); fluegel.push(k(engel(-1))); }
    else if (eStil) { fluegel.push(k(stilFl(eStil, 1))); fluegel.push(k(stilFl(eStil, -1))); }
    if (p.fluegel === 'rechts' || p.fluegel === 'beide') fluegel.push(k(fahne(1)));
    if (p.fluegel === 'links' || p.fluegel === 'beide') fluegel.push(k(fahne(-1)));
    let fl = fluegel.length ? k(M.difference(k(M.union(fluegel)), koerper)) : null;   // im Körper steckender Teil gehört zum Körper
    let umriss = u;                                                           // Fläche für Gravur/Streifen (Holz: inkl. Flügel)
    if (holz && fl) { koerper = k(M.union(koerper, fl)); umriss = k(k(koerper.project()).offset(0, 'Round')); fl = null; }   // einfarbig: Flügel = Körper
    // ── Dunkel: Text + Streifen (erhaben auf der Oberseite) ──
    const glatt = p.druck === 'glatt' && !holz, tE = Math.min(p.tiefe || 0.6, d - 1);     // glatt: Einlage-Tiefe von oben; Holz = immer Gravur oben
    const gravur = [];                                                        // Holz: Rillen/Schrift von oben eingraviert
    const dunkel = [], hR = p.relief, sperr = [];                            // sperr = Rechtecke ohne Pünktchen
    const innen = k(u.offset(-2.2, 'Round'));
    if (textFn && (p.text1 || p.text2)) {
      let yb = holz ? H * 0.2 : H * 0.09;                                     // Holz: Schrift mitten aufs Kleid (Foto)
      const zeile = (txt, font, h) => {
        if (!txt || !(h > 0)) return;
        const r = textFn(CS, k, txt, font, h, 0, yb, 2 * halbB(yb + h) - 8);
        if (r && r.cs && holz) { gravur.push(k(k(k(r.cs.intersect(innen)).extrude(tE + 0.01)).translate([0, 0, d - tE]))); yb += r.h + h * 0.25; return; }
        if (r && r.cs) { dunkel.push(k(k(r.cs.intersect(innen)).extrude(glatt ? tE : hR).translate([0, 0, glatt ? d - tE : d - 0.01]))); sperr.push([-halbB(yb) , yb - 2, halbB(yb), yb + r.h + 2]); yb += r.h + h * 0.25; }
      };
      zeile(p.text2, p.font2, p.h2);                                          // untere Zeile zuerst (Schreibschrift)
      zeile(p.text1, p.font1, p.h1);
    }
    if (p.muster === 'streifen' && holz) {                                  // Holz: gleichmäßige waagerechte Rillen über Kleid und Flügel, Rand bleibt stehen
      const n = Math.max(1, Math.round(p.streifen)), y0 = H * 0.05, y1 = yHals - rk * 0.15, fl2 = k(umriss.offset(-1.8, 'Round')), bars = [];
      for (let i = 0; i < n; i++) { const y = y0 + (y1 - y0) * (i + 0.5) / n; bars.push(k(CS.square([4 * H, Math.min(1.6, (y1 - y0) / n * 0.4)], false).translate([-2 * H, y - 0.8]))); }
      gravur.push(k(k(k(k(CS.union(bars)).intersect(fl2)).extrude(tE + 0.01)).translate([0, 0, d - tE])));
    } else if (p.muster === 'streifen') {
      const n = Math.max(1, Math.round(p.streifen)), y0 = H * 0.06, y1 = yHals - rk * 0.3;
      for (let i = 0; i < n; i++) {
        const y = y0 + (y1 - y0) * (i + 0.5) / n + (rnd() - 0.5) * (y1 - y0) / n * 0.25, t = 1 + rnd() * 1.6, a = (rnd() - 0.5) * 7;
        const hb = halbB(y) * (0.8 + rnd() * 0.15), x0 = -hb + rnd() * hb * 0.25;
        const bar = k(CS.square([hb * 2 - (x0 + hb), t]).translate([x0, y - t / 2]).rotate(a));
        dunkel.push(k(k(bar.intersect(innen)).extrude(glatt ? tE : hR).translate([0, 0, glatt ? d - tE : d - 0.01])));
      }
    }
    let dk = dunkel.length ? k(M.union(dunkel)) : null;
    // ── Pünktchen + Stern (Körperfarbe) ──
    const auf = [];
    if (p.muster === 'punkte' && !holz) {
      const flaeche = u.area(), n = Math.round(flaeche * p.punkte / 1000);
      const ib = innen.bounds();
      let gesetzt = 0; const pkt = [];
      for (let t = 0; t < n * 8 && gesetzt < n; t++) {
        const x = ib.min[0] + rnd() * (ib.max[0] - ib.min[0]), y = ib.min[1] + rnd() * (ib.max[1] - ib.min[1]);
        if (Math.abs(x) > halbB(y) - 2.2 && y < yHals) continue;
        if ((x * x + (y - yK) ** 2 > (rk - 2.2) ** 2) && y > yHals) continue;
        if (sperr.some(r => x > r[0] && x < r[2] && y > r[1] && y < r[3])) continue;
        if (p.oese > 0 && x * x + (y - lochY) ** 2 < (oeseR + 2) ** 2) continue;
        if (p.stern && x * x + (y - H * 0.6) ** 2 < 64) continue;
        if (p.herzB && x * x + (y - H * 0.6) ** 2 < 64) continue;
        const r = 0.9 + rnd() * 0.7;                                          // Fuß-Ø 1,8–3,2 mm: ≥ 4 Düsenbahnen, sonst schmieren die Mini-Inseln (Druck 11.11.)
        if (pkt.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 < (q[2] + r + 1.2) ** 2)) continue;   // Abstand, keine Klumpen
        pkt.push([x, y, r]);
        auf.push(glatt ? k(M.cylinder(tE, r, r, 24).translate([x, y, d - tE]))
                       : k(M.cylinder(hR + 0.05, r, r * 0.6, 24).translate([x, y, d - 0.05]))); gesetzt++;   // flacher Kegelstumpf, Höhe = Relief (3 Schichten à 0,2)
      }
    }
    const brustY = holz ? yHals - 0.11 * H : H * 0.6;                          // Holz: Motiv oben auf der Brust (Foto)
    if (p.herzB) {
      const hz = herz2D(0, brustY, H * 0.06);
      if (holz) gravur.push(k(k(hz.extrude(d + 2)).translate([0, 0, -1])));   // ausgeschnitten
      else auf.push(glatt ? k(k(hz.extrude(tE)).translate([0, 0, d - tE])) : k(k(hz.extrude(hR + 0.2)).translate([0, 0, d - 0.01])));
    }
    if (p.stern) {
      const sR = H * 0.055, pts = [];
      for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? sR * 0.45 : sR; pts.push([r * Math.cos(a), brustY + r * Math.sin(a)]); }
      if (holz) gravur.push(k(k(k(new CS([pts])).extrude(d + 2)).translate([0, 0, -1])));   // ausgeschnitten
      else auf.push(glatt ? k(k(new CS([pts])).extrude(tE).translate([0, 0, d - tE])) : k(k(new CS([pts])).extrude(hR + 0.2).translate([0, 0, d - 0.01])));
    }
    let pk = null;
    if (glatt) {                                                              // Einlagen: aus dem Körper schneiden, Punkte/Stern als eigenes Teil (Gold)
      if (auf.length) { pk = k(M.union(auf)); if (dk) pk = k(M.difference(pk, dk)); koerper = k(M.difference(koerper, pk)); }
    } else if (auf.length) koerper = k(M.union(koerper, k(M.union(auf))));
    if (dk) koerper = k(M.difference(koerper, dk));
    if (gravur.length) koerper = k(M.difference(koerper, k(M.union(gravur))));
    // Rückseite (z = 0) mit Struktur — beim Glatt-Druck ist sie die große oberste Fläche; Glätten krümelte dort und
    // zeigte das Füllmuster (Druck 12.11.). 'auto' = beim Glatt-Druck Leinen, sonst glatt (liegt dann auf der Platte).
    const rueck = (p.rueck || 'auto') === 'auto' ? (glatt ? 'leinen' : 'glatt') : p.rueck;
    if (rueck === 'leinen' || rueck === 'hammer') {
      const tB = Math.min(0.4, d * 0.15), rr = _sgeZufall((p.seed || 7) + 99);
      const muster = feld => {
        const fb = feld.bounds(), cx = (fb.min[0] + fb.max[0]) / 2, cy = (fb.min[1] + fb.max[1]) / 2, L = Math.hypot(fb.max[0] - fb.min[0], fb.max[1] - fb.min[1]) + 4, z = [];
        if (rueck === 'leinen') { for (const wnk of [45, -45]) for (let o = -L / 2; o <= L / 2; o += 1.6) z.push(k(k(k(CS.square([L, 0.5], true)).translate([0, o])).rotate(wnk))); }
        else {                                                              // Hammerschlag: dichte, zufällige Mulden mit Abstand
          const mp = [], n = Math.round(feld.area() / 4.5);
          for (let t = 0; t < n * 12 && mp.length < n; t++) {
            const x = fb.min[0] + rr() * (fb.max[0] - fb.min[0]) - cx, y = fb.min[1] + rr() * (fb.max[1] - fb.min[1]) - cy, r = 0.6 + rr() * 0.6;
            if (mp.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 < (q[2] + r + 0.45) ** 2)) continue;
            mp.push([x, y, r]); z.push(k(k(CS.circle(r, 14)).translate([x, y])));
          }
        }
        return z.length ? k(k(k(CS.union(z)).translate([cx, cy])).intersect(feld)) : null;
      };
      const schnitt = cs => k(k(cs.extrude(tB + 0.01)).translate([0, 0, -0.01]));
      const mK = muster(k(u.offset(-1.5, 'Round')));
      if (mK && mK.area() > 1) koerper = k(M.difference(koerper, schnitt(mK)));
      if (fl) { const mF = muster(k(k(fl.project()).offset(-1.2, 'Round'))); if (mF && mF.area() > 1) fl = k(M.difference(fl, schnitt(mF))); }
    }
    const res = { koerper: koerper.translate([0, 0, 0]), fluegel: fl ? fl.translate([0, 0, 0]) : null, dunkel: dk ? dk.translate([0, 0, 0]) : null,
      punkte: pk ? pk.translate([0, 0, 0]) : null, wenden: glatt };   // Kopien: tmp wird gleich gelöscht
    res.farbwechsel = glatt ? tE : d; res.masse = m;
    return res;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
