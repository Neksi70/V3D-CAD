// Schutzengel-Anhänger — Manifold, mm, Platte in XY (y oben), Dicke entlang Z, liegt auf z = 0.
// Teile: Körper (Kopf + Kegel, Aufhängeloch, Pünktchen/Stern), Flügel (Fähnchen mit Herz,
// eigene Farbe), Dunkel (Streifen + Text, erhaben oben drauf → Farbwechsel nur bei z = Dicke).
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
    if (p.fluegel === 'rechts' || p.fluegel === 'beide') fluegel.push(k(fahne(1)));
    if (p.fluegel === 'links' || p.fluegel === 'beide') fluegel.push(k(fahne(-1)));
    let fl = fluegel.length ? k(M.difference(k(M.union(fluegel)), koerper)) : null;   // im Körper steckender Teil gehört zum Körper
    // ── Dunkel: Text + Streifen (erhaben auf der Oberseite) ──
    const dunkel = [], hR = p.relief, sperr = [];                            // sperr = Rechtecke ohne Pünktchen
    const innen = k(u.offset(-2.2, 'Round'));
    if (textFn && (p.text1 || p.text2)) {
      let yb = H * 0.09;
      const zeile = (txt, font, h) => {
        if (!txt || !(h > 0)) return;
        const r = textFn(CS, k, txt, font, h, 0, yb, 2 * halbB(yb + h) - 8);
        if (r && r.cs) { dunkel.push(k(k(r.cs.intersect(innen)).extrude(hR).translate([0, 0, d - 0.01]))); sperr.push([-halbB(yb) , yb - 2, halbB(yb), yb + r.h + 2]); yb += r.h + h * 0.25; }
      };
      zeile(p.text2, p.font2, p.h2);                                          // untere Zeile zuerst (Schreibschrift)
      zeile(p.text1, p.font1, p.h1);
    }
    if (p.muster === 'streifen') {
      const n = Math.max(1, Math.round(p.streifen)), y0 = H * 0.06, y1 = yHals - rk * 0.3;
      for (let i = 0; i < n; i++) {
        const y = y0 + (y1 - y0) * (i + 0.5) / n + (rnd() - 0.5) * (y1 - y0) / n * 0.25, t = 1 + rnd() * 1.6, a = (rnd() - 0.5) * 7;
        const hb = halbB(y) * (0.8 + rnd() * 0.15), x0 = -hb + rnd() * hb * 0.25;
        const bar = k(CS.square([hb * 2 - (x0 + hb), t]).translate([x0, y - t / 2]).rotate(a));
        dunkel.push(k(k(bar.intersect(innen)).extrude(hR).translate([0, 0, d - 0.01])));
      }
    }
    let dk = dunkel.length ? k(M.union(dunkel)) : null;
    // ── Pünktchen + Stern (Körperfarbe) ──
    const auf = [];
    if (p.muster === 'punkte') {
      const flaeche = u.area(), n = Math.round(flaeche * p.punkte / 1000);
      const ib = innen.bounds();
      let gesetzt = 0;
      for (let t = 0; t < n * 6 && gesetzt < n; t++) {
        const x = ib.min[0] + rnd() * (ib.max[0] - ib.min[0]), y = ib.min[1] + rnd() * (ib.max[1] - ib.min[1]);
        if (Math.abs(x) > halbB(y) - 2.2 && y < yHals) continue;
        if ((x * x + (y - yK) ** 2 > (rk - 2.2) ** 2) && y > yHals) continue;
        if (sperr.some(r => x > r[0] && x < r[2] && y > r[1] && y < r[3])) continue;
        if (p.oese > 0 && x * x + (y - lochY) ** 2 < (oeseR + 2) ** 2) continue;
        if (p.stern && x * x + (y - H * 0.6) ** 2 < 64) continue;
        const r = 0.5 + rnd() * 0.8;
        auf.push(k(M.sphere(r, 10).scale([1, 1, 0.75]).translate([x, y, d - 0.05]))); gesetzt++;
      }
    }
    if (p.stern) {
      const sR = H * 0.055, pts = [];
      for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? sR * 0.45 : sR; pts.push([r * Math.cos(a), H * 0.6 + r * Math.sin(a)]); }
      auf.push(k(k(new CS([pts])).extrude(hR + 0.2).translate([0, 0, d - 0.01])));
    }
    if (auf.length) koerper = k(M.union(koerper, k(M.union(auf))));
    if (dk) koerper = k(M.difference(koerper, dk));
    const res = { koerper: koerper.translate([0, 0, 0]), fluegel: fl ? fl.translate([0, 0, 0]) : null, dunkel: dk ? dk.translate([0, 0, 0]) : null };   // Kopien: tmp wird gleich gelöscht
    res.farbwechsel = d; res.masse = m;
    return res;
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
