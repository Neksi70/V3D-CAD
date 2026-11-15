// Wedelkranz-Kern — Blätterkranz aus gefiederten Wedeln um ein Kerzenglas (nach Silkes Foto, 15.11.2026).
// Höhenfeld über Polarraster (mm, Y oben, Boden y = 0): jeder Wedel ist ein Bogen um die Mitte, der leicht nach außen
// läuft (Spirale), mit Mittelrippe und schräg abgehenden Fiederblättchen (Rillen dazwischen → Schatten im Druck).
// Wedel steigen zur Spitze leicht an → die Spitze liegt über dem Fuß des nächsten (überlappend, ohne Naht ringsum).
// Die höchste Stelle gewinnt; jede Säule ist voll → druckt flach ohne Stützen.
const WDK_DEF = { glasD: 80, spiel: 2, dia: 190, wedel: 12, lagen: 2, laenge: 82, breite: 36, dichte: 6, kruemm: 8, winkel: 40, hInnen: 30, hAussen: 9,
  relief: 2.2, boden: 0, bodenT: 2, seed: 7 };
function wdkRand(seed) { let s = (Math.floor(seed) * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function wdkMasse(p) {
  const rIn = p.glasD / 2 + p.spiel, rOut = p.dia / 2, ring = rOut - rIn;
  return { rIn, rOut, ring, ok: ring > 25 };
}
// Grundhöhe (Polster unter den Wedeln): innen hoch, außen flach
function wdkH0(p, d, rho) { const x = Math.min(1, Math.max(0, (rho - d.rIn) / d.ring)); return p.hAussen + (p.hInnen - p.hAussen) * Math.pow(1 - x, 1.25); }
function wdkWedel(p) {
  const d = wdkMasse(p), R = wdkRand(p.seed), L = [], n = Math.max(4, Math.round(p.wedel)), lagen = Math.max(1, Math.round(p.lagen));
  const T = (p.hInnen - p.hAussen) * 0.25 + 6 + p.relief;                   // Wedel-Wölbung über dem Polster
  for (let k = 0; k < lagen; k++) {                                       // Lagen: gegeneinander versetzt, obere etwas höher
    for (let i = 0; i < n; i++) {
      const lj = p.laenge * (0.88 + 0.24 * R()), wj = p.breite * (0.85 + 0.3 * R());
      const innen = lagen > 1 && k === lagen - 1;                          // oberste Lage schmiegt sich flacher ums Glas
      const beta = ((innen ? 0.45 : 1) * p.winkel + 10 * (R() - 0.5)) * Math.PI / 180;   // Winkel nach außen (0 = tangential, 90 = radial)
      const rs = d.rIn + (innen ? wj * 0.42 : 3 + wj * 0.2), re = Math.max(rs + 4, Math.min(d.rOut - wj * 0.45 - 1, rs + lj * Math.sin(beta)));
      const rm = (rs + re) / 2, dth = lj * Math.cos(beta) / rm;
      const th0 = 2 * Math.PI * (i + k / lagen + 0.3 * (R() - 0.5)) / n;
      const z0 = wdkH0(p, d, rm) * 0.55 - 1.5 + k * 1.5, rise = Math.min(4, T * 0.5);   // Fuß auf Polsterhöhe
      L.push({ th0, dth, rs, re, rm, rIn: d.rIn, L: Math.hypot(re - rs, dth * rm), W: wj / 2, bulge: p.kruemm * (0.7 + 0.6 * R()), z0, rise, T, k });
    }
  }
  return { d, L };
}
// Höhe eines Wedels an (rho, dphi) oder −Inf. Lokal: u = 0…1 längs (Fuß → Spitze), t quer zur Rippe.
function wdkWedelH(p, f, rho, dphi) {
  if (dphi < 0 || dphi > f.dth) return -Infinity;
  const u = dphi / f.dth, spine = f.rs + (f.re - f.rs) * u + f.bulge * Math.sin(Math.PI * u);
  const cosA = Math.cos(Math.atan2(f.re - f.rs, f.dth * f.rm)), t = (rho - spine) * cosA, at = Math.abs(t), s = u * f.L;   // quer zur schrägen Rippe
  const wf = f.W * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.97)), 0.6);   // Fuß schmal, Mitte breit, Spitze spitz
  if (wf <= 0.4) return -Infinity;
  const v = (s + at * 0.95) / p.dichte, fq = v - Math.floor(v);            // Fiederblättchen schräg zur Spitze (≈ 45°)
  const rand = wf * (0.72 + 0.28 * Math.sqrt(Math.sin(Math.PI * fq)));     // rund auslaufende Blättchen-Spitzen
  if (at > rand) return -Infinity;
  const q = at / rand, dome = Math.sqrt(1 - q * q);
  const blatt = Math.pow(Math.sin(Math.PI * fq), 0.6);                      // rund gewölbte Blättchen, Rille dazwischen
  const rippe = at < 1.4 ? (1 - at / 1.4) : 0;                              // Mittelrippe als Kerbe
  const glas = Math.min(1, (rho - f.rIn) / 5);                              // am Glas weich abfallen
  const auf = Math.sqrt(dome) * (0.65 + 0.35 * blatt);                     // Rand läuft flach aufs Polster aus, Blättchen gewölbt
  return (f.z0 + f.rise * u + f.T * auf - p.relief * (1 - blatt) * dome - p.relief * 0.5 * rippe) * (0.55 + 0.45 * Math.sin(Math.max(0, glas) * Math.PI / 2));
}
// Höhe an (rho, ph) – für Suppe und Bilder; akt = Wedel, die den Winkel ph überdecken ([f, dphi])
function wdkAktiv(L, ph) { const TAU = 2 * Math.PI, a = []; for (const f of L) { let dp = ph - f.th0; dp -= TAU * Math.floor(dp / TAU); if (dp <= f.dth) a.push([f, dp]); } return a; }
function wdkHoehe(p, d, akt, rho) {
  let h = wdkH0(p, d, rho) * 0.55 - 1;                                      // Polster in den Lücken, tiefer (Schatten zwischen den Wedeln)
  const xi = (rho - d.rIn) / 7; if (xi < 1) h *= 0.35 + 0.65 * Math.sin(xi * Math.PI / 2);   // zum Glas hin abrunden statt Wand
  const xa = (rho - d.rIn) / d.ring; if (xa > 0.9) h = Math.min(h, 1.2 + (h - 1.2) * (1 - xa) / 0.1);   // außen flach auslaufen
  for (const [f, dp] of akt) { const hw = wdkWedelH(p, f, rho, dp); if (hw > h) h = hw; }
  const xo = (d.rOut - rho) / 10; if (xo < 1) h = 1.2 + (h - 1.2) * Math.sin(Math.max(0, xo) * Math.PI / 2);   // außen flach auslaufen (keine Wand)
  return Math.max(0.8, h);
}
// Dreiecks-Suppe (x, y=Höhe, z) eines geschlossenen Rings: Oberseite Höhenfeld, Unterseite y = 0
function wdkSoup(p, fein) {
  const { d, L } = wdkWedel(p), step = fein ? 0.45 : 1.4;
  const nPhi = Math.max(240, Math.ceil(2 * Math.PI * d.rOut / step)), J = Math.max(24, Math.ceil(d.ring / (fein ? 0.4 : 1.2))), cols = J + 1;
  const P = new Float32Array(nPhi * cols * 3), TAU = 2 * Math.PI;
  for (let i = 0; i < nPhi; i++) {
    const ph = TAU * i / nPhi, cp = Math.cos(ph), sp = Math.sin(ph);
    const akt = wdkAktiv(L, ph);
    for (let j = 0; j <= J; j++) {
      const rho = d.rIn + d.ring * j / J, y = (j === 0 || j === J) ? 0 : wdkHoehe(p, d, akt, rho);
      const o = (i * cols + j) * 3; P[o] = rho * cp; P[o + 1] = y; P[o + 2] = rho * sp;
    }
  }
  const tris = new Float32Array((nPhi * J * 2 + nPhi * 2) * 9); let w = 0;
  const put = (i, j) => { const o = (i * cols + j) * 3; tris[w++] = P[o]; tris[w++] = P[o + 1]; tris[w++] = P[o + 2]; };
  for (let i = 0; i < nPhi; i++) {
    const i1 = (i + 1) % nPhi;
    for (let j = 0; j < J; j++) { put(i, j); put(i1, j); put(i1, j + 1); put(i, j); put(i1, j + 1); put(i, j + 1); }
    put(i, 0); put(i1, J); put(i1, 0); put(i, 0); put(i, J); put(i1, J);  // Unterseite
  }
  return { tris, d, nPhi, J };
}
// Suppe → Manifold (Punkte verschweißen); optional Boden in der Mitte (Glas steht darauf)
function wdkBuild(w, p, fein) {
  const M = w.Manifold, S = wdkSoup(p, fein), t = S.tris, idx = new Map(), V = [], T = new Uint32Array(t.length / 3);
  for (let k = 0; k < t.length / 3; k++) { const x = t[k * 3], y = t[k * 3 + 1], z = t[k * 3 + 2], key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
    let i = idx.get(key); if (i === undefined) { i = V.length / 3; idx.set(key, i); V.push(x, y, z); } T[k] = i; }
  const mesh = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(V), triVerts: T }); mesh.merge();
  let body = new M(mesh);
  if (p.boden) { const tmp = body, c = M.cylinder(p.bodenT, S.d.rIn + 1, S.d.rIn + 1, fein ? 128 : 48), cr = c.rotate([-90, 0, 0]); body = M.union([tmp, cr]); tmp.delete(); c.delete(); cr.delete(); }
  return { body, d: S.d };
}
if (typeof module !== 'undefined') module.exports = { WDK_DEF, wdkMasse, wdkWedel, wdkAktiv, wdkHoehe, wdkSoup, wdkBuild };
