// ═══ ADVENTSKALENDER-GENERATOR (🎁 _adv*) ═════════════════════════════════════
// Kern (Manifold, mm), 1:1 in volme3d.html eingebettet. Test in Node: tools/adventskalender/test_core.mjs
//
// Aufbau: Formen sind Module in _ADV_FORMEN. Eine neue Form (Haus, Rakete, Zug …) = ein neues
// Objekt { id, name, icon, params, build(w, p, textFn) } — Fenster, Vorschau, Bettprüfung,
// Druckanordnung und STL-Export sind formunabhängig.
// build liefert { teile, info }:
//   teile: [{ name, farbe, m, d, anz }]
//     m = Manifold in Gebrauchslage (mm, y oben, vorne +z, steht auf y = 0) oder null (nur Druckteil)
//     d = Manifold in Drucklage (mm, z oben, liegt auf z = 0)
//   info:  { zeilen: [Text …], warn: [Text …] }
// Gemeinsame Parameter (_ADV_GEMEIN) gelten für alle Formen, Form-Parameter stehen im Modul.
// textFn(CS, keep, txt, font, h, cx, yb, maxW) → { cs } (App: _lttText) — in Node null (ohne Zahlen).

const _ADV_GEMEIN = [
  { k: 'hoehe', l: 'Höhe', min: 250, max: 450, step: 5, def: 400, u: 'mm', t: 'Höhe des fertigen Kalenders' },
  { k: 'wand', l: 'Wand Fächer', min: 1.2, max: 2.4, step: 0.1, def: 1.5, u: 'mm', t: 'Wandstärke der Fächer (Schachteln)' },
  { k: 'spiel', l: 'Spiel Fach', min: 0.1, max: 0.6, step: 0.05, def: 0.3, u: 'mm', t: 'Luft je Seite zwischen Fach/Stöpsel und Rahmen' },
  { k: 'konus', l: 'Konus', min: 0, max: 3, step: 0.25, def: 1, u: '°', t: 'Fächer werden nach innen schmaler: leicht zu ziehen, fallen aber nicht von allein heraus' },
  { k: 'steck', l: 'Spiel Stecker', min: 0.05, max: 0.4, step: 0.05, def: 0.15, u: 'mm', t: 'Luft je Seite an den Steckstiften zwischen den Rahmenteilen' },
  { k: 'griff', l: 'Zahl-Griff', min: 3, max: 8, step: 0.5, def: 5, u: 'mm', t: 'So weit stehen die Zahlen als Griff vor' },
  { k: 'bett', l: 'Druckbett', min: 180, max: 350, step: 1, def: 256, u: 'mm', t: 'Bambu Lab P1S: 256 × 256 × 256' },
];
const _ADV_STIFT_D = 5;                                                    // Steckstift-Ø (gedruckt, stehend)

function _advRnd(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function _advNoise(seed){                                                  // glattes 2D-Wertrauschen (fbm), Werte 0…1
  const h = (i, j) => { let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2246822519)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const s = t => t * t * (3 - 2 * t);
  const v = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j), a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
  return (x, y, o = 3) => { let r = 0, A = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { r += A * v(x * f + k * 17.3, y * f - k * 9.1); n += A; A *= 0.5; f *= 2.03; } return r / n; };
}
function _advMischen(n, p){                                                // Tageszahlen 1…n auf die Plätze verteilen
  const a = Array.from({ length: n }, (_, i) => i + 1);
  if (p.mischen) { const r = _advRnd(p.seed || 1); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
  return a;
}
// Block mit ebener Unterseite z0 und Höhenfeld-Oberseite f(x, y) über [x0,x1]×[y0,y1]
function _advHF(w, x0, x1, y0, y1, z0, f, nx, ny){
  const P = [], T = [], N = (nx + 1) * (ny + 1);
  for (let b = 0; b < 2; b++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (x1 - x0) * i / nx, y = y0 + (y1 - y0) * j / ny; P.push(x, y, b ? z0 : Math.max(z0 + 0.05, f(x, y))); }
  const id = (i, j, b) => (b ? N : 0) + j * (nx + 1) + i;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = id(i, j, 0), bb = id(i + 1, j, 0), c = id(i + 1, j + 1, 0), d = id(i, j + 1, 0);
    T.push(a, bb, c, a, c, d);
    const A = id(i, j, 1), B = id(i + 1, j, 1), C = id(i + 1, j + 1, 1), D = id(i, j + 1, 1);
    T.push(A, C, B, A, D, C);
  }
  for (let i = 0; i < nx; i++) {
    let A = id(i, 0, 1), B = id(i + 1, 0, 1), a = id(i, 0, 0), b = id(i + 1, 0, 0); T.push(A, B, b, A, b, a);
    A = id(i, ny, 1); B = id(i + 1, ny, 1); a = id(i, ny, 0); b = id(i + 1, ny, 0); T.push(A, a, b, A, b, B);
  }
  for (let j = 0; j < ny; j++) {
    let A = id(0, j, 1), B = id(0, j + 1, 1), a = id(0, j, 0), b = id(0, j + 1, 0); T.push(A, a, b, A, b, B);
    A = id(nx, j, 1); B = id(nx, j + 1, 1); a = id(nx, j, 0); b = id(nx, j + 1, 0); T.push(A, B, b, A, b, a);
  }
  const mesh = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(P), triVerts: new Uint32Array(T) }); mesh.merge();
  return new w.Manifold(mesh);
}
// Zahl als CrossSection, um (cx, cy) zentriert; null ohne Schrift
function _advZahl(w, textFn, keep, n, h, maxW, cx, cy){
  if (!textFn) return null;
  const r = textFn(w.CrossSection, keep, String(n), 'baloo_local', h, 0, 0, maxW);
  if (!r || !r.cs) return null;
  const b = r.cs.bounds();
  return keep(r.cs.translate([cx - (b.min[0] + b.max[0]) / 2, cy - (b.min[1] + b.max[1]) / 2]));
}
// Steckstifte: n Zylinder stehend im Raster (Drucklage), ein Teil
function _advStifte(w, n, L){
  const M = w.Manifold, cols = Math.ceil(Math.sqrt(n)), a = [];
  for (let i = 0; i < n; i++) a.push(M.cylinder(L, _ADV_STIFT_D / 2, _ADV_STIFT_D / 2 - 0.3, 24).translate([(i % cols) * 10, Math.floor(i / cols) * 10, 0]));
  const u = M.union(a); a.forEach(x => x.delete());
  return u;
}
function _advSauber(w, m){                                               // Splitter (< 1 mm³) entfernen
  const ps = m.decompose(); if (ps.length < 2) { ps.forEach(x => x.delete()); return m; }
  const u = w.Manifold.union(ps.filter(x => x.volume() > 1)); ps.forEach(x => x.delete()); m.delete(); return u;
}
function _advGramm(m){                                                    // Filament: 3 Wandlinien (1,2 mm) + 15 % Füllung, PLA
  const V = m.volume(), A = m.surfaceArea ? m.surfaceArea() : 0, sh = Math.min(V, A / 2 * 1.2);
  return (sh + 0.15 * (V - sh)) / 1000 * 1.24;
}
function _advBox(m){ const b = m.boundingBox(); return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]; }
const _v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; },
};

