// Bubble-Buchstaben (Kissen-Buchstaben für die Wand) — Manifold, mm, Rückseite flach auf z = 0, Wölbung nach +Z.
// Idee nach „Bubble Letters: Puffy Wall Alphabet“ (MakerWorld, GoldenPants) — eigene Umsetzung, beliebiger Text.
// Ablauf je Buchstabe: Schriftkontur → „pummelig“ aufweiten (offset) → exakter Abstand d zur Kontur auf einem Raster →
// Höhe h(d) = T·√(1 − (1 − d/Dm)²) (Kissenprofil, dünne Striche bleiben flacher) → Manifold.levelSet.
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs, h, w} (App: _lttText) — in Node eigene Ersatzfunktion.
function _bubFlaeche(q) { let a = 0; for (let i = 0; i < q.length; i++) { const u = q[i], v = q[(i + 1) % q.length]; a += u[0] * v[1] - v[0] * u[1]; } return a / 2; }
// Höhenfeld eines Umrisses: Raster (Schritt g) mit Höhe innen, −Abstand außen
function _bubFeld(cs, g, T, rand) {
  const polys = cs.toPolygons(), b = cs.bounds(), seg = [];
  for (const q of polys) for (let i = 0; i < q.length; i++) { const a = q[i], c = q[(i + 1) % q.length]; seg.push(a[0], a[1], c[0], c[1]); }
  const x0 = b.min[0] - rand, y0 = b.min[1] - rand, nx = Math.ceil((b.max[0] - b.min[0] + 2 * rand) / g) + 1, ny = Math.ceil((b.max[1] - b.min[1] + 2 * rand) / g) + 1;
  const d = new Float32Array(nx * ny), ns = seg.length / 4;
  let dMax = 0;
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * g, xs = [];
    for (let s = 0; s < ns; s++) {                                     // Schnittpunkte der Zeile mit den Kanten → innen/außen (gerade/ungerade)
      const ay = seg[s * 4 + 1], cy = seg[s * 4 + 3];
      if ((ay <= y) !== (cy <= y)) { const ax = seg[s * 4], cx = seg[s * 4 + 2]; xs.push(ax + (y - ay) / (cy - ay) * (cx - ax)); }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * g;
      let inn = false; for (let k = 0; k < xs.length && xs[k] < x; k++) inn = !inn;
      let m = Infinity;
      for (let s = 0; s < ns; s++) {
        const ax = seg[s * 4], ay = seg[s * 4 + 1], ex = seg[s * 4 + 2] - ax, ey = seg[s * 4 + 3] - ay;
        const L = ex * ex + ey * ey; let t = L > 0 ? ((x - ax) * ex + (y - ay) * ey) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - ax - t * ex, dy = y - ay - t * ey, q = dx * dx + dy * dy; if (q < m) m = q;
      }
      m = Math.sqrt(m); d[j * nx + i] = inn ? m : -m; if (inn && m > dMax) dMax = m;
    }
  }
  return { d, nx, ny, x0, y0, g, dMax };
}
function _bubLetter(w, cs, p, g) {
  const M = w.Manifold, T = p.dicke, F = _bubFeld(cs, g, T, 2 * g), { d, nx, ny, x0, y0 } = F;
  // Lokale Strichbreite: Maximum von d in einem Fenster (≈ dickste Stelle des Buchstabens), danach geglättet.
  // Höhe relativ dazu → jede Strichmitte hat eine waagerechte Tangente (kein Grat auf der Mittellinie);
  // dünne Striche bleiben etwas flacher (Faktor (Dloc/dMax)^0,35). Erste Fassung mit festem Dm zeigte Knicke.
  const Dm = Math.max(1, F.dMax), r = Math.max(2, Math.round(Dm * 0.9 / g)), pos = new Float32Array(nx * ny);
  for (let i = 0; i < pos.length; i++) pos[i] = d[i] > 0 ? d[i] : 0;
  const maxZeile = (a, n, schritt, anz, start) => { const out = new Float32Array(n);    // gleitendes Maximum (Fenster ±r) mit Deque
    for (let z = 0; z < anz; z++) { const o = start(z), q = []; let h = 0;
      for (let i = 0, j = 0; i < n; i++) { while (j < n && j <= i + r) { const v = a[o + j * schritt]; while (q.length > h && a[o + q[q.length - 1] * schritt] <= v) q.pop(); q.push(j); j++; }
        while (q[h] < i - r) h++; out[i] = a[o + q[h] * schritt]; }
      for (let i = 0; i < n; i++) a[o + i * schritt] = out[i]; } };
  const loc = Float32Array.from(pos);
  maxZeile(loc, nx, 1, ny, z => z * nx); maxZeile(loc, ny, nx, nx, z => z);
  const blur = (a, rb) => { const t = new Float32Array(a.length);                          // Kastenfilter, getrennt in x und y
    for (let j = 0; j < ny; j++) { let s = 0, c = 0; for (let i = -rb; i < nx + rb; i++) { const ia = i + rb, ib = i - rb - 1; if (ia < nx && ia >= 0) { s += a[j * nx + ia]; c++; } if (ib >= 0) { s -= a[j * nx + ib]; c--; } if (i >= 0 && i < nx) t[j * nx + i] = s / c; } }
    for (let i = 0; i < nx; i++) { let s = 0, c = 0; for (let j = -rb; j < ny + rb; j++) { const ja = j + rb, jb = j - rb - 1; if (ja < ny && ja >= 0) { s += t[ja * nx + i]; c++; } if (jb >= 0) { s -= t[jb * nx + i]; c--; } if (j >= 0 && j < ny) a[j * nx + i] = s / c; } } };
  blur(loc, Math.max(1, r >> 1)); blur(loc, Math.max(1, r >> 1));
  const hf = new Float32Array(nx * ny);
  for (let i = 0; i < hf.length; i++) { const v = d[i]; if (v <= 0) { hf[i] = v; continue; }
    const Dl = Math.max(v, loc[i], 0.5), u = Math.min(1, v / Dl); hf[i] = T * Math.pow(Dl / Dm, 0.35) * Math.sqrt(1 - (1 - u) * (1 - u)); }
  const sdf = q => {
    let gx = (q[0] - x0) / g, gy = (q[1] - y0) / g;
    gx = gx < 0 ? 0 : gx > nx - 1.0001 ? nx - 1.0001 : gx; gy = gy < 0 ? 0 : gy > ny - 1.0001 ? ny - 1.0001 : gy;
    const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, i0 = iy * nx + ix;
    const h = (hf[i0] * (1 - fx) + hf[i0 + 1] * fx) * (1 - fy) + (hf[i0 + nx] * (1 - fx) + hf[i0 + nx + 1] * fx) * fy;
    return Math.min(q[2], h - q[2]);                                     // > 0 innen: über der Rückseite und unter dem Kissen
  };
  const bounds = { min: [x0, y0, -g * 0.37], max: [x0 + (nx - 1) * g, y0 + (ny - 1) * g, T + g] };
  const mf = M.levelSet(sdf, bounds, g, 0);
  return { mf, F, Dm };
}
// Stellen für Magnet/Schlüsselloch: Rasterpunkte mit genug Abstand zur Kontur
function _bubStellen(F, rMin, anzahl, obenBevorzugt) {
  const { d, nx, ny, x0, y0, g } = F, kand = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = d[j * nx + i]; if (v >= rMin) kand.push([x0 + i * g, y0 + j * g, v]); }
  if (!kand.length) return [];
  kand.sort(obenBevorzugt ? (a, b) => (b[1] + b[2] * 0.3) - (a[1] + a[2] * 0.3) : (a, b) => b[2] - a[2]);
  const aus = [kand[0]];
  if (anzahl > 1) { let best = null; for (const k of kand) { const ab = Math.hypot(k[0] - aus[0][0], k[1] - aus[0][1]); if (ab > 25 && (!best || k[2] > best[2])) best = k; } if (best) aus.push(best); }
  return aus;
}
function _bubBuild(w, p, textFn, opt) {
  const M = w.Manifold, CS = w.CrossSection, tmp = [], k = x => { tmp.push(x); return x; };
  const fein = opt && opt.vorschau ? 70 : 150;
  try {
    const txt = String(p.text || '').replace(/\s+/g, ' ').trim(); if (!txt) return null;
    const off = p.hoehe * p.pummel / 100, hKern = p.hoehe - 2 * off;
    // Maßstab: Großbuchstabe „H“ soll hKern hoch sein
    const ref = textFn(CS, k, 'H', p.font, 50, 0, 0, 1e5); if (!ref || !ref.cs) return null;
    const rb = ref.cs.bounds(), s = hKern / (rb.max[1] - rb.min[1]);
    const wort = textFn(CS, k, txt, p.font, 50, 0, 0, 1e6); if (!wort || !wort.cs) return null;
    const ws = k(wort.cs.scale([s, s])), base = rb.min[1] * s;
    // Zusammenhängende Stücke → Buchstaben (Stücke, die sich in x überlappen: i-Punkt, Umlaute)
    const st = ws.decompose().map(q => { k(q); const b = q.bounds(); return { q, x0: b.min[0], x1: b.max[0] }; }).sort((a, b) => a.x0 - b.x0);
    const gruppen = [];
    for (const e of st) { const gL = gruppen[gruppen.length - 1]; if (gL && e.x0 < gL.x1 - 0.2 * Math.min(e.x1 - e.x0, gL.x1 - gL.x0)) { gL.teile.push(e.q); gL.x1 = Math.max(gL.x1, e.x1); } else gruppen.push({ teile: [e.q], x0: e.x0, x1: e.x1 }); }
    const g = p.hoehe / fein, T = p.dicke, out = [];
    let versatz = 0;
    for (let n = 0; n < gruppen.length; n++) {
      const gr = gruppen[n];
      let c = gr.teile.length > 1 ? k(CS.union(gr.teile)) : gr.teile[0];
      const rc = off * 0.25;                                              // aufweiten + Innenecken runden
      c = k(k(k(c.offset(off + rc, 'Round', 2, 24)).offset(-rc, 'Round', 2, 24)).translate([versatz, -base]));
      const cb = c.bounds();
      const L = _bubLetter(w, c, { dicke: T }, g); let mf = k(L.mf);
      const info = { ch: '', teile: 0, halter: 0 };
      if (p.halter === 'magnet' && !(opt && opt.vorschau)) {
        const r = p.magD / 2 + 0.15, tief = p.magH + 0.2;
        const pl = T >= tief + 1.5 ? _bubStellen(L.F, r + 2, cb.max[0] - cb.min[0] > p.hoehe * 0.95 ? 2 : 1, false) : [];
        for (const q of pl) mf = k(M.difference(mf, k(M.cylinder(tief + 0.01, r, r, 48).translate([q[0], q[1], -0.01]))));
        info.halter = pl.length;
      } else if (p.halter === 'loch' && !(opt && opt.vorschau)) {
        // Schlüsselloch: Eintritt Ø9, Schlitz 4,4 breit nach oben, Lippe 2,2 mm, darüber Kammer 9 breit bis 6 mm (Brücke oben)
        const pl = T >= 8 ? _bubStellen(L.F, 6.5, 1, true) : [];
        for (const [x, y] of pl) {
          const ein = k(M.cylinder(6.01, 4.6, 4.6, 40).translate([x, y - 4.5, -0.01]));
          const schl = k(k(M.cube([4.4, 9, 2.25])).translate([x - 2.2, y - 4.5, -0.01]));
          const kam = k(M.union(k(k(M.cube([9.2, 9, 3.8])).translate([x - 4.6, y - 4.5, 2.2])), k(M.cylinder(3.8, 4.6, 4.6, 40).translate([x, y + 4.5, 2.2]))));
          mf = k(M.difference(mf, k(M.union([ein, schl, kam]))));
        }
        info.halter = pl.length;
      }
      try { info.teile = mf.decompose().length; } catch (e) { info.teile = 1; }
      out.push({ mf: mf.translate([0, 0, 0]), info, breite: cb.max[0] - cb.min[0], x0: cb.min[0] });
      versatz += 2 * off + p.abstand;                                      // Abstand bleibt nach dem Aufweiten erhalten
    }
    // Zeichen zuordnen (ohne Leerzeichen, Reihenfolge wie im Text)
    const zeichen = [...txt.replace(/ /g, '')];
    out.forEach((o, i) => { o.info.ch = zeichen[i] || '?'; });
    return { teile: out, hoehe: p.hoehe, dicke: T };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}
