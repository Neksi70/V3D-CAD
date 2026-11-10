// Wort-Tanne / Namens-Anhänger — Manifold, mm. Frontansicht in XY (y oben), Dicke Z, liegt auf z = 0.
// Zeilen (Wörter/Namen) übereinander, je Zeile eine Schiene darunter, die Zeilen greifen 0,8 mm
// ineinander → ein zusammenhängendes Teil. Oben Stern (+ Öse beim Anhänger), unten Jahreszahl.
// Aufsteller: Steckzunge unten + eigener Fuß mit Schlitz und gravierter Inschrift (Vorderseite −Y).
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs, h, w} (App: _lttText).
function _wtbBuild(w, p, textFn) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { if (x) tmp.push(x); return x; };
  try {
    let Z = String(p.woerter || '').split(/\n|,/).map(s => s.trim()).filter(Boolean);
    if (p.gross) Z = Z.map(s => s.toUpperCase());
    if (p.sortieren) Z = Z.slice().sort((a, b) => a.length - b.length);
    const h = p.zeilenH, sch = p.schiene, ue = 0.8, teile = [];
    // Zeilen von unten nach oben aufbauen
    let y = 0, breiteUnten = 0, breiteOben = 0;
    const zeilen = Z.slice().reverse();
    if (p.jahr) {
      const r = textFn(CS, k, String(p.jahr), p.font, h * 0.85, 0, y, 1e4);
      if (r && r.cs) { teile.push(r.cs); y += r.h - ue; breiteUnten = r.w; }
    }
    zeilen.forEach((t, i) => {
      const n = Z.length, f = p.form === 'dreieck' && n > 1 ? (n - 1 - i) / (n - 1) : 0;
      const r = textFn(CS, k, t, p.font, h, 0, y + sch - ue, 1e4);
      if (!r || !r.cs) return;
      let cs = r.cs, wB = r.w;
      if (p.form === 'dreieck') {                                          // Breite linear von oben schmal nach unten breit
        const ziel = p.breite * (0.35 + 0.65 * (1 - (n > 1 ? i / (n - 1) : 0)));
        const s = ziel / Math.max(1, r.w); cs = k(r.cs.scale([s, Math.min(1.4, Math.max(0.7, s))])); const b = cs.bounds(); cs = k(cs.translate([0, (y + sch - ue) - b.min[1]])); wB = ziel;
      }
      const bb = cs.bounds();
      teile.push(cs);
      if (sch > 0) teile.push(k(CS.square([bb.max[0] - bb.min[0] + 2, sch]).translate([bb.min[0] - 1, y])));   // Schiene unter der Zeile
      if (i === 0 && !breiteUnten) breiteUnten = bb.max[0] - bb.min[0];
      breiteOben = bb.max[0] - bb.min[0];
      y = bb.max[1] - ue;
    });
    // Stern oben
    const sR = p.sternR;
    if (sR > 0) {
      const cy = y + sR * 0.81 - 0.6, pts = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? sR * 0.45 : sR; pts.push([r * Math.cos(a), cy + r * Math.sin(a)]); }   // untere Spitzen tauchen 0,6 mm in die oberste Zeile
      let st = k(new CS([pts]));
      if (p.sternHohl) { const inn = k(st.offset(-Math.max(1.6, sR * 0.16), 'Miter', 2)); st = k(st.subtract(inn)); }
      teile.push(st, k(CS.square([Math.max(2.5, sR * 0.25), cy - y + 1.5]).translate([-Math.max(2.5, sR * 0.25) / 2, y - 1.5])));   // Stiel in die oberste Schiene
      if (p.modus === 'anhaenger') { const yo = cy + sR + 3.2 - 1.4; teile.push(k(k(CS.circle(4.6, 40).translate([0, yo])).subtract(k(CS.circle(2.4, 32).translate([0, yo]))))); }
      y = cy + sR;
    }
    let F = k(CS.union(teile));
    const d = p.modus === 'anhaenger' ? p.dicke : p.dickeAuf, out = {};
    // Steckzunge für den Fuß
    const zunge = p.modus === 'aufsteller' ? p.fussSchlitz : 0;
    if (zunge > 0) { const bz = Math.max(20, (F.bounds().max[0] - F.bounds().min[0]) * 0.7); F = k(F.add(k(CS.square([bz, zunge + 1]).translate([-bz / 2, -zunge])))); }
    out.modell = F.extrude(d);
    out.stuecke = out.modell.decompose().length;
    const fb = F.bounds(); out.breite = fb.max[0] - fb.min[0]; out.hoehe = fb.max[1] - fb.min[1];
    // Fuß: Block mit Schlitz (Mitte) und gravierter Inschrift vorn
    if (p.modus === 'aufsteller') {
      const L = Math.max(out.breite + 16, 60), T = p.fussT, H = p.fussH, sl = d + p.spiel;
      let fuss = k(M.cube([L, T, H]).translate([-L / 2, -T / 2, 0]));
      fuss = k(M.difference(fuss, k(M.cube([out.breite * 0.7 + 1 + p.spiel * 2, sl, zunge + 0.5]).translate([-(out.breite * 0.7 + 1 + p.spiel * 2) / 2, -sl / 2, H - zunge]))));
      const G = [];
      const z1 = p.fussText1 ? textFn(CS, k, p.fussText1, p.fussFont1, H * 0.34, 0, 0, L * 0.4) : null;
      const z2 = p.fussText2 ? textFn(CS, k, p.fussText2, p.fussFont2, H * 0.24, 0, 0, L * 0.5) : null;
      // nebeneinander: Zeile 1 (Schreibschrift) links, Zeile 2 rechts, Tännchen am Ende — mittig auf der Front
      const stuecke = [z1, z2].filter(r => r && r.cs).map(r => ({ cs: r.cs, b: r.cs.bounds() }));
      const gap = 4, tw = p.fussTanne ? H * 0.32 : 0, gesamt = stuecke.reduce((s2, q) => s2 + (q.b.max[0] - q.b.min[0]) + gap, 0) + tw;
      let x = -gesamt / 2;
      for (const q of stuecke) { const bw = q.b.max[0] - q.b.min[0], bh = q.b.max[1] - q.b.min[1]; G.push(k(q.cs.translate([x - q.b.min[0], H * 0.5 - bh / 2 - q.b.min[1]]))); x += bw + gap; }
      if (p.fussTanne) { const cx = x + tw / 2, g = H * 0.22, cy = H * 0.5, bb = 1.1;
        G.push(k(_lbxStrich(CS, [[cx, cy - g], [cx, cy + g]], bb)));
        for (let i = 0; i < 4; i++) { const yy = cy + g * (0.85 - i * 0.48), br = g * (0.18 + i * 0.17); G.push(k(_lbxStrich(CS, [[cx - br, yy - br * 0.6], [cx, yy], [cx + br, yy - br * 0.6]], bb))); } }
      if (G.length) {                                                       // Gravur in die Vorderseite (−Y), 0,8 mm tief
        const gr = k(k(k(CS.union(G)).extrude(0.8 + 1)).rotate([90, 0, 0])).translate([0, -T / 2 + 0.8, 0]); k(gr);
        fuss = k(M.difference(fuss, gr));
      }
      out.fuss = fuss.translate([0, 0, 0]);
    }
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
