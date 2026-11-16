// Schrift-Türecke („HO HO HO“ mit Weihnachtsmütze) — nach TikTok-Bild (Kunstoff Komplize, 16.11.).
// Flach, mm, Vorderseite oben (z), y oben. Schwarz = L-Winkel für die Türecke + Kontur um Schrift und Mütze (ein Teil),
// Rot = Buchstaben + Mütze, Weiß = Krempe + Bommel – beide erhaben auf der schwarzen Platte (stützfrei).
// textFn(CS, keep, txt, fontKey, h, cx, yb, maxW) → { cs } (App: _lttText); ohne textFn (Node) nur Mütze + Winkel.
const HHO_DEF = { text: 'HO\nHO\nHO', font: 'helvetiker_bold', hoehe: 40, zeilen: 0.92, rand: 3, dicke: 4, erhaben: 2.5,
  hut: 1, hut_gr: 1.0, hut_winkel: -14, modus: 'ecke', ecke: 'links', leiste: 12, lippe: 2, oben: 0, seite: 0 };
function _hhoBuild(w, pIn, textFn) {
  const p = { ...HHO_DEF, ...pIn }, M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  const rund = (cs, r) => k(k(cs.offset(-r, 'Round', 2, 24)).offset(r, 'Round', 2, 24));
  try {
    const H = p.hoehe, rand = p.rand, hb = p.leiste, ecke = p.modus === 'ecke';
    // ── Schrift: Zeilen untereinander, linksbündig ab x = 0, oberste Zeile Oberkante y = 0 ──
    const zeilen = String(p.text || '').split('\n').map(z => z.trim()).filter(Boolean).slice(0, 6);
    const L = []; let breite = 0, y = 0, oben0 = null;
    if (textFn) {
      const ref = textFn(CS, k, 'H', p.font, 50, 0, 0, 1e6), rb = ref && ref.cs ? ref.cs.bounds() : null;
      const s = rb ? H / (rb.max[1] - rb.min[1]) : 1;
      zeilen.forEach((z, i) => {
        const r = textFn(CS, k, z, p.font, 50, 0, 0, 1e6); if (!r || !r.cs) return;
        const t = k(r.cs.scale([s, s])), b = t.bounds(), yb = -(i + 1) * H * p.zeilen - (i ? 0 : 0);
        L.push(k(t.translate([-b.min[0], yb - rb.min[1] * s]))); breite = Math.max(breite, b.max[0] - b.min[0]);
        if (oben0 === null) oben0 = yb + H;
      });
    }
    if (oben0 === null) { oben0 = -H * p.zeilen + H; breite = Math.max(breite, 1.6 * H); }
    let rot = L.length ? k(CS.union(L)) : null, weiss = null;
    // ── Weihnachtsmütze: Krempe, Zipfel nach rechts hängend, Bommel; sitzt schräg auf der ersten Zeile ──
    let hutAlles = null;
    if (p.hut) {
      const g = p.hut_gr * H, P = pts => k(new CS([pts.map(([a, b]) => [a * g, b * g])], 'NonZero'));
      const krempe = rund(k(CS.square([1.3 * g, 0.3 * g], false).translate([-0.65 * g, 0])), 0.14 * g);
      const kappe = rund(P([[-0.56, 0.18], [-0.5, 0.55], [-0.32, 0.86], [-0.05, 1.02], [0.25, 1.04], [0.55, 0.92], [0.8, 0.7], [0.98, 0.42], [0.88, 0.36], [0.68, 0.58], [0.45, 0.66], [0.5, 0.18]]), 0.08 * g);
      const bommel = k(k(CS.circle(0.19 * g, 40)).translate([0.95 * g, 0.38 * g]));
      const dreh = cs => k(k(cs.rotate(p.hut_winkel)).translate([Math.min(breite, 2.2 * H) * 0.38, oben0 - 0.18 * g]));
      const K = dreh(kappe), Kr = dreh(krempe), B = dreh(bommel);
      weiss = k(CS.union([Kr, B]));
      const kappeRot = k(K.subtract(weiss));
      rot = rot ? k(k(rot.subtract(weiss)).add(kappeRot)) : kappeRot;
      hutAlles = k(CS.union([K, Kr, B]));
    }
    const motiv = k(CS.union([rot, weiss, hutAlles].filter(Boolean)));
    let schwarz = rund(k(motiv.offset(rand, 'Round', 2, 24)), Math.min(4, rand * 0.6));
    const mb = schwarz.bounds();
    // ── L-Winkel: Leiste oben + Schenkel liegen auf der Türzarge; Schrift und Mütze sitzen AUSSEN neben dem Schenkel
    // auf der Wand (nicht in der Türöffnung), die Mütze schaut oben über die Ecke. Rechte Ecke: nur der Winkel wird gespiegelt.
    const re = ecke && p.ecke === 'rechts';
    let dx = 0, dy = 0, info = {}, Lw = null, lippe = null;
    if (ecke) {
      dx = re ? -mb.min[0] - 1 : -mb.max[0] + 1;                                // Kontur überlappt die Außenkante des Schenkels um 1 mm
      dy = -mb.max[1] + (p.hut ? 0.35 * H * p.hut_gr : 0);                       // Oberkante bündig mit der Zarge, Mütze ragt darüber
      const oben = Math.max(p.oben || 0, 60), seite = Math.max(p.seite || 0, mb.max[1] - mb.min[1] - (p.hut ? 0.35 * H * p.hut_gr : 0) + 10);
      Lw = k(CS.union([k(CS.square([oben, hb], false).translate([0, -hb])), k(CS.square([hb, seite], false).translate([0, -seite]))]));
      if (p.lippe > 0) lippe = k(CS.union([k(CS.square([oben - hb, 1.6], false).translate([hb, -hb])), k(CS.square([1.6, seite - hb + 1.6], false).translate([hb - 1.6, -seite]))]));   // Lippe an der Innenkante (Türöffnung)
      if (re) { Lw = k(Lw.mirror([1, 0])); if (lippe) lippe = k(lippe.mirror([1, 0])); }
      info = { oben, seite };
    }
    const lage = cs => cs ? k(cs.translate([dx, dy])) : null;
    const S = Lw ? k(lage(schwarz).add(Lw)) : schwarz;
    const out = { schwarz: k(S.extrude(p.dicke)), info };
    if (lippe) out.schwarz = k(out.schwarz.add(k(k(lippe.extrude(p.lippe)).translate([0, 0, p.dicke]))));
    if (rot) out.rot = k(k(lage(rot).extrude(p.erhaben)).translate([0, 0, p.dicke]));
    if (weiss) out.weiss = k(k(lage(weiss).extrude(p.erhaben)).translate([0, 0, p.dicke]));
    const bb = out.schwarz.boundingBox(); out.info = { ...info, breite: bb.max[0] - bb.min[0], hoehe: bb.max[1] - bb.min[1], zeilen: zeilen.length };
    for (const key of ['schwarz', 'rot', 'weiss']) if (out[key]) out[key] = out[key].translate([0, 0, 0]);
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
if (typeof module !== 'undefined') module.exports = { HHO_DEF, _hhoBuild };
