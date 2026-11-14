// Namens-Lesezeichen (🔖 _lzn*, Wunsch Ralf 14.11.26: „jedem Kind ein Lesezeichen“) — Manifold, mm, liegt flach (z = 0 … dicke).
// Streifen mit runden Enden (x quer, y längs, oben = Kopf), oben der Anfangsbuchstabe als Kopf (Buchstabe + Rand),
// Name längs (um 90° gedreht), darunter Logo + Zusatztext, unten Loch fürs Bändchen.
// Darstellung: erhaben (eigenes Teil, zweite Farbe) | einfarbig (erhaben, ein Teil) | eingelassen (graviert) | eingelegt (bündig, zweite Farbe).
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → { cs, h, w } (App: _lttText) – in Node null (dann ohne Schrift).
// logo: null | 'regenbogen' | 'herz' | 'stern' | { loops: [[[x, y], …], …] } (eigenes Bild/SVG, EvenOdd, beliebige Einheit)
const LZN_DEF = { name: 'Martina', laenge: 150, breite: 22, dicke: 2, kopfH: 34, kopfRand: 2.4, nameH: 13, font: 'pacifico_local',
  darstellung: 'erhaben', erhaben: 0.8, tiefe: 0.6, strich: 0.2, logo: 'regenbogen', logoH: 13, zusatz: 'Regenbogenschule', zusatzH: 3.2, loch: 5 };
