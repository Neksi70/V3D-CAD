// Kugel-Anhänger (Weihnachtskugel als flacher Anhänger) — Manifold, mm, liegt flach (z = 0 … dicke), Kugel in XY (y oben).
// Teile: Käfig (Außenring, Längsrippen wie Kugel-Meridiane, Kappe mit Rillen, Schleife, Aufhänge-Öse) und Text
// (Schreibschrift, zweite Farbe, durch die ganze Dicke und etwas erhaben, aus dem Käfig ausgespart).
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs, h, w} (App: _lttText) — in Node null.
function _kglStrich(CS, k, pts, b, zu) {                                     // Linienzug als Band der Breite b (offene Enden rund)
  const L = [], R = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(n - 1, i + 1)], dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l * b / 2, ny = dx / l * b / 2; L.push([pts[i][0] + nx, pts[i][1] + ny]); R.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  let cs = k(new CS([[...L, ...R.reverse()]], 'NonZero'));
  if (!zu) for (const e of [pts[0], pts[n - 1]]) cs = k(cs.add(k(k(CS.circle(b / 2, 16)).translate(e))));
  return cs;
}
function _kglBuild(w, p, textFn) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  try {
    const R = p.groesse / 2, t = p.dicke, b = p.steg, ry = R * 0.94;           // Kugel leicht gedrückt
    const kreis = (rx, ryy, n) => { const o = []; for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; o.push([rx * Math.cos(a), ryy * Math.sin(a)]); } return o; };
    const aussen = k(new CS([kreis(R, ry, 160)])), innen = k(new CS([kreis(R - p.rand, ry - p.rand, 160)]));
    let kaefig = k(aussen.subtract(innen));
    // Längsrippen: Meridiane x = a·sin(s), y = ry·cos(s); paarweise links/rechts + Mittellinie
    const n = Math.max(1, Math.round(p.rippen));
    const rip = [];
    for (let i = 0; i <= n; i++) {
      const a = (R - p.rand / 2) * i / (n + 1);
      for (const sx of i === 0 ? [1] : [-1, 1]) { const pts = []; for (let j = 0; j <= 48; j++) { const s = Math.PI * j / 48; pts.push([sx * a * Math.sin(s), ry * Math.cos(s)]); } rip.push(_kglStrich(CS, k, pts, b, true)); }
    }
    kaefig = k(kaefig.add(k(k(CS.union(rip)).intersect(aussen))));
    // Kappe oben (mit Rillen), Schleife (zwei Schlaufen + zwei Bänder), Öse
    const kb = R * 0.3, kh = R * 0.16, ky = ry - R * 0.03;
    let kappe = k(k(CS.square([kb, kh], false)).translate([-kb / 2, ky]));
    for (const gx of [-0.25, 0, 0.25]) kappe = k(kappe.subtract(k(k(CS.square([Math.max(0.8, b * 0.6), kh * 0.6], false)).translate([gx * kb - Math.max(0.4, b * 0.3), ky + kh * 0.2]))));
    const sm = [0, ky + kh * 0.55], teile = [kappe];
    if (p.schleife) {
      for (const sx of [-1, 1]) {
        const loop = [], loopI = [], c = [sx * R * 0.3, sm[1] + R * 0.1], ang = sx * 0.28;
        for (let i = 0; i < 72; i++) { const a = i / 72 * 2 * Math.PI, x = R * 0.27 * Math.cos(a), y = R * 0.14 * Math.sin(a);
          loop.push([c[0] + x * Math.cos(ang) - y * Math.sin(ang), c[1] + x * Math.sin(ang) + y * Math.cos(ang)]);
          const xi = (R * 0.27 - b) * Math.cos(a), yi = (R * 0.14 - b) * Math.sin(a); loopI.push([c[0] + xi * Math.cos(ang) - yi * Math.sin(ang), c[1] + xi * Math.sin(ang) + yi * Math.cos(ang)]); }
        teile.push(k(k(new CS([loop])).subtract(k(new CS([loopI])))));
        // Band: schräg nach außen unten, am Ende V-Kerbe
        const e0 = [sx * R * 0.08, sm[1] - R * 0.02], e1 = [sx * R * 0.62, sm[1] - R * 0.2], bb = Math.max(b * 1.8, R * 0.07);
        const dx = e1[0] - e0[0], dy = e1[1] - e0[1], l = Math.hypot(dx, dy), nx = -dy / l * bb / 2, ny = dx / l * bb / 2, ux = dx / l, uy = dy / l;
        teile.push(k(new CS([[[e0[0] + nx, e0[1] + ny], [e1[0] + nx, e1[1] + ny], [e1[0] - ux * bb * 0.6, e1[1] - uy * bb * 0.6], [e1[0] - nx, e1[1] - ny], [e0[0] - nx, e0[1] - ny]]], 'NonZero')));
      }
      teile.push(k(k(CS.circle(R * 0.075, 32)).translate(sm)));               // Knoten
    }
    const oy = ky + kh + R * 0.06, ro = Math.max(3.2, R * 0.1), ri = Math.max(1.8, ro * 0.55);
    teile.push(k(k(k(CS.circle(ro, 40)).subtract(k(CS.circle(ri, 32)))).translate([0, oy + ro * 0.4])));
    kaefig = k(kaefig.add(k(CS.union(teile))));
    kaefig = k(k(kaefig.offset(-0.3, 'Round')).offset(0.3, 'Round'));        // Haarspitzen weg
    // Text (Schreibschrift), zentriert im Kreis, 1–2 Zeilen
    let text = null, info = { textZeilen: 0 };
    const zeilen = String(p.text || '').split('\n').map(z => z.trim()).filter(Boolean).slice(0, 3);
    if (textFn && zeilen.length) {
      const zh = p.textH, abst = zh * 0.25, ges = zeilen.length * zh + (zeilen.length - 1) * abst, L = [];
      let yb = ges / 2 - zh - R * 0.04;
      for (const z of zeilen) { const r = textFn(CS, k, z, p.font, zh, 0, yb, 2 * R * 0.84); if (r && r.cs) { L.push(r.cs); info.textZeilen++; } yb -= zh + abst; }
      if (L.length) {
        let tc = k(k(CS.union(L)).intersect(innen));
        tc = k(tc.offset(p.textDick / 2, 'Round'));                         // Schreibschrift etwas fetter → druckbar
        text = k(k(tc.extrude(t + p.erhaben)));
        kaefig = k(kaefig.subtract(tc));
        info.textTeile = text.decompose().length;
      }
    }
    const kf = k(kaefig.extrude(t)), out = { kaefig: kf.translate([0, 0, 0]), text: text ? text.translate([0, 0, 0]) : null, info };
    out.info.kaefigTeile = kf.decompose().length;
    out.info.breite = 2 * R; const bb2 = kf.boundingBox(); out.info.hoehe = bb2.max[1] - bb2.min[1];
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
