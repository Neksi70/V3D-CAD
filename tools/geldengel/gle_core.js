// Geld-Engel (3D-Druck + UV-Druck) — Manifold, mm. Frontansicht in XY (y oben), Tiefe Z (0 … T),
// Vorderseite z = T ist eben (UV-Druck). Flügel aus je drei Federn mit Spalten = Schlitze für Geldscheine.
// Kopf = Kugel mit flachem Boden und Zapfenloch, steckt auf einem Zapfen oben am Körper.
function _gleUmriss(CS, p) {
  const H = p.hoehe, S = p.schlitz, ue = 0.01;
  const robe = [[-0.40, 0], [0.40, 0], [0.38, 0.03], [0.30, 0.08], [0.24, 0.2], [0.19, 0.38], [0.17, 0.5], [0.19, 0.62], [0.22, 0.72], [0.21, 0.8],
    [0.15, 0.86], [0.08, 0.88], [-0.08, 0.88], [-0.15, 0.86], [-0.21, 0.8], [-0.22, 0.72], [-0.19, 0.62], [-0.17, 0.5], [-0.19, 0.38], [-0.24, 0.2], [-0.30, 0.08], [-0.38, 0.03]];
  let u = new CS([robe.map(([x, y]) => [x * H, y * H])]);
  const r0 = u.offset(-H * 0.02, 'Round', 2, 32), r1 = r0.offset(H * 0.02, 'Round', 2, 32); u.delete(); r0.delete(); u = r1;
  // Federn: je Seite drei abgerundete Balken, gestaffelt, von der Taille nach außen-oben; Spalten = Schlitze
  const fed = [];
  const lagen = [[0.50, 0.40, 4], [0.60, 0.47, 17], [0.70, 0.45, 32]];   // [y Ansatz, Länge, Winkel°]
  const dick = H * 0.17;                                                  // breite Lagen, überlappen sich → nur die Schlitze bleiben
  for (const sx of [-1, 1]) lagen.forEach(([y0, L, a], i) => {
    const l = L * H, rr = dick / 2, pts = [];
    for (let k = 0; k <= 16; k++) { const t = -Math.PI / 2 + Math.PI * k / 16; pts.push([l + rr * Math.cos(t), rr * Math.sin(t)]); }
    pts.push([H * 0.05, rr], [H * 0.05, -rr]);
    const b = new CS([pts]).rotate(a).translate([0, y0 * H]);
    const c = sx < 0 ? b.mirror([1, 0]) : b; if (c !== b) b.delete(); fed.push(c);
  });
  // Spalten zwischen den Federn: jede Feder wird um den Schlitz von der darüberliegenden getrennt
  const F = [];
  for (const sx of [0, 3]) for (let i = 0; i < 3; i++) {
    let f = fed[sx + i].translate([0, 0]);
    if (i < 2) { const ob = fed[sx + i + 1].offset(S, 'Round', 2, 16), f2 = f.subtract(ob); f.delete(); ob.delete(); f = f2; }
    F.push(f);
  }
  const torso = CS.square([H * 0.3, H * 0.46]).translate([-H * 0.15, H * 0.4]);   // endet unter der Schulter (Kopf sitzt bei 0,88·H)
  const alle = CS.union([u, ...F]); F.forEach(f => f.delete()); fed.forEach(f => f.delete());
  // Spalten außerhalb der Körpermitte offen lassen (Schlitze), innen schließt der Torso
  const fertig = alle.add(torso); alle.delete(); torso.delete(); u.delete();
  return fertig;
}
function _gleBuild(w, p) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { if (x) tmp.push(x); return x; };
  try {
    const H = p.hoehe, T = p.tiefe, U = k(_gleUmriss(CS, p));
    let koerper = k(U.extrude(T));
    // Kanten vorn/hinten leicht brechen (0,8 mm Fase) — UV-Fläche bleibt eben
    const f = 0.8, fase = k(k(U.offset(-f, 'Round')).extrude(f));
    koerper = k(M.union(k(M.difference(koerper, k(U.extrude(f)))), fase));
    koerper = k(M.union(k(M.difference(koerper, k(U.extrude(f).translate([0, 0, T - f])))), k(fase.translate([0, 0, T - f]))));
    // Kopf: Kugel auf dem Zapfen
    const rK = H * p.kopf / 100, yHals = 0.88 * H, zap = p.zapfen;
    koerper = k(M.union(koerper, k(M.cylinder(10, zap / 2, zap / 2, 32).rotate([-90, 0, 0]).translate([0, yHals - 0.5, T / 2]))));
    const zK = -rK * 0.72;                                                  // Kugel unten abgeflacht (Druck ohne Stützen)
    let kopf = k(M.sphere(rK, 96));
    kopf = k(kopf.trimByPlane([0, 0, 1], zK));
    kopf = k(M.difference(kopf, k(M.cylinder(11, (zap + p.spiel) / 2, (zap + p.spiel) / 2, 32).translate([0, 0, zK - 0.5]))));
    // Kopf in Gebrauchslage: flacher Boden auf dem Hals, Zapfen steckt drin
    const kopfAuf = kopf.rotate([-90, 0, 0]).translate([0, yHals - zK, T / 2]);
    return { koerper: koerper.translate([0, 0, 0]), kopf: kopf.translate([0, 0, -zK]), kopfAuf, umriss: U.translate([0, 0]), H, T, rK, yHals };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
// Wortwolke in der Engel-Front: Zeilen von oben nach unten, je Zeile 1–2 Wörter (Schrift im Wechsel),
// auf die verfügbare Breite gezogen. Liefert CrossSection (Frontansicht, mm) — oder null.
function _gleWolke(w, p, U, textFn) {
  const CS = w.CrossSection, tmp = [], k = x => { if (x) tmp.push(x); return x; };
  try {
    const H = p.hoehe, W = String(p.woerter || '').split(/\n|,/).map(s => s.trim()).filter(Boolean);
    if (!W.length || !textFn) return null;
    const F = [p.font1, p.font2, p.font3].filter(Boolean);
    let a0 = (p.seed || 5) >>> 0; const rnd = () => { a0 = (a0 + 0x6D2B79F5) >>> 0; let t = a0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const rand = p.wolkeRand, feld = k(k(U.offset(-rand, 'Round')).intersect(k(CS.square([4 * H, H * 0.86]).translate([-2 * H, 0]))));
    // nur die Robe + Brust (zwischen den Flügeln), nicht in die Federn
    const mitte = k(feld.intersect(k(CS.square([H * 0.5, H]).translate([-H * 0.25, 0]))));
    const fb = mitte.bounds(), teile = [];
    let y = fb.max[1], wi = 0, fi = 0, z = 0;
    const hMin = H * p.wortMin / 100, hMax = H * p.wortMax / 100;
    while (y > fb.min[1] + hMin && z++ < 80) {
      const h = hMin + (hMax - hMin) * rnd();
      const band = k(mitte.intersect(k(CS.square([4 * H, h]).translate([-2 * H, y - h]))));
      if (band.isEmpty()) { y -= h * 0.5; continue; }
      const bb = band.bounds(), schmal = k(mitte.intersect(k(CS.square([4 * H, h * 0.1]).translate([-2 * H, y - h * 0.55]))));
      const sb = schmal.isEmpty() ? bb : schmal.bounds(), xL = sb.min[0] + 1, xR = sb.max[0] - 1, avail = xR - xL;
      if (avail < h * 1.2) { y -= h * 0.6; continue; }
      const zeile = [];
      let r = textFn(CS, k, W[wi++ % W.length], F[fi++ % F.length], h, 0, 0, 1e4);
      if (r && r.cs) zeile.push(r);
      if (r && r.w < avail * 0.5) { const r2 = textFn(CS, k, W[wi++ % W.length], F[fi++ % F.length], h * (0.7 + rnd() * 0.3), 0, 0, 1e4); if (r2 && r2.cs) zeile.push(r2); }
      if (!zeile.length) { y -= h; continue; }
      const gap = h * 0.35, natur = zeile.reduce((s, q) => s + q.w, 0) + gap * (zeile.length - 1);
      const s = Math.min(avail / natur, (hMax * 1.25) / Math.max(...zeile.map(q => q.h)));
      let x = xL + (avail - natur * s) / 2, zh = Math.max(...zeile.map(q => q.h)) * s;
      for (const q of zeile) { const b = q.cs.bounds(), m = k(q.cs.translate([-b.min[0], -b.min[1]])).scale([s, s]); k(m);
        teile.push(k(m.translate([x, y - zh + (zh - (b.max[1] - b.min[1]) * s) / 2]))); x += q.w * s + gap * s; }
      y -= zh + h * p.zeilenAbstand / 100;
    }
    if (!teile.length) return null;
    return CS.union(teile).intersect(feld);
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