function lznLogo2D(CS, k, logo) {                                              // Logo als CrossSection, Einheit beliebig (wird später eingepasst)
  if (!logo || logo === 'keins') return null;
  if (logo === 'regenbogen') {                                                 // drei Bögen + Wolke links/rechts nicht nötig: schlicht
    const L = [];
    for (const [ra, ri] of [[10, 8], [7.2, 5.4], [4.6, 3]]) L.push(k(k(CS.circle(ra, 72)).subtract(k(CS.circle(ri, 72)))));
    return k(k(CS.union(L)).intersect(k(CS.square([30, 15], false).translate([-15, 0]))));
  }
  if (logo === 'herz') {
    const c = r => k(CS.circle(r, 48)), h = k(CS.hull([k(c(5).translate([-4.2, 2])), k(c(5).translate([4.2, 2])), k(c(0.6).translate([0, -9]))]));
    return h;
  }
  if (logo === 'stern') {
    const pts = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.2 : 10; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
    return k(new CS([pts], 'NonZero'));
  }
  if (logo.loops && logo.loops.length) return k(new CS(logo.loops, 'EvenOdd'));
  return null;
}
// cs auf Breite ≤ bw und Höhe ≤ bh einpassen, Mitte auf (0, cy)
function lznEinpassen(k, cs, bw, bh, cy) {
  const b = cs.bounds(), w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  if (!(w > 0 && h > 0)) return null;
  const s = Math.min(bw / w, bh / h);
  return k(k(cs.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2])).scale([s, s]).translate([0, cy]));
}
function lznBuild(w, pIn, textFn) {
  const p = { ...LZN_DEF, ...pIn }, M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  try {
    const b = p.breite, L = p.laenge, t = p.dicke, info = { warn: [] };
    const name = String(p.name || '').trim(), ch = name ? [...name][0] : '';
    // Kopf: Anfangsbuchstabe (Großschreibung wie getippt), Oberkante bei y = L
    let kopf = null;
    if (ch && textFn) { const r = textFn(CS, k, ch, p.font, p.kopfH, 0, 0, 1e6); if (r && r.cs) { const bb = r.cs.bounds(); kopf = k(r.cs.translate([-(bb.min[0] + bb.max[0]) / 2, L - p.kopfRand - bb.max[1]])); } }
    const kb = kopf ? kopf.bounds() : null, kopfUnten = kb ? kb.min[1] : L - b;
    const yStreifenOben = kopf ? Math.max(b, kopfUnten + Math.min(p.kopfH * 0.45, (kb.max[1] - kb.min[1]) * 0.5)) : L;   // Streifen reicht bis in den Buchstaben hinein
    const streifen = k(CS.hull([k(k(CS.circle(b / 2, 64)).translate([0, b / 2])), k(k(CS.circle(b / 2, 64)).translate([0, yStreifenOben - b / 2]))]));
    let platte = kopf ? k(streifen.add(k(kopf.offset(p.kopfRand, 'Round', 2, 24)))) : streifen;
    platte = k(k(platte.offset(-0.6, 'Round')).offset(0.6, 'Round'));       // Haarspitzen weg
    // Loch unten
    const yLoch = Math.max(b / 2, p.loch / 2 + 2.5);
    if (p.loch > 0) platte = k(platte.subtract(k(k(CS.circle(p.loch / 2, 48)).translate([0, yLoch]))));
    // Bereich für Name / Logo / Zusatz: zwischen Loch und Kopf
    let yU = yLoch + p.loch / 2 + 3, yO = (kopf ? kopfUnten : L - b / 2) - 3;
    const deko = [];
    if (kopf) deko.push(kopf);
    const laengs = (txt, h, y0, y1) => {                                     // Text um −90° gedreht (liest von oben nach unten), zwischen y0 und y1 mittig
      if (!txt || !textFn || y1 - y0 < 4) return null;
      const r = textFn(CS, k, txt, p.font, h, 0, 0, y1 - y0); if (!r || !r.cs) return null;
      const g = k(r.cs.rotate(-90)), bb = g.bounds();
      return k(g.translate([-(bb.min[0] + bb.max[0]) / 2, (y0 + y1) / 2 - (bb.min[1] + bb.max[1]) / 2]));
    };
    // Zusatz unten (über dem Loch), dann Logo, Rest für den Namen
    if (p.zusatz && textFn) {
      const z = laengs(p.zusatz, p.zusatzH, yU, Math.min(yO, yU + 46));
      if (z) { const zb = z.bounds(); deko.push(z); yU = zb.max[1] + 3; }
    }
    const lg = lznLogo2D(CS, k, p.logo);
    if (lg && yO - yU > p.logoH + 10) { const g = lznEinpassen(k, lg, b * 0.78, p.logoH, yU + p.logoH / 2); if (g) { deko.push(g); yU += p.logoH + 4; } }
    if (name) { const n = laengs(name, Math.min(p.nameH, b * 0.72), yU, yO); if (n) { deko.push(n); const nb = n.bounds(); info.nameLaenge = nb.max[1] - nb.min[1]; } else if (textFn) info.warn.push('Für den Namen ist kein Platz – Lesezeichen länger machen oder Logo/Zusatz verkleinern.'); }
    let deko2 = deko.length ? k(k(CS.union(deko)).offset(p.strich, 'Round')) : null;   // Schreibschrift etwas fetter → druckbar
    if (deko2) deko2 = k(deko2.intersect(k(platte.offset(-0.8, 'Round'))));   // Deko bleibt auf der Platte
    const plate3 = k(platte.extrude(t));
    const out = { platte: null, deko: null, info };
    const bb = platte.bounds(); info.groesse = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]];
    if (!deko2 || p.darstellung === 'nur') { out.platte = plate3.translate([0, 0, 0]); return out; }
    if (p.darstellung === 'eingelassen' || p.darstellung === 'eingelegt') {
      const tief = Math.min(p.tiefe, t - 0.6), cut = k(k(deko2.extrude(tief + 0.01)).translate([0, 0, t - tief]));
      out.platte = k(plate3.subtract(cut)).translate([0, 0, 0]);
      if (p.darstellung === 'eingelegt') out.deko = k(k(deko2.extrude(tief)).translate([0, 0, t - tief])).translate([0, 0, 0]);   // bündig, zweite Farbe
      return out;
    }
    const dk = k(k(deko2.extrude(p.erhaben)).translate([0, 0, t]));
    if (p.darstellung === 'einfarbig') { out.platte = k(plate3.add(dk)).translate([0, 0, 0]); return out; }
    out.platte = plate3.translate([0, 0, 0]); out.deko = dk.translate([0, 0, 0]);
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
if (typeof module !== 'undefined') module.exports = { LZN_DEF, lznBuild, lznLogo2D };
