// Wichtel-Anhänger — Manifold, mm, Z oben, Gesicht schaut nach −Y.
// Teile: Körper (Rotationskörper Spitzhut, Wickel-Rillen, Gesichtsmulde, Beinlöcher, Aufhängung),
// Gesicht (Schale bündig in der Mulde, Nase, Augen, Bart-Rillen), Beine (2 Stück mit Zapfen).
function _wchRadius(p, z, glatt) {                                          // Profil r(z), Boden z = 0, Spitze z = H
  const H = p.hoehe, R = p.breite / 2, t = Math.min(1, Math.max(0, z / H)), tb = 0.13;
  let r;
  if (t < tb) r = R * (0.84 + 0.16 * Math.sin(t / tb * Math.PI / 2));     // gerundeter Fuß (Schräge < 45°)
  else { const u = (t - tb) / (1 - tb); r = R * Math.pow(Math.max(0, 1 - Math.pow(u, p.spitz)), 0.62); }
  if (!glatt && p.rillen > 0) {                                             // Wickel-Kordel: runde Wülste, schmale Rillen
    const s = Math.abs(Math.sin(Math.PI * z / p.rillenAbstand)), aus = Math.min(1, z / 3, (H - z) / (0.12 * H));
    r -= p.rillen * (1 - Math.sqrt(s)) * Math.max(0, aus);
  }
  return Math.max(0, r);
}
function _wchRevolve(w, p, add, glatt, seg) {
  const H = p.hoehe, dz = glatt ? 0.6 : p.rillenAbstand / 8, pts = [[0, 0]];
  for (let z = 0; z < H; z += dz) pts.push([Math.max(0.01, _wchRadius(p, z, glatt) + add), z]);
  pts.push([0, H + (add > 0 ? add : 0)]);
  const cs = new w.CrossSection([pts]), m = cs.revolve(seg || 128); cs.delete();
  return add < 0 ? m : m;
}
function _wchBuild(w, p) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  try {
    const H = p.hoehe, R = p.breite / 2;
    let koerper = k(_wchRevolve(w, p, 0, false, 144));
    // ── Gesicht: ovales Feld vorn, folgt der Rundung ──
    const zc = H * p.gesichtZ / 100, fh = H * p.gesichtH / 100 / 2, fw = _wchRadius(p, zc, true) * p.gesichtB / 100;
    const ell = k(k(CS.circle(1, 96).scale([fw, fh])).translate([0, zc]));
    const prisma = k(k(ell.extrude(R + 20)).rotate([90, 0, 0]));          // (x, Höhe) → x/z, Tiefe nach −Y
    const fe = p.gesichtDick, tief = 1.6;                                   // steht fe vor, sitzt tief in der Mulde
    const aussen = k(_wchRevolve(w, p, fe, true, 144)), innen = k(_wchRevolve(w, p, -tief, true, 144));
    let gesicht = k(M.intersection(k(M.difference(aussen, k(_wchRevolve(w, p, -tief + 0.03, true, 144)))), prisma));   // 0,03 mm Fuge zur Mulde
    koerper = k(M.difference(koerper, k(M.intersection(aussen, prisma))));   // Mulde: alles vor der Innenfläche weg
    koerper = k(M.union(koerper, k(M.intersection(innen, prisma))));
    // Nase + Augen
    const zn = zc + fh * 0.18, rn = R * 0.075, yS = z => -(_wchRadius(p, z, true) + fe);
    gesicht = k(M.union(gesicht, k(M.sphere(rn, 24).scale([1, 0.8, 1]).translate([0, yS(zn) + Math.min(rn * 0.35, fe + tief - 0.8 * rn - 0.1), zn]))));   // Nase darf nicht durch die Schale in den Körper
    for (const sx of [-1, 1]) gesicht = k(M.difference(gesicht, k(M.sphere(R * 0.03, 12).translate([sx * fw * 0.3, yS(zn + fh * 0.22) - 0.15, zn + fh * 0.22]))));
    // Bart: senkrechte, leicht gewellte Rillen unterhalb der Nase
    if (p.bart) {
      const L = [], zTop = zn - rn * 1.3, zBot = zc - fh * 0.92, n = Math.max(3, Math.round(2 * fw / p.bartAbstand));
      for (let i = 0; i < n; i++) {
        const x0 = -fw * 0.85 + 1.7 * fw * (i + 0.5) / n, links = [], rechts = [];
        for (let z = zBot; z <= zTop; z += 0.8) { const x = x0 + 0.5 * Math.sin(z / 2.6 + i * 1.7); links.push([x - 0.35, z]); rechts.push([x + 0.35, z]); }
        L.push(k(new CS([[...links, ...rechts.reverse()]], 'NonZero')));
      }
      const linien = k(k(k(CS.union(L)).intersect(ell)).extrude(R + 20)).rotate([90, 0, 0]); k(linien);
      const haut = k(M.difference(k(_wchRevolve(w, p, fe + 1, true, 144)), k(_wchRevolve(w, p, fe - 0.6, true, 144))));
      gesicht = k(M.difference(gesicht, k(M.intersection(linien, haut))));
    }
    // ── Beinlöcher + Beine ──
    const bd = p.beinD, bx = R * p.beinAbstand / 100 / 2, zapfen = 8, beine = [];
    for (const sx of [-1, 1]) {
      koerper = k(M.difference(koerper, k(M.cylinder(zapfen + 0.5, (bd + 0.3) / 2, (bd + 0.3) / 2, 32).translate([sx * bx, 0, -0.5]))));
      if (p.beinL > 0) {
        const bein = M.union(M.cylinder(p.beinL, bd / 2, bd / 2, 32).translate([sx * bx, 0, -p.beinL]),
          M.cylinder(zapfen, bd / 2 - 0.1, bd / 2 - 0.1, 32).translate([sx * bx, 0, 0])).translate([0, 0, -0.03]);   // ganzes Bein 0,03 mm tiefer: Fuge zum Boden
        beine.push(bein);
      }
    }
    // ── Aufhängung ──
    if (p.aufhaenger === 'quer') {
      const zq = H - Math.max(5, H * 0.075);
      koerper = k(M.difference(koerper, k(M.cylinder(4 * R, 1.6, 1.6, 24).rotate([0, 90, 0]).translate([-2 * R, 0, zq]))));
    } else if (p.aufhaenger === 'oben') koerper = k(M.difference(koerper, k(M.cylinder(14, 1.5, 1.5, 24).translate([0, 0, H - 12]))));
    const sauber = m => { const st = m.decompose(); if (st.length < 2) { st.forEach(q => q.delete()); return m.translate([0, 0, 0]); }   // Null-Splitter der Muldenkanten weg
      const r = M.union(st.filter(q => q.volume() > 1)); st.forEach(q => q.delete()); return r; };
    return { koerper: sauber(koerper), gesicht: sauber(gesicht), beine, H, R };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
