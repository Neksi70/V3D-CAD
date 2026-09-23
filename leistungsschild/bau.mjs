// Leistungsschild als echte Schrift: Platte + Schrift als getrennte Körper.
// node bau.mjs <breite_mm> [erhaben|unten]
import fs from 'fs';
import Module from '/home/v3da/node_modules/manifold-3d/manifold.js';
globalThis.window = globalThis; (0, eval)(fs.readFileSync('/home/v3da/lib/opentype.min.js', 'utf8'));
const W = +(process.argv[2] || 180), MODE = process.argv[3] || 'erhaben';
const PLATE = 2.0, TXT = 0.6, NOZ = 0.4;
const wasm = await Module(); wasm.setup(); const { CrossSection, Manifold } = wasm;
const fb = fs.readFileSync(process.env.FONT || '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf');
const font = opentype.parse(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.length));
const capEm = (() => { const b = font.charToGlyph('H').getBoundingBox(); return (b.y2 - b.y1) / font.unitsPerEm; })();

// Text -> Konturen (mm, y nach oben)
function textPolys(str, x, y, cap) {
  const size = cap / capEm, path = font.getPath(str, x, -y, size), out = []; let cur = null, px = 0, py = 0;
  const push = (X, Y) => { cur.push([X, -Y]); px = X; py = Y; };
  for (const c of path.commands) {
    if (c.type === 'M') { cur = []; out.push(cur); push(c.x, c.y); }
    else if (c.type === 'L') push(c.x, c.y);
    else if (c.type === 'Q') { const x0 = px, y0 = py, n = Math.max(2, Math.min(8, Math.ceil(Math.hypot(c.x - x0, c.y - y0) * size / 1000 * 0 + Math.hypot(c.x - x0, c.y - y0) / 0.4))); for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; push(u*u*x0 + 2*u*t*c.x1 + t*t*c.x, u*u*y0 + 2*u*t*c.y1 + t*t*c.y); } }
    else if (c.type === 'C') { const x0 = px, y0 = py, n = Math.max(3, Math.min(10, Math.ceil(Math.hypot(c.x - x0, c.y - y0) / 0.4))); for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; push(u*u*u*x0 + 3*u*u*t*c.x1 + 3*u*t*t*c.x2 + t*t*t*c.x, u*u*u*y0 + 3*u*u*t*c.y1 + 3*u*t*t*c.y2 + t*t*t*c.y); } }
  }
  return out.filter(p => p.length > 2);
}
const tw = (s, cap) => font.getAdvanceWidth(s, cap / capEm);

// Inhalt (vom Ausdruck abgelesen, Serial laut Ralf 101600277)
const rows = [
  [['Type', 'TR 1000/7/1000x2'], ['Year', '2025']],
  [['Serial No.', '101600277'], ['Po No.', 'ER002']],
  [['Liquid', 'Sea Water'], ['Temp.', '6 °C']],
  [['Density', '1025 kg/m³'], ['Viscosity', '1,47 cP']],
  [['Capacity', '11358 m³/h'], ['Head', '68,9 m']],
  [['Rot. Speed', '592 min-1'], ['Power input', '2470 kW']],
  [['Hydro. test', '27 bar'], ['NPSH req.', '9,7 m']],
  [['MAWP', '18 bar @ 30 °C'], ['Rad. Brg', '61856']],
  [['Weight dry', '19500 kg'], ['Thr. Brg', '29348E']],
  [['operating', '30181 kg'], ['Design', 'API 610']],
];
// Schriftgröße: größte Versalhöhe, bei der die breiteste Zeile passt
const M = 6, GAP = 0.9, LF = +(process.env.LF || 0.9);           // Rand innen, Abstand Bezeichnung->Wert (x Versalhöhe)
function widths(cap) {
  const lw = [0, 1].map(k => Math.max(...rows.map(r => tw(r[k][0], cap * LF))));
  const vw = [0, 1].map(k => Math.max(...rows.map(r => tw(r[k][1], cap))));
  return { lw, vw, total: lw[0] + vw[0] + lw[1] + vw[1] + GAP * cap * 3 + 2 * M };
}
let cap = 8; while (widths(cap).total > W && cap > 1) cap -= 0.05;
cap = Math.min(cap, 6);
const { lw, vw } = widths(cap);
const pitch = cap * 1.85, markH = Math.max(8, cap * 2.2);
const H = +(M + rows.length * pitch + 1.5 + markH + M * 0.8).toFixed(1);
const colX = [M, W - M - (lw[1] + GAP * cap + vw[1])];
const vX = [colX[0] + lw[0] + GAP * cap, colX[1] + lw[1] + GAP * cap];

const txt = [];
rows.forEach((r, i) => { const y = H - M - cap - i * pitch;
  r.forEach((c, k) => { txt.push(...textPolys(c[0], colX[k], y, cap * LF)); txt.push(...textPolys(c[1], vX[k], y, cap)); }); });
