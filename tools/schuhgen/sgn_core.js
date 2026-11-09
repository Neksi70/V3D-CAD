// Schuh-Generator (Badelatsche / Clog) — Manifold, mm, Z oben, Spitze +X, Mitte y = 0.
// Braucht _ksuFuss/_ksuLeisten/_ksuKurve aus dem KI-Schuh-Kern (Fuß-Leisten).
// p: { typ: 'slide'|'clog', eu, weite, sohle (mm), rand (mm), mulde (mm), profil: 'wellen'|'noppen'|'glatt',
//      luft (mm Abstand Fuß–Oberteil), wand (mm), riemen ('glatt'|'loecher'), loecher (Clog-Lüftung 0/1), fersenriemen 0/1 }
function _sgnBuild(w, p) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  try {
    const { Lf, W } = _ksuFuss(p), rand = p.rand ?? 7, hs = p.sohle ?? 12, mulde = Math.min(p.mulde ?? 4, hs - 4), luft = p.luft ?? 3, wd = p.wand ?? 3.5;
    const x0 = rand + 2;                                                     // Ferse des Fußes
    const fussZ = hs - mulde;                                               // Fußsohle liegt in der Mulde
    // Umriss = Leisten-Fußabdruck + Rand, rundum gleichmäßig
    const L0 = k(_ksuLeisten(w, p, 0, 0)), abdr = k(L0.slice(2)), umriss = k(abdr.offset(rand, 'Round', 2, 48));
    let sohle = k(umriss.extrude(hs).translate([x0, 0, 0]));
    // Kanten unten/oben brechen (1,2 mm): schmaler Umriss als Unterkante
    const fase = k(k(umriss.offset(-1.2, 'Round')).extrude(1.2).translate([x0, 0, 0]));
    sohle = k(M.union(k(M.difference(sohle, k(umriss.extrude(1.2).translate([x0, 0, 0])))), fase));
    // Fußbett: Leisten als Mulde (Fersenschale + Ballen von selbst)
    const fuss = L => k(L.translate([x0, 0, fussZ]));
    sohle = k(M.difference(sohle, fuss(L0)));
    // Profil unten
    const prof = [];
    if (p.profil === 'wellen') {
      for (let x = 6; x < Lf + 2 * rand; x += 7) {
        const pts = []; for (let y = -W; y <= W; y += 3) pts.push([x + 2 * Math.sin(y / 9), y]);
        const band = [...pts.map(q => [q[0] - 1.1, q[1]]), ...pts.reverse().map(q => [q[0] + 1.1, q[1]])];
        prof.push(k(new CS([band], 'NonZero').extrude(1.6).translate([x0 - rand, 0, -0.01])));
      }
    } else if (p.profil === 'noppen') {
      for (let x = 4; x < Lf + 2 * rand; x += 8) for (let y = -W; y <= W; y += 8) prof.push(k(M.cylinder(1.4, 2.4, 2.4, 16).translate([x0 - rand + x, y + ((x / 8) % 2 ? 4 : 0), -0.01])));
    }
    if (prof.length) {                                                      // Rillen/Näpfe vertieft: Unterseite bleibt plan (druckt flach)
      const pr = k(M.intersection(k(M.union(prof)), k(k(umriss.offset(-3, 'Round')).extrude(3).translate([x0, 0, -1]))));
      sohle = k(M.difference(sohle, pr));
    }
    // Oberteil: Schale zwischen Leisten+Luft und Leisten+Luft+Wand
    const innen = fuss(k(_ksuLeisten(w, p, luft, 0))), aussen = fuss(k(_ksuLeisten(w, p, luft + wd, 0)));
    const schale = k(M.difference(aussen, innen));
    const ueberSohle = k(M.cube([Lf * 2, W * 3, 300]).translate([-Lf / 2, -W * 1.5, hs - 0.5]));   // Oberteil erst ab Sohlenoberkante
    const slab = (xa, xb) => k(M.cube([xb - xa, W * 3, 300]).translate([xa, -W * 1.5, 0]));
    let ober = null, info = { Lf, W, hs };
    if (p.typ === 'clog') {
      // Kappe ab gut 40 % der Fußlänge, Öffnung schräg (oben weiter hinten)
      const xo = x0 + 0.42 * Lf;
      const keil = k(M.cube([Lf * 2, W * 3, 400]).translate([0, -W * 1.5, -200]).rotate([0, -22, 0]).translate([xo, 0, fussZ]));
      let kappe = k(M.intersection(k(M.intersection(schale, ueberSohle)), keil));
      if (p.loecher) {                                                      // Lüftungslöcher oben auf der Kappe (senkrecht)
        const L = [], d = 7.5;
        for (let t = 0.6; t <= 0.9; t += 0.075) {
          const b = _ksuKurve(_KSU_BREITE, t) * W / 2 - 9, n = Math.max(1, Math.floor(2 * b / (d * 1.9)) + 1);
          for (let i = 0; i < n; i++) L.push(k(M.cylinder(200, d / 2, d / 2, 24).translate([x0 + t * Lf, n > 1 ? -b + 2 * b * i / (n - 1) : 0, fussZ + _ksuKurve(_KSU_HOEHE, t) * Lf * 0.55])));
        }
        kappe = k(M.difference(kappe, k(M.union(L))));
        info.loecher = L.length;
      }
      ober = kappe;
      if (p.fersenriemen) {                                                 // Riemen um die Ferse, seitlich an die Kappe
        const zr = fussZ + 0.13 * Lf + 4, bw = 14;
        const r = k(M.intersection(k(M.intersection(schale, slab(x0 - 30, xo + 12))), k(M.cube([Lf * 2, W * 3, bw]).translate([-Lf / 2, -W * 1.5, zr]))));
        ober = k(M.union(ober, r));
      }
    } else {
      // Badelatsche: breiter Riemen über den Rist
      const xa = x0 + 0.5 * Lf, xb = x0 + 0.8 * Lf;
      let riemen = k(M.intersection(k(M.intersection(schale, ueberSohle)), slab(xa, xb)));
      if (p.riemen === 'loecher') {
        const L = [];
        for (let t = 0.56; t <= 0.75; t += 0.06) for (let a = -60; a <= 60; a += 24) {
          const r = M.cylinder(200, 3.2, 3.2, 20).translate([0, 0, -100]).rotate([a, 0, 0]).translate([x0 + t * Lf, 0, fussZ + 10]);
          L.push(k(r));
        }
        riemen = k(M.difference(riemen, k(M.union(L))));
      }
      ober = riemen;
    }
    ober = k(M.intersection(ober, k(umriss.extrude(400).translate([x0, 0, 0]))));   // nicht über die Sohlenkante hinaus (kein Überhang am Fuß)
    const ganz = M.union(sohle, ober);
    info.laenge = ganz.boundingBox().max[0] - ganz.boundingBox().min[0];
    info.breite = ganz.boundingBox().max[1] - ganz.boundingBox().min[1];
    info.hoehe = ganz.boundingBox().max[2];
    return { m: ganz, info, fussX: x0, fussZ };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