// ─── Form 1: Fußball (abgestumpftes Ikosaeder) ────────────────────────────────
// 12 Fünfecke + 20 Sechsecke. 24 Flächen sind Stöpsel (Deckel mit Kragen, Zahl als Griff),
// dahinter ein keilförmiges Fach zur Mitte (Tortenstück, begrenzt durch die Radialebenen
// durch die Kanten – Wände je 1 Wand-Stärke). Die 8 Sechsecke auf den Raumdiagonalen sind
// fest: je eins pro Achtel, eins davon ist die Standfläche. Geteilt wird an den Koordinaten-
// ebenen (Spiegelebenen des Balls): 2 Halbkugeln, wenn sie aufs Bett passen, sonst 8 Achtel.
// Verbunden über Flanschringe innen mit Steckstiften.
function _advTI(){
  const f = (1 + Math.sqrt(5)) / 2, V = [], seen = new Set();
  const cyc = (b, c) => [b[c % 3], b[(c + 1) % 3], b[(c + 2) % 3]];
  for (const b of [[0, 1, 3 * f], [1, 2 + f, 2 * f], [f, 2, f * f * f]])
    for (let c = 0; c < 3; c++) for (let s = 0; s < 8; s++) {
      const q = cyc(b, c).map((x, i) => (s >> i) & 1 ? -x : x), k = q.map(x => (x + 0).toFixed(4)).join();
      if (!seen.has(k)) { seen.add(k); V.push(q); }
    }
  const N = [];
  for (let c = 0; c < 3; c++) for (let s = 0; s < 4; s++) N.push({ n: cyc([0, s & 1 ? -1 : 1, s & 2 ? -f : f], c), k: 5 });
  for (let s = 0; s < 8; s++) N.push({ n: [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1], k: 6, diag: true });
  for (let c = 0; c < 3; c++) for (let s = 0; s < 4; s++) N.push({ n: cyc([0, s & 1 ? -f : f, s & 2 ? -1 / f : 1 / f], c), k: 6 });
  return { V, N, R: Math.hypot(1, 3 * f) };
}
function _advBallGeo(p){
  const ti = _advTI(), Rv = p.hoehe / 2 / 0.9149, s = Rv / ti.R;                // hoehe = Abstand gegenüberliegender Sechsecke
  const V = ti.V.map(q => _v.mul(q, s)), up = _v.norm([1, 1, 1]);
  const faces = ti.N.map(({ n: n0, k, diag }) => {
    const n = _v.norm(n0); let rf = -1e9; for (const q of V) rf = Math.max(rf, _v.dot(q, n));
    const vs = V.filter(q => Math.abs(_v.dot(q, n) - rf) < 1e-6 * Rv);
    let ref = _v.sub(up, _v.mul(n, _v.dot(up, n))); if (Math.hypot(...ref) < 1e-6) ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const vv = _v.norm(_v.sub(ref, _v.mul(n, _v.dot(ref, n)))), u = _v.cross(vv, n), c = _v.mul(n, rf);
    const loc = vs.map(q => { const d = _v.sub(q, c); return [_v.dot(d, u), _v.dot(d, vv)]; }).sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
    const rv = Math.hypot(...loc[0]), rho = rv * Math.cos(Math.PI / k);
    return { n, k, diag: !!diag, rf, c, u, v: vv, loc, rv, rho, ok: vs.length === k };
  });
  return { V, faces, Rv };
}
function _advBallBuild(w, p, textFn){
  const M = w.Manifold, CS = w.CrossSection, tmp = [], keep = x => { tmp.push(x); return x; };
  const warn = [], zeilen = [];
  try {
    const { V, faces, Rv } = _advBallGeo(p);
    if (faces.some(f => !f.ok)) throw new Error('Ball-Geometrie fehlerhaft');
    const wall = p.wand, sp = p.spiel, tp = p.deckel, kr = p.kragen, tk = Math.tan(p.konus * Math.PI / 180), tFix = 3;
    // Rand-Einzug der Keilfächer: Radialebene durch die Kante, um wall/2 nach innen versetzt
    const rhoC = (f, z) => f.rho * (f.rf - z) / f.rf - wall / 2 * Math.sqrt(1 + (f.rho / f.rf) ** 2);
    const ring = (f, z, r) => f.loc.map(([a, b]) => _v.add(_v.mul(f.n, f.rf - z), _v.add(_v.mul(f.u, a * r / f.rho), _v.mul(f.v, b * r / f.rho))));
    const ringL = (f, z, r) => f.loc.map(([a, b]) => [a * r / f.rho, b * r / f.rho, -z]);         // lokal: Deckel-Rahmen, außen = +z
    const hullW = (f, z1, r1, z2, r2) => keep(M.hull([...ring(f, z1, r1), ...ring(f, z2, r2)]));
    const hullL = (f, z1, r1, z2, r2) => keep(M.hull([...ringL(f, z1, r1), ...ringL(f, z2, r2)]));
    // Stöpsel: 12 Fünfecke + 12 Sechsecke; fest: 8 Diagonal-Sechsecke
    const plugs = faces.filter(f => !f.diag), up = _v.norm([1, 1, 1]);
    const f24 = plugs.filter(f => f.k === 6).sort((a, b) => _v.dot(b.n, _v.norm([1, 1, -0.2])) - _v.dot(a.n, _v.norm([1, 1, -0.2])))[0];
    const zahlen = _advMischen(23, p); let zi = 0;
    for (const f of plugs) f.tag = f === f24 ? 24 : zahlen[zi++];
    const T = p.tiefe + wall, T24 = Math.min(p.tiefe * 1.3, p.tiefe + 25) + wall;   // Schalendicke; Fach 24 tiefer
    for (const f of plugs) { f.tiefe = f === f24 ? T24 - wall : p.tiefe; f.seatB = rhoC(f, tp + kr); f.seatT = f.seatB + kr * tk; }
    const depthMax = Math.max(T, T24);
    // ── Körper ─────────────────────────────────────────────────────────────
    const poly = keep(M.hull(V));
    const innen = d => { let m = M.cube([4 * Rv, 4 * Rv, 4 * Rv], true); for (const f of faces) { const m2 = m.trimByPlane(_v.mul(f.n, -1), -(f.rf - d(f))); m.delete(); m = m2; } return keep(m); };
    const inner = innen(f => f === f24 ? T24 : T);
    let body = keep(poly.subtract(inner));
    const loecher = [];
    for (const f of plugs) {
      loecher.push(hullW(f, -2, rhoC(f, -2), tp, rhoC(f, tp)));                                   // Sitz der Deckelplatte
      loecher.push(hullW(f, tp - 0.01, f.seatT, tp + kr, f.seatB));                               // Kragenführung (Konus)
      loecher.push(hullW(f, tp + kr - 0.01, rhoC(f, tp + kr), f.tiefe, rhoC(f, f.tiefe)));        // Keilfach
    }
    for (const f of faces.filter(f => f.diag)) loecher.push(hullW(f, tFix, rhoC(f, tFix), depthMax + 5, rhoC(f, depthMax + 5)));   // feste Fläche: nur Haut
    const loch = keep(M.union(loecher));
    body = keep(body.subtract(loch));
    // Polster (Wölbung) auf den festen Flächen wie auf den Deckeln
    const polster = (f, r0, z0) => {                                      // lokal, Platte bei z = 0
      const rv = f.rv * r0 / f.rho, wv = p.wolb, n = 24;
      const hf = keep(_advHF(w, -rv, rv, -rv, rv, z0, (x, y) => wv * Math.max(0, 1 - (x * x + y * y) / (rv * rv)) + 0.02, n, n));
      const pr = keep(M.extrude(keep(new CS([ringL(f, 0, r0).map(q => [q[0], q[1]])])), wv + 2).translate([0, 0, z0 - 0.5]));
      return keep(hf.intersect(pr));
    };
    const matL = f => [f.u[0], f.u[1], f.u[2], 0, f.v[0], f.v[1], f.v[2], 0, f.n[0], f.n[1], f.n[2], 0, f.c[0], f.c[1], f.c[2], 1];
    const fBoden = faces.find(f => f.diag && _v.dot(f.n, up) < -0.99);
    if (p.wolb > 0) for (const f of faces.filter(f => f.diag && f !== fBoden)) body = keep(body.add(keep(polster(f, rhoC(f, 0) - sp, -0.5).transform(matL(f)))));
    // ── Flansche an den Schnittebenen + Steckstift-Löcher ──────────────────
    const achtel = 2 * Rv * 0.98 > p.bett - 4;
    if (Rv * 0.98 > p.bett - 4) warn.push('Ball zu groß: auch die Achtel passen nicht aufs Bett.');
    const ebenen = achtel ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[0, 0, 1]];
    const fw = 15, fd = 8, hl = fd - 1.5, dh = _ADV_STIFT_D + 2 * p.steck, tiefeF = f => f === f24 ? T24 : T;
    const innerGrow = innen(f => tiefeF(f) - 3);
    const rInnen = d => { let r = 1e9; for (const f of faces) { const c = _v.dot(f.n, d); if (c > 1e-6) r = Math.min(r, (f.rf - tiefeF(f)) / c); } return r; };   // Abstand Mitte → Innenfläche
    const fl = [], st = [];
    for (const e of ebenen) {                                              // Steckblöcke innen an den Fachböden, je Stift einer
      const ax = e[0] ? [0, 90, 0] : e[1] ? [90, 0, 0] : [0, 0, 0];
      const a = e[0] ? [0, 1, 0] : [1, 0, 0], b = e[2] ? [0, 1, 0] : [0, 0, 1];
      const winkel = achtel ? [20, 70, 110, 160, 200, 250, 290, 340] : [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5];
      for (const g of winkel) { const t = g * Math.PI / 180, d = _v.add(_v.mul(a, Math.cos(t)), _v.mul(b, Math.sin(t))), q = _v.mul(d, rInnen(d) - fw / 2 + 1), tg = _v.cross(e, d), ri = rInnen(d);
        const blk = keep(M.cube([16, fw + 4, 2 * fd], true).translate([0, -(fw + 4) / 2 + 3, 0]));   // radial von ri−fw bis ri+3
        fl.push(keep(blk.transform([tg[0], tg[1], tg[2], 0, d[0], d[1], d[2], 0, e[0], e[1], e[2], 0, d[0] * ri, d[1] * ri, d[2] * ri, 1]).intersect(innerGrow)));
        st.push(keep(M.cylinder(2 * hl, dh / 2, dh / 2, 24, true).rotate(ax).translate(q))); }
    }
    body = keep(keep(body.add(keep(keep(M.union(fl)).subtract(loch)))).subtract(keep(M.union(st))));
    // ── Teile ──────────────────────────────────────────────────────────────
    // Gebrauchslage: Diagonale (1,1,1) nach oben (y), festes Sechseck (−1,−1,−1) als Standfläche
    const yA = up, zA0 = _v.norm(_v.cross([1, 0, 0], yA)), xA = _v.cross(yA, zA0), zA = _v.cross(xA, yA);
    const ans0 = [xA[0], yA[0], zA[0], 0, xA[1], yA[1], zA[1], 0, xA[2], yA[2], zA[2], 0, 0, 0, 0, 1];   // Welt → Ansicht (Zeilen = Achsen)
    const yBoden = fBoden.rf;
    const ans = m => m.transform(ans0).translate([0, yBoden, 0]);
    const teile = [];
    const sig = achtel ? [[1, 1, 1], [-1, 1, 1], [-1, -1, 1], [1, -1, 1], [1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]] : [[0, 0, 1], [0, 0, -1]];
    sig.forEach((sg, i) => {
      let m = body.translate([0, 0, 0]);
      for (let k = 0; k < 3; k++) if (sg[k]) { const e = [0, 0, 0]; e[k] = sg[k]; const m2 = m.trimByPlane(e, 0); m.delete(); m = m2; }
      const druck = sg[2] < 0 ? m.rotate([180, 0, 0]) : m.translate([0, 0, 0]);
      teile.push({ name: achtel ? `Ball-Achtel ${i + 1}` : (sg[2] > 0 ? 'Ball oben' : 'Ball unten'), farbe: '#f2f2f0', m: ans(m), d: druck, art: 'rahmen' });
      m.delete();
    });
    // Deckel (Stöpsel) im lokalen Rahmen: außen = +z, Platte z ∈ [−tp, 0], Kragen darunter
    const kw = 1.6;
    for (const f of plugs) {
      const pl = hullL(f, 0, rhoC(f, 0) - sp, tp, rhoC(f, tp) - sp);
      const ko = hullL(f, tp - 0.01, f.seatT - sp, tp + kr, f.seatB - sp);
      const kiVoll = hullL(f, tp - 0.02, f.seatT - sp - kw, tp + kr + 1, f.seatB - sp - kw - tk);
      const rip = [];
      for (let x = -f.rho + 22; x < f.rho - 10; x += 24) rip.push(keep(M.cube([1.2, 2 * f.rv, kr + 0.5]).translate([x - 0.6, -f.rv, -(tp + kr)])));
      let lid = keep(keep(pl.add(ko)).subtract(kiVoll));
      if (rip.length) lid = keep(lid.add(keep(keep(M.union(rip)).intersect(kiVoll))));
      if (p.wolb > 0) lid = keep(lid.add(polster(f, rhoC(f, 0) - sp, -0.5)));
      const th = Math.min(f.rho * 0.95, 46), zs = _advZahl(w, textFn, keep, f.tag, th, f.rho * 1.3, 0, 0);
      if (zs) lid = keep(lid.add(keep(M.extrude(zs, p.wolb + p.griff).translate([0, 0, -0.5]))));
      lid = _advSauber(w, lid.translate([0, 0, 0])); tmp.push(lid);
      const druck = lid.translate([0, 0, tp + kr]);
      const name = `Stöpsel ${String(f.tag).padStart(2, '0')}` + (f.k === 5 ? ' (Fünfeck)' : ' (Sechseck)');
      teile.push({ name, farbe: f.k === 5 ? '#26262a' : '#f7f7f5', m: ans(lid.transform(matL(f))), d: druck, art: 'fach', tag: f.tag });
    }
    const nStift = ebenen.length * 8, L = 2 * hl - 1;
    teile.push({ name: `Steckstifte ${nStift}×`, farbe: '#bdbdbd', m: null, d: _advStifte(w, nStift, L), art: 'stift' });
    // ── Info ───────────────────────────────────────────────────────────────
    const f5 = plugs.find(f => f.k === 5), f6 = plugs.find(f => f.k === 6 && f !== f24);
    const offen = f => Math.round(2 * (f.seatB - sp - kw)), unten = f => Math.round(2 * rhoC(f, f.tiefe));
    zeilen.push(`Ball ${Math.round(p.hoehe)} mm hoch (Ecke zu Ecke ${Math.round(2 * Rv)} mm), ${achtel ? '8 Achtel' : '2 Halbkugeln'} + 24 Stöpsel.`);
    zeilen.push(`Fächer: Fünfeck Öffnung ≈ ${offen(f5)} mm, Sechseck ≈ ${offen(f6)} mm, Tiefe ${Math.round(p.tiefe + tp)} mm (innen auf ≈ ${unten(f5)}/${unten(f6)} mm verjüngt). Fach 24 ist ein Sechseck, ${Math.round(T24 - wall + tp)} mm tief.`);
    if (offen(f5) < 40) warn.push('Fünfeck-Fächer sind sehr klein (< 40 mm) – Ball größer oder Fachtiefe kleiner wählen.');
    return { teile, info: { zeilen, warn, stifte: nStift, stiftL: L } };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}

