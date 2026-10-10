// Weltkarte für den Geldgeschenk-Platten-Generator (_ggp*) aufbereiten.
// Quelle: Natural Earth 1:50m Land (gemeinfrei), tools/ne_50m_land.geojson — holen mit
//   curl -L -o tools/ne_50m_land.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson
// Ergebnis ersetzt _GGP_WELT_B64 in volme3d.html.
// Antarktis raus, nahe Küsten verschmelzen (Morphologisches Schließen), dann
// vereinfachen und Mini-Inseln verwerfen. Ausgabe: Int16-Paare (Grad×10) als
// Base64, je Ring [Anzahl, x,y, x,y …] — Projektion passiert erst im Browser.
// Aufruf: node tools/bau_weltkarte.mjs > /tmp/weltkarte.b64
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const Module = (await import(path.join(here, '../lib/manifold.js'))).default;
const w = await Module(); w.setup();
const gj = JSON.parse(fs.readFileSync(path.join(here, 'ne_50m_land.geojson'), 'utf8'));
const K = 10;                                   // 0,1°-Raster
const rings = [];
for (const f of gj.features) {
  const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of polys) {
    const outer = p[0];
    if (Math.max(...outer.map(q => q[1])) < -58) continue;   // Antarktis
    for (const r of p) rings.push(r.map(([x, y]) => [x * K, Math.max(-58, y) * K]));   // inkl. Löcher (Schwarzes Meer, Kaspisee)
  }
}
const R = +(process.env.CLOSE || 0.25) * K, EPS = +(process.env.EPS || 0.12) * K, MINA = +(process.env.MINA || 0.6) * K * K;
let cs = new w.CrossSection(rings, 'NonZero');
cs = cs.offset(R, 'Round', 2, 16).offset(-R, 'Round', 2, 16);
// Das Schließen macht schmale Meerengen dicht — Mittelmeer, Schwarzes Meer und
// Ostsee wären sonst eingeschlossene Seen (= fallen beim Lasern als Land mit raus).
// Darum dort je einen Kanal wieder herausschneiden (Polylinie, 0,3° breit).
const KANAL = [
  [[-7.5, 35.9], [-5.6, 35.97], [-4.6, 36.1]],                                  // Gibraltar
  [[25.0, 39.7], [26.2, 40.05], [26.7, 40.4], [27.5, 40.7], [28.6, 40.85], [29.0, 41.05], [29.1, 41.25], [29.4, 41.8]],   // Dardanellen–Bosporus
  [[10.4, 57.9], [11.6, 57.0], [12.4, 56.2], [12.7, 55.7], [12.9, 55.2]],       // Kattegat–Öresund
  [[42.9, 13.2], [43.4, 12.6], [43.8, 12.2]],                                   // Bab al-Mandab
];
const HB = 0.15 * K, strips = [];
for (const line of KANAL) for (let i = 0; i + 1 < line.length; i++) {
  const [ax, ay] = line[i].map(v => v * K), [bx, by] = line[i + 1].map(v => v * K);
  const L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L * HB, ny = (bx - ax) / L * HB;
  const ex = (bx - ax) / L * HB, ey = (by - ay) / L * HB;
  strips.push([[ax - ex + nx, ay - ey + ny], [ax - ex - nx, ay - ey - ny], [bx + ex - nx, by + ey - ny], [bx + ex + nx, by + ey + ny]]);
}
cs = cs.subtract(new w.CrossSection(strips, 'NonZero')).simplify(EPS);
const out = [];
let nPts = 0, nRing = 0;
for (const poly of cs.toPolygons()) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  if (a < 0 && -a / 2 > MINA) process.stderr.write('Loch: ' + JSON.stringify([Math.min(...poly.map(q=>q[0]))/K, Math.min(...poly.map(q=>q[1]))/K, Math.max(...poly.map(q=>q[0]))/K, Math.max(...poly.map(q=>q[1]))/K]) + '\n');
  if (a <= 0 || a / 2 < MINA || poly.length < 3) continue;   // Seen (Löcher) und Mini-Inseln raus
  out.push(poly.length); nRing++;
  for (const [x, y] of poly) { out.push(Math.round(x), Math.round(y)); nPts++; }
}
const b64 = Buffer.from(new Int16Array(out).buffer).toString('base64');
process.stderr.write(`Ringe ${nRing}, Punkte ${nPts}, Base64 ${b64.length} Zeichen\n`);
process.stdout.write(b64);
