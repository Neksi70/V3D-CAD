// Schrift-Türecke („HO HO HO“ mit Weihnachtsmütze) — nach TikTok-Bild (Kunstoff Komplize, 16.11.).
// Flach, mm, Vorderseite oben (z), y oben. Schwarz = L-Winkel für die Türecke + Kontur um Schrift und Mütze (ein Teil),
// Rot = Buchstaben + Mütze, Weiß = Krempe + Bommel – beide erhaben auf der schwarzen Platte (stützfrei).
// textFn(CS, keep, txt, fontKey, h, cx, yb, maxW) → { cs } (App: _lttText); ohne textFn (Node) nur Mütze + Winkel.
const HHO_DEF = { text: 'HO\nHO\nHO', font: 'helvetiker_bold', hoehe: 40, zeilen: 1.1, sperren: -6, rand: 3, dicke: 4, erhaben: 2.5,
  hut: 1, hut_gr: 1.35, hut_winkel: 14, modus: 'ecke', ecke: 'rechts', leiste: 12, lippe: 2, oben: 0, seite: 0 };
// Anordnung wie im Vorbild (rechte Türecke): Winkel = Leiste nach links + Schenkel nach unten; die Zeilen stehen AUSSEN
// rechts neben dem Schenkel und beginnen an seiner Kante; die große Mütze sitzt oben auf der Ecke, Spitze zur Leiste,
// Krempe schräg nach unten zur Schrift. Linke Ecke = alles gespiegelt, nur die Buchstaben bleiben lesbar.
function _hhoBuild(w, pIn, textFn) {
  const p = { ...HHO_DEF, ...pIn }, M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  const rund = (cs, r) => k(k(cs.offset(-r, 'Round', 2, 24)).offset(r, 'Round', 2, 24));
  try {
    const H = p.hoehe, rand = p.rand, hb = p.leiste, ecke = p.modus === 'ecke', li = ecke && p.ecke === 'links', sg = li ? -1 : 1;
    const x0 = ecke ? rand - 1 : 0, yTop = ecke ? -hb * 0.5 : 0;               // Zeilen beginnen an der Schenkelkante, Oberkante knapp unter der Leiste
    // ── Schrift: Buchstabe für Buchstabe (enger gesetzt, „sperren“ in % der Höhe, negativ = überlappend) ──
    const zeilen = String(p.text || '').split('\n').map(z => z.trim()).filter(Boolean).slice(0, 6);
    const L = []; let breite = 0;
    if (textFn) {
      const ref = textFn(CS, k, 'H', p.font, 50, 0, 0, 1e6), rb = ref && ref.cs ? ref.cs.bounds() : null;
      const s = rb ? H / (rb.max[1] - rb.min[1]) : 1, gap = H * p.sperren / 100;
      zeilen.forEach((z, i) => {
        const yb = yTop - H - i * H * p.zeilen, glyphen = [];
        let x = 0;
        for (const ch of [...z]) {
          if (ch === ' ') { x += H * 0.35; continue; }
          const r = textFn(CS, k, ch, p.font, 50, 0, 0, 1e6); if (!r || !r.cs) continue;
          const t = k(r.cs.scale([s, s])), b = t.bounds();
          glyphen.push(k(t.translate([x - b.min[0], yb - rb.min[1] * s]))); x += (b.max[0] - b.min[0]) + gap;
        }
        if (!glyphen.length) return;
        const lw = x - gap; breite = Math.max(breite, lw);
        let zl = k(CS.union(glyphen));
        zl = k(zl.translate([li ? -x0 - lw : x0, 0]));                        // rechte Ecke: links bündig am Schenkel, linke Ecke: rechts bündig
        L.push(zl);
      });
    }
    if (!breite) breite = 1.6 * H;
    let rot = L.length ? k(CS.union(L)) : null, weiss = null, hutAlles = null;
    // ── Weihnachtsmütze auf der Ecke: lokal Spitze nach −x (zur Leiste), Krempe fällt nach +x (zur Schrift) ──
    if (p.hut) {
      const g = p.hut_gr * H, P = pts => k(new CS([pts.map(([a, b]) => [a * g, b * g])], 'NonZero'));
      const krempe = rund(k(CS.square([1.3 * g, 0.3 * g], false).translate([-0.65 * g, 0])), 0.14 * g);
      const kappe = rund(P([[0.56, 0.18], [0.5, 0.55], [0.32, 0.86], [0.05, 1.02], [-0.25, 1.04], [-0.55, 0.92], [-0.8, 0.7], [-0.98, 0.42], [-0.88, 0.36], [-0.68, 0.58], [-0.45, 0.66], [-0.5, 0.18]]), 0.08 * g);
      const bommel = k(k(CS.circle(0.19 * g, 40)).translate([-0.95 * g, 0.38 * g]));
      const lage = cs => { let c = k(cs.rotate(-p.hut_winkel)); if (li) c = k(c.mirror([1, 0])); return k(c.translate([sg * (x0 + 0.42 * g), yTop - 0.12 * g])); };
      const K = lage(kappe), Kr = lage(krempe), B = lage(bommel);
      weiss = k(CS.union([Kr, B]));
      const kappeRot = k(K.subtract(weiss));
      rot = rot ? k(k(rot.subtract(weiss)).add(kappeRot)) : kappeRot;
      hutAlles = k(CS.union([K, Kr, B]));
    }
    const motiv = k(CS.union([rot, weiss, hutAlles].filter(Boolean)));
    let schwarz = rund(k(motiv.offset(rand, 'Round', 2, 24)), Math.min(4, rand * 0.6));
    const mb = schwarz.bounds();
    let info = {}, lippe = null;
    if (ecke) {                                                                // Winkel: Leiste zur Türmitte, Schenkel nach unten (rechte Ecke: Leiste nach links)
      const zeilenH = zeilen.length ? (zeilen.length - 1) * H * p.zeilen + H : H;
      const oben = Math.max(p.oben || 0, 80), seite = Math.max(p.seite || 0, -yTop + zeilenH + rand + 15);
      let Lw = k(CS.union([k(CS.square([oben, hb], false).translate([-oben, -hb])), k(CS.square([hb, seite], false).translate([-hb, -seite]))]));
      if (p.lippe > 0) lippe = k(CS.union([k(CS.square([oben - hb, 1.6], false).translate([-oben, -hb])), k(CS.square([1.6, seite - hb + 1.6], false).translate([-hb, -seite]))]));   // Lippe an der Innenkante (Türöffnung)
      if (li) { Lw = k(Lw.mirror([1, 0])); if (lippe) lippe = k(lippe.mirror([1, 0])); }
      schwarz = k(schwarz.add(Lw)); info = { oben, seite };
    }
    const out = { schwarz: k(schwarz.extrude(p.dicke)), info };
    if (lippe) out.schwarz = k(out.schwarz.add(k(k(lippe.extrude(p.lippe)).translate([0, 0, p.dicke]))));
    if (rot) out.rot = k(k(rot.extrude(p.erhaben)).translate([0, 0, p.dicke]));
    if (weiss) out.weiss = k(k(weiss.extrude(p.erhaben)).translate([0, 0, p.dicke]));
    const bb = out.schwarz.boundingBox(); out.info = { ...info, breite: bb.max[0] - bb.min[0], hoehe: bb.max[1] - bb.min[1], zeilen: zeilen.length };
    for (const key of ['schwarz', 'rot', 'weiss']) if (out[key]) out[key] = out[key].translate([0, 0, 0]);
    return out;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
if (typeof module !== 'undefined') module.exports = { HHO_DEF, _hhoBuild };
