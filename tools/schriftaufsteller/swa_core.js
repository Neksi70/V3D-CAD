// Schrift-Aufsteller — Manifold, mm. Frontansicht in XY (y oben), Tiefe Z: Vorderseite z = 0, nach hinten +z.
// Block: Zeilen in Blockschrift, jede auf dieselbe Breite gezogen, Zeilen überlappen → ein Teil, Tiefe D.
// Schreibschrift: eigenes Teil (zweite Farbe), vorn bündig (z 0 … tS), sitzt auf der Oberkante des Blocks.
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs, h, w} (App: _lttText).
function _swaBuild(w, p, textFn) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { if (x) tmp.push(x); return x; };
  try {
    const Z = String(p.block || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => p.gross ? s.toUpperCase() : s);
    if (!Z.length) throw new Error('Bitte mindestens eine Zeile Blockschrift eingeben');
    const h = p.zeilenH, ue = h * p.ueberlapp / 100;
    // Zeile Buchstabe für Buchstabe setzen, Nachbarn überlappen → die Zeile hängt zusammen (wie im Bild)
    const zeile = t => { const L = []; let x = 0, hMax = 0;
      for (const ch of [...t]) { if (ch === ' ') { x += h * 0.35; continue; }
        const r = textFn(CS, k, ch, p.blockFont, h, 0, 0, 1e5); if (!r || !r.cs) continue;
        const b = r.cs.bounds(); let dx = L.length ? h * p.ueberlapp / 100 : 0, c = k(r.cs.translate([x - b.min[0] - dx, 0]));
        if (L.length) { const vor = L[L.length - 1];                         // so weit heranschieben, bis sich die Nachbarn sicher berühren
          for (let n = 0; n < 60; n++) { const ix = vor.intersect(c), a2 = ix.area(); ix.delete(); if (a2 > h * 0.6) break; dx += h * 0.01; c = k(r.cs.translate([x - b.min[0] - dx, 0])); } }
        L.push(c); x += (b.max[0] - b.min[0]) - dx; hMax = Math.max(hMax, b.max[1]); }
      if (!L.length) return null; const cs = k(CS.union(L)), b = cs.bounds(); return { cs, w: b.max[0] - b.min[0], h: b.max[1] - b.min[1] }; };
    const roh = Z.map(zeile).filter(r => r && r.cs);
    if (!roh.length) return null;
    const B = p.blocksatz ? Math.max(...roh.map(r => r.w)) : 0;
    let y = 0; const teile = [];
    for (let i = roh.length - 1; i >= 0; i--) {                             // von unten nach oben stapeln
      const r = roh[i], bb = r.cs.bounds(), sx = B ? B / (bb.max[0] - bb.min[0]) : 1;
      let cs = k(r.cs.translate([-(bb.min[0] + bb.max[0]) / 2, -bb.min[1]]));
      if (sx !== 1) cs = k(cs.scale([sx, 1]));
      teile.push(k(cs.translate([0, y])));
      y += (bb.max[1] - bb.min[1]) - ue;
    }
    const block2d = k(CS.union(teile)), bb = block2d.bounds(), yTop = bb.max[1];
    const out = { breite: bb.max[0] - bb.min[0], hoehe: yTop };
    out.block = block2d.extrude(p.tiefe);
    out.stuecke = out.block.decompose().length;
    if (p.schrift && p.schrift.trim()) {
      const r = textFn(CS, k, p.schrift.trim(), p.schriftFont, p.schriftH, 0, 0, 1e5);
      if (r && r.cs) {
        const sb = r.cs.bounds(), sw = sb.max[0] - sb.min[0], frei = Math.max(0, out.breite - sw);
        const x0 = bb.min[0] + frei * (0.5 + p.schriftX / 200) - sb.min[0], y0 = yTop - p.schriftH * p.schriftTief / 100 - sb.min[1];
        let s2 = k(r.cs.translate([x0, y0]));
        const sch = s2.extrude(p.schriftD);                                // Schreibschrift bleibt ganz (hängt zusammen) …
        const blk = M.difference(out.block, sch); out.block.delete(); out.block = blk;   // … der Block bekommt vorn die Aussparung
        out.stuecke = out.block.decompose().length;
        out.schrift = sch; out.hoehe = Math.max(yTop, y0 + (sb.max[1] - sb.min[1]) + sb.min[1] - sb.min[1]);
        const s3 = s2.bounds(); out.hoehe = Math.max(yTop, s3.max[1]); out.breite = Math.max(bb.max[0], s3.max[0]) - Math.min(bb.min[0], s3.min[0]);
        out.schriftTeile = sch.decompose().length;
      }
    }
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
