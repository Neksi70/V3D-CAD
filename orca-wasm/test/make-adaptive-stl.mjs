// Testkörper für die automatische adaptive Schichthöhe: Platte 40×40×3 mit zwei
// „Schrift"-Balken (0,6 / 0,8 mm hoch) + Halbkugel Ø16 → Schräge, Relief, Kanten.
import { writeFileSync } from 'node:fs';
const tris = [];
function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  for (const t of [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]) tris.push(t.map(i => v[i]));
}
function dome(cx, cy, z0, r, seg = 48, rings = 16) {
  const P = (i, s) => { const a = i / rings * Math.PI / 2, b = s / seg * 2 * Math.PI;
    return [cx + r * Math.cos(a) * Math.cos(b), cy + r * Math.cos(a) * Math.sin(b), z0 + r * Math.sin(a)]; };
  for (let i = 0; i < rings; i++) for (let s = 0; s < seg; s++) {
    const A = P(i, s), B = P(i, s + 1), C = P(i + 1, s + 1), D = P(i + 1, s);
    tris.push([A, B, C]); if (i + 1 < rings) tris.push([A, C, D]);
  }
  for (let s = 0; s < seg; s++) tris.push([[cx, cy, z0], P(0, s + 1), P(0, s)]);   // Boden
}
box(0, 0, 0, 40, 40, 3); box(4, 4, 3, 36, 9, 3.8); box(4, 12, 3, 20, 17, 3.6);
dome(20, 28, 3, 8);
const buf = Buffer.alloc(84 + tris.length * 50);
buf.writeUInt32LE(tris.length, 80);
// Echte Normalen schreiben: Orcas ASCII-Heuristik (admesh) prüft die 128 Bytes NACH
// dem Header — ohne ein Byte > 0x7F (z. B. negative Normale) gilt die Datei als ASCII
tris.forEach((t, k) => {
  const [a, b, c] = t, u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(...n) || 1;
  let o = 84 + k * 50;
  for (const v of n) { buf.writeFloatLE(v / l, o); o += 4; }
  for (const p of t) for (const q of p) { buf.writeFloatLE(q, o); o += 4; }
});
writeFileSync(new URL('./adaptive-relief.stl', import.meta.url), buf);
console.log('adaptive-relief.stl:', tris.length, 'Dreiecke');
