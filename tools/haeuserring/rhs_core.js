// Häuser-Ring zum Aufhängen — Manifold, mm, flach in XY (Ringmitte 0,0), liegt auf z = 0.
// Braucht _lbxHaeuser/_lbxWimpel/_lbxStrich/_lbxStern aus dem Lichtbox-Kern.
// Teile: Körper (Ring, Öse, Steg, Häuser-Fläche mit Kontur, Wimpel), Motiv (Häuser-Strichbild,
// Buchstaben/Herzen auf den Wimpeln, Herz unter dem Steg) erhaben ab z = Dicke.
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs, h, w} (App: _lttText) — in Node null.
function _rhsBuild(w, p, textFn) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { if (x) tmp.push(x); return x; };
  try {
    const R = p.durchmesser / 2, rb = p.ringB, d = p.dicke, hR = p.relief, b = p.strich;
    const flaeche = [k(k(CS.circle(R, 180)).subtract(k(CS.circle(R - rb, 180))))];
    // Öse oben
    if (p.oese) flaeche.push(k(k(CS.circle(rb * 1.4 + 2.5, 48).translate([0, R + 2.5])).subtract(k(CS.circle(2.5, 32).translate([0, R + 2.5])))));
    // Steg
    const ys = -R * p.steg / 100, sh = p.stegH, sx = Math.sqrt(Math.max(0, (R - rb / 2) ** 2 - ys ** 2));
    flaeche.push(k(k(CS.square([2 * sx, sh])).translate([-sx, ys - sh])));
    // Häuser auf dem Steg
    const motiv = [], innen = k(CS.circle(R - rb, 180));
    const txtN = (p.wimpelText || '').trim().length + (p.wimpelHerz ? 2 : 0);
    const yFrei = txtN > 0 ? R * p.wimpelY / 100 - R * 0.07 - R * 0.13 - 3 : R - rb - 4;   // Häuser bleiben unter der Wimpelkette
    const hb = Math.min(2 * sx * p.haeuserB / 100, (yFrei - ys) / 0.82);
    const H = _lbxHaeuser(CS, 0, ys, hb, b); k(H.strich); k(H.fuell); k(H.umriss);
    flaeche.push(k(k(k(H.umriss.offset(p.kontur, 'Round', 2, 32)).intersect(innen)).add(k(CS.square([1, 1]).translate([0, ys - 0.5])))));
    motiv.push(H.strich, H.fuell);
    // Wimpelkette mit Buchstaben
    const txt = (p.wimpelText || '').trim(), n = txt.length + 2 * (p.wimpelHerz ? 1 : 0);
    if (n > 0) {
      const yw = R * p.wimpelY / 100, xw = Math.sqrt(Math.max(0, (R - rb / 2) ** 2 - yw ** 2));
      const wk = _lbxWimpel(CS, -xw, yw, xw, yw, n, R * 0.07, b * 1.2, R * 0.13); k(wk.cs);
      flaeche.push(k(wk.cs.intersect(k(CS.circle(R - rb / 2, 180)))));
      const zeichen = (p.wimpelHerz ? ['♥'] : []).concat([...txt]).concat(p.wimpelHerz ? ['♥'] : []);
      wk.wimpel.forEach(([cx, cy, wb, wh], i) => {
        const z = zeichen[i]; if (!z || z === ' ') return;
        if (z === '♥') { const s2 = wb * 0.18;
          motiv.push(k(CS.union([k(CS.circle(s2 * 0.6, 24).translate([cx - s2 * 0.5, cy + s2 * 0.6])), k(CS.circle(s2 * 0.6, 24).translate([cx + s2 * 0.5, cy + s2 * 0.6])),
            k(new CS([[[cx - s2 * 1.05, cy + s2 * 0.4], [cx + s2 * 1.05, cy + s2 * 0.4], [cx, cy - s2 * 0.75]]], 'NonZero'))]))); return; }
        if (textFn) { const th = wh * 0.46, r = textFn(CS, k, z, p.font, th, cx, cy - th * 0.05, wb * 0.62); if (r && r.cs) motiv.push(r.cs); }
      });
    }
    // Herz unter dem Steg
    if (p.herzUnten) { const s2 = sh * 0.38, cx = 0, cy = ys - sh / 2;
      motiv.push(k(CS.union([k(CS.circle(s2 * 0.6, 24).translate([cx - s2 * 0.5, cy + s2 * 0.25])), k(CS.circle(s2 * 0.6, 24).translate([cx + s2 * 0.5, cy + s2 * 0.25])),
        k(new CS([[[cx - s2 * 1.05, cy + s2 * 0.05], [cx + s2 * 1.05, cy + s2 * 0.05], [cx, cy - s2 * 1.1]]], 'NonZero'))]))); }
    const F = k(CS.union(flaeche));
    const koerper = F.extrude(d);
    let mot = null;
    if (motiv.length) { const mu = k(k(CS.union(motiv.filter(Boolean))).intersect(k(F.offset(-0.6, 'Round')))); mot = mu.extrude(hR).translate([0, 0, d]); }   // liegt exakt auf (keine Überlappung zweier Farbteile)
    return { koerper, motiv: mot, farbwechsel: d };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
