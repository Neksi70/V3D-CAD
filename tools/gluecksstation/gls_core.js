// Glücks-Aufladestation — leuchtender Stern auf Sockel mit LED-Teelicht. mm, Y oben, Vorderseite +Z.
// Stern: hohl (Wand p.wand), Kanten gerundet, Füße flach, Lichtloch unten in der Mitte; vorn Text + Pünktchen
// eingraviert (Gravur dünnt die Wand → leuchtet heller). Sockel: Platte mit Perlenrand, Herz vorn, Teelicht-Mulde,
// Schalterloch, Taschen für die Sternfüße. Braucht: _zwiPolyD, _lgfLevel; textFn wie _lttText.
function _glsBuild(w, p, textFn, q) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  try {
    const R = p.groesse / 2, D = p.tiefe, wd = p.wand, re = Math.min(4, D * 0.18), hB = p.sockelH, tasche = 3;
    // Stern-Umriss (gerundete Spitzen), Mitte so, dass die Füße auf y = hB − tasche stehen
    const pts = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.52 : R; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
    const rk = R * 0.09, cs0 = k(k(k(new CS([pts])).offset(-rk, 'Round', 2, 24)).offset(rk, 'Round', 2, 24));
    const bb0 = cs0.bounds(), fussY = bb0.min[1] + R * 0.05;                  // Füße flach: unten 5 % abschneiden
    const yOff = hB - tasche - fussY, poly = cs0.toPolygons()[0].map(([x, y]) => [x, y + yOff]);
    const yFuss = fussY + yOff;
    const f = (x, y, z) => {
      const d2 = _zwiPolyD(poly, x, y), az = Math.abs(z) - D / 2;
      const qx = Math.max(d2 + re, 0), qz = Math.max(az + re, 0), d = Math.hypot(qx, qz) + Math.min(Math.max(d2 + re, az + re), 0) - re;
      return Math.max(Math.max(d, -(d + wd)), yFuss - y);                     // Schale, Füße flach
    };
    const bb = [bb0.min[0] - 2, yFuss - 1, -D / 2 - 2, bb0.max[0] + 2, bb0.max[1] + yOff + 2, D / 2 + 2];
    const V = (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]);
    let stern = k(_lgfLevel(w, (x, y, z) => f(x, y, z), bb, Math.max(0.3, Math.min(wd / 2.4, Math.cbrt(V / (q === 'fein' ? 5e6 : 4e5))))));
    stern = k(stern.trimByPlane([0, 1, 0], yFuss));                          // Fußsohlen exakt eben
    // Lichtloch unten in der Mitte (über dem Teelicht)
    const notchY = Math.min(...poly.filter(([x]) => Math.abs(x) < R * 0.2).map(([, y]) => y));
    const rL = Math.min(D / 2 - wd - 1, R * 0.2);
    stern = k(stern.subtract(k(M.cylinder(R * 0.3, rL, rL, 48).rotate([-90, 0, 0]).translate([0, notchY - R * 0.1, 0]))));
    // Gravur vorn: Text + kleiner Stern + Pünktchen
    const tief = Math.min(p.gravur, wd - 0.6), info = { zeilen: 0 };
    const inn = k(k(new CS([poly])).offset(-(re + 2), 'Round', 2, 16)), grav = [];
    let cur = yOff + R * 0.42, frei = [];                                     // Textblock von oben nach unten (cur = Oberkante der nächsten Zeile)
    const zeile = (txt, font, h) => { if (!textFn || !txt) return; const r = textFn(CS, k, txt, font, h, 0, cur - h, 2 * R * 0.62); if (r && r.cs) { grav.push(r.cs); const b = r.cs.bounds(); frei.push([b.min[0] - 3, b.min[1] - 3, b.max[0] + 3, b.max[1] + 3]); cur = b.min[1] - h * 0.3; info.zeilen++; } };
    zeile(p.text1, p.font1, p.h1);
    if (p.sternchen) { const sR = p.h2 * 0.6, yc = cur - sR, sp = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? sR * 0.42 : sR; sp.push([r * Math.cos(a), yc + r * Math.sin(a)]); }
      grav.push(k(new CS([sp]))); frei.push([-sR - 3, yc - sR - 2, sR + 3, yc + sR + 2]); cur = yc - sR - p.h2 * 0.4; }
    for (const z of String(p.text2 || '').split('\n').filter(Boolean)) zeile(z, p.font2, p.h2);
    if (p.punkte) {
      let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }, ib = inn.bounds(), pk = [];
      for (let t = 0; t < 4000 && pk.length < p.punkte; t++) {
        const x = ib.min[0] + rnd() * (ib.max[0] - ib.min[0]), y = ib.min[1] + rnd() * (ib.max[1] - ib.min[1]);
        if (_zwiPolyD(poly, x, y) > -(re + 4)) continue;
        if (frei.some(b => x > b[0] && x < b[2] && y > b[1] && y < b[3])) continue;
        if (pk.some(([a, c]) => (a - x) ** 2 + (c - y) ** 2 < 100)) continue;
        pk.push([x, y]); grav.push(k(k(CS.circle(1.1, 16)).translate([x, y])));
      }
    }
    if (grav.length) { const g = k(k(CS.union(grav)).intersect(inn)); stern = k(stern.subtract(k(k(g.extrude(tief + 2)).translate([0, 0, D / 2 - tief])))); }
    // Sockel: Platte, Perlenrand oben, Herz vorn, Teelicht-Mulde, Schalterloch, Fußtaschen
    const rS = Math.max(p.sockelD / 2, p.ledD / 2 + 8), cyl = (h, r, y) => k(M.cylinder(h, r, r, 128).rotate([-90, 0, 0]).translate([0, y, 0]));
    let sockel = cyl(hB, rS, 0);
    const nb = Math.round(2 * Math.PI * (rS - 2.2) / 4.4), perlen = [];
    for (let i = 0; i < nb; i++) { const a = i / nb * 2 * Math.PI; perlen.push(k(M.sphere(2.1, 16).translate([(rS - 2.2) * Math.cos(a), hB + 0.6, (rS - 2.2) * Math.sin(a)]))); }
    sockel = k(M.union([sockel, ...perlen]));
    const muldeT = Math.min(hB - 3, 14);
    sockel = k(sockel.subtract(cyl(muldeT + 1, p.ledD / 2, hB - muldeT)));
    sockel = k(sockel.subtract(cyl(hB, 8, -1)));                              // Schalter von unten
    // Taschen: Sternfüße + 0,3 Luft
    const streifen = k(k(CS.square([4 * R, tasche + 0.01], false)).translate([-2 * R, yFuss]));
    const fussCS = k(k(k(new CS([poly])).intersect(streifen)).offset(0.3, 'Round'));
    const fussQ = fussCS.bounds(), taschen = [];
    for (const sx of [-1, 1]) { const xs = sx > 0 ? [0, fussQ.max[0] + 1] : [fussQ.min[0] - 1, 0];
      const part = k(fussCS.intersect(k(k(CS.square([xs[1] - xs[0], 3 * tasche], false)).translate([xs[0], yFuss - tasche])))); const pb = part.bounds();
      taschen.push(k(M.cube([pb.max[0] - pb.min[0], tasche + 1, D + 0.6], false).translate([pb.min[0], hB - tasche, -D / 2 - 0.3]))); }
    sockel = k(sockel.subtract(k(M.union(taschen))));
    // Herz vorn auf der Mantelfläche (0,8 mm tief)
    const hz = 5.5, hc = [0, hB * 0.5], herz = k(CS.union([k(k(CS.circle(hz * 0.55, 24)).translate([-hz * 0.45, hc[1] + hz * 0.25])), k(k(CS.circle(hz * 0.55, 24)).translate([hz * 0.45, hc[1] + hz * 0.25])),
      k(new CS([[[-hz, hc[1] + hz * 0.1], [hz, hc[1] + hz * 0.1], [0, hc[1] - hz * 1.05]]], 'NonZero'))]));
    sockel = k(sockel.subtract(k(k(herz.extrude(rS)).translate([0, 0, rS * 0.0 + Math.sqrt(Math.max(0, rS * rS - hz * hz)) - 0.8]))));
    info.notchHoehe = notchY - hB; info.breite = bb0.max[0] - bb0.min[0]; info.hoehe = bb0.max[1] + yOff;
    info.ledPasst = info.notchHoehe > 8;
    return { stern: stern.translate([0, 0, 0]), sockel: sockel.translate([0, 0, 0]), info };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