let text = new CrossSection(txt, 'NonZero').simplify(0.01);
// Rahmen + Trennlinien
const fw = Math.max(1.0, 2.5 * NOZ), fi = 2.2, R = 3;
const rr = (w, h, r) => CrossSection.square([w - 2*r, h - 2*r]).translate([r, r]).offset(r, 'Round', 2, 32);
const frame = rr(W - 2*fi, H - 2*fi, R - 1).translate([fi, fi]).subtract(rr(W - 2*fi - 2*fw, H - 2*fi - 2*fw, Math.max(0.3, R - 1 - fw)).translate([fi + fw, fi + fw]));
const lineY = H - M - pitch * 0.62 - cap * 0.55;             // unter der Type-Zeile
const lineY2 = H - M - cap - (rows.length - 1) * pitch - cap * 0.5 - fw;   // unter den Unterlängen der letzten Zeile
const sep = CrossSection.union([CrossSection.square([W - 2*fi, fw]).translate([fi, lineY]), CrossSection.square([W - 2*fi, fw]).translate([fi, lineY2])]);
// CE-Zeichen (zwei Halbkreis-Ringe, E mit Mittelsteg) + Ex-Sechseck (ATEX)
const mh = markH * 0.8, mr = mh / 2, st = Math.max(1.0, mr * 0.3), my = M * 0.8 + markH / 2;
const ring = (cx) => CrossSection.circle(mr, 64).subtract(CrossSection.circle(mr - st, 64)).translate([cx, my]);
const half = (cx, side) => CrossSection.square([mr + 0.01, 2*mr + 1]).translate([side < 0 ? cx - mr - 0.01 : cx, my - mr - 0.5]);
const ceW = mr * 2.4, ceX = W / 2 - ceW - 8;
const cC = ceX + mr, eC = cC + mr * 0.4;   // E-Ring links bei cC+0,4r
const C = ring(cC).intersect(half(cC, -1)).add(ring(cC).intersect(half(cC, 1)).intersect(CrossSection.square([0.001,0.001]))); // nur linke Hälfte
const E = ring(eC + mr).intersect(half(eC + mr, -1)).add(CrossSection.square([mr * 0.8, st * 0.9]).translate([eC, my - st * 0.45]));
const hex = (r) => new CrossSection([[...Array(6)].map((_, i) => [Math.cos(Math.PI/6 + i*Math.PI/3) * r, Math.sin(Math.PI/6 + i*Math.PI/3) * r])]);
const hx = W / 2 + 8 + mr * 1.15;
const exHex = hex(mr * 1.15).subtract(hex(mr * 1.15 - st)).translate([hx, my]);
const exT = new CrossSection(textPolys('Ex', 0, 0, mr * 0.72), 'NonZero'); const eb = exT.bounds();
const ex = exT.translate([hx - (eb.min[0] + eb.max[0]) / 2, my - (eb.min[1] + eb.max[1]) / 2]);
text = CrossSection.union([text, frame, sep, C, E, exHex, ex]);
const plate2d = rr(W, H, R);

// Druckbarkeit: was bei zwei Düsenbahnen (0,8 mm) wegfällt
const lostAt = r => text.subtract(text.offset(-r, 'Round').offset(r + 0.06, 'Round'));
const lost = lostAt(NOZ), lossPct = 100 * lost.area() / text.area();
const lost05 = 100 * lostAt(0.25).area() / text.area(), lost06 = 100 * lostAt(0.3).area() / text.area();

let plate, letters;
if (MODE === 'unten') {   // bündig, Schriftseite aufs Bett (gespiegelt durch Umdrehen)
  plate = plate2d.extrude(PLATE + TXT).subtract(text.extrude(TXT + 0.01).translate([0, 0, PLATE]));
  letters = text.extrude(TXT).translate([0, 0, PLATE]);
  const flip = m => m.rotate([180, 0, 0]).translate([0, H, PLATE + TXT]);
  plate = flip(plate); letters = flip(letters);
} else {
  plate = plate2d.extrude(PLATE); letters = text.extrude(TXT).translate([0, 0, PLATE]);
}
const tag = `leistungsschild_${W}_${MODE}`;
function mesh(m) { const g = m.getMesh(); return { v: g.vertProperties, t: g.triVerts, n: g.numProp }; }
function stl(m, f) { const { v, t, n } = mesh(m), N = t.length / 3, b = Buffer.alloc(84 + N * 50); b.writeUInt32LE(N, 80);
  for (let i = 0; i < N; i++) { let o = 84 + i * 50 + 12; for (let j = 0; j < 3; j++) { const k = t[i*3+j] * n; for (let a = 0; a < 3; a++) { b.writeFloatLE(v[k+a], o); o += 4; } } }
  fs.writeFileSync(f, b); }
stl(plate, tag + '_platte.stl'); stl(letters, tag + '_schrift.stl');
fs.writeFileSync(tag + '.json', JSON.stringify({ W, H, cap, mode: MODE, lossPct, meshes: { platte: mesh(plate), schrift: mesh(letters) }, textPolys: text.toPolygons(), lostPolys: lost.toPolygons() }, (k, x) => x instanceof Float32Array || x instanceof Uint32Array ? Array.from(x) : x));
console.log(JSON.stringify({ tag, W, H, cap: +cap.toFixed(2), labelCap: +(cap*LF).toFixed(2), verlust_unter_0_8mm: +lossPct.toFixed(1), unter_0_6mm: +lost06.toFixed(1), unter_0_5mm: +lost05.toFixed(1), genusPlate: plate.genus(), vol: [plate.volume().toFixed(0), letters.volume().toFixed(0)] }));
