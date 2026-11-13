// Kamin-Adventskalender — Rechenkern 1:1 nach v3d_kamin_adventskalender.scad (Volme 3D Akademie).
// Manifold, mm, OpenSCAD-Koordinaten (Z oben). Namen und Formeln wie in der .scad, damit jede Zeile vergleichbar bleibt.
// Läuft im Browser (App) und in Node (Test): kakBuild(wasm, p, textFn) — textFn(CS, keep, txt, font, h, cx, yb, maxW) → {cs}
// (App: _lttText); ohne textFn (Node) entstehen keine Zahlen/Namen.
const KAK_DEF = {
  tage: 24,
  /* Schacht */ in_w: 96, in_d: 96, wall: 4, gd: 2, pitch: 14, slots: 30, margin_b: 9, margin_t: 12,
  /* Schieber */ pt: 2.4, slot_h: 3.0, clr: 0.3, tab_d: 5, tab_gap: 1.2, num_h: 0.6, blank_len: 18,
  /* Feuerstelle */ base_w: 176, base_d: 136, base_h: 112, open_w: 112, open_h: 74, open_ch: 20, floor_t: 4, ramp_h: 12, mantel_t: 10, mantel_o: 8,
  name_txt: '', name_size: 8,
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
  const tab_h = p.pitch - p.tab_gap;
  const tower_x = (p.base_w - out_w) / 2, tower_y = (p.base_d - out_d) / 2, sock = 5;
  const plate_w = p.in_w + 2 * p.gd - 2 * p.clr, plate_l = p.wall + p.in_d + p.gd - p.clr;
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
    // ── TURM ──
    const tower = () => {
      const cut = [cube([p.in_w, p.in_d, tower_h + 2 * eps], [p.wall, p.wall, -eps])];
      for (let i = 0; i < p.slots; i++) cut.push(cube([p.in_w + 2 * p.gd, p.wall + p.in_d + p.gd + eps, p.slot_h], [p.wall - p.gd, -eps, slot_z(i)]));
      for (let i = 0; i <= p.slots - 2; i++) {
        const z = slot_z(i) + p.slot_h / 2 + p.pitch / 2 - p.joint_w / 2;
        for (const x of [-eps, out_w - p.joint_d]) cut.push(cube([p.joint_d + eps, out_d + 2 * eps, p.joint_w], [x, -eps, z]));
        cut.push(cube([out_w + 2 * eps, p.joint_d + eps, p.joint_w], [-eps, out_d - p.joint_d, z]));
      }
      for (let i = 0; i <= p.slots - 2; i += 2) {
        const z0 = slot_z(i) + p.slot_h / 2 + p.pitch / 2;
        for (let kk = 0; kk <= 1; kk++) {
          const zz = z0 + kk * p.pitch, off = kk === 0 ? 0.5 : 0.25;
          for (const x of [-eps, out_w - p.joint_d]) for (const f of [off, off + 0.5]) if (f < 1) cut.push(cube([p.joint_d + eps, p.joint_w, p.pitch], [x, out_d * f - p.joint_w / 2, zz]));
          for (const f of [off, off + 0.5]) if (f < 1) cut.push(cube([p.joint_w, p.joint_d + eps, p.pitch], [out_w * f - p.joint_w / 2, out_d - p.joint_d, zz]));
        }
      }
      return k(cube([out_w, out_d, tower_h]).subtract(U(cut)));
    };
    // ── TAGESSTEIN / SCHIEBER ──
    const stone_tab_shape = () => { const c = 0.8; return hull([cube([out_w - 1 - 2 * c, p.tab_d, tab_h], [0.5 + c, -p.tab_d, 0]), cube([out_w - 1, p.tab_d - c, tab_h - 2 * c], [0.5, -p.tab_d + c, c])]); };
    const jxOf = d => (d % 2 === 1) ? out_w * 0.28 : out_w * 0.72;
    const stone_body = (d, with_plate) => {
      const plate = cube([plate_w, (with_plate ? plate_l + p.tab_d - eps : p.blank_len + p.tab_d), p.pt], [p.wall - p.gd + p.clr, -p.tab_d + eps, (p.slot_h - p.pt) / 2]);
      const jx = jxOf(d);
      let b = k(U([k(stone_tab_shape().translate([0, 0, tab_z0])), plate]).subtract(cube([p.joint_w, p.joint_d + eps, tab_h + 2 * eps], [jx - p.joint_w / 2, -p.tab_d - eps, tab_z0 - eps])));
      if (!with_plate) {                                                     // Klemmnoppen am Blindstein
        const n = []; for (const x of [p.wall - p.gd + p.clr + 6, p.wall - p.gd + p.clr + plate_w - 6]) n.push(k(k(k(M.sphere(0.7, fein ? 24 : 12)).scale([1, 1, 0.5])).translate([x, p.blank_len * 0.6, (p.slot_h - p.pt) / 2 + p.pt])));
        b = U([b, ...n]);
      }
      return b;
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
    const stone_number = d => {
      const jx = jxOf(d), cx = (d % 2 === 1) ? (jx + out_w) / 2 : jx / 2;
      const cs = textMitte(String(d), tab_h * 0.62, 0, 0); if (!cs) return null;
      // translate([cx, -tab_d+eps, tab_z0+tab_h/2]) rotate([90,0,0]) linear_extrude(num_h+eps): (x,y,z) → (x, −z, y)
      return k(k(k(cs.extrude(p.num_h + eps)).rotate([90, 0, 0])).translate([cx, -p.tab_d + eps, tab_z0 + tab_h / 2]));
    };
    const stone_print = d => k(stone_body(d, true).translate([0, 0, -(p.slot_h - p.pt) / 2]));
    const number_print = d => { const n = stone_number(d); return n ? k(n.translate([0, 0, -(p.slot_h - p.pt) / 2])) : null; };
    const blank_print = () => k(stone_body(0, false).translate([0, 0, -(p.slot_h - p.pt) / 2]));
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
    const base = () => {
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
      const ow = p.open_w, oh = p.open_h, oc = p.open_ch;
      const pol = k(new CS([[[-ow / 2, 0], [-ow / 2, -(oh - oc)], [-ow / 2 + oc, -oh], [ow / 2 - oc, -oh], [ow / 2, -(oh - oc)], [ow / 2, 0]]], 'NonZero'));
      cut.push(k(k(k(pol.extrude(40)).rotate([-90, 0, 0])).translate([p.base_w / 2, -20, p.floor_t])));
      cut.push(...base_joints(body_h));
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
      const wh = p.wall / 2, hz = 3, c = 0.3;
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
    return { m, p, tower, stone_body, stone_number, stone_print, number_print, blank_print, base, nameplate_text, cap, cap_top, cap_print, turmTeile, tmp, k,
      aufraeumen: () => { for (const x of tmp) { try { x.delete(); } catch (e) {} } tmp.length = 0; } };
  } catch (e) { for (const x of tmp) { try { x.delete(); } catch (e2) {} } throw e; }
}

if (typeof module !== 'undefined') module.exports = { KAK_DEF, KAK_DRUCKER, kakMasse, kakBelegung, kakSegmente, kakBuild };
