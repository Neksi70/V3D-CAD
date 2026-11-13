// Kamin-Adventskalender — Rechenkern. Feuerstelle, Trichter und Krone wie v3d_kamin_adventskalender.scad;
// Turm und Schieber nach Volkers Foto (13.11.): Schlitze links UND rechts auf jeder Etage, Tages-Schieber mit runder
// Griffscheibe + Zahl abwechselnd von rechts (ungerade) und links (gerade), freie Schlitze mit Blindstopfen.
// Fachhöhe = beim Befüllen wählen (den nächsten Tag einfach ein paar Etagen höher einschieben).
// Manifold, mm, OpenSCAD-Koordinaten (Z oben).
// Läuft im Browser (App) und in Node (Test): kakBuild(wasm, p, textFn) — textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs}
// (App: _lttText); ohne textFn (Node) entstehen keine Zahlen/Namen.
const KAK_DEF = {
  tage: 24,
  /* Schacht */ in_w: 96, in_d: 96, wall: 4, gd: 1.6, pitch: 12, slots: 38, margin_b: 9, margin_t: 24,
  /* Schieber */ pt: 2.4, slot_h: 3.0, clr: 0.3, num_h: 0.6, griff_r: 10.5, griff_t: 3, hals: 2.5, lippe: 1.2,
  /* Feuerstelle */ base_w: 176, base_d: 136, base_h: 112, open_w: 112, open_h: 74, open_ch: 20, floor_t: 4, ramp_h: 12, mantel_t: 10, mantel_o: 8,
  name_txt: '', name_size: 8,
  /* Deko (Foto) */ bogen: 1, schnee: 1, flamme: 1, socken: '', socke_h: 70, deko_t: 1.6,
  /* Optik */ joint_w: 1.2, joint_d: 0.8, font: 'helvetiker_bold',
  /* Generator */ drucker: 'sv08max', bett: [500, 500, 500], teilen: 1
};
const KAK_DRUCKER = {                                                      // Bauraum X × Y × Z (mm)
  sv08max: { name: 'Sovol SV08 Max', bett: [500, 500, 500] },
  h2c: { name: 'Bambu Lab H2C', bett: [300, 320, 325] },                     // sicher für beide Düsen (Bambu: einzeln 305 × 320 × 325)
  k3: { name: 'Creality K3', bett: [260, 260, 260] },                       // laut Vorbestell-Angaben 10/2026
  frei: { name: 'benutzerdefiniert', bett: null }
};
const KAK_EPS = 0.01;
// Abgeleitete Maße (wie „abgeleitete Maße“ in der .scad)
function kakMasse(p) {
  const out_w = p.in_w + 2 * p.wall, out_d = p.in_d + 2 * p.wall;
  const tower_h = p.margin_b + (p.slots - 1) * p.pitch + p.slot_h + p.margin_t;
  const slot_z = i => p.margin_b + i * p.pitch;
  const tab_h = 2 * p.griff_r;                                              // Höhe der Griffscheibe
  const tower_x = (p.base_w - out_w) / 2, tower_y = (p.base_d - out_d) / 2, sock = 5;
  const plate_w = p.in_d + 2 * p.gd - 2 * p.clr, plate_l = p.wall + p.in_w - p.clr;   // Schieber quer (Y) × lang (X, durch Wand + Schacht)
  const tab_z0 = (p.slot_h - p.pt) / 2;
  const fb_w = p.open_w + 18, fb_d = p.base_d - 2 * 8, fb_top = p.floor_t + p.open_h;
  const cap_t = 8;
  return { out_w, out_d, tower_h, slot_z, tab_h, tower_x, tower_y, sock, plate_w, plate_l, tab_z0, fb_w, fb_d, fb_top, cap_t };
}
// Beispielbelegung: Tage gleichmäßig über die Schlitze (24/30 = feste Liste der .scad)
function kakBelegung(tage, slots) {
  const n = Math.max(0, Math.min(tage, slots));
  if (n === 24 && slots === 30) return [0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 26, 27, 28];
  const used = [];
  for (let d = 0; d < n; d++) used.push(Math.floor(d * slots / n));        // gleichmäßig, Lücken = Blindsteine
  return used;
}
// Turm-Segmente: Teilung immer mittig zwischen zwei Schlitzen (auf der horizontalen Mauerfuge)
// Steckfalz-Höhe: Zunge (hz + halbe Wand an 45°) samt Nut-Spiel muss unter den nächsten Schlitz passen → < 1 mm = Raster zu eng zum Teilen
function kakFalzHoehe(p) { return Math.min(3, (p.pitch - p.slot_h) / 2 - p.wall / 2 - 2 * 0.3 - 0.4); }
function kakSegmente(p, m, zMax) {
  const fuge = i => m.slot_z(i) + p.slot_h / 2 + p.pitch / 2, falz = 5.5, teil = [];
  if (!(zMax > 0) || m.tower_h <= zMax) return [0, m.tower_h];
  let z0 = 0; teil.push(0);
  for (let it = 0; it < 50; it++) {
    if (m.tower_h - z0 + (z0 > 0 ? falz : 0) <= zMax) break;
    let best = null;
    for (let i = 0; i < p.slots - 1; i++) { const z = fuge(i); if (z > z0 + p.pitch && z - z0 + (z0 > 0 ? falz : 0) + falz <= zMax) best = z; }
    if (best == null) return null;                                           // passt nicht (Bauhöhe kleiner als ein Raster)
    teil.push(best); z0 = best;
  }
  teil.push(m.tower_h);
  // gleichmäßiger verteilen: bei n Segmenten die Mauerfuge nächst an s·H/n nehmen, wenn alles passt
  const n = teil.length - 1, fugen = Array.from({ length: p.slots - 1 }, (_, i) => fuge(i));
  const glatt = [0]; for (let s = 1; s < n; s++) { const ziel = m.tower_h * s / n; glatt.push(fugen.reduce((a, b) => Math.abs(b - ziel) < Math.abs(a - ziel) ? b : a)); }
  glatt.push(m.tower_h);
  const passt = glatt.every((z, s) => s === 0 || (z > glatt[s - 1] && z - glatt[s - 1] + (s > 1 ? falz : 0) + (s < n ? falz : 0) <= zMax));
  return passt ? glatt : teil;
}
function kakBuild(w, pIn, textFn, opt) {
  const p = { ...KAK_DEF, ...pIn }, m = kakMasse(p), M = w.Manifold, CS = w.CrossSection, eps = KAK_EPS, tmp = [], k = x => { tmp.push(x); return x; };
  const cube = (s, t) => { let c = k(M.cube(s)); return t ? k(c.translate(t)) : c; };
  const U = a => a.length === 1 ? a[0] : k(M.union(a));
  const hull = a => k(M.hull(a));
  const fein = !(opt && opt.vorschau);
  try {
    const { out_w, out_d, tower_h, slot_z, tab_h, tower_x, tower_y, sock, plate_w, plate_l, tab_z0, fb_w, fb_d, fb_top, cap_t } = m;
    // ── TURM: Schlitze links + rechts auf jeder Etage (durch beide Seitenwände), Führungsnut vorn/hinten, Mauerfugen vorn/hinten ──
    const tower = () => {
      const cut = [cube([p.in_w, p.in_d, tower_h + 2 * eps], [p.wall, p.wall, -eps])];
      for (let i = 0; i < p.slots; i++) cut.push(cube([out_w + 2, p.in_d + 2 * p.gd, p.slot_h], [-1, p.wall - p.gd, slot_z(i)]));
      const reihe = 2 * p.pitch, stein = 36;                                 // Ziegel: 2 Etagen hoch
      for (let r = 0; ; r++) {
        const z = slot_z(0) + p.slot_h / 2 + p.pitch / 2 + r * reihe; if (z + reihe > tower_h - 3) break;
        for (const y of [-eps, out_d - p.joint_d]) cut.push(cube([out_w + 2 * eps, p.joint_d + eps, p.joint_w], [-eps, y, z - p.joint_w / 2]));
        if (z + reihe + reihe > tower_h - 3) continue;
        for (let x = (r % 2 ? stein / 2 : stein) ; x < out_w - 4; x += stein) for (const y of [-eps, out_d - p.joint_d]) cut.push(cube([p.joint_w, p.joint_d + eps, reihe], [x - p.joint_w / 2, y, z]));
      }
      return k(cube([out_w, out_d, tower_h]).subtract(U(cut)));
    };
    // ── TAGES-SCHIEBER (links eingeschoben; rechts = um 180° gedreht, gleiches Teil): Platte + Hals + Griffscheibe ──
    // Lage: z = 0 Schlitzunterkante, x = 0 Außenfläche der linken Wand
    const yM = out_d / 2;
    const scheibe = () => k(k(k(M.cylinder(p.griff_t, p.griff_r, p.griff_r, fein ? 64 : 32)).rotate([0, 90, 0])).translate([-p.hals - p.griff_t, yM, tab_z0 + p.griff_r]));
    const stone_body = (d, with_plate) => {
      if (!with_plate) {                                                     // Blindstopfen: Platte in der Wand + Abdecklippe außen + Klemmnoppen
        const y0 = p.wall - p.gd + p.clr, b = [cube([p.wall - p.clr + p.lippe / 2, plate_w, p.pt], [-p.lippe / 2, y0, tab_z0]), cube([p.lippe, p.in_d + 2 * p.gd + 2, p.slot_h + 1 - tab_z0], [-p.lippe, p.wall - p.gd - 1, tab_z0])];   // Lippe endet an der Wandfläche
        for (const y of [y0 + 8, y0 + plate_w - 8]) b.push(k(k(k(M.sphere(0.7, fein ? 24 : 12)).scale([1, 1, 0.5])).translate([(p.wall - p.clr) / 2, y, tab_z0 + p.pt])));
        return U(b);
      }
      const hb = Math.min(p.griff_r * 1.2, plate_w);
      return U([cube([plate_l, plate_w, p.pt], [0, p.wall - p.gd + p.clr, tab_z0]), cube([p.hals + 2 * eps, hb, p.pt], [-p.hals - eps, yM - hb / 2, tab_z0]), scheibe()]);
    };
    // Text mittig an (cx, cy) in der XY-Ebene; Höhe = Ziffern-/Großbuchstabenhöhe (OpenSCAD size ≈ Versalhöhe)
    const textMitte = (txt, size, cx, cy) => {
      if (!textFn || !txt) return null;
      const ref = textFn(CS, k, /\d/.test(txt) ? '0' : 'H', p.font, 50, 0, 0, 1e6); if (!ref || !ref.cs) return null;
      const rb = ref.cs.bounds(), s = size / (rb.max[1] - rb.min[1]);
      const r = textFn(CS, k, txt, p.font, 50, 0, 0, 1e6); if (!r || !r.cs) return null;
      const t = k(r.cs.scale([s, s])), b = t.bounds();
      return k(t.translate([cx - (b.min[0] + b.max[0]) / 2, cy - (rb.min[1] + rb.max[1]) / 2 * s]));
    };
    // Zahl erhaben auf der Außenseite der Scheibe, lesbar von links: Text-x → −Y, Text-y → +Z, Extrusion → −X
    const stone_number = d => {
      const txt = String(d), cs = textMitte(txt, p.griff_r * (txt.length > 1 ? 0.85 : 1.05), 0, 0); if (!cs) return null;
      return k(k(k(cs.extrude(p.num_h + eps)).rotate([90, 0, -90])).translate([-p.hals - p.griff_t + eps, yM, tab_z0 + p.griff_r]));
    };
    const stone_print = d => k(stone_body(d, true).translate([0, 0, -tab_z0]));
    const number_print = d => { const n = stone_number(d); return n ? k(n.translate([0, 0, -tab_z0])) : null; };
    const blank_print = () => k(stone_body(0, false).translate([0, 0, -tab_z0]));
    // ── FEUERSTELLE MIT SIMS ──
    const base_joints = body_h => {
      const row = 14, brick = 36, c = [];
      for (let r = 0; r <= Math.floor((body_h - p.mantel_o - 8) / row); r++) {
        const z = 8 + r * row;
        if (!(z < body_h - p.mantel_o - 2)) continue;
        c.push(k(cube([p.base_w + 2, p.base_d + 2, p.joint_w], [-1, -1, z]).subtract(cube([p.base_w - 2 * p.joint_d, p.base_d - 2 * p.joint_d, p.joint_w + 2], [p.joint_d, p.joint_d, z - 1]))));
        const off = (r % 2 === 0) ? 0 : brick / 2;
        for (let x = off + brick / 2; x <= p.base_w - 4 + 1e-9; x += brick) for (const y of [-eps, p.base_d - p.joint_d]) c.push(cube([p.joint_w, p.joint_d + eps, row], [x, y, z]));
        for (let y = off + brick / 2; y <= p.base_d - 4 + 1e-9; y += brick) for (const x of [-eps, p.base_w - p.joint_d]) c.push(cube([p.joint_d + eps, p.joint_w, row], [x, y, z]));
      }
      return c;
    };
    // Kaminöffnung in (x, −Höhe): .scad = Rechteck mit 45°-Fasen; Deko „Rundbogen“ = Korbbogen (Ellipse, Stich ≤ halbe Höhe)
    const oeffnung2D = () => {
      const ow = p.open_w, oh = p.open_h, oc = p.open_ch;
      if (!p.bogen) return k(new CS([[[-ow / 2, 0], [-ow / 2, -(oh - oc)], [-ow / 2 + oc, -oh], [ow / 2 - oc, -oh], [ow / 2, -(oh - oc)], [ow / 2, 0]]], 'NonZero'));
      const stich = Math.min(ow / 2, oh * 0.5), hs = oh - stich, pts = [[ow / 2, 0], [ow / 2, -hs]];
      for (let i = 1; i < 48; i++) { const t = Math.PI * i / 48; pts.push([ow / 2 * Math.cos(t), -(hs + stich * Math.sin(t))]); }
      pts.push([-ow / 2, -hs], [-ow / 2, 0]);
      return k(new CS([pts], 'NonZero'));
    };
    let baseRoh = null;
    const base = () => {
      if (!baseRoh) baseRoh = base0();
      const ein = [p.bogen && bogenRing(), p.schnee && schneeKante()].filter(Boolean);
      return ein.length ? k(baseRoh.subtract(U(ein))) : baseRoh;
    };
    // ── DEKO als Einlage (gleiche Lage, zweite Farbe, Maße bleiben): heller Bogenrahmen, Schneekante mit Tropfen ──
    const bogenRing = () => {
      if (!baseRoh) baseRoh = base0();
      const ar = oeffnung2D(), aussen = k(k(ar.offset(9, 'Round', 2, 32)).intersect(k(CS.square([p.open_w + 40, p.open_h + 40], false).translate([-(p.open_w + 40) / 2, -(p.open_h + 40)]))));
      let ring = k(aussen.subtract(ar));
      const stich = Math.min(p.open_w / 2, p.open_h * 0.5), hs = p.open_h - stich, fugen = [];   // Fugen: radial im Bogen, waagerecht in den Pfeilern
      for (let i = 1; i < 9; i++) {                                         // radiale Fuge an der Ellipse (Richtung = Normale)
        const t = Math.PI * i / 9, a2 = p.open_w / 2, fx = a2 * Math.cos(t), fy = -(hs + stich * Math.sin(t)), w = Math.atan2(-Math.sin(t) / stich, Math.cos(t) / a2) * 180 / Math.PI;
        fugen.push(k(k(k(CS.square([16, p.joint_w], false).translate([-2, -p.joint_w / 2])).rotate(w)).translate([fx, fy])));
      }
      for (let z = 14; z < hs - 4; z += 14) for (const sx of [-1, 1]) fugen.push(k(CS.square([12, p.joint_w], false).translate([sx > 0 ? p.open_w / 2 - 1 : -p.open_w / 2 - 11, -z - p.joint_w / 2])));
      if (fugen.length) ring = k(ring.subtract(k(CS.union(fugen))));
      if (!baseGlatt) baseGlatt = base0(false);                              // ohne Mauerfugen: der weiße Rahmen hat nur seine eigenen Bogenfugen
      return k(k(k(k(k(ring.extrude(p.deko_t + 1)).rotate([-90, 0, 0])).translate([p.base_w / 2, -1, p.floor_t]))).intersect(baseGlatt));
    };
    const schneeKante = () => {
      if (!baseRoh) baseRoh = base0();
      const t = p.deko_t, top = p.base_h, mo = p.mantel_o, tief = [0.55, 0.85, 0.4, 0.7, 0.5, 0.9, 0.45, 0.75];
      const tropfen = (laenge, frei) => {                                     // 2D-Band (u längs, v nach unten) mit Tropfen
        const L = [k(CS.square([laenge, t + 0.6], false).translate([0, -(t + 0.6)]))];
        for (let i = 0, u = 7; u < laenge - 5; i++, u += 11 + (i % 3) * 3) {
          if (frei && u > frei[0] && u < frei[1]) continue;
          const w = 5 + (i % 2) * 2, d = Math.min(p.mantel_t - 2, 2 + (p.mantel_t - 3) * tief[i % tief.length]);
          L.push(k(CS.square([w, d - w / 2], false).translate([u - w / 2, -(d - w / 2)])), k(CS.circle(w / 2, 24).translate([u, -(d - w / 2)])));
        }
        return k(CS.union(L));
      };
      const breit = p.base_w + 2 * mo, nb = p.name_txt ? [breit / 2 - p.name_txt.length * p.name_size * 0.45, breit / 2 + p.name_txt.length * p.name_size * 0.45] : null;
      const vorn = k(k(k(tropfen(breit, nb).extrude(t + 1)).rotate([90, 0, 0])).translate([-mo, -mo + t, top]));     // (u,v,w) → (u, −w, v)
      const seite = sx => k(k(k(k(tropfen(p.base_d + mo, null).extrude(t + 1)).rotate([90, 0, 90])).translate([0, 0, 0])).translate([sx < 0 ? -mo - 1 : p.base_w + mo - t, -mo, top]));
      const deckel = cube([breit + 2, p.base_d + mo + 2, t], [-mo - 1, -mo - 1, top - t]);
      return k(k(U([vorn, seite(-1), seite(1), deckel])).intersect(baseRoh));
    };
    // Flamme (flach drucken, orange + gelb erhaben) → zum Einkleben an die Rückwand der Feuerstelle
    const flamme2D = () => {
      const tr = (x, y, r, tx, ty) => k(k(CS.hull([k(CS.circle(r, 32).translate([x, y])), k(CS.circle(0.8, 12).translate([tx, ty]))])));
      const a = k(CS.union([tr(0, 14, 14, 3, 60), tr(-13, 10, 9, -21, 41), tr(14, 11, 10, 23, 45)]));
      return { aussen: a, innen: k(k(a.offset(-5, 'Round')).translate([0, -1])) };
    };
    const flammeH = () => Math.max(20, Math.min(p.open_h - p.ramp_h - 6, p.open_h * 0.72));
    const flamme_print = () => { const F = flamme2D(), b = F.aussen.bounds(), s = flammeH() / (b.max[1] - b.min[1]);
      const sc = c => k(k(c.translate([0, -b.min[1]])).scale([s, s]));
      return { aussen: k(sc(F.aussen).extrude(2)), innen: k(k(sc(F.innen).extrude(p.num_h)).translate([0, 0, 2])) }; };
    const flamme_lage = mf => k(k(mf.rotate([90, 0, 0])).translate([p.base_w / 2, (p.base_d + fb_d) / 2 - 0.2, p.floor_t + p.ramp_h]));   // Gesicht nach vorn, an der Rückwand
    // Socke mit Namensschild (flach drucken: rot, weiß erhaben + Name erhaben) → vorn an die Simsecken kleben
    const sockenNamen = () => String(p.socken || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean).slice(0, 2);
    const socke_print = (name, links) => {
      const s = p.socke_h / 70, m = links ? -1 : 1, P = (x, y) => [m * x * s, y * s];
      const R = (x0, y0, x1, y1, r) => { const a = [Math.min(x0, x1), Math.min(y0, y1)], b = [Math.max(x0, x1), Math.max(y0, y1)];
        return k(k(k(CS.square([b[0] - a[0] - 2 * r, b[1] - a[1] - 2 * r], false).translate([a[0] + r, a[1] + r])).offset(r, 'Round', 2, 24))); };
      const schild = R(...P(-21, -8), ...P(21, 8), 4 * s);
      const bein = R(...P(-12, -4), ...P(12, -42), 3 * s), fuss = R(...P(-12, -36), ...P(27, -56), 9 * s);
      const rot = k(k(k(CS.union([schild, bein, fuss])).offset(-2 * s, 'Round')).offset(2 * s, 'Round'));
      const sockeOhneSchild = k(CS.union([bein, fuss]));
      const weiss = k(k(CS.union([R(...P(-14, -10), ...P(14, -19), 2 * s), k(CS.circle(7.5 * s, 32).translate(P(-11, -50))), k(CS.circle(8 * s, 32).translate(P(26, -46)))])).intersect(k(sockeOhneSchild.offset(-1.2 * s, 'Round'))));
      const weissAll = k(CS.union([weiss, R(...P(-14, -10), ...P(14, -19), 2 * s)]));   // Umschlag darf etwas überstehen
      let txt = null;
      if (name && textFn) { const tw = textMitte(name, 7 * s, 0, 0); if (tw) { const bb = tw.bounds(), f = Math.min(1, 34 * s / (bb.max[0] - bb.min[0])); txt = k(k(k(tw.scale([f, f])).extrude(p.num_h)).translate([0, 0, 3])); } }
      return { rot: k(rot.extrude(3)), weiss: k(k(weissAll.extrude(p.num_h)).translate([0, 0, 3])), text: txt };
    };
    const socke_lage = (mf, links) => { const x = links ? 26 : p.base_w - 26;
      return k(k(mf.rotate([90, 0, 0])).translate([x, -p.mantel_o - 0.05, p.base_h - p.mantel_t / 2 + 2])); };   // Rückseite an der Simsfront
    let baseGlatt = null;
    const base0 = (fugen = true) => {
      const body_h = p.base_h - p.mantel_t;
      const koerper = U([hull([cube([p.base_w + 6, p.base_d + 6, 4], [-3, -3, 0]), cube([p.base_w, p.base_d, eps], [0, 0, 7])]),
        cube([p.base_w, p.base_d, body_h]),
        hull([cube([p.base_w, p.base_d, eps], [0, 0, body_h - p.mantel_o]), cube([p.base_w + 2 * p.mantel_o, p.base_d + p.mantel_o, p.mantel_t], [-p.mantel_o, -p.mantel_o, body_h])])]);
      const sx = tower_x + p.wall, sy = tower_y + p.wall;
      const cut = [cube([fb_w, fb_d, p.open_h], [(p.base_w - fb_w) / 2, (p.base_d - fb_d) / 2, p.floor_t]),
        hull([cube([fb_w, fb_d, eps], [(p.base_w - fb_w) / 2, (p.base_d - fb_d) / 2, fb_top - eps]), cube([p.in_w, p.in_d, eps], [sx, sy, fb_top + (fb_w - p.in_w) / 2])]),
        cube([p.in_w, p.in_d, p.base_h], [sx, sy, fb_top]),
        cube([out_w + 0.6, out_d + 0.6, sock + eps], [tower_x - 0.3, tower_y - 0.3, p.base_h - sock])];
      // Kaminöffnung: translate([base_w/2,-20,floor_t]) rotate([-90,0,0]) linear_extrude(40) polygon(…): (x,y,z) → (x, z, −y)
      const pol = oeffnung2D();
      cut.push(k(k(k(pol.extrude(40)).rotate([-90, 0, 0])).translate([p.base_w / 2, -20, p.floor_t])));
      if (fugen) cut.push(...base_joints(body_h));
      let b = k(koerper.subtract(U(cut)));
      // Rampe: rotate([90,0,90]) linear_extrude(fb_w) polygon: (px,py,ez) → (ez, px, py)
      const rp = k(new CS([[[0, 0], [fb_d, 0], [fb_d, p.ramp_h], [fb_d * 0.25, 0]]], 'NonZero'));   // wie .scad (Fläche = Dreieck ab 25 %)
      const ramp = k(k(k(rp.extrude(fb_w)).rotate([90, 0, 90])).translate([(p.base_w - fb_w) / 2, (p.base_d - fb_d) / 2, p.floor_t - eps]));
      b = U([b, ramp]);
      return b;
    };
    const nameplate_text = () => {
      const body_h = p.base_h - p.mantel_t, cs = textMitte(p.name_txt, p.name_size, 0, 0); if (!cs) return null;
      return k(k(k(cs.extrude(p.num_h + eps)).rotate([90, 0, 0])).translate([p.base_w / 2, -p.mantel_o + eps, body_h + p.mantel_t / 2]));
    };
    // ── KAMINKRONE ──
    const cap = () => {
      const plug = p.margin_t - 3;
      const rand = k(cube([p.in_w - 0.7, p.in_d - 0.7, plug + eps]).subtract(cube([p.in_w - 4.7, p.in_d - 4.7, plug + 3 * eps], [2, 2, -eps])));
      return U([k(rand.translate([p.wall + 0.35, p.wall + 0.35, -plug])), hull([cube([out_w, out_d, eps]), cube([out_w + 12, out_d + 12, cap_t - 6], [-6, -6, 6])])]);
    };
    const cap_top = () => {
      const d = out_w * 0.45, hx = k(k(M.cylinder(14, d / 2, d / 2, 6)).subtract(k(k(M.cylinder(20, d / 2 - 3, d / 2 - 3, 6)).translate([0, 0, 3]))));
      return U([cube([out_w - 12, out_d - 12, 5]), k(hx.translate([(out_w - 12) / 2, (out_d - 12) / 2, 5]))]);
    };
    const cap_print = () => k(k(cap().translate([0, 0, -cap_t])).rotate([180, 0, 0]));
    // ── TURM TEILEN (Steckfalz, stützfrei): unten Zunge innen (halbe Wand, oben 45°), oben passende Nut mit 45°-Decke ──
    const turmTeile = () => {
      const t = tower(), zMax = p.teilen && p.bett ? p.bett[2] : 0, Z = kakSegmente(p, m, zMax);
      if (!Z || Z.length <= 2) return { teile: [{ mf: t, z0: 0, z1: tower_h }], ok: !!Z || !zMax, Z: Z || [0, tower_h] };
      const wh = p.wall / 2, hz = kakFalzHoehe(p), c = 0.3;
      if (hz < 1) return { teile: [{ mf: t, z0: 0, z1: tower_h }], ok: false, Z: [0, tower_h], falz: false };
      const ring = (a, b, z0, z1) => k(cube([out_w - 2 * a, out_d - 2 * a, z1 - z0], [a, a, z0]).subtract(cube([out_w - 2 * b, out_d - 2 * b, z1 - z0 + 2], [b, b, z0 - 1])));
      const teile = [];
      for (let s = 0; s + 1 < Z.length; s++) {
        const z0 = Z[s], z1 = Z[s + 1];
        let seg = k(t.intersect(cube([out_w + 2, out_d + 2, z1 - z0], [-1, -1, z0])));
        if (s + 1 < Z.length - 1) {                                          // Zunge oben (innen, halbe Wand), Spitze 45°
          const zunge = U([ring(wh, p.wall, z1 - eps, z1 + hz), hull([ring(wh, p.wall, z1 + hz - eps, z1 + hz), ring(p.wall - 0.01, p.wall, z1 + hz + wh - 0.01, z1 + hz + wh)])]);
          seg = U([seg, zunge]);
        }
        if (s > 0) {                                                         // Nut unten: innen halbe Wand + Spiel, Decke 45° (druckt ohne Stütze)
          const nut = U([ring(wh - c, p.wall + 0.5, z0 - 1, z0 + hz + c), hull([ring(wh - c, p.wall + 0.5, z0 + hz + c - eps, z0 + hz + c), ring(p.wall - 0.01, p.wall + 0.5, z0 + hz + c + wh + c - 0.01, z0 + hz + c + wh + c)])]);
          seg = k(seg.subtract(nut));
        }
        teile.push({ mf: seg, z0, z1 });
      }
      return { teile, ok: true, Z };
    };
    return { m, p, oeffnung2D, bogenRing, schneeKante, flamme_print, flamme_lage, flammeH, sockenNamen, socke_print, socke_lage, tower, stone_body, stone_number, stone_print, number_print, blank_print, base, nameplate_text, cap, cap_top, cap_print, turmTeile, tmp, k,
      aufraeumen: () => { for (const x of tmp) { try { x.delete(); } catch (e) {} } tmp.length = 0; } };
  } catch (e) { for (const x of tmp) { try { x.delete(); } catch (e2) {} } throw e; }
}

if (typeof module !== 'undefined') module.exports = { KAK_DEF, KAK_DRUCKER, kakMasse, kakBelegung, kakFalzHoehe, kakSegmente, kakBuild };
