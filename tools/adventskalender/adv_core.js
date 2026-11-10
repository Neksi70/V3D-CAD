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
];
