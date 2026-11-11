// Wichtel-Anhänger — Manifold, mm, Z oben, Gesicht schaut nach −Y.
// Teile: Körper (Rotationskörper Spitzhut, Wickel-Rillen, Gesichtsmulde, Beinlöcher, Aufhängung),
// Gesicht (Schale bündig in der Mulde, Nase, Augen, Bart-Rillen), Beine (2 Stück mit Zapfen).
function _wchRadius(p, z, glatt) {                                          // Profil r(z), Boden z = 0, Spitze z = H
  const H = p.hoehe, R = p.breite / 2, t = Math.min(1, Math.max(0, z / H)), tb = 0.13;
  let r;
  if (t < tb) r = R * (0.84 + 0.16 * Math.sin(t / tb * Math.PI / 2));     // gerundeter Fuß (Schräge < 45°)
  else { const u = (t - tb) / (1 - tb); r = R * Math.pow(Math.max(0, 1 - Math.pow(u, p.spitz)), 0.62); }
  const rillen = p.hohl ? Math.min(p.rillen, (p.wand || 2.4) * 0.35) : p.rillen;   // dünne Wand: Rillen dürfen sie nicht durchbrechen
  if (!glatt && rillen > 0) {                                               // Wickel-Kordel: runde Wülste, schmale Rillen
    const s = Math.abs(Math.sin(Math.PI * z / p.rillenAbstand)), aus = Math.min(1, z / 3, (H - z) / (0.12 * H));
    r -= rillen * (1 - Math.sqrt(s)) * Math.max(0, aus);
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
    // p.nase = Größe in % (100 = bisher), p.augen = Tiefe der Augenhöhlen in mm (Volker 11.11.)
    const zn = zc + fh * 0.18, rn = R * 0.075 * (p.nase ?? 100) / 100, yS = z => -(_wchRadius(p, z, true) + fe);
    const nC = [0, yS(zn) + Math.min(rn * 0.35, fe + tief - 0.8 * rn - 0.1), zn];   // große Nase: Mitte wandert nach außen, nie durch die Schale in den Körper
    let nase = k(M.sphere(rn, 32).scale([1, 0.8, 1]).translate(nC));
    if (0.8 * rn - (nC[1] - yS(zn)) > 1.5) nase = k(M.hull([nase, k(M.sphere(0.3, 8).translate([nC[0], nC[1], nC[2] - rn * 1.42]))]));   // steht weit vor: unten 45°-Spitze, druckt stehend ohne Stützen
    gesicht = k(M.union(gesicht, nase));
    const licht = !!(p.hohl && (p.gesLicht ?? 1)), dL = 1.2;               // Gesicht leuchtet durch: Fenster im Körper, Gesicht dort nur dL dick
    const tA = Math.max(0, Math.min(p.augen ?? 0.75, licht ? dL - 0.4 : fe + tief - 0.3)), rA = Math.max(R * 0.03, 0.8 * tA + 0.6), zA = zn + fh * 0.22;
    if (tA > 0) for (const sx of [-1, 1]) {                                // auf der echten Oberfläche an der Augenstelle (seitlich liegt sie weiter hinten), entlang der Radialrichtung
      const ra = _wchRadius(p, zA, true) + fe, xa = sx * fw * 0.3, ya = -Math.sqrt(Math.max(1, ra * ra - xa * xa)), f = (ra - (tA - rA)) / ra;
      gesicht = k(M.difference(gesicht, k(M.sphere(rA, 24).translate([xa * f, ya * f, zA]))));
    }
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
    // ── Hohl + Bodenplatte mit Beinen (Bajonett in der Plattenebene) ──
    const bd = p.beinD, bx = R * p.beinAbstand / 100 / 2, zapfen = 8, beine = [];
    let boden = null, info = {};
    if (p.hohl) {
      const wd = p.wand, sp = p.spiel, plT = 4, nubH = 2, nubD = 1.4, band = 3, hB = plT + 4;
      // Hohlraum: Innenkontur im Abstand wd; hinter dem Gesicht um die Muldentiefe verstärkt
      let hohl = k(_wchRevolve(w, p, -wd, true, 144));
      hohl = k(M.difference(hohl, k(M.intersection(k(M.difference(k(_wchRevolve(w, p, -wd + 0.01, true, 144)), k(_wchRevolve(w, p, -(wd + tief), true, 144)))), prisma))));
      const ri0 = _wchRadius(p, 0, true) - wd;
      hohl = k(M.union(hohl, k(M.cylinder(1.5, ri0, ri0, 96).translate([0, 0, -1]))));   // unten offen
      koerper = k(M.difference(koerper, hohl));
      // Bajonett-Ring innen unten: Öffnung rB, drei L-Schlitze (senkrecht hinein, 45° drehen, Rastmulde)
      const rB = ri0 - band, nubW = 14, schW = nubW + 6, zC0 = plT - nubH - 0.3, zC1 = plT + 0.3;
      info.rB = rB;
      let ring = k(M.difference(k(M.cylinder(hB, ri0 + 0.6, ri0 + 0.6, 96)), k(M.cylinder(hB + 2, rB, rB, 96).translate([0, 0, -1]))));
      ring = k(M.intersection(ring, k(_wchRevolve(w, p, -0.4, true, 144))));
      const sektor = (r1, r2, a0, a1, z0, z1) => k(k(k(k(CS.circle(r2, 96)).subtract(k(CS.circle(r1, 96)))).intersect(k(new CS([[[0, 0], ...Array.from({ length: 13 }, (_, i) => { const t = (a0 + (a1 - a0) * i / 12) * Math.PI / 180; return [3 * r2 * Math.cos(t), 3 * r2 * Math.sin(t)]; })]], 'NonZero')))).extrude(z1 - z0)).translate([0, 0, z0]);
      for (let i = 0; i < 3; i++) {
        const a = 90 + i * 120, rS = rB + nubD + sp;
        ring = k(M.difference(ring, sektor(rB - 0.5, rS, a - schW / 2, a + schW / 2, -1, zC1)));                    // Einführung von unten
        ring = k(M.difference(ring, sektor(rB - 0.5, rS, a - schW / 2, a + 45 + schW / 2, zC0, zC1)));            // Drehkanal
        ring = k(M.difference(ring, sektor(rB - 0.5, rS, a + 45 - nubW / 2 - 1, a + 45 + nubW / 2 + 1, zC0 - 0.8, zC0 + 0.1)));   // Rastmulde am Ende
      }
      koerper = k(M.union(koerper, ring));
      // Lichtlöcher: Punkte oder Sternchen radial durch die Wand — nicht im Gesicht, nicht im Bajonett-Ring, nicht in der Spitze
      if (p.licht && p.licht !== 'keine') {
        const L = [], gr = p.licht === 'sterne' ? 2.8 : 1.3, ab = gr * 4.2;
        let reihe = 0;
        for (let z = hB + 5; z < H * 0.86; z += ab * 0.8, reihe++) {
          const rz = _wchRadius(p, z, true); if (rz < 8) break;
          const n = Math.max(4, Math.floor(2 * Math.PI * rz / ab));
          for (let j = 0; j < n; j++) {
            const t = (j + (reihe % 2) * 0.5) / n * 2 * Math.PI, x = rz * Math.cos(t), y = rz * Math.sin(t);
            if (y < 0 && Math.abs(x) < fw + 4 && Math.abs(z - zc) < fh + 4) continue;    // Gesicht frei lassen
            if (p.aufhaenger === 'quer' && z > H - Math.max(5, H * 0.075) - 6) continue;
            let form;
            if (p.licht === 'sterne') { const pts = []; for (let q = 0; q < 10; q++) { const a2 = Math.PI + q * Math.PI / 5,   /* Spitze zeigt nach −x → nach dem Drehen um y nach oben */ rr = q % 2 ? gr * 0.42 : gr; pts.push([rr * Math.cos(a2), rr * Math.sin(a2)]); } form = k(new CS([pts])); }
            else form = k(CS.circle(gr, 20));
            // Prisma entlang +z gebaut → auf die Radialrichtung drehen, an die Wand setzen
            const pr = k(k(form.extrude(wd + 6)).translate([0, 0, -3]));
            L.push(k(k(k(pr.rotate([0, 90, 0])).rotate([0, 0, t * 180 / Math.PI])).translate([(rz - wd / 2) * Math.cos(t), (rz - wd / 2) * Math.sin(t), z])));
          }
        }
        if (L.length) koerper = k(M.difference(koerper, k(M.union(L))));
        info.lichtLoecher = L.length;
      }
      // Bodenplatte (Gebrauchslage: z 0 … plT, sitzt bündig in der Öffnung) mit Nasen, Teelicht-Mulde, Schaltloch, Beinen
      const rP = rB - sp;
      let pl = k(M.cylinder(plT, rP, rP, 96));
      for (let i = 0; i < 3; i++) { const a = 90 + i * 120; pl = k(M.union(pl, sektor(rP - 1, rB + nubD, a - nubW / 2, a + nubW / 2, plT - nubH, plT))); }
      const led = p.ledD / 2 + 0.6;
      info.ledPasst = led + 0.3 <= rP;                                    // Mulde zentriert das Teelicht, 0,3 mm Rand reichen
      if (info.ledPasst) pl = k(M.difference(pl, k(M.cylinder(2, led, led, 96).translate([0, 0, plT - 1.6]))));
      pl = k(M.difference(pl, k(M.cylinder(plT + 2, 6, 6, 48).translate([0, 0, -1]))));   // Schaltloch
      if (p.beinL > 0) for (const sx of [-1, 1]) pl = k(M.union(pl, k(M.cylinder(p.beinL + 0.5, bd / 2, bd / 2, 32).translate([sx * bx, 0, -p.beinL]))));
      boden = pl.translate([0, 0, 0]);
      // Gesicht durchleuchten (Volker 11.11.): Fenster hinter dem Gesicht bis in den Innenraum, Rand bleibt als Auflage;
      // Gesicht im Fenster auf dL ausgedünnt (3 Bahnen). Stifte wandern dann an den Rand.
      const fwW = Math.max(4, fw - 6.5), fhW = Math.max(4, fh - 4);
      if (licht) {
        const prW = k(k(k(k(CS.circle(1, 96).scale([fwW, fhW])).translate([0, zc])).extrude(R + 20)).rotate([90, 0, 0]));
        const ueberRing = k(k(M.cube([4 * R, 4 * R, H])).translate([-2 * R, -2 * R, hB + 2]));
        koerper = k(M.difference(koerper, k(M.intersection(k(M.intersection(k(_wchRevolve(w, p, -tief + 0.05, true, 144)), prW)), ueberRing))));
        gesicht = k(M.difference(gesicht, k(M.intersection(k(_wchRevolve(w, p, fe - dL, true, 144)), prW))));
        info.fenster = [fwW * 2, fhW * 2];
      }
      // Gesicht: zwei Stifte hinten, Löcher durch die Wand
      const pinZ = licht ? zc : zc - fh * 0.15;
      for (const sx of [-1, 1]) {
        const x = licht ? sx * (fw - 3.2) : sx * fw * 0.32, ri = _wchRadius(p, pinZ, true) - tief, yi = -Math.sqrt(Math.max(1, ri * ri - x * x));
        gesicht = k(M.union(gesicht, k(M.cylinder(4.2, 1.5, 1.5, 24).rotate([-90, 0, 0]).translate([x, yi - 0.2, pinZ]))));
        koerper = k(M.difference(koerper, k(M.cylinder(wd + tief + 6, 1.7, 1.7, 24).rotate([-90, 0, 0]).translate([x, yi - 1, pinZ]))));
      }
    } else for (const sx of [-1, 1]) {
      koerper = k(M.difference(koerper, k(M.cylinder(zapfen + 0.5, (bd + 0.3) / 2, (bd + 0.3) / 2, 32).translate([sx * bx, 0, -0.5]))));
      if (p.beinL > 0) {
        const bein = M.union(M.cylinder(p.beinL, bd / 2, bd / 2, 32).translate([sx * bx, 0, -p.beinL]),
          M.cylinder(zapfen, bd / 2 - 0.1, bd / 2 - 0.1, 32).translate([sx * bx, 0, 0])).translate([0, 0, -0.03]);   // ganzes Bein 0,03 mm tiefer: Fuge zum Boden
        beine.push(bein);
      }
    }
    // Naht-Kerbe hinten (+Y, Gesicht schaut nach −Y): schmale senkrechte Nut — Slicer legen die Naht bevorzugt in
    // solche Innenecken, sonst lag sie vorn im Gesicht (Volker 11.11.)
    {
      const nd = Math.min(0.6, (p.hohl ? p.wand : 3) * 0.35), nb = 0.6;
      const nut = k(M.intersection(k(M.difference(k(_wchRevolve(w, p, 1, false, 144)), k(_wchRevolve(w, p, -nd, false, 144)))), k(k(M.cube([nb, R + 10, H - 4])).translate([-nb / 2, 0, 0.4]))));
      koerper = k(M.difference(koerper, nut));
    }
    // ── Aufhängung ──
    if (p.aufhaenger === 'quer') {
      const zq = H - Math.max(5, H * 0.075);
      koerper = k(M.difference(koerper, k(M.cylinder(4 * R, 1.6, 1.6, 24).rotate([0, 90, 0]).translate([-2 * R, 0, zq]))));
    } else if (p.aufhaenger === 'oben') koerper = k(M.difference(koerper, k(M.cylinder(14, 1.5, 1.5, 24).translate([0, 0, H - 12]))));
    const sauber = m => { const st = m.decompose(); if (st.length < 2) { st.forEach(q => q.delete()); return m.translate([0, 0, 0]); }   // Null-Splitter der Muldenkanten weg
      const r = M.union(st.filter(q => q.volume() > 1)); st.forEach(q => q.delete()); return r; };
    return { koerper: sauber(koerper), gesicht: sauber(gesicht), beine, boden, info, H, R };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
