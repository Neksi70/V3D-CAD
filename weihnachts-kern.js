/**
 * V3D CAD – 🎄 Weihnachts-Studio: Geometrie-Kern
 * ---------------------------------------------------------------------------
 * Baum, Mütze und Glocke in mehreren Stilen, jeweils mit Sockel, als Licht
 * (Lampenschirm über LED-Teelicht), als Dose (Baum mit Steckdeckel) oder als
 * Anhänger mit Öse. Reines JavaScript ohne three.js: läuft im Browser
 * (window.V3DWeihnacht) und in Node (module.exports) – die Tests prüfen jedes
 * Teil auf Wasserdichtheit und Überhang.
 *
 * Einheiten mm, Z oben, Platte bei z = 0.
 *
 * Grundbaustein ist der Zugkörper (zug): eine Linie in der (r, z)-Halbebene,
 * die an der Achse beginnt und an der Achse endet, wird um die Achse geführt.
 * Ringe bleiben waagrecht; ihr Mittelpunkt darf wandern (gebogene Mütze), ihr
 * Radius darf vom Winkel abhängen (Falten, Sterne, Muster, eckige Sockel).
 * Damit ist jeder Körper per Bauart geschlossen – ganz ohne Bool-Operationen.
 * Nur Lampenschirm-Löcher und vertiefte Schrift rechnet die App per Manifold.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2, EPS = 1e-6;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ── Zugkörper ─────────────────────────────────────────────────────────────
  // punkte: [{z, r | rf(θ), cx?, cy?}] – erster und letzter Punkt mit r = 0
  // (Pol auf der Achse). Mit geschlossen = true darf die Linie die Achse nicht
  // berühren und wird ringförmig geschlossen (Torus, Krempe).
  function zug(punkte, S, geschlossen) {
    const P = [], I = [], ringe = [];
    let last = null;
    for (const p of punkte) {
      const key = p.z.toFixed(5) + '|' + (p.rf ? 'f' + p.rf(0).toFixed(5) + p.rf(1).toFixed(5) : (+p.r).toFixed(5)) + '|' + (p.cx || 0).toFixed(4) + (p.cy || 0).toFixed(4);
      if (key === last) continue;                         // doppelte Punkte → entartete Streifen
      last = key;
      const cx = p.cx || 0, cy = p.cy || 0;
      const pol = !p.rf && p.r <= EPS;
      const start = P.length / 3;
      if (pol) { P.push(cx, cy, p.z); ringe.push({ pol: true, i: start }); continue; }
      for (let j = 0; j < S; j++) {
        const a = j / S * TAU, r = Math.max(0.05, p.rf ? p.rf(a) : p.r);
        P.push(cx + r * Math.cos(a), cy + r * Math.sin(a), p.z);
      }
      ringe.push({ pol: false, i: start });
    }
    const verbinde = (A, B) => {
      if (A.pol && B.pol) return;
      for (let j = 0; j < S; j++) {
        const k = (j + 1) % S;
        if (A.pol) I.push(A.i, B.i + j, B.i + k);
        else if (B.pol) I.push(A.i + j, B.i, A.i + k);
        else { I.push(A.i + j, B.i + j, B.i + k); I.push(A.i + j, B.i + k, A.i + k); }
      }
    };
    for (let k = 0; k + 1 < ringe.length; k++) verbinde(ringe[k], ringe[k + 1]);
    if (geschlossen) verbinde(ringe[ringe.length - 1], ringe[0]);
    const m = { positions: new Float32Array(P), indices: new Uint32Array(I) };
    if (volumen(m) < 0) wende(m);                          // Normalen nach außen
    return m;
  }
  function volumen(m) {
    const P = m.positions, I = m.indices; let v = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
    }
    return v / 6;
  }
  function wende(m) { const I = m.indices; for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; } }
  function bewege(m, dx, dy, dz) { const P = m.positions; for (let i = 0; i < P.length; i += 3) { P[i] += dx; P[i + 1] += dy; P[i + 2] += dz; } return m; }
  // um die X-Achse drehen (Grad) – für stehende Ösen und liegende Druckteile
  function drehX(m, grad) {
    const c = Math.cos(grad * Math.PI / 180), s = Math.sin(grad * Math.PI / 180), P = m.positions;
    for (let i = 0; i < P.length; i += 3) { const y = P[i + 1], z = P[i + 2]; P[i + 1] = y * c - z * s; P[i + 2] = y * s + z * c; }
    return m;
  }
  function box(m) {
    const P = m.positions, b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], P[i + k]); b[k + 3] = Math.max(b[k + 3], P[i + k]); }
    return b;
  }
  // Prisma aus einem sternförmigen 2D-Umriss (Fächer ab Punkt 0,0), Dicke entlang y
  function prisma(umriss, dicke) {
    const n = umriss.length, P = [0, -dicke / 2, 0, 0, dicke / 2, 0], I = [];
    for (const [x, z] of umriss) P.push(x, -dicke / 2, z, x, dicke / 2, z);
    for (let j = 0; j < n; j++) {
      const a = 2 + j * 2, b = 2 + ((j + 1) % n) * 2;
      I.push(0, b, a); I.push(1, a + 1, b + 1);              // Deckflächen
      I.push(a, b, b + 1); I.push(a, b + 1, a + 1);          // Mantel
    }
    const m = { positions: new Float32Array(P), indices: new Uint32Array(I) };
    if (volumen(m) < 0) wende(m);
    return m;
  }
  // Platte (Dicke entlang y) aus Außen- und Innenumriss: beide auf gleich viele Punkte
  // umgetastet und Streifen für Streifen verbunden → wasserdicht mit Loch
  function umtasten(poly, n) {
    const L = [0]; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const out = [], ges = L[poly.length];
    for (let k = 0; k < n; k++) {
      const t = k / n * ges; let i = 0; while (L[i + 1] < t) i++;
      const a = poly[i], b = poly[(i + 1) % poly.length], f = (t - L[i]) / Math.max(EPS, L[i + 1] - L[i]);
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    return out;
  }
  function lochPlatte(aussen, innen, dicke, n) {
    n = n || 64;
    const A = umtasten(aussen, n), B = umtasten(innen, n), P = [], I = [];
    for (const [x, z] of A) P.push(x, -dicke / 2, z, x, dicke / 2, z);
    for (const [x, z] of B) P.push(x, -dicke / 2, z, x, dicke / 2, z);
    const a = i => 2 * (i % n), b = i => 2 * n + 2 * (i % n);
    for (let i = 0; i < n; i++) {
      const j = i + 1;
      I.push(a(i), a(j), b(j), a(i), b(j), b(i));                     // Vorderseite
      I.push(a(i) + 1, b(j) + 1, a(j) + 1, a(i) + 1, b(i) + 1, b(j) + 1); // Rückseite
      I.push(a(i), a(i) + 1, a(j) + 1, a(i), a(j) + 1, a(j));         // außen
      I.push(b(i), b(j) + 1, b(i) + 1, b(i), b(j), b(j) + 1);         // innen
    }
    const m = { positions: new Float32Array(P), indices: new Uint32Array(I) };
    if (volumen(m) < 0) wende(m);
    return m;
  }
  const sternUmriss = (R, r, n, dreh) => Array.from({ length: n * 2 }, (_, k) => {
    const a = Math.PI / 2 + k * Math.PI / n + (dreh || 0), rr = k % 2 ? r : R;
    return [rr * Math.cos(a), rr * Math.sin(a)];
  });

  // ── Oberflächenmuster (Faktor auf den Radius; z in mm) ────────────────────
  const MUSTER = {
    keine:   { name: 'Glatt',        f: () => 0 },
    rippen:  { name: 'Rippen',       f: (a, z, o) => Math.cos(a * o.musterZahl) },
    spirale: { name: 'Spirale',      f: (a, z, o) => Math.cos(o.musterZahl * a - z / o.hoehe * TAU * 1.5) },
    rauten:  { name: 'Rauten',       f: (a, z, o) => Math.cos(o.musterZahl * a + z * 0.35) * Math.cos(o.musterZahl * a - z * 0.35) },
    strick:  { name: 'Strickzopf',   f: (a, z, o) => Math.abs(Math.sin(o.musterZahl * a + Math.sin(z * 0.5) * 0.6)) * 2 - 1 },
    noppen:  { name: 'Noppen',       f: (a, z, o) => Math.pow(Math.max(0, Math.cos(o.musterZahl * a) * Math.cos(z * 0.45)), 3) * 2 - 0.3 },
  };
  // Muster als absolute Tiefe in mm (wirkt gleich stark auf dünnen und dicken Teilen)
  const musterRf = (rBasis, z, o, stilMod) => a => {
    const r = rBasis * (stilMod ? stilMod(a, z) : 1);
    const t = MUSTER[o.muster] ? MUSTER[o.muster].f(a, z, o) : 0;
    return r + (o.muster !== 'keine' ? o.musterTiefe * 0.5 * t : 0);
  };

  // ── Baum-Stile: liefern das Außenprofil [[r, z], …] (unten → Spitze) und
  //    optional eine Winkel-Modulation stilMod(a, z) ──────────────────────────
  // Etagen-Grundform: jede Etage beginnt unten mit einer 45°-Fase (kein
  // Überhang) und läuft als Kegel nach oben ein.
  function etagenProfil(o, bauch) {
    const T = o.etagen, R = o.durchmesser / 2, H = o.hoehe, pts = [];
    const Rk = k => R * (1 - 0.72 * k / T);
    let rTop = 0, z = 0;
    for (let k = 0; k < T; k++) {
      const R0 = Rk(k), last = k === T - 1;
      const fase = k === 0 ? 0 : Math.max(0, R0 - rTop) * 1.2;   // 50° statt 45°: sicher unter der Überhang-Grenze
      const h = (H - z) / (T - k) * (k === 0 ? 1.15 : 1);
      if (k === 0) pts.push([R0, 0]);
      else pts.push([R0, z + fase]);
      const zEnd = Math.min(H, z + Math.max(h, fase + 6));
      if (bauch) {                                        // rundlicher Bauch, oben eingezogen
        const zB = z + fase, n = 8;
        for (let i = 1; i <= n; i++) {
          const t = i / n, zz = zB + (zEnd - zB) * t;
          const rr = last ? R0 * Math.cos(t * Math.PI / 2) * (1 - 0.2 * t) : R0 * (1 - (1 - o.stufe) * Math.pow(t, 1.7));
          pts.push([Math.max(0, rr), zz]);
        }
        rTop = last ? 0 : R0 * o.stufe;
      } else {
        rTop = last ? 0 : R0 * o.stufe;
        pts.push([rTop, zEnd]);
      }
      z = zEnd;
    }
    if (pts[pts.length - 1][0] > 0) pts.push([0, H]);
    return pts;
  }
  function kegelProfil(o, bauch, n) {
    const R = o.durchmesser / 2, H = o.hoehe, pts = [];
    n = n || 24;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([R * Math.pow(1 - t, bauch || 1), H * t]);
    }
    return pts;
  }
  const BAUMSTILE = {
    etagen:   { name: 'Etagen',        info: 'klassisch gestuft',         profil: o => etagenProfil(o, false) },
    kuerbis:  { name: 'Kugel-Etagen',  info: 'bauchige Etagen mit Kerben', profil: o => etagenProfil(o, true),
                mod: o => (a) => 1 - o.stilTiefe * 0.5 * (1 - Math.cos(o.zahl * a)) },
    spirale:  { name: 'Spirale',       info: 'gedrehte Wülste',           profil: o => kegelProfil(o, 1.1, 40),
                mod: o => (a, z) => 1 + o.stilTiefe * 0.5 * Math.cos(o.zahl * a - z / o.hoehe * o.drehung * Math.PI / 180 * o.zahl) },
    stern:    { name: 'Stern',         info: 'spitzer Stern-Querschnitt', profil: o => kegelProfil(o, 1, 30),
                mod: o => (a, z) => { const w = ((a * o.zahl / TAU + z / o.hoehe * o.drehung / 360) % 1 + 1) % 1; return 1 - o.stilTiefe * Math.abs(w * 2 - 1); } },
    schlank:  { name: 'Schlank',       info: 'hoch, feine Längsrillen',   profil: o => kegelProfil(Object.assign({}, o, { durchmesser: Math.min(o.durchmesser, o.hoehe / 2.6) }), 0.9, 30),
                mod: o => (a) => 1 - o.stilTiefe * 0.25 * (1 - Math.cos(o.zahl * 2 * a)) },
    wellen:   { name: 'Wellen',        info: 'waagrechte Wellen',         profil: o => {
                  const R = o.durchmesser / 2, H = o.hoehe, lam = H / Math.max(2, o.etagen * 1.5), amp = Math.min(R * 0.12, lam / TAU * 0.85), pts = [];
                  for (let i = 0; i <= 90; i++) { const t = i / 90, z = H * t; pts.push([Math.max(0, R * (1 - t) + amp * Math.sin(z / lam * TAU) * (1 - t)), z]); }
                  return pts; } },
    kristall: { name: 'Kristall',      info: 'kantig, je Etage gedreht',  profil: o => etagenProfil(o, false), kanten: o => Math.max(5, Math.min(12, o.zahl)),
                mod: o => (a, z) => { const n = Math.max(5, Math.min(12, o.zahl)), tier = Math.floor(z / o.hoehe * o.etagen), ph = a + tier * Math.PI / n;
                  return Math.cos(Math.PI / n) / Math.cos(((ph % (TAU / n)) + TAU / n) % (TAU / n) - Math.PI / n); } },
    gefaltet: { name: 'Gefaltet',      info: 'Papier-Falten (Faltenbaum)', extern: true },
  };

  // ── Mützen-Stile: Profil + Biegung (Mittelpunkt wandert) ───────────────────
  const MUETZENSTILE = {
    klassisch: { name: 'Klassisch',  info: 'leicht gebogen, glatte Krempe', biegung: 0.35, spitz: 1.3 },
    zipfel:    { name: 'Zipfel',     info: 'lang und stark gebogen',       biegung: 0.3, spitz: 1.6, lang: 1.25 },
    strick:    { name: 'Strick',     info: 'Strickrippen, gerippte Krempe', biegung: 0.3, spitz: 1.2, strick: true },
    kurz:      { name: 'Kurz',       info: 'gerade, kegelig',              biegung: 0.08, spitz: 1.0, lang: 0.8 },
  };
  // ── Glocken-Stile: Profilpunkte relativ (r/R, z/H) von unten nach oben ─────
  const GLOCKENSTILE = {
    klassisch: { name: 'Klassisch', info: 'ausgestellter Rand', pr: [[1, 0], [0.97, 0.06], [0.82, 0.18], [0.66, 0.38], [0.6, 0.6], [0.58, 0.78], [0.52, 0.9], [0.36, 0.98], [0, 1]] },
    schlank:   { name: 'Schlank',   info: 'hoch und schmal',    pr: [[1, 0], [0.93, 0.08], [0.72, 0.22], [0.6, 0.45], [0.56, 0.72], [0.52, 0.88], [0.34, 0.98], [0, 1]], streck: 1.25 },
    tulpe:     { name: 'Tulpe',     info: 'weit ausgestellt',   pr: [[1, 0], [0.88, 0.05], [0.66, 0.14], [0.52, 0.3], [0.5, 0.55], [0.52, 0.78], [0.46, 0.92], [0.3, 0.99], [0, 1]], streck: 0.9 },
    gerippt:   { name: 'Gerippt',   info: 'mit Längsrippen',    pr: [[1, 0], [0.97, 0.06], [0.82, 0.18], [0.66, 0.38], [0.6, 0.6], [0.58, 0.78], [0.52, 0.9], [0.36, 0.98], [0, 1]], rippen: true },
  };

  const OBJEKTE = { baum: 'Baum', muetze: 'Mütze', glocke: 'Glocke' };
  const LICHTMUSTER = { keine: 'ohne Löcher', rauten: 'Rauten', sterne: 'Sterne', punkte: 'Punkte', schlitze: 'Spitzbögen' };
  const TEELICHT = { d: 39.5, h: 17 };                     // LED-Teelicht Ø 38 × 15–16 mm + Luft

  const DEFAULTS = {
    objekt: 'baum', stil: 'etagen',
    hoehe: 120, durchmesser: 80, etagen: 4, stufe: 0.62, zahl: 8, stilTiefe: 0.18, drehung: 120,
    muster: 'keine', musterTiefe: 1.2, musterZahl: 16,
    variante: 'massiv',                // massiv | licht | dose | anhaenger
    wand: 1.6, lichtMuster: 'rauten', lichtGroesse: 7, spiel: 0.3,
    sockel: true, sockelForm: 'rund', sockelBreite: 0, sockelTiefe: 0, sockelDicke: 8, sockelRand: 8,
    inschrift: '', inschriftArt: 'erhaben',
    stern: true, kloeppel: true, oese: false,
    anordnung: 'ansicht',              // ansicht | druck
    farbeKoerper: '#3F8E43', farbeAkzent: '#E4BD68', farbeSockel: '#D1D3D5', farbeWeiss: '#FFFFFF', farbeRot: '#C12E1F',
    aufloesung: 1,
  };
  const UI = {
    allgemein: [
      { key: 'hoehe', label: 'Höhe', min: 30, max: 300, step: 1, unit: 'mm' },
      { key: 'durchmesser', label: 'Durchmesser', min: 20, max: 220, step: 1, unit: 'mm' },
    ],
    baum: [
      { key: 'etagen', label: 'Etagen', min: 1, max: 9, step: 1 },
      { key: 'stufe', label: 'Einzug je Etage', min: 0.3, max: 0.9, step: 0.01 },
      { key: 'zahl', label: 'Zacken / Kerben', min: 3, max: 24, step: 1 },
      { key: 'stilTiefe', label: 'Ausprägung', min: 0, max: 0.45, step: 0.01 },
      { key: 'drehung', label: 'Drehung', min: 0, max: 360, step: 5, unit: '°' },
    ],
    muetze: [], glocke: [],
    muster: [
      { key: 'musterTiefe', label: 'Mustertiefe', min: 0.2, max: 3, step: 0.1, unit: 'mm' },
      { key: 'musterZahl', label: 'Musterdichte', min: 4, max: 48, step: 1 },
    ],
    licht: [
      { key: 'wand', label: 'Wandstärke', min: 1.2, max: 4, step: 0.1, unit: 'mm' },
      { key: 'lichtGroesse', label: 'Lochgröße', min: 4, max: 16, step: 0.5, unit: 'mm' },
    ],
    sockel: [
      { key: 'sockelDicke', label: 'Sockelhöhe', min: 3, max: 30, step: 0.5, unit: 'mm' },
      { key: 'sockelRand', label: 'Rand', min: 2, max: 40, step: 1, unit: 'mm' },
      { key: 'sockelBreite', label: 'Breite (0 = auto)', min: 0, max: 260, step: 1, unit: 'mm' },
      { key: 'sockelTiefe', label: 'Tiefe (0 = auto)', min: 0, max: 260, step: 1, unit: 'mm' },
      { key: 'spiel', label: 'Spiel Zapfen/Deckel', min: 0.1, max: 0.8, step: 0.05, unit: 'mm' },
    ],
  };
  const VORLAGEN = {
    'Tannenbaum klassisch': { objekt: 'baum', stil: 'etagen', hoehe: 120, durchmesser: 80, etagen: 4 },
    'Kugel-Tanne mit Namen': { objekt: 'baum', stil: 'kuerbis', hoehe: 130, durchmesser: 82, etagen: 4, zahl: 9, stilTiefe: 0.16, inschrift: 'Emma 2026' },
    'Sternbaum-Licht': { objekt: 'baum', stil: 'stern', variante: 'licht', hoehe: 160, durchmesser: 95, zahl: 6, stilTiefe: 0.22, drehung: 90, lichtMuster: 'sterne', stern: true },
    'Spiralbaum-Dose': { objekt: 'baum', stil: 'spirale', variante: 'dose', hoehe: 140, durchmesser: 90, zahl: 6, stilTiefe: 0.2, drehung: 200, sockel: false },
    'Nikolausmütze': { objekt: 'muetze', stil: 'klassisch', hoehe: 110, durchmesser: 75 },
    'Mützen-Licht': { objekt: 'muetze', stil: 'strick', variante: 'licht', hoehe: 130, durchmesser: 90, lichtMuster: 'punkte' },
    'Glocke mit Öse': { objekt: 'glocke', stil: 'klassisch', hoehe: 70, durchmesser: 60, sockel: false, oese: true },
    'Mini-Anhänger Baum': { objekt: 'baum', stil: 'kristall', variante: 'anhaenger', hoehe: 60, durchmesser: 42, etagen: 3, zahl: 6, sockel: false },
  };

  // Bambu PLA Basic / Matte (Namen + Code aus Bambu Studio, filaments_color_codes.json)
  const FARBEN = [
    ['PLA Basic', 'Mistelzweig-Grün', '10502', '#3F8E43'], ['PLA Basic', 'Bambusgrün', '10501', '#00AE42'], ['PLA Matte', 'Grasgrün', '11500', '#61C680'],
    ['PLA Matte', 'Dunkelgrün', '11501', '#68724D'], ['PLA Basic', 'Rot', '10200', '#C12E1F'], ['PLA Matte', 'Scharlachrot', '11200', '#DE4343'],
    ['PLA Basic', 'Kastanienrot', '10205', '#9D2235'], ['PLA Basic', 'Jade-Weiß', '10100', '#FFFFFF'], ['PLA Matte', 'Elfenbeinweiß', '11100', '#FFFFFF'],
    ['PLA Basic', 'Gold', '10401', '#E4BD68'], ['PLA Basic', 'Silber', '10102', '#A6A9AA'], ['PLA Basic', 'Bronze', '10801', '#847D48'],
    ['PLA Basic', 'Hellgrau', '10104', '#D1D3D5'], ['PLA Basic', 'Schwarz', '10101', '#000000'], ['PLA Basic', 'Kakaobraun', '10802', '#6F5034'],
    ['PLA Matte', 'Karamell', '11803', '#AE835B'], ['PLA Basic', 'Sonnenblumen-Gelb', '10402', '#FEC600'], ['PLA Matte', 'Eisblau', '11601', '#A3D8E1'],
    ['PLA Basic', 'Kobaltblau', '10604', '#0056B8'], ['PLA Basic', 'Beige', '10201', '#F7E6DE'],
  ].map(([typ, name, code, hex]) => ({ typ, name, code, hex }));

  function normalize(p) {
    const o = Object.assign({}, DEFAULTS, p || {});
    o.hoehe = clamp(+o.hoehe, 30, 300); o.durchmesser = clamp(+o.durchmesser, 20, 220);
    o.etagen = Math.round(clamp(+o.etagen, 1, 9)); o.zahl = Math.round(clamp(+o.zahl, 3, 24));
    o.stufe = clamp(+o.stufe, 0.3, 0.9); o.stilTiefe = clamp(+o.stilTiefe, 0, 0.45);
    o.musterTiefe = clamp(+o.musterTiefe, 0.2, 3); o.musterZahl = Math.round(clamp(+o.musterZahl, 4, 48));
    o.wand = clamp(+o.wand, 1.2, 4); o.spiel = clamp(+o.spiel, 0.1, 0.8); o.lichtGroesse = clamp(+o.lichtGroesse, 4, 16);
    o.sockelDicke = clamp(+o.sockelDicke, 3, 30); o.sockelRand = clamp(+o.sockelRand, 2, 40);
    if (!OBJEKTE[o.objekt]) o.objekt = 'baum';
    const stile = o.objekt === 'baum' ? BAUMSTILE : o.objekt === 'muetze' ? MUETZENSTILE : GLOCKENSTILE;
    if (!stile[o.stil]) o.stil = Object.keys(stile)[0];
    if (!['massiv', 'licht', 'dose', 'anhaenger'].includes(o.variante)) o.variante = 'massiv';
    if (o.variante === 'dose' && o.objekt !== 'baum') o.variante = 'massiv';
    if (o.variante === 'anhaenger') { o.sockel = false; o.oese = true; }
    if (o.variante === 'licht') o.sockel = true;           // Licht braucht den Teelicht-Sockel
    return o;
  }

  // Außenprofil eines Objekts (ohne Muster): [[r, z], …] + Winkel-Modulation + Mitte(z)
  function aussen(o) {
    if (o.objekt === 'baum') {
      const st = BAUMSTILE[o.stil];
      if (st.extern) return { pr: kegelProfil(o, 1, 12), mod: null, mitte: () => [0, 0] };   // Faltenbaum: Hülle nur für Sockelmaße
      return { pr: st.profil(o), mod: st.mod ? st.mod(o) : null, mitte: () => [0, 0] };
    }
    if (o.objekt === 'glocke') {
      const st = GLOCKENSTILE[o.stil], R = o.durchmesser / 2, H = o.hoehe * (st.streck || 1);
      const pr = [];
      for (let i = 0; i + 1 < st.pr.length; i++) {          // glätten: Catmull-Rom zwischen den Stützpunkten
        const a = st.pr[Math.max(0, i - 1)], b = st.pr[i], c = st.pr[i + 1], d = st.pr[Math.min(st.pr.length - 1, i + 2)];
        for (let k = 0; k < 6; k++) {
          const t = k / 6, t2 = t * t, t3 = t2 * t;
          const f = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
          pr.push([Math.max(0, f(a[0], b[0], c[0], d[0]) * R), f(a[1], b[1], c[1], d[1]) * H]);
        }
      }
      pr.push([0, H]);
      return { pr, mod: st.rippen ? (a => 1 - 0.06 * (1 - Math.cos(12 * a))) : null, mitte: () => [0, 0], hoehe: H };
    }
    // Mütze: Körper über der Krempe; Mitte wandert mit wachsender Höhe zur Seite
    const st = MUETZENSTILE[o.stil], R = o.durchmesser / 2 * 0.86, kH = krempe(o).h, H = o.hoehe * (st.lang || 1) - kH, pr = [];
    const rSpitze = Math.max(2, R * 0.08);
    for (let i = 0; i <= 40; i++) { const t = i / 40; pr.push([rSpitze + (R - rSpitze) * Math.pow(1 - t, st.spitz), kH + H * t]); }
    // Biegung als Schräge der Ringmitten; Steigung gedeckelt, damit die Unterseite ≤ 45° bleibt
    const B = st.biegung * H;
    const mitte = z => { const t = clamp((z - kH) / H, 0, 1); return [B * t * t, 0]; };
    return { pr, mod: st.strick ? (a => 1 - 0.07 * Math.abs(Math.sin(8 * a))) : null, mitte, spitze: { r: rSpitze, z: kH + H, x: B } };
  }
  function krempe(o) {
    const R = o.durchmesser / 2;
    return { r: R, h: Math.max(6, o.hoehe * 0.14), dick: Math.max(4, R * 0.16) };
  }

  // Innenprofil (Hohlkörper): Wand ≥ w rundum; die Decke steigt nie flacher als 45°
  function innenProfil(pr, w, rMin, zBoden) {
    const zMax = pr[pr.length - 1][1], N = 160, rAt = z => {
      if (z <= pr[0][1]) return pr[0][0];
      for (let i = 1; i < pr.length; i++) if (pr[i][1] >= z) { const [r0, z0] = pr[i - 1], [r1, z1] = pr[i]; return z1 - z0 < EPS ? Math.min(r0, r1) : r0 + (r1 - r0) * (z - z0) / (z1 - z0); }
      return 0;
    };
    const zMin = pr[0][1], zs = Array.from({ length: N + 1 }, (_, i) => zBoden + (zMax - zBoden) * i / N);
    let ri = zs.map(z => { let m = Infinity; for (let d = -w; d <= w + EPS; d += w / 4) m = Math.min(m, rAt(clamp(z + d, zMin, zMax)) * rMin - Math.sqrt(Math.max(0, w * w - d * d))); return m; });
    for (let i = N - 1; i >= 0; i--) ri[i] = Math.min(ri[i], ri[i + 1] + (zs[i + 1] - zs[i]));   // 45°-Regel von oben
    const out = [];
    for (let i = 0; i <= N; i++) { if (ri[i] < 1) { out.push([0, zs[i]]); break; } out.push([ri[i], zs[i]]); }
    if (out[out.length - 1][0] > 0) out.push([0, zs[N] - w]);
    return out;                                              // unten → oben, endet auf der Achse
  }

  // ── Teile bauen ───────────────────────────────────────────────────────────
  function generate(params) {
    const o = normalize(params), S = Math.round(clamp(96 * o.aufloesung, 24, 192)), teile = [], hinweise = [];
    const A = aussen(o), modBreite = A.mod ? 1 - (o.objekt === 'baum' ? o.stilTiefe : 0.07) : 1;
    const mus = o.muster !== 'keine' ? o.musterTiefe : 0;
    const SK = o.objekt === 'baum' && BAUMSTILE[o.stil].kanten ? BAUMSTILE[o.stil].kanten(o) * Math.ceil(S / BAUMSTILE[o.stil].kanten(o)) : S;
    const dz = o.sockel ? o.sockelDicke : 0;                 // Körper steht auf dem Sockel
    const rf = (r, z) => musterRf(r, z, o, A.mod);
    const auss = (r, z) => { const [cx, cy] = A.mitte(z); return { z: z + dz, rf: rf(r, z), cx, cy }; };
    const pr = A.pr, R0 = pr[0][0];
    const zapfen = o.sockel && o.variante === 'massiv' && o.objekt === 'baum' ? { r: clamp(R0 * 0.18, 3, 8), h: clamp(o.hoehe * 0.08, 4, 10) } : null;
    let koerperName = OBJEKTE[o.objekt];

    if (o.objekt === 'baum' && BAUMSTILE[o.stil].extern) {
      teile.push({ rolle: 'koerper', name: 'Baum (gefaltet)', extern: 'faltenbaum', farbe: o.farbeKoerper, z: dz });
    } else if (o.variante === 'licht' || o.objekt === 'glocke') {
      // Hohlkörper, unten offen. Licht: Wand o.wand; Glocke immer hohl (wie eine echte Glocke)
      const w = o.variante === 'licht' ? o.wand : Math.max(1.6, o.durchmesser * 0.04);
      const inn = innenProfil(pr, w + mus * 0.5, modBreite, pr[0][1]);
      const pts = [];
      for (let i = inn.length - 1; i >= 0; i--) pts.push({ z: inn[i][1] + dz, r: inn[i][0], cx: A.mitte(inn[i][1])[0] });
      pts.push(auss(R0, pr[0][1]));
      for (let i = 1; i < pr.length; i++) pr[i][0] > 0 ? pts.push(auss(pr[i][0], pr[i][1])) : pts.push({ z: pr[i][1] + dz, r: 0, cx: A.mitte(pr[i][1])[0] });
      if (A.spitze && pts[pts.length - 1].r !== 0) pts.push({ z: A.spitze.z + dz, r: 0, cx: A.spitze.x });
      teile.push({ rolle: 'koerper', name: koerperName + (o.variante === 'licht' ? '-Licht' : ''), mesh: zug(pts, SK), farbe: o.objekt === 'muetze' ? o.farbeRot : o.objekt === 'glocke' ? o.farbeAkzent : o.farbeKoerper });
      if (o.variante === 'licht') {
        if (inn[0][0] < TEELICHT.d / 2 + 2.5 + o.spiel) hinweise.push('Unten zu eng für ein LED-Teelicht (Ø 38 mm) – Durchmesser größer wählen.');
        teile[teile.length - 1].innenUnten = inn[0][0];
        teile[teile.length - 1].loecher = lichtLoecher(o, pr, inn, A, dz);
      }
    } else if (o.variante === 'dose') {
      // Unterteil: Boden 2 mm, Innenwand, oben 45°-Trichter. Deckel: Steckzapfen + passende Fase, darüber der Baum.
      const zs = o.hoehe * 0.42, w = Math.max(1.6, o.wand), lipH = 6;
      const inn = innenProfil(pr.map(p => [p[0], p[1]]), w + mus * 0.5, modBreite, 2);
      const lerp = (P, z) => { for (let i = 1; i < P.length; i++) if (P[i][1] >= z) { const [r0, z0] = P[i - 1], [r1, z1] = P[i]; return r0 + (r1 - r0) * (z - z0) / Math.max(EPS, z1 - z0); } return P[P.length - 1][0]; };
      // Fuge folgt der Außenform (Kerben/Muster): Trichterrand überall 0,8 mm hinter der Haut
      const rFuge = lerp(inn, zs), rfZ = rf(lerp(pr, zs), zs);
      let rA = Infinity, rMax = 0; for (let k = 0; k < 96; k++) { const v = rfZ(k / 96 * TAU); rA = Math.min(rA, v); rMax = Math.max(rMax, v); }
      const fase = Math.max(0.8, rMax - 0.8 - rFuge), fz = fase * 1.2;   // Trichter ≥ 50°
      let rLip = Infinity; for (let z = zs - fz - lipH; z <= zs - fz; z += 0.5) rLip = Math.min(rLip, lerp(inn, z));
      rLip = Math.max(3, rLip - o.spiel);
      if (rFuge < 8) hinweise.push('Dose wird innen sehr eng – Durchmesser größer oder Wand dünner wählen.');
      const unten = [{ z: dz, r: 0 }];
      for (const [r, z] of pr) { if (z >= zs) break; unten.push(auss(r, z)); }
      unten.push(auss(lerp(pr, zs), zs), { z: zs + dz, rf: a => Math.max(rFuge + 0.4, rfZ(a) - 0.8) }, { z: zs - fz + dz, r: rFuge });
      // Hohlraum unter dem Trichter höchstens 45° enger werdend (sonst entsteht innen eine Decke)
      for (let i = inn.length - 1; i >= 0; i--) if (inn[i][1] < zs - fz - 0.2 && inn[i][0] > 0) unten.push({ z: inn[i][1] + dz, r: Math.min(inn[i][0], rFuge + (zs - fz - inn[i][1])) });
      unten.push({ z: inn[0][1] + dz, r: 0 });
      teile.push({ rolle: 'koerper', name: 'Baum-Dose (unten)', mesh: zug(unten, SK), farbe: o.farbeKoerper });
      const zL = zs - fz - lipH - Math.max(0, rFuge - o.spiel - rLip) * 1.2, deckel = [{ z: zL + dz, r: 0 }, { z: zL + dz, r: rLip }, { z: zs - fz + dz, r: rLip }];
      const stufeD = rFuge - o.spiel - rLip;
      if (stufeD > 0.3) { deckel[2].z = zs - fz - stufeD * 1.2 + dz; deckel.push({ z: zs - fz + dz, r: rFuge - o.spiel }); }   // 50°-Schräge statt Absatz
      deckel.push({ z: zs + dz, rf: a => Math.max(rFuge + 0.4, rfZ(a) - 0.8) - o.spiel }, auss(lerp(pr, zs), zs));
      for (const [r, z] of pr) if (z > zs + 0.3) deckel.push(r > 0 ? auss(r, z) : { z: z + dz, r: 0 });
      teile.push({ rolle: 'deckel', name: 'Baum-Dose (Deckel)', mesh: zug(deckel, SK), farbe: o.farbeKoerper, druckZ: -(zL + dz),
        ueberhangOk: TAU * rMax * (0.8 + o.spiel) * 1.15 });                     // 0,8-mm-Absatz an der Fuge: druckbar
    } else {
      // Vollkörper; mit Sockel unten eine Bohrung für den Zapfen
      const pts = [];
      const z0 = pr[0][1] + dz, rb = zapfen ? zapfen.r + o.spiel : 0;
      if (zapfen) pts.push({ z: z0 + zapfen.h + 0.5 + rb, r: 0 }, { z: z0 + zapfen.h + 0.5, r: rb }, { z: z0, r: rb });   // Bohrungsdecke als 45°-Kegel
      else pts.push({ z: z0, r: 0 });
      pts.push(auss(R0, pr[0][1]));
      for (let i = 1; i < pr.length; i++) pts.push(pr[i][0] > 0 ? auss(pr[i][0], pr[i][1]) : { z: pr[i][1] + dz, r: 0, cx: A.mitte(pr[i][1])[0] });
      if (A.spitze) pts.push({ z: A.spitze.z + dz, r: 0, cx: A.spitze.x });
      teile.push({ rolle: 'koerper', name: koerperName, mesh: zug(pts, SK), farbe: o.objekt === 'muetze' ? o.farbeRot : o.farbeKoerper });
    }

    // Mütze: Krempe (Ring) + Bommel
    if (o.objekt === 'muetze') {
      const K = krempe(o), st = MUETZENSTILE[o.stil], innen = o.variante === 'licht' ? Math.max(1, A.pr[0][0] - o.wand - 0.5) : 0;
      const kr = r => st.strick ? (a => r * (1 - 0.05 * Math.pow(Math.abs(Math.cos(18 * a)), 0.5))) : null;
      const bauch = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10, rr = K.r - K.dick * 0.35 * Math.pow(Math.abs(t * 2 - 1), 2); bauch.push({ z: dz + K.h * t, ...(kr(rr) ? { rf: kr(rr) } : { r: rr }) }); }
      const pts = innen ? [{ z: dz + K.h, r: innen }, { z: dz, r: innen }].concat(bauch.reverse().reverse()) : [{ z: dz, r: 0 }].concat(bauch, [{ z: dz + K.h, r: 0 }]);
      teile.push({ rolle: 'krempe', name: 'Krempe', mesh: zug(pts, S, !!innen), farbe: o.farbeWeiss });
      const sp = A.spitze, rb = Math.max(6, o.durchmesser * 0.13), bom = [{ z: 0, r: 0 }];
      // Bommel mit flachem Fuß (auf der Spitze), Unterseite 45°, oben rund
      bom.push({ z: 0, r: sp.r + 0.5 }, { z: rb - sp.r, r: rb });
      for (let i = 1; i <= 8; i++) { const a = i / 8 * Math.PI / 2; bom.push({ z: rb - sp.r + Math.sin(a) * rb, r: Math.cos(a) * rb }); }
      bom[bom.length - 1].r = 0;
      const fluff = a => 1;                                 // glatt – Flausch über das Muster „Noppen“
      teile.push({ rolle: 'bommel', name: 'Bommel', mesh: bewege(zug(bom.map(p => ({ z: p.z, r: p.r * fluff(0) })), S), sp.x, 0, sp.z + dz), farbe: o.farbeWeiss, druckZ: -(sp.z + dz), druckX: -sp.x });
    }

    // Glocke: Klöppel (Tropfen, druckbar mit Spitze nach unten → Kugel hängt) + Öse
    const hTop = (A.hoehe || o.hoehe) + dz;
    if (o.objekt === 'glocke' && o.kloeppel) {
      // Tropfen: Spitze unten, 45° aufgehend, oben runde Kappe, darüber der Stiel (druckt stehend ohne Stütze)
      const rk = Math.max(3, o.durchmesser * 0.1), L = (A.hoehe || o.hoehe) * 0.55, rs = Math.max(1.6, rk * 0.3), pts = [{ z: 0, r: 0 }];
      const zc = rk * Math.SQRT2;                            // Kugelmitte: 45°-Kegel trifft die Kugel tangential
      for (let i = 0; i <= 8; i++) { const a = -Math.PI / 4 + i / 8 * (Math.PI / 4 + Math.acos(rs / rk)); pts.push({ z: zc + Math.sin(a) * rk, r: Math.cos(a) * rk }); }
      pts.push({ z: L, r: rs }, { z: L, r: 0 });
      teile.push({ rolle: 'kloeppel', name: 'Klöppel', mesh: bewege(zug(pts, 48), 0, 0, dz + 2), farbe: o.farbeSockel, hinweis: 'Klöppel getrennt drucken und innen einkleben' });
    }
    if (o.oese || o.variante === 'anhaenger') {
      // flache Lasche mit Tropfenloch (Spitze oben, 45°) – steht senkrecht, druckt ohne Stütze
      const b = Math.max(2.4, o.durchmesser * 0.05), lo = Math.max(2.2, o.durchmesser * 0.045), d = Math.max(2.4, o.durchmesser * 0.04);
      const tropfen = (rr, z0) => [[-rr, z0], [rr, z0], [rr, z0 + rr], [0, z0 + rr + rr * 1.15], [-rr, z0 + rr]];
      const oe = lochPlatte(tropfen(lo + b, -lo), tropfen(lo, b * 0.6), d);
      // Mütze: Öse oben auf dem Bommel (hängt beim Drucken an ihm); sonst auf der Spitze des Körpers
      const rbM = Math.max(6, o.durchmesser * 0.13), aufBommel = o.objekt === 'muetze';
      const topX = A.spitze ? A.spitze.x : 0, topZ = A.spitze ? A.spitze.z + dz + (aufBommel ? 2 * rbM - A.spitze.r : 0) : hTop;
      teile.push({ rolle: 'oese', name: 'Öse', mesh: bewege(oe, topX, 0, topZ - b * 0.4), farbe: aufBommel ? o.farbeWeiss : o.farbeAkzent, haftAn: aufBommel ? 'bommel' : 'koerper' });
    }

    // Baum: Stern auf der Spitze
    if (o.objekt === 'baum' && o.stern && o.variante !== 'dose') {
      const Rs = clamp(o.durchmesser * 0.16, 7, 26), d = clamp(Rs * 0.3, 3, 6), st = prisma(sternUmriss(Rs, Rs * 0.45, 5), d);
      const stiel = zug([{ z: 0, r: 0 }, { z: 0, r: d * 0.4 }, { z: Rs * 0.9, r: d * 0.4 }, { z: Rs * 0.9, r: 0 }], 24);
      const zT = o.hoehe + dz;
      teile.push({ rolle: 'stern', name: 'Stern', mesh: bewege(st, 0, 0, zT + Rs * 0.55), farbe: o.farbeAkzent, flach: true });
      teile.push({ rolle: 'stern', name: 'Stern-Stiel', mesh: bewege(stiel, 0, 0, zT - Rs * 0.25), farbe: o.farbeAkzent });
    }

    // Sockel (rund / oval / eckig) mit Fase; Zapfen oder Teelicht-Fach
    if (o.sockel) teile.push(sockelTeil(o, R0, zapfen, teile));

    // Modell-Nummer aus den Parametern (gleiches Modell = gleiche Nummer)
    const sig = JSON.stringify(Object.keys(DEFAULTS).sort().map(k => o[k]));
    let h = 2166136261; for (let i = 0; i < sig.length; i++) { h ^= sig.charCodeAt(i); h = Math.imul(h, 16777619); }
    const nummer = 'W-' + (h >>> 0).toString(36).toUpperCase().slice(0, 5);

    let dreiecke = 0; teile.forEach(t => { if (t.mesh) dreiecke += t.mesh.indices.length / 3; });
    const bb = teile.filter(t => t.mesh).reduce((b, t) => { const x = box(t.mesh); return [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.min(b[2], x[2]), Math.max(b[3], x[3]), Math.max(b[4], x[4]), Math.max(b[5], x[5])]; }, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    return { teile, params: o, info: { dreiecke, box: bb, nummer, hinweise } };
  }

  function sockelTeil(o, R0, zapfen, teile) {
    const rand = o.sockelRand, D = o.sockelDicke, licht = o.variante === 'licht';
    const textPlatz = o.inschrift ? Math.max(12, Math.min(22, R0 * 0.35)) : 0;
    const B = (o.sockelBreite || (2 * R0 + 2 * rand)) / 2, T = (o.sockelTiefe || (2 * R0 + 2 * rand + textPlatz)) / 2;
    const cy = o.sockelTiefe || !textPlatz ? 0 : -textPlatz / 2;   // Sockel nach vorn verlängert: Platz für die Inschrift
    const n = o.sockelForm === 'eckig' ? 6 : o.sockelForm === 'sechseck' ? 0 : 2;
    const form = (a, ein) => {
      if (o.sockelForm === 'sechseck') { const s = TAU / 6, ph = ((a % s) + s) % s - s / 2; return (B - ein) * Math.cos(s / 2) / Math.cos(ph); }
      const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
      return 1 / Math.pow(Math.pow(c / (B - ein), n) + Math.pow(s / (T - ein), n), 1 / n);
    };
    const fase = Math.min(2, D * 0.3), pts = [{ z: 0, r: 0, cy }, { z: 0, rf: a => form(a, 0), cy }, { z: D - fase, rf: a => form(a, 0), cy }, { z: D, rf: a => form(a, fase), cy }];
    if (licht) {
      // oben: Ring, über den der Schirm greift; darin das Fach fürs LED-Teelicht
      const kopf = teile.find(t => t.rolle === 'koerper'), rS = (kopf && kopf.innenUnten ? kopf.innenUnten : R0 - o.wand) - o.spiel, rF = TEELICHT.d / 2;
      const rRing = Math.max(rF + 1.6, rS);
      pts.push({ z: D, r: rRing }, { z: D + 4, r: rRing }, { z: D + 4, r: rF }, { z: Math.max(1.2, D + 4 - TEELICHT.h), r: rF }, { z: Math.max(1.2, D + 4 - TEELICHT.h), r: 0 });
    } else if (zapfen) {
      pts.push({ z: D, r: zapfen.r }, { z: D + zapfen.h, r: zapfen.r }, { z: D + zapfen.h, r: 0 });
    } else pts.push({ z: D, r: 0 });
    const m = zug(pts.map(p => p.rf ? p : Object.assign({}, p, { cy: p.r ? 0 : 0 })), 128);
    // Pole liegen bei cy = 0 bzw. Sockelmitte – Ringe mit Form-Funktion sind um cy verschoben
    return { rolle: 'sockel', name: licht ? 'Teelicht-Sockel' : 'Sockel', mesh: m, farbe: o.farbeSockel,
      inschrift: o.inschrift ? { text: o.inschrift, art: o.inschriftArt, x: 0, y: cy - T + textPlatz / 2 + rand * 0.25, z: D, breite: B * 1.5, hoehe: Math.min(textPlatz * 0.6, 10) } : null };
  }

  // Löcher im Lampenschirm: Prismen radial durch die Wand (App zieht sie per Manifold ab)
  function lichtLoecher(o, pr, inn, A, dz) {
    if (o.lichtMuster === 'keine') return [];
    const g = o.lichtGroesse, out = [], zMax = inn[inn.length - 1][1];
    const rAt = (P, z) => { for (let i = 1; i < P.length; i++) if (P[i][1] >= z) { const [r0, z0] = P[i - 1], [r1, z1] = P[i]; return r0 + (r1 - r0) * (z - z0) / Math.max(EPS, z1 - z0); } return 0; };
    const umriss = {
      rauten:   [[0, -g / 2], [g * 0.32, 0], [0, g / 2], [-g * 0.32, 0]],
      sterne:   sternUmriss(g / 2, g * 0.22, 5).map(([x, y]) => [x, y]),
      punkte:   Array.from({ length: 16 }, (_, k) => [Math.cos(k / 16 * TAU) * g * 0.4, Math.sin(k / 16 * TAU) * g * 0.4]),
      schlitze: [[-g * 0.18, -g * 0.8], [g * 0.18, -g * 0.8], [g * 0.18, g * 0.45], [0, g * 0.8], [-g * 0.18, g * 0.45]],
    }[o.lichtMuster];
    const reihe = g * 1.9, zStart = 8 + g, zEnde = zMax - g * 1.4;
    let k = 0;
    for (let z = zStart; z <= zEnde; z += reihe, k++) {
      const rA = rAt(pr, z), rI = rAt(inn, z);
      if (rI < g || rA - rI > o.wand * 3 + 4) continue;     // zu eng oder zu dick (Etagenrand) → auslassen
      const n = Math.floor(TAU * rA / (g * 1.8));
      if (n < 3) continue;
      const [cx] = A.mitte(z);
      for (let j = 0; j < n; j++) {
        const a = (j + (k % 2) * 0.5) / n * TAU, c = Math.cos(a), s = Math.sin(a), r1 = rI - 1.5, r2 = rA + 3, P = [], I = [];
        const q = (rr, u, v) => [cx + rr * c - u * s, rr * s + u * c, z + dz + v];
        const m = umriss.length;
        P.push(...q(r1, 0, 0), ...q(r2, 0, 0));
        for (const [u, v] of umriss) P.push(...q(r1, u, v), ...q(r2, u, v));
        for (let i = 0; i < m; i++) {
          const a1 = 2 + i * 2, b1 = 2 + ((i + 1) % m) * 2;
          I.push(0, b1, a1, 1, a1 + 1, b1 + 1, a1, b1, b1 + 1, a1, b1 + 1, a1 + 1);
        }
        const mm = { positions: new Float32Array(P), indices: new Uint32Array(I) };
        if (volumen(mm) < 0) wende(mm);
        out.push(mm);
      }
    }
    return out;
  }

  // ── Prüfungen (auch von den Tests genutzt) ────────────────────────────────
  function pruefe(m) {
    const P = m.positions, I = m.indices, q = 1e-4, key = i => Math.round(P[i * 3] / q) + ',' + Math.round(P[i * 3 + 1] / q) + ',' + Math.round(P[i * 3 + 2] / q);
    const kanten = new Map();
    for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) {
      const ka = key(a), kb = key(b); if (ka === kb) continue;
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka; kanten.set(k, (kanten.get(k) || 0) + 1);
    }
    let offen = 0, mehr = 0; for (const n of kanten.values()) { if (n === 1) offen++; else if (n > 2) mehr++; }
    return { offen, mehr, volumen: volumen(m) };
  }
  // Überhangfläche (mm²): Dreiecke, deren Normale steiler als grenze° nach unten zeigt, nicht auf z = zBett
  function ueberhang(m, grenze, zBett) {
    const P = m.positions, I = m.indices, cg = Math.cos((grenze || 45) * Math.PI / 180); let f = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
      if (l < 1e-12 || nz / l > -cg - 1e-6) continue;
      if ((P[a + 2] + P[b + 2] + P[c + 2]) / 3 < (zBett || 0) + 0.05) continue;
      f += l / 2;
    }
    return f;
  }

  const API = { generate, normalize, zug, prisma, pruefe, ueberhang, volumen, box, bewege, drehX,
    DEFAULTS, UI, VORLAGEN, OBJEKTE, BAUMSTILE, MUETZENSTILE, GLOCKENSTILE, MUSTER, LICHTMUSTER, FARBEN, TEELICHT };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.V3DWeihnacht = API;
})(typeof window !== 'undefined' ? window : this);