// ─── Form 2: Berg ─────────────────────────────────────────────────────────────
// Rahmen mit Schubladen in Reihen (unten breit, oben schmal), jede Schublade trägt vorn ihr
// Stück Landschaft (Wiese → Fels mit Vorsprüngen → Schnee). Fach 24 ist der Gipfel: das
// Gipfelstück sitzt auf dem Rahmendach und kommt mit der Schublade heraus, Gipfelkreuz
// gesteckt. Rahmen in 2–3 Segmenten (automatisch nach Bettgröße), Steckstifte in den Flanken.
// Gedruckt wird alles auf dem Rücken liegend (Vorderseite oben) → ohne Stützen.
function _advBergMasse(p){
  const t = p.wand, sp = p.spiel, rw = 2, tp = 3, rb = 3, base = 3, g = 0.6, k = Math.tan(p.konus * Math.PI / 180);
  const warn = [];
  let reihen = String(p.reihen || '').split(/[^0-9]+/).map(Number).filter(n => n > 0);
  if (reihen.reduce((a, b) => a + b, 0) !== 23) { warn.push(`Reihen „${p.reihen}“ ergeben nicht 23 Fächer (+ Gipfel) – Standard 4,4,4,3,3,3,2 verwendet.`); reihen = [4, 4, 4, 3, 3, 3, 2]; }
  const R = reihen.length, Bo = p.fachB + 2 * t, cw = Bo + 2 * sp, Do = p.fachT + t, Dr = Do + sp + rb;
  const Bs = p.fachB * p.gipfel / 100, cws = Bs + 2 * t + 2 * sp;
  const hrel = i => R > 1 ? p.hU + (p.hO - p.hU) * i / (R - 1) : p.hU, hsRel = Math.max(p.hU, p.hO) * 1.05;
  const peakH = 0.11 * p.hoehe, kreuzH = p.kreuz ? 0.085 * p.hoehe : 0;
  const lay = nCuts => {
    const fest = base + R * (t + 2 * sp + rw) + (t + 2 * sp) + rw + nCuts * (rw + 2) + sp + peakH + kreuzH;
    let f = (p.hoehe - fest) / (reihen.reduce((a, _, i) => a + hrel(i), 0) + hsRel);
    const hs = reihen.map((_, i) => Math.max(30, hrel(i) * f)), hS = Math.max(36, hsRel * f);
    return { hs, hS, f };
  };
  const bau = (cutsAfter) => {
    const L = lay(cutsAfter.length), rows = []; let y = base;
    reihen.forEach((n, i) => { const ch = L.hs[i] + t + 2 * sp; rows.push({ n, i, y0: y, ch, h: L.hs[i], cw, req: (n * cw + (n + 1) * rw) / 2 }); y += ch;
      if (cutsAfter.includes(i)) { rows[i].cut = y + rw + 1; y += 2 * rw + 2; } else y += rw; });
    const S = { n: 1, i: R, y0: y, ch: L.hS + t + 2 * sp, h: L.hS, cw: cws, req: (cws + 2 * rw) / 2, gipfel: true };
    rows.push(S); y += S.ch + rw;
    return { rows, yTop: y, f: L.f };
  };
  // Segmente: so wenige wie möglich (mind. 2), Schnitt an den Reihengrenzen, ausgeglichen
  let L0 = bau([]), nSeg = Math.max(2, Math.ceil(L0.yTop / (p.bett - 8))), cuts = [], L1;
  for (let it = 0; it < 3; it++) {
    const yT = (L1 || L0).yTop, rows = (L1 || L0).rows; cuts = [];
    for (let s = 1; s < nSeg; s++) { const ziel = s * yT / nSeg; let best = -1, bd = 1e9;
      for (let i = 0; i < R; i++) { const yb = rows[i].y0 + rows[i].ch; if (!cuts.includes(i) && Math.abs(yb - ziel) < bd) { bd = Math.abs(yb - ziel); best = i; } }
      if (best >= 0) cuts.push(best); }
    cuts.sort((a, b) => a - b); L1 = bau(cuts);
  }
  const { rows, yTop } = L1;
  const segs = []; let ya = 0;
  for (const r of rows) if (r.cut) { segs.push([ya, r.cut]); ya = r.cut; }
  segs.push([ya, yTop]);
  return { t, sp, rw, tp, rb, g, k, R, reihen, Bo, cw, Do, Dr, Bs, cws, rows, yTop, peakH, kreuzH, segs, warn };
}
function _advBergBuild(w, p, textFn){
  const M = w.Manifold, CS = w.CrossSection, tmp = [], keep = x => { tmp.push(x); return x; };
  try {
    const m = _advBergMasse(p), { t, sp, rw, tp, g, k, Do, Dr, rows, yTop, peakH, kreuzH } = m, warn = m.warn.slice(), zeilen = [];
    const nz = _advNoise((p.seed || 1) * 7 + 3), rnd = _advRnd((p.seed || 1) * 13 + 5);
    const yApex = yTop + sp + peakH, rel = p.relief;
    // ── Silhouette: Flanken mit Felsvorsprüngen, links/rechts verschieden ──────
    const slope = 0.32;
    const E = y => { let e = 0; for (const r of rows) if (y >= r.y0 - 2 * rw) e = Math.max(e, r.req + p.rand - slope * Math.max(0, y - (r.y0 + r.ch + rw))); return e; };
    const vor = [0, 1].map(s => { const a = []; for (let i = 0; i < 3; i++) a.push({ y: yTop * (0.25 + 0.6 * rnd()), h: 6 + 8 * rnd(), b: 10 + 12 * rnd() }); return a; });
    const tri = (y, s) => p.breite / 2 * (s ? 1.04 : 0.95) * Math.pow(Math.max(0, 1 - y / yApex), 0.62);   // konkave Bergflanke
    const c = (p.bett - 6) / 2;                                            // Kern bis ±c (bettbreit), außen Flanken-Teile
    const Sx0 = (y, s) => { let v = Math.max(E(y), tri(y, s)) + p.rand * 0.45 * nz(y / 34 + s * 40, s * 3.1);
      for (const q of vor[s]) { const d = (y - q.y) / q.b; if (d > -1 && d < 1.6) v += q.h * (d < 0 ? 1 + d : Math.max(0, 1 - d / 1.6)); }   // Felsnase: oben flach, unten schräg
      return v; };
    const yEnd = [0, 1].map(s => { for (let y = 0; y <= yTop; y += 1) if (Sx0(y, s) <= c) return y; return yTop; });   // Flanke = ein Stück
    const Sx = (y, s) => y > yEnd[s] ? Math.min(Sx0(y, s), c - 0.5) : Sx0(y, s);
    const silPts = [], dy = 3;
    for (let y = 0; y <= yTop + 1e-6; y += dy) silPts.push([Sx(Math.min(y, yTop), 1), Math.min(y, yTop)]);
    if (silPts[silPts.length - 1][1] < yTop) silPts.push([Sx(yTop, 1), yTop]);
    for (let i = silPts.length - 1; i >= 0; i--) silPts.push([-Sx(silPts[i][1], 0), silPts[i][1]]);
    const breite = Math.max(...silPts.map(q => q[0])) - Math.min(...silPts.map(q => q[0]));
    const reqMax = Math.max(...rows.map(r => r.req));
    if (reqMax + 10 > c) warn.push(`Die Fächer brauchen ${Math.round(2 * reqMax + 20)} mm Breite – mehr als das Bett (${p.bett}). Fachbreite oder Fächer je Reihe verkleinern.`);
    const sil = keep(new CS([silPts]));
    // Gipfel (Teil von Fach 24): sitzt auf dem Dach, Spitze leicht versetzt, oben Plateau fürs Kreuz
    const xA = (rnd() - 0.5) * 0.15 * (Sx(yTop, 0) + Sx(yTop, 1)), plat = 5, pk = [];
    const nP = 24, wL = Sx(yTop, 0), wR = Sx(yTop, 1), y0p = yTop + sp;
    for (let i = 0; i <= nP; i++) { const q = i / nP, y = y0p + q * peakH; pk.push([xA + plat + (wR - xA - plat) * Math.pow(1 - q, 0.85) + 3 * (nz(q * 5, 9) - 0.5) * (1 - q), y]); }
    for (let i = nP; i >= 0; i--) { const q = i / nP, y = y0p + q * peakH; pk.push([xA - plat - (wL + xA - plat) * Math.pow(1 - q, 0.85) - 3 * (nz(q * 5, 11) - 0.5) * (1 - q), y]); }
    const peakCS = keep(new CS([pk]));
    // ── Landschaft (Relief vorn): Wiese → Fels mit Stufen → Schnee ───────────
    const Hges = yApex, zone = (x, y) => y / Hges + 0.07 * (nz(x / 45, y / 300 + 5) - 0.5);
    const Rf = (x, y) => {
      const t0 = zone(x, y), wiese = 0.22 + 0.4 * nz(x / 20, y / 20), rid = 1 - Math.abs(2 * nz(x / 26, y / 16, 4) - 1),
        stufe = ((y / 26 + 0.8 * nz(x / 55, 3)) % 1 + 1) % 1, fels = 0.25 + 0.5 * rid + 0.25 * stufe, schnee = 0.6 + 0.25 * nz(x / 40, y / 40);
      const sm = (a, b, q) => q <= a ? 0 : q >= b ? 1 : (q - a) / (b - a);
      const a1 = sm(0.3, 0.36, t0), a2 = sm(0.68, 0.74, t0);
      return rel * (wiese * (1 - a1) + (fels * (1 - a2) + schnee * a2) * a1);
    };
    const farbe = (x, y) => { const q = zone(x, y); return q < 0.33 ? '#5f9a3a' : q < 0.71 ? '#8f8a84' : '#f2f4f7'; };
    // Fächer anordnen
    const zahlen = _advMischen(23, p); let zi = 0;
    const faecher = [];
    for (const r of rows) for (let j = 0; j < r.n; j++) {
      const xc = (j - (r.n - 1) / 2) * (r.cw + rw);
      faecher.push({ r, xc, tag: r.gipfel ? 24 : zahlen[zi++],
        tile: [xc - r.cw / 2 - rw / 2 + g / 2, xc + r.cw / 2 + rw / 2 - g / 2, r.y0 - rw / 2 + g / 2, r.gipfel ? y0p + 0.5 : r.y0 + r.ch + rw / 2 - g / 2] });
    }
    // ── Rahmen ─────────────────────────────────────────────────────────────
    let rahmen = keep(M.extrude(sil, Dr).translate([0, 0, -Dr]));
    const hohl = faecher.map(({ r, xc }) => { const d = Do + sp + 1, s = d * k;
      return keep(M.hull([[xc - r.cw / 2, r.y0, 1], [xc + r.cw / 2, r.y0, 1], [xc - r.cw / 2, r.y0 + r.ch, 1], [xc + r.cw / 2, r.y0 + r.ch, 1],
        [xc - r.cw / 2 + s, r.y0, -(Do + sp)], [xc + r.cw / 2 - s, r.y0, -(Do + sp)], [xc - r.cw / 2 + s, r.y0 + r.ch - s, -(Do + sp)], [xc + r.cw / 2 - s, r.y0 + r.ch - s, -(Do + sp)]])); });
    rahmen = keep(rahmen.subtract(keep(M.union(hohl))));
    if (rel > 0 || tp > 0) {                                              // Flanken vorn mit Landschaft (bündig mit den Schubladen)
      const xs = silPts.map(q => q[0]), x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1;
      const hf = keep(_advHF(w, x0, x1, -1, yTop + 1, -0.5, (x, y) => tp + Rf(x, y), Math.ceil((x1 - x0) / 2), Math.ceil((yTop + 2) / 2)));
      const pr = keep(M.extrude(sil, tp + rel + 2).translate([0, 0, -0.5]));
      const frei = keep(M.union(faecher.map(({ tile }) => keep(M.cube([tile[1] - tile[0] + 2 * g, tile[3] - tile[2] + 2 * g, tp + rel + 6]).translate([tile[0] - g, tile[2] - g, -1])))));
      rahmen = keep(rahmen.add(keep(keep(hf.intersect(pr)).subtract(frei))));
    }
    // Segmente + Steckstift-Löcher in den Flanken
    const dh = _ADV_STIFT_D + 2 * p.steck, hd = 9, stifte = [];
    for (const r of rows) if (r.cut) {
      const r2 = rows[r.i + 1], gh = Math.max(r.req, r2.req) - rw, flL = Sx(r.cut, 0) - gh, flR = Sx(r.cut, 1) - gh;
      if (Math.min(flL, flR) < dh + 4) warn.push(`Flanke an Schnitt ${stifte.length / 4 + 1} nur ${Math.round(Math.min(flL, flR))} mm breit – „Rand“ vergrößern.`);
      for (const [xx, fl] of [[-(gh + flL / 2), flL], [gh + flR / 2, flR]]) for (const zz of [-Dr * 0.3, -Dr * 0.72])
        stifte.push(keep(M.cylinder(2 * hd, dh / 2, dh / 2, 24, true).rotate([90, 0, 0]).translate([xx, r.cut, zz])));
    }
    const nSeg = stifte.length;
    for (const sd of [0, 1]) {
      let yF = 0; for (let y = 0; y <= yTop; y += 2) if (Sx(y, sd) > c + hd + 4) yF = y;
      for (let y = 18; y < yF - 10; y += 55) {
        if (rows.some(r => r.cut && Math.abs(r.cut - y) < 12)) y += 14;
        stifte.push(keep(M.cylinder(2 * hd, dh / 2, dh / 2, 24, true).rotate([0, 90, 0]).translate([sd ? c : -c, y, -Dr / 2])));
      }
    }
    if (stifte.length) rahmen = keep(rahmen.subtract(keep(M.union(stifte))));
    const kern = keep(keep(rahmen.trimByPlane([1, 0, 0], -c)).trimByPlane([-1, 0, 0], -c)), flanken = [];
    for (const [nrm, nm] of [[[-1, 0, 0], 'links'], [[1, 0, 0], 'rechts']]) {
      const fl = _advSauber(w, rahmen.trimByPlane(nrm, c)); tmp.push(fl);
      if (fl.volume() > 1000) flanken.push([fl, nm]);
    }
    const teile = [];
    m.segs.forEach(([ya, yb], i) => {
      let s = kern.translate([0, 0, 0]);
      if (ya > 0) { const s2 = s.trimByPlane([0, 1, 0], ya); s.delete(); s = s2; }
      if (yb < yTop) { const s2 = s.trimByPlane([0, -1, 0], -yb); s.delete(); s = s2; }
      const nm = m.segs.length === 1 ? 'Berg-Rahmen' : `Berg-Rahmen ${['unten', 'Mitte', 'oben'][m.segs.length === 2 && i === 1 ? 2 : i] || i + 1}`;
      teile.push({ name: nm, farbe: '#7d766e', m: s.translate([0, 0, 0]), d: s.translate([0, -ya, Dr]), art: 'rahmen' });
      s.delete();
    });
    // ── Schubladen ─────────────────────────────────────────────────────────
    for (const fa of faecher) {
      const { r, xc, tile, tag } = fa, Bo = r.gipfel ? m.Bs + 2 * t : m.Bo, Ho = r.h + t, yb = r.y0 + sp, s = Do * k, si = (Do - t) * k;
      const box = keep(M.hull([[xc - Bo / 2, yb, 0], [xc + Bo / 2, yb, 0], [xc - Bo / 2, yb + Ho, 0], [xc + Bo / 2, yb + Ho, 0],
        [xc - Bo / 2 + s, yb, -Do], [xc + Bo / 2 - s, yb, -Do], [xc - Bo / 2 + s, yb + Ho - s, -Do], [xc + Bo / 2 - s, yb + Ho - s, -Do]]));
      const inn = keep(M.hull([[xc - Bo / 2 + t, yb + t, 0.01], [xc + Bo / 2 - t, yb + t, 0.01], [xc - Bo / 2 + t, yb + Ho + 2, 0.01], [xc + Bo / 2 - t, yb + Ho + 2, 0.01],
        [xc - Bo / 2 + t + si, yb + t, -(Do - t)], [xc + Bo / 2 - t - si, yb + t, -(Do - t)], [xc - Bo / 2 + t + si, yb + Ho + 2, -(Do - t)], [xc + Bo / 2 - t - si, yb + Ho + 2, -(Do - t)]]));
      let sch = keep(box.subtract(inn));
      const [x0, x1, y0, y1] = tile;
      let front = keep(_advHF(w, x0, x1, y0, y1, 0, (x, y) => tp + Rf(x, y), Math.max(4, Math.ceil((x1 - x0) / 1.5)), Math.max(4, Math.ceil((y1 - y0) / 1.5))));
      if (r.gipfel) {                                                      // Gipfelstück: auf dem Dach, Vorderseite mit Schnee
        const pb = keep(M.extrude(peakCS, Do).translate([0, 0, -Do]));
        const bx = peakCS.bounds(), hf = keep(_advHF(w, bx.min[0] - 1, bx.max[0] + 1, y0p - 0.5, bx.max[1] + 1, -0.01, (x, y) => tp + Rf(x, y), Math.ceil((bx.max[0] - bx.min[0]) / 1.5), Math.ceil((bx.max[1] - y0p) / 1.5)));
        front = keep(keep(front.add(keep(hf.intersect(keep(M.extrude(peakCS, tp + rel + 2).translate([0, 0, -0.02])))))).add(pb));
        if (p.kreuz) {                                                     // Vierkant-Loch fürs Gipfelkreuz
          const q = 3.2 + 2 * p.steck, zc0 = tp - 6;
          front = keep(front.subtract(keep(M.cube([q, 12, q]).translate([xA - q / 2, yApex - 10, zc0 - p.steck]))));
        }
      }
      sch = keep(sch.add(front));
      const th = Math.min((tile[3] - tile[2]) * 0.5, (tile[1] - tile[0]) * 0.55, 30), zs = _advZahl(w, textFn, keep, tag, th, (tile[1] - tile[0]) * 0.8, xc, r.y0 + r.ch / 2);
      if (zs) sch = keep(sch.add(keep(M.extrude(zs, tp + rel + p.griff))));
      teile.push({ name: `Fach ${String(tag).padStart(2, '0')}` + (r.gipfel ? ' (Gipfel)' : ''), farbe: farbe(xc, r.y0 + r.ch / 2), m: sch.translate([0, 0, 0]), d: sch.translate([0, 0, Do]), art: 'fach', tag });
    }
    // Gipfelkreuz (flach gedruckt, Vierkant-Zapfen unten)
    if (p.kreuz) {
      const kh = kreuzH, sw = Math.max(5, kh * 0.17), bw = kh * 0.62, d = 6;
      const kr = keep(M.union([keep(M.cube([sw, kh, d]).translate([-sw / 2, 0, 0])), keep(M.cube([bw, sw, d]).translate([-bw / 2, kh * 0.62, 0])), keep(M.cube([3.2, 9.5, 3.2]).translate([-1.6, -9.5, 0]))]));
      teile.push({ name: 'Gipfelkreuz', farbe: '#8a5a2b', m: kr.translate([xA, yApex, tp - 6]), d: kr.rotate([0, 0, 0]).translate([0, 9.5, 0]), art: 'deko' });
    }
    for (const [fl, nm] of flanken) {
      const b = fl.boundingBox();
      teile.push({ name: `Berg-Flanke ${nm}`, farbe: '#7d766e', m: fl.translate([0, 0, 0]), d: fl.translate([-b.min[0], -b.min[1], Dr]), art: 'rahmen' });
    }
    const nStift = stifte.length;
    if (nStift) teile.push({ name: `Steckstifte ${nStift}×`, farbe: '#bdbdbd', m: null, d: _advStifte(w, nStift, 2 * hd - 1), art: 'stift' });
    // ── Info ───────────────────────────────────────────────────────────────
    const hMin = Math.min(...rows.filter(r => !r.gipfel).map(r => r.h)), hMax = Math.max(...rows.filter(r => !r.gipfel).map(r => r.h)), G = rows[rows.length - 1];
    zeilen.push(`Berg ${Math.round(yApex + kreuzH)} mm hoch, ${Math.round(breite)} mm breit, ${Math.round(Dr + tp + rel)} mm tief; Rahmen in ${m.segs.length} Segmenten` + (flanken.length ? ` + ${flanken.length} angesteckte Flanken.` : '.'));
    zeilen.push(`Fächer innen ${p.fachB} × ${Math.round(hMax)}…${Math.round(hMin)} × ${p.fachT} mm (B × H × T), Reihen ${m.reihen.join('-')} von unten. Gipfel (24): ${Math.round(m.Bs)} × ${Math.round(G.h)} × ${p.fachT} mm.`);
    return { teile, info: { zeilen, warn, stifte: nStift, stiftL: 2 * hd - 1 } };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}

// ─── Form 3: Rakete ───────────────────────────────────────────────────────────
// Ralf 10.11.: Rumpf mit Schubladen in Reihen (Fächer ca. 40 × 50), Spitze mit Fach 24 als
// runde Kapsel, zwei Flossen als Standfuß, Düse unten. Rumpf in Segmenten nach Bettgröße,
// Spitze und Flossen eigene Teile (rot), alles mit Steckstiften. Gedruckt auf dem Rücken.
function _advRaketeBuild(w, p, textFn){
  const M = w.Manifold, CS = w.CrossSection, tmp = [], keep = x => { tmp.push(x); return x; };
  try {
    const t = p.wand, sp = p.spiel, rw = 2, tp = 3, rb = 3, g = 0.6, k = Math.tan(p.konus * Math.PI / 180), warn = [], zeilen = [];
    let reihen = String(p.reihen || '').split(/[^0-9]+/).map(Number).filter(n => n > 0);
    if (reihen.reduce((a, b) => a + b, 0) !== 23) { warn.push(`Reihen „${p.reihen}“ ergeben nicht 23 Fächer (+ Kapsel) – Standard 4,4,4,4,4,3 verwendet.`); reihen = [4, 4, 4, 4, 4, 3]; }
    const R = reihen.length, Bo = p.fachB + 2 * t, cw = Bo + 2 * sp, Do = p.fachT + t, Dr = Do + sp + rb;
    const nMax = Math.max(...reihen), Wb = nMax * cw + (nMax + 1) * rw + 2 * p.rand, xe = Wb / 2;
    const noseH = p.hoehe * p.spitze / 100, yb0 = p.duese ? Math.max(12, 0.05 * p.hoehe) : 0, base = 3;
    // Reihenhöhen: Rest der Höhe gleichmäßig, Schnitte nach Bettgröße an Reihengrenzen
    const bau = cutsAfter => {
      const fest = yb0 + base + R * (t + 2 * sp + rw) + cutsAfter.length * (rw + 2) + noseH;
      const h = Math.max(30, (p.hoehe - fest) / R), rows = []; let y = yb0 + base;
      reihen.forEach((n, i) => { const ch = h + t + 2 * sp; rows.push({ n, i, y0: y, ch, h }); y += ch;
        if (cutsAfter.includes(i)) { rows[i].cut = y + rw + 1; y += 2 * rw + 2; } else y += rw; });
      return { rows, yTop: y, h };
    };
    let L = bau([]); const nSeg = Math.max(1, Math.ceil(L.yTop / (p.bett - 8)));
    for (let it = 0; it < 3 && nSeg > 1; it++) { const cuts = [];
      for (let s = 1; s < nSeg; s++) { const ziel = s * L.yTop / nSeg; let best = -1, bd = 1e9;
        for (let i = 0; i < R - 1; i++) { const yb = L.rows[i].y0 + L.rows[i].ch; if (!cuts.includes(i) && Math.abs(yb - ziel) < bd) { bd = Math.abs(yb - ziel); best = i; } }
        if (best >= 0) cuts.push(best); }
      L = bau(cuts.sort((a, b) => a - b)); }
    const { rows, yTop, h } = L;
    if (h < 32) warn.push(`Fächer nur ${Math.round(h)} mm hoch – Höhe vergrößern oder weniger Reihen.`);
    if (Wb > p.bett - 4) warn.push(`Rumpf ${Math.round(Wb)} mm breit – mehr als das Bett. Weniger Fächer je Reihe oder schmalere Fächer.`);
    // ── Silhouetten ────────────────────────────────────────────────────────
    const yApex = yTop + noseH, hw = y => xe * Math.pow(Math.max(0, 1 - Math.pow((y - yTop) / noseH, 1.7)), 0.62);   // Ogive
    const noseP = []; const nN = 40;
    for (let i = 0; i <= nN; i++) { const y = yTop + noseH * i / nN; noseP.push([hw(y), y]); }
    for (let i = nN; i >= 0; i--) { const y = yTop + noseH * i / nN; noseP.push([-hw(y), y]); }
    const noseCS = keep(new CS([noseP]));
    const rumpfP = [[-xe, yb0], [xe, yb0], [xe, yTop], [-xe, yTop]];
    if (p.duese) { const a = Wb * 0.24, b = Wb * 0.17; rumpfP.splice(1, 0, [-a, yb0], [-b, 0], [b, 0], [a, yb0]); }
    const rumpfCS = keep(new CS([rumpfP]));
    // ── Fächer: Reihen + Kapsel (24) in der Spitze ─────────────────────────
    const zahlen = _advMischen(23, p); let zi = 0; const faecher = [];
    for (const r of rows) for (let j = 0; j < r.n; j++) {
      const xc = (j - (r.n - 1) / 2) * (cw + rw);
      faecher.push({ r, xc, Bo, tag: zahlen[zi++], tile: [xc - cw / 2 - rw / 2 + g / 2, xc + cw / 2 + rw / 2 - g / 2, r.y0 - rw / 2 + g / 2, r.y0 + r.ch + rw / 2 - g / 2] });
    }
    // Kapsel: Fach so groß, dass die runde Klappe (umschreibt die Öffnung) in die Spitze passt
    let kap = null;
    for (let f = 1; f > 0.3 && !kap; f -= 0.04) {
      const B = p.fachB * f, ch = Math.max(24, h * f) + t + 2 * sp, cwk = B + 2 * t + 2 * sp;
      const Rc = Math.hypot(cwk / 2 + rw, ch / 2 + rw), yc = yTop + 3 + Rc, y0 = yc - ch / 2;   // Klappe liegt ganz über dem Schnitt
      let passt = true;
      for (let a = 0; a < 24 && passt; a++) { const x = Rc * Math.cos(a * Math.PI / 12) + Math.sign(Math.cos(a * Math.PI / 12)) * 3, y = yc + Rc * Math.sin(a * Math.PI / 12) + 3 * Math.sin(a * Math.PI / 12);
        if (y > yTop && Math.abs(x) > hw(y)) passt = false; }
      if (passt) kap = { B, ch, cwk, y0, Rc, yc, f };
    }
    if (!kap) { warn.push('Spitze zu klein für die Kapsel – „Spitze“ vergrößern.'); kap = { B: p.fachB * 0.5, ch: 30, cwk: p.fachB * 0.5 + 2 * t + 2 * sp, y0: yTop + 6, Rc: 25, yc: yTop + 21, f: 0.5 }; }
    const kapR = { n: 1, i: R, y0: kap.y0, ch: kap.ch, h: kap.ch - t - 2 * sp, kapsel: true };
    faecher.push({ r: kapR, xc: 0, Bo: kap.B + 2 * t, tag: 24, kreis: [0, kap.yc, kap.Rc] });
    // ── Rahmen ─────────────────────────────────────────────────────────────
    const hohl = faecher.map(({ r, xc, Bo: bo }) => { const c = bo + 2 * sp, d = Do + sp + 1, s = d * k;
      return keep(M.hull([[xc - c / 2, r.y0, 1], [xc + c / 2, r.y0, 1], [xc - c / 2, r.y0 + r.ch, 1], [xc + c / 2, r.y0 + r.ch, 1],
        [xc - c / 2 + s, r.y0, -(Do + sp)], [xc + c / 2 - s, r.y0, -(Do + sp)], [xc - c / 2 + s, r.y0 + r.ch - s, -(Do + sp)], [xc + c / 2 - s, r.y0 + r.ch - s, -(Do + sp)]])); });
    const kachel = fa => fa.kreis ? keep(M.cylinder(tp + p.griff + 6, fa.kreis[2] + g, fa.kreis[2] + g, 72).translate([0, fa.kreis[1], -1]))
      : keep(M.cube([fa.tile[1] - fa.tile[0] + 2 * g, fa.tile[3] - fa.tile[2] + 2 * g, tp + p.griff + 6]).translate([fa.tile[0] - g, fa.tile[2] - g, -1]));
    const frei = keep(M.union(faecher.map(kachel)));
    const vorn = cs => keep(keep(M.extrude(cs, tp)).subtract(frei));     // bündige Frontplatte um die Klappen
    let rumpf = keep(keep(keep(M.extrude(rumpfCS, Dr).translate([0, 0, -Dr])).add(vorn(rumpfCS))).subtract(keep(M.union(hohl.slice(0, 23)))));
    let spitze = keep(keep(keep(M.extrude(noseCS, Dr).translate([0, 0, -Dr])).add(vorn(noseCS))).subtract(hohl[23]));
    // Steckstifte: senkrecht in den Seitenwänden (Schnitte, Spitze), waagerecht in die Flossen
    const dh = _ADV_STIFT_D + 2 * p.steck, hd = 9, stifte = [], xs = xe - p.rand / 2 - rw / 2;
    if (p.rand < dh + 5) warn.push(`Seitenwand nur ${p.rand} mm – für die Steckstifte mind. ${Math.ceil(dh + 5)} mm.`);
    const senk = y => { for (const xx of [-xs, xs]) for (const zz of [-Dr * 0.3, -Dr * 0.72]) stifte.push(keep(M.cylinder(2 * hd, dh / 2, dh / 2, 24, true).rotate([90, 0, 0]).translate([xx, y, zz]))); };
    for (const r of rows) if (r.cut) senk(r.cut);
    senk(yTop);
    const yF = yb0 + p.flosseH / 100 * (yTop - yb0), fw = p.flossen;
    const yFb = yb0 + 0.12 * (yF - yb0), quer = [];
    for (const yy of [yFb + 0.25 * (yF - yFb), yFb + 0.6 * (yF - yFb)]) for (const sd of [-1, 1])
      quer.push(keep(M.cylinder(2 * hd, dh / 2, dh / 2, 24, true).rotate([0, 90, 0]).translate([sd * xe, yy, -Dr / 2])));
    const alle = keep(M.union([...stifte, ...quer]));
    rumpf = keep(rumpf.subtract(alle)); spitze = keep(spitze.subtract(alle));
    const teile = [], segs = []; let ya = 0;
    for (const r of rows) if (r.cut) { segs.push([ya, r.cut]); ya = r.cut; }
    segs.push([ya, yTop]);
    segs.forEach(([y0, y1], i) => {
      let s = rumpf.translate([0, 0, 0]);
      if (y0 > 0) { const s2 = s.trimByPlane([0, 1, 0], y0); s.delete(); s = s2; }
      if (y1 < yTop) { const s2 = s.trimByPlane([0, -1, 0], -y1); s.delete(); s = s2; }
      const nm = segs.length === 1 ? 'Raketen-Rumpf' : `Raketen-Rumpf ${['unten', 'Mitte', 'oben'][segs.length === 2 && i === 1 ? 2 : i] || i + 1}`;
      teile.push({ name: nm, farbe: '#efe8dc', m: s.translate([0, 0, 0]), d: s.translate([0, -y0, Dr]), art: 'rahmen' }); s.delete();
    });
    teile.push({ name: 'Raketen-Spitze', farbe: '#d94040', m: spitze.translate([0, 0, 0]), d: spitze.translate([0, -yTop, Dr]), art: 'rahmen' });
    // Flossen: schlanke Dreiecke, Spitze auf dem Boden = Standfuß
    for (const sd of [-1, 1]) {
      const P = [[0, yF], [fw, 0], [fw - Math.min(14, fw * 0.25), 0], [0, yFb]].map(([x, y]) => [sd * (xe + x), y]);
      let A2 = 0; for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; A2 += x1 * y2 - x2 * y1; }
      if (A2 < 0) P.reverse();                                             // Umlauf gegen den Uhrzeiger, sonst leer
      // Flossen reichen hinten über den Rumpf hinaus: 400 mm hoch auf 58 mm Tiefe kippt sonst beim Ziehen eines Fachs
      let fl = keep(M.extrude(keep(new CS([P])), Dr + p.stand).translate([0, 0, -Dr - p.stand]));
      fl = keep(fl.subtract(alle));
      teile.push({ name: `Flosse ${sd < 0 ? 'links' : 'rechts'}`, farbe: '#d94040', m: fl.translate([0, 0, 0]), d: fl.translate([-(sd < 0 ? -xe - fw : xe), 0, Dr + p.stand]), art: 'rahmen' });
    }
    // ── Schubladen ─────────────────────────────────────────────────────────
    for (const fa of faecher) {
      const { r, xc, tile, tag } = fa, bo = fa.Bo, Ho = r.h + t, yb = r.y0 + sp, s = Do * k, si = (Do - t) * k;
      const box = keep(M.hull([[xc - bo / 2, yb, 0], [xc + bo / 2, yb, 0], [xc - bo / 2, yb + Ho, 0], [xc + bo / 2, yb + Ho, 0],
        [xc - bo / 2 + s, yb, -Do], [xc + bo / 2 - s, yb, -Do], [xc - bo / 2 + s, yb + Ho - s, -Do], [xc + bo / 2 - s, yb + Ho - s, -Do]]));
      const inn = keep(M.hull([[xc - bo / 2 + t, yb + t, 0.01], [xc + bo / 2 - t, yb + t, 0.01], [xc - bo / 2 + t, yb + Ho + 2, 0.01], [xc + bo / 2 - t, yb + Ho + 2, 0.01],
        [xc - bo / 2 + t + si, yb + t, -(Do - t)], [xc + bo / 2 - t - si, yb + t, -(Do - t)], [xc - bo / 2 + t + si, yb + Ho + 2, -(Do - t)], [xc + bo / 2 - t - si, yb + Ho + 2, -(Do - t)]]));
      let sch = keep(box.subtract(inn));
      const front = fa.kreis ? keep(M.cylinder(tp, fa.kreis[2], fa.kreis[2], 72).translate([0, fa.kreis[1], 0]))
        : keep(M.cube([tile[1] - tile[0], tile[3] - tile[2], tp]).translate([tile[0], tile[2], 0]));
      sch = keep(sch.add(front));
      const bw = fa.kreis ? fa.kreis[2] * 1.3 : tile[1] - tile[0], bh = fa.kreis ? fa.kreis[2] * 1.3 : tile[3] - tile[2];
      const zs = _advZahl(w, textFn, keep, tag, Math.min(bh * 0.5, bw * 0.55, 30), bw * 0.8, xc, fa.kreis ? fa.kreis[1] : r.y0 + r.ch / 2);
      if (zs) sch = keep(sch.add(keep(M.extrude(zs, tp + p.griff))));
      teile.push({ name: `Fach ${String(tag).padStart(2, '0')}` + (fa.kreis ? ' (Kapsel)' : ''), farbe: fa.kreis ? '#f6c35a' : '#a9cdf0', m: sch.translate([0, 0, 0]), d: sch.translate([0, 0, Do]), art: 'fach', tag });
    }
    const nStift = stifte.length + quer.length;
    teile.push({ name: `Steckstifte ${nStift}×`, farbe: '#bdbdbd', m: null, d: _advStifte(w, nStift, 2 * hd - 1), art: 'stift' });
    if (p.stand < 0.15 * yApex - Dr) warn.push(`Steht nur ${Math.round(Dr + p.stand)} mm tief bei ${Math.round(yApex)} mm Höhe – „Standfuß hinten“ vergrößern, sonst kippt sie beim Ziehen eines Fachs.`);
    zeilen.push(`Rakete ${Math.round(yApex)} mm hoch, Rumpf ${Math.round(Wb)} mm breit (mit Flossen ${Math.round(Wb + 2 * fw)}), ${Math.round(Dr + tp)} mm tief (Standfläche ${Math.round(Dr + p.stand)} mm); Rumpf in ${segs.length} Segment${segs.length > 1 ? 'en' : ''} + Spitze + 2 Flossen.`);
    zeilen.push(`Fächer innen ${p.fachB} × ${Math.round(h)} × ${p.fachT} mm (B × H × T), Reihen ${reihen.join('-')} von unten. Kapsel (24): ${Math.round(kap.B)} × ${Math.round(kap.ch - t - 2 * sp)} × ${p.fachT} mm.`);
    return { teile, info: { zeilen, warn, stifte: nStift, stiftL: 2 * hd - 1 } };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}

// ─── Form 4: Piratenschiff ────────────────────────────────────────────────────
// Ralf 10.11.: Rumpf mit zwei Reihen Kanonenluken (Fächer 1–23), Fach 24 im Ausguck am Mast.
// Der Rumpf ist breiter als das Bett → SENKRECHT in Segmente geteilt (Schnitte zwischen den
// Fächern, Steckstifte im Kiel- und Deckband). Kajüte am Heck, Bugspriet hinten am Rumpf
// (liegt beim Druck auf dem Bett), Mastfuß auf dem Deck. Mast mit Rahen, Segel, Ausguck und
// Flagge sind eigene Teile. Alles auf dem Rücken bzw. flach gedruckt, ohne Stützen.
function _advSchiffBuild(w, p, textFn){
  const M = w.Manifold, CS = w.CrossSection, tmp = [], keep = x => { tmp.push(x); return x; };
  try {
    const t = p.wand, sp = p.spiel, rw = 2, tp = 3, rb = 3, g = 0.6, k = Math.tan(p.konus * Math.PI / 180), warn = [], zeilen = [];
    let reihen = String(p.reihen || '').split(/[^0-9]+/).map(Number).filter(n => n > 0);
    if (reihen.reduce((a, b) => a + b, 0) !== 23) { warn.push(`Reihen „${p.reihen}“ ergeben nicht 23 Fächer (+ Ausguck) – Standard 11,12 verwendet.`); reihen = [11, 12]; }
    const Bo = p.fachB + 2 * t, cw = Bo + 2 * sp, Do = p.fachT + t, Dr = Do + sp + rb, h = p.fachH, ch = h + t + 2 * sp;
    const kiel = 18, deck = 14, flare = 0.3 * (kiel + reihen.length * (ch + rw) + deck), rand = p.rand;
    // Spalten je Segment: so viele, dass das breiteste (Endsegment mit Rumpfende) aufs Bett passt
    const nMax = Math.max(...reihen);
    let kSeg = 1; while (kSeg < nMax && (kSeg + 1) * cw + (kSeg + 2) * rw + 2 + rand + flare + 14 <= p.bett - 8) kSeg++;
    const nSeg = Math.ceil(nMax / kSeg);
    // vom Heck her volle Segmente, der Rest am Bug — sonst klafft mitten in der Reihe eine Lücke
    const teilen = n => { const a = []; let r = n; for (let s = 0; s < nSeg; s++) { const m = Math.min(kSeg, Math.max(0, r - (nSeg - 1 - s))); a.push(m); r -= m; } return a; };
    const gruppen = reihen.map(teilen), sw = [...Array(nSeg)].map((_, s) => Math.max(...gruppen.map(gr => gr[s])) * cw + (Math.max(...gruppen.map(gr => gr[s])) + 1) * rw + 2);
    const Wi = sw.reduce((a, b) => a + b, 0), xs0 = -Wi / 2, cutX = []; { let x = xs0; for (let s = 0; s < nSeg - 1; s++) { x += sw[s]; cutX.push(x); } }
    const yDeck = kiel + reihen.length * (ch + rw) - rw + deck, xK = Wi / 2 + rand;   // Halbbreite unten an den Fächern
    const hwR = y => y < kiel ? xK - 0.9 * (kiel - y) : xK + flare * (y - kiel) / (yDeck - kiel);
    // ── Fächer ─────────────────────────────────────────────────────────────
    const zahlen = _advMischen(23, p); let zi = 0; const faecher = [];
    reihen.forEach((n, ri) => { const y0 = kiel + ri * (ch + rw); let xs = xs0;
      for (let s = 0; s < nSeg; s++) { const m = gruppen[ri][s], inner = m * cw + (m + 1) * rw, x0 = xs + (sw[s] - inner) / 2;
        for (let j = 0; j < m; j++) { const xc = x0 + rw + cw / 2 + j * (cw + rw);
          faecher.push({ r: { y0, ch, h }, xc, Bo, tag: zahlen[zi++], tile: [xc - cw / 2 - rw / 2 + g / 2, xc + cw / 2 + rw / 2 - g / 2, y0 - rw / 2 + g / 2, y0 + ch + rw / 2 - g / 2] }); }
        xs += sw[s]; } });
    // ── Rumpf-Silhouette: Trapez, Kajüte am Heck (links) ───────────────────
    const xD = hwR(yDeck), cabW = Math.min(0.75 * sw[0], 1.3 * cw), cabH = Math.max(28, 0.55 * h);
    const rumpfP = [[-hwR(0), 0], [hwR(0), 0], [xD, yDeck], [-xD + cabW, yDeck], [-xD + cabW, yDeck + cabH], [-xD - 4, yDeck + cabH], [-xD, yDeck]];
    const rumpfCS = keep(new CS([rumpfP]));
    const hohl = faecher.map(({ r, xc }) => { const d = Do + sp + 1, s = d * k;
      return keep(M.hull([[xc - cw / 2, r.y0, 1], [xc + cw / 2, r.y0, 1], [xc - cw / 2, r.y0 + r.ch, 1], [xc + cw / 2, r.y0 + r.ch, 1],
        [xc - cw / 2 + s, r.y0, -(Do + sp)], [xc + cw / 2 - s, r.y0, -(Do + sp)], [xc - cw / 2 + s, r.y0 + r.ch - s, -(Do + sp)], [xc + cw / 2 - s, r.y0 + r.ch - s, -(Do + sp)]])); });
    const frei = keep(M.union(faecher.map(fa => keep(M.cube([fa.tile[1] - fa.tile[0] + 2 * g, fa.tile[3] - fa.tile[2] + 2 * g, tp + p.griff + 6]).translate([fa.tile[0] - g, fa.tile[2] - g, -1])))));
    let rumpf = keep(keep(M.extrude(rumpfCS, Dr).translate([0, 0, -Dr])).add(keep(keep(M.extrude(rumpfCS, tp)).subtract(frei))));
    rumpf = keep(rumpf.subtract(keep(M.union(hohl))));
    // Kajütenfenster (rund, leicht vertieft) und Bugspriet hinten am Bug
    rumpf = keep(rumpf.subtract(keep(M.cylinder(3, cabH * 0.22, cabH * 0.22, 32).translate([-xD + cabW / 2 - 2, yDeck + cabH * 0.5, tp - 1.5]))));
    const bsL = Math.min(90, p.bett - 8 - (sw[nSeg - 1] + rand + flare + 4)), bsA = 22 * Math.PI / 180;
    if (bsL > 20) { const x1 = xD - 6, y1 = yDeck - 6, x2 = x1 + bsL * Math.cos(bsA), y2 = y1 + bsL * Math.sin(bsA), n = [-Math.sin(bsA) * 4, Math.cos(bsA) * 4];
      rumpf = keep(rumpf.add(keep(M.extrude(keep(new CS([[[x1 - n[0], y1 - n[1]], [x2 - n[0], y2 - n[1]], [x2 + n[0], y2 + n[1]], [x1 + n[0], y1 + n[1]]]])), 10).translate([0, 0, -Dr])))); }
    // Mastfuß auf dem Deck (Block mit Vierkantloch, Mast steht in der Rumpfmitte der Tiefe)
    // Mast in die Mitte des Segments, das der Schiffsmitte am nächsten liegt (ein Schnitt bei x = 0
    // ginge sonst mitten durch Mastfuß und Mastloch)
    const mitten = []; { let x = xs0; for (let s = 0; s < nSeg; s++) { mitten.push(x + sw[s] / 2); x += sw[s]; } }
    const mX = mitten.reduce((a, b) => Math.abs(b) < Math.abs(a) ? b : a);
    const mq = 12, mqL = mq + 2 * p.steck, fussH = 26, zM = -Dr / 2;
    rumpf = keep(rumpf.add(keep(M.cube([34, fussH + 2, Dr]).translate([mX - 17, yDeck - 2, -Dr]))));
    rumpf = keep(rumpf.subtract(keep(M.cube([mqL, 23, mqL]).translate([mX - mqL / 2, yDeck + fussH - 22, zM - mqL / 2]))));
    // Steckstifte an den Schnitten: waagerecht durchs Kiel- und Deckband
    const dh = _ADV_STIFT_D + 2 * p.steck, hd = 9, stifte = [];
    for (const xc of cutX) for (const yy of [kiel / 2, yDeck - deck / 2]) for (const zz of [-Dr * 0.3, -Dr * 0.72])
      stifte.push(keep(M.cylinder(2 * hd, dh / 2, dh / 2, 24, true).rotate([0, 90, 0]).translate([xc, yy, zz])));
    if (stifte.length) rumpf = keep(rumpf.subtract(keep(M.union(stifte))));
    const teile = [], grenzen = [-1e4, ...cutX, 1e4];
    for (let s = 0; s < nSeg; s++) {
      let seg = rumpf.translate([0, 0, 0]);
      if (s > 0) { const x = seg.trimByPlane([1, 0, 0], grenzen[s]); seg.delete(); seg = x; }
      if (s < nSeg - 1) { const x = seg.trimByPlane([-1, 0, 0], -grenzen[s + 1]); seg.delete(); seg = x; }
      seg = _advSauber(w, seg); const b = seg.boundingBox();
      const nm = nSeg === 1 ? 'Schiffsrumpf' : `Schiffsrumpf ${s === 0 ? 'Heck' : s === nSeg - 1 ? 'Bug' : 'Mitte' + (nSeg > 3 ? ' ' + s : '')}`;
      teile.push({ name: nm, farbe: '#b8761e', m: seg.translate([0, 0, 0]), d: seg.translate([-b.min[0], 0, Dr]), art: 'rahmen' }); seg.delete();
    }
    // ── Ausguck (Fach 24) auf dem Mast ─────────────────────────────────────
    const flagH = 0.11 * p.hoehe, B24 = p.fachB, h24 = Math.max(30, 0.75 * h), cw24 = B24 + 2 * t + 2 * sp, ch24 = h24 + t + 2 * sp;
    const nestB = 10, nestT = 8, nestH = nestB + ch24 + nestT, nestW = cw24 + 2 * 7, yNest = p.hoehe - flagH - nestH;
    const mastL = yNest + (nestB - 2) - (yDeck + fussH - 22);              // unten 22 im Fuß, oben 8 im Ausguck (Loch 9)
    if (yNest - (yDeck + fussH) < 1.4 * h) warn.push('Wenig Platz für das Segel – „Höhe“ vergrößern.');
    if (mastL > p.bett - 8) warn.push(`Mast ${Math.round(mastL)} mm – länger als das Bett. „Höhe“ verkleinern.`);
    const nestCS = keep(new CS([[[-nestW / 2 + 4, 0], [nestW / 2 - 4, 0], [nestW / 2 + 3, nestH], [-nestW / 2 - 3, nestH]]]));
    const n24 = { r: { y0: nestB, ch: ch24, h: h24 }, xc: 0, Bo: B24 + 2 * t, tag: 24, tile: [-cw24 / 2 - rw / 2 + g / 2, cw24 / 2 + rw / 2 - g / 2, nestB - rw / 2 + g / 2, nestB + ch24 + rw / 2 - g / 2] };
    let nest = keep(keep(M.extrude(nestCS, Dr).translate([0, 0, -Dr])).add(keep(keep(M.extrude(nestCS, tp)).subtract(keep(M.cube([n24.tile[1] - n24.tile[0] + 2 * g, n24.tile[3] - n24.tile[2] + 2 * g, tp + 6]).translate([n24.tile[0] - g, n24.tile[2] - g, -1]))))));
    { const d = Do + sp + 1, s = d * k, c = cw24, y0 = nestB;
      nest = keep(nest.subtract(keep(M.hull([[-c / 2, y0, 1], [c / 2, y0, 1], [-c / 2, y0 + ch24, 1], [c / 2, y0 + ch24, 1], [-c / 2 + s, y0, -(Do + sp)], [c / 2 - s, y0, -(Do + sp)], [-c / 2 + s, y0 + ch24 - s, -(Do + sp)], [c / 2 - s, y0 + ch24 - s, -(Do + sp)]])))); }
    if (Dr < mqL + 6) warn.push('Fächer zu flach für den Mast.');
    nest = keep(nest.subtract(keep(M.cube([mqL, nestB - 1, mqL]).translate([-mqL / 2, -0.01, zM - mqL / 2]))));          // Mast von unten
    nest = keep(nest.subtract(keep(M.cube([8 + 2 * p.steck, nestT + 1, 8 + 2 * p.steck]).translate([-4 - p.steck, nestH - nestT + 0.5, zM - 4 - p.steck]))));   // Flaggenstock oben (0,5 tiefer als der Zapfen)
    if (nestB < 14 || Dr - (Do + sp) < 3) { /* Mastloch reicht in die Wand unter dem Fach */ }
    teile.push({ name: 'Ausguck', farbe: '#b8761e', m: nest.translate([mX, yNest, 0]), d: nest.translate([nestW / 2 + 3, 0, Dr]), art: 'rahmen', nurDeko: true });
    // ── Mast mit Rahen (flach), Segel, Flagge ──────────────────────────────
    const yM0 = yDeck + fussH - 22, segelO = yNest - 0.12 * (yNest - yDeck), segelU = yDeck + fussH + 0.12 * (yNest - yDeck), segW = Math.min(2.4 * p.fachB * 2, p.bett - 30, 0.5 * (2 * xD));
    const rahe = y => keep(M.cube([segW + 24, 8, mq]).translate([-(segW + 24) / 2, y - 4, zM - mq / 2]));   // so tief wie der Mast: Segel liegt hinten plan an
    const mast = keep(M.union([keep(M.cube([mq, mastL, mq]).translate([-mq / 2, yM0, zM - mq / 2])), rahe(segelO), rahe(segelU)]));
    const mb = mast.boundingBox();
    teile.push({ name: 'Mast mit Rahen', farbe: '#7a4a1c', m: mast.translate([mX, 0, 0]), d: mast.translate([-mb.min[0], -mb.min[1], -mb.min[2]]), art: 'deko' });
    const bauch = 6, segN = 16, sP = [];                                    // Segel leicht gebaucht (Kontur), flach gedruckt
    for (let i = 0; i <= segN; i++) { const q = i / segN; sP.push([-segW / 2 + segW * q, segelU + 4 + bauch * Math.sin(Math.PI * q)]); }
    for (let i = segN; i >= 0; i--) { const q = i / segN; sP.push([-segW / 2 + segW * q, segelO - 4 + bauch * Math.sin(Math.PI * q) * 0.6]); }
    const segel = keep(M.extrude(keep(new CS([sP])), 2.4).translate([0, 0, zM - mq / 2 - 2.4]));   // hinten an Mast und Rahen geklebt
    const sb = segel.boundingBox();
    teile.push({ name: 'Segel', farbe: '#f2ede4', m: segel.translate([mX, 0, 0]), d: segel.translate([-sb.min[0], -sb.min[1], -sb.min[2]]), art: 'deko' });
    const fq = 8, fl = flagH, fW = Math.min(0.9 * fl * 1.5, 70), fH = fl * 0.55;
    const stock = keep(M.cube([fq, fl + nestT - 1, fq]).translate([-fq / 2, -(nestT - 1), -fq / 2]));
    const tuch = keep(M.cube([fW, fH, 2.4]).translate([fq / 2 - 0.5, fl - fH, -fq / 2]));
    let flagge = keep(stock.add(tuch));
    const kz = keep(M.cylinder(1.2, fH * 0.2, fH * 0.2, 32).translate([fq / 2 + fW * 0.5, fl - fH * 0.42, -fq / 2 + 2.4]));      // Totenkopf schlicht: Kreis + gekreuzte Knochen
    const kn = a => keep(M.cube([fH * 0.75, fH * 0.09, 1.2]).translate([-fH * 0.375, -fH * 0.045, 0]).rotate([0, 0, a]).translate([fq / 2 + fW * 0.5, fl - fH * 0.6, -fq / 2 + 2.4]));   // unter dem Kopf, überlappend → ein Stück
    const zeichen = keep(M.union([kz, kn(25), kn(-25)]));
    teile.push({ name: 'Flagge', farbe: '#222222', m: flagge.translate([mX, yNest + nestH, zM]), d: flagge.translate([fq / 2, nestT - 1, fq / 2]), art: 'deko' });
    teile.push({ name: 'Flaggen-Zeichen', farbe: '#f5f5f5', m: zeichen.translate([mX, yNest + nestH, zM]), d: zeichen.translate([fq / 2, nestT - 1, fq / 2 - 2.4]), art: 'deko' });
    // ── Schubladen ─────────────────────────────────────────────────────────
    const lade = (fa, yOff) => {
      const { r, xc, tile, tag } = fa, bo = fa.Bo, Ho = r.h + t, yb = r.y0 + sp, s = Do * k, si = (Do - t) * k;
      const box = keep(M.hull([[xc - bo / 2, yb, 0], [xc + bo / 2, yb, 0], [xc - bo / 2, yb + Ho, 0], [xc + bo / 2, yb + Ho, 0],
        [xc - bo / 2 + s, yb, -Do], [xc + bo / 2 - s, yb, -Do], [xc - bo / 2 + s, yb + Ho - s, -Do], [xc + bo / 2 - s, yb + Ho - s, -Do]]));
      const inn = keep(M.hull([[xc - bo / 2 + t, yb + t, 0.01], [xc + bo / 2 - t, yb + t, 0.01], [xc - bo / 2 + t, yb + Ho + 2, 0.01], [xc + bo / 2 - t, yb + Ho + 2, 0.01],
        [xc - bo / 2 + t + si, yb + t, -(Do - t)], [xc + bo / 2 - t - si, yb + t, -(Do - t)], [xc - bo / 2 + t + si, yb + Ho + 2, -(Do - t)], [xc + bo / 2 - t - si, yb + Ho + 2, -(Do - t)]]));
      let sch = keep(keep(box.subtract(inn)).add(keep(M.cube([tile[1] - tile[0], tile[3] - tile[2], tp]).translate([tile[0], tile[2], 0]))));
      const bw = tile[1] - tile[0], bh = tile[3] - tile[2], zs = _advZahl(w, textFn, keep, tag, Math.min(bh * 0.5, bw * 0.55, 30), bw * 0.8, xc, r.y0 + r.ch / 2);
      if (zs) sch = keep(sch.add(keep(M.extrude(zs, tp + p.griff))));
      return sch.translate([0, yOff, 0]);
    };
    for (const fa of faecher) { const sch = keep(lade(fa, 0)); teile.push({ name: `Fach ${String(fa.tag).padStart(2, '0')}`, farbe: '#f3e6c8', m: sch.translate([0, 0, 0]), d: sch.translate([0, 0, Do]), art: 'fach', tag: fa.tag }); }
    { const sch = keep(lade(n24, yNest)); teile.push({ name: 'Fach 24 (Ausguck)', farbe: '#f6c35a', m: sch.translate([mX, 0, 0]), d: sch.translate([0, -yNest, Do]), art: 'fach', tag: 24 }); }
    // Ausguck-Fach gegen den Ausguck prüfen lassen wie die anderen: Ausguck zählt als Rahmen
    teile.find(x => x.name === 'Ausguck').art = 'rahmen';
    const nStift = stifte.length;
    if (nStift) teile.push({ name: `Steckstifte ${nStift}×`, farbe: '#bdbdbd', m: null, d: _advStifte(w, nStift, 2 * hd - 1), art: 'stift' });
    const breite = 2 * xD + Math.max(0, bsL * Math.cos(bsA) - 6) + 4;
    zeilen.push(`Piratenschiff ${Math.round(p.hoehe)} mm hoch, ${Math.round(breite)} mm breit, ${Math.round(Dr + tp)} mm tief; Rumpf in ${nSeg} Segmenten (senkrecht geteilt, ${kSeg} Spalten je Segment).`);
    zeilen.push(`Kanonenluken innen ${p.fachB} × ${p.fachH} × ${p.fachT} mm (B × H × T), Reihen ${reihen.join('-')} von unten. Ausguck (24): ${p.fachB} × ${Math.round(h24)} × ${p.fachT} mm. Segel hinten an Mast und Rahen kleben.`);
    return { teile, info: { zeilen, warn, stifte: nStift, stiftL: 2 * hd - 1 } };
  } finally { for (const x of tmp) { try { x.delete(); } catch (e) {} } }
}

// ─── Formen-Register ──────────────────────────────────────────────────────────
// Neue Form: Objekt anhängen. params: Regler (k, l, min, max, step, def, u, t) oder
// { k, l, typ: 'text'|'schalter', def }. build(w, p, textFn) → { teile, info } (siehe oben).
const _ADV_FORMEN = [
  { id: 'ball', icon: '⚽', name: 'Fußball', hint: 'Lederball aus 12 Fünfecken + 20 Sechsecken, 24 Stöpsel mit Keilfach',
    params: [
      { k: 'tiefe', l: 'Fachtiefe', min: 40, max: 80, step: 1, def: 55, u: 'mm', t: 'Tiefe der Keilfächer hinter den Stöpseln' },
      { k: 'wolb', l: 'Wölbung', min: 0, max: 10, step: 0.5, def: 3, u: 'mm', t: 'Polster-Wölbung der Flächen (Lederball-Look)' },
      { k: 'deckel', l: 'Deckelplatte', min: 1.6, max: 4, step: 0.2, def: 2.2, u: 'mm' },
      { k: 'kragen', l: 'Kragen', min: 5, max: 14, step: 0.5, def: 8, u: 'mm', t: 'Länge des Stöpsel-Kragens, der im Fach klemmt' },
    ],
    build: (w, p, tf) => _advBallBuild(w, p, tf),
    druck: 'Achtel/Halbkugeln auf der Schnittfläche, Stöpsel mit der Zahl nach oben. Die Achtel brauchen innen Baumstützen (Fachböden zeigen zur Mitte); Stöpsel und Stifte ohne Stützen.' },
  { id: 'berg', icon: '⛰️', name: 'Berg', hint: 'Schubladen in Reihen, Landschaft vorn, Gipfel = Fach 24',
    params: [
      { k: 'fachB', l: 'Fachbreite', min: 42, max: 70, step: 1, def: 50, u: 'mm', t: 'Innenbreite der Schubladen' },
      { k: 'fachT', l: 'Fachtiefe', min: 40, max: 70, step: 1, def: 50, u: 'mm', t: 'Innentiefe der Schubladen' },
      { k: 'hU', l: 'Höhe unten', min: 30, max: 80, step: 1, def: 48, u: '', t: 'Verhältnis der Schichthöhen: unten …' },
      { k: 'hO', l: 'Höhe oben', min: 30, max: 80, step: 1, def: 32, u: '', t: '… oben (wird auf die Gesamthöhe umgerechnet, mind. 30 mm)' },
      { k: 'breite', l: 'Fußbreite', min: 240, max: 520, step: 5, def: 420, u: 'mm', t: 'Breite des Bergfußes – was übers Druckbett hinausgeht, wird als Flanke links/rechts angesteckt' },
      { k: 'gipfel', l: 'Gipfelfach', min: 100, max: 170, step: 5, def: 130, u: '%', t: 'Breite des Gipfelfachs im Verhältnis zur Fachbreite' },
      { k: 'relief', l: 'Landschaft', min: 0, max: 8, step: 0.5, def: 4, u: 'mm', t: 'Wie plastisch Wiese, Fels und Schnee vorn sind' },
      { k: 'rand', l: 'Flanke', min: 10, max: 30, step: 1, def: 12, u: 'mm', t: 'Mindestbreite der Bergflanke neben den Fächern (hier sitzen die Steckstifte)' },
      { k: 'reihen', l: 'Fächer je Reihe', typ: 'text', def: '4,4,4,3,3,3,2', t: 'Von unten nach oben, zusammen 23 (das 24. ist der Gipfel)' },
      { k: 'kreuz', l: 'Gipfelkreuz', typ: 'schalter', def: 1 },
    ],
    build: (w, p, tf) => _advBergBuild(w, p, tf),
    druck: 'Alles auf dem Rücken liegend, Landschaft und Zahlen nach oben – ohne Stützen. Gipfelkreuz flach. Rahmen-Segmente und Flanken mit Steckstiften verbinden und kleben.' },
  { id: 'rakete', icon: '🚀', name: 'Rakete', hint: 'Rumpf mit Schubladen, Kapsel in der Spitze = Fach 24, Flossen als Standfuß',
    params: [
      { k: 'fachB', l: 'Fachbreite', min: 30, max: 60, step: 1, def: 40, u: 'mm', t: 'Innenbreite der Schubladen' },
      { k: 'fachT', l: 'Fachtiefe', min: 35, max: 70, step: 1, def: 50, u: 'mm', t: 'Innentiefe der Schubladen' },
      { k: 'reihen', l: 'Fächer je Reihe', typ: 'text', def: '4,4,4,4,4,3', t: 'Von unten nach oben, zusammen 23 (das 24. ist die Kapsel in der Spitze)' },
      { k: 'spitze', l: 'Spitze', min: 15, max: 32, step: 1, def: 22, u: '%', t: 'Höhe der Spitze im Verhältnis zur Gesamthöhe' },
      { k: 'flossen', l: 'Flossen', min: 30, max: 90, step: 1, def: 55, u: 'mm', t: 'Wie weit die Flossen seitlich herausstehen' },
      { k: 'flosseH', l: 'Flossenhöhe', min: 20, max: 50, step: 1, def: 32, u: '%', t: 'Wie weit die Flossen am Rumpf hinaufreichen' },
      { k: 'stand', l: 'Standfuß hinten', min: 0, max: 120, step: 5, def: 60, u: 'mm', t: 'So weit reichen die Flossen hinten über den Rumpf hinaus – macht die Rakete standfest' },
      { k: 'rand', l: 'Seitenwand', min: 10, max: 24, step: 1, def: 12, u: 'mm', t: 'Wand neben den Fächern (hier sitzen die Steckstifte)' },
      { k: 'duese', l: 'Düse unten', typ: 'schalter', def: 1 },
    ],
    build: (w, p, tf) => _advRaketeBuild(w, p, tf),
    druck: 'Rumpf, Spitze und Flossen auf dem Rücken liegend (Vorderseite oben), Fächer mit der Zahl nach oben – alles ohne Stützen. Segmente, Spitze und Flossen mit Steckstiften verbinden und kleben.' },
  { id: 'schiff', icon: '🏴‍☠️', name: 'Piratenschiff', hint: 'Kanonenluken = Fächer 1–23, Ausguck am Mast = Fach 24, Segel und Flagge',
    params: [
      { k: 'fachB', l: 'Fachbreite', min: 30, max: 60, step: 1, def: 40, u: 'mm', t: 'Innenbreite der Kanonenluken-Fächer' },
      { k: 'fachH', l: 'Fachhöhe', min: 30, max: 70, step: 1, def: 50, u: 'mm', t: 'Innenhöhe der Fächer' },
      { k: 'fachT', l: 'Fachtiefe', min: 35, max: 70, step: 1, def: 50, u: 'mm', t: 'Innentiefe der Fächer' },
      { k: 'reihen', l: 'Fächer je Reihe', typ: 'text', def: '11,12', t: 'Von unten nach oben, zusammen 23 (das 24. ist der Ausguck)' },
      { k: 'rand', l: 'Bug/Heck', min: 10, max: 40, step: 1, def: 16, u: 'mm', t: 'Rumpf neben den äußeren Fächern' },
    ],
    build: (w, p, tf) => _advSchiffBuild(w, p, tf),
    druck: 'Rumpf-Segmente und Ausguck auf dem Rücken liegend, Fächer mit der Zahl nach oben, Mast, Segel und Flagge flach – alles ohne Stützen. Segmente mit Steckstiften verbinden und kleben, Mast in den Mastfuß und den Ausguck stecken, Segel hinten an Mast und Rahen kleben.' },
];
