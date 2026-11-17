// Node-Test 2D-Messen (web/flachbett.js): synthetisches Flachbettbild mit Kreis, Kante, Winkel – Sollwerte bekannt.
//   node tests/test_flachbett.mjs
import { createRequire } from 'node:module';
const F = createRequire(import.meta.url)('../web/flachbett.js');
let fehler = 0;
const ok = (b, t) => { console.log((b ? '  ok   ' : '  FEHLER ') + t); if (!b) fehler++; };
// Bild 800×600: hell (1), darin ein dunkles Teil = Rechteck mit einer schrägen Kante und einer Bohrung (hell)
const W = 800, H = 600, G = new Float32Array(W * H);
const KX = 420.37, KY = 290.81, KR = 101.3;                // Bohrung
const WINKEL = 12.5 * Math.PI / 180;                      // schräge Oberkante
const innen = (x, y) => {
  const imTeil = x > 150 && x < 700 && y < 520 && (y - 120) > Math.tan(WINKEL) * (x - 150);
  const imLoch = Math.hypot(x - KX, y - KY) < KR;
  return imTeil && !imLoch;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {      // 8×8 Überabtastung = weiche, echte Kante
  let s = 0; for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) s += innen(x + (a + 0.5) / 8, y + (b + 0.5) / 8) ? 1 : 0;
  G[y * W + x] = 0.92 - 0.8 * s / 64;
}
const schw = F.otsu(G);
ok(schw > 0.3 && schw < 0.8, 'Otsu-Schwelle ' + schw.toFixed(3));
const kreis = F.elementAnKlick(G, W, H, schw, 'kreis', KX + KR, KY, 400);
ok(kreis && Math.abs(kreis.r - KR) < 0.05 && Math.hypot(kreis.c[0] - KX, kreis.c[1] - KY) < 0.05, `Kreis: r ${kreis && kreis.r.toFixed(4)} (101,3), Mitte ±${kreis && Math.hypot(kreis.c[0] - KX, kreis.c[1] - KY).toFixed(4)} px`);
const rechts = F.elementAnKlick(G, W, H, schw, 'linie', 700, 400, 300);
ok(rechts && Math.abs(Math.abs(rechts.d[1]) - 1) < 1e-4 && Math.abs(rechts.p[0] - 700) < 0.05, `senkrechte Kante x=${rechts && rechts.p[0].toFixed(4)} (700)`);
const schraeg = F.elementAnKlick(G, W, H, schw, 'linie', 400, 120 + Math.tan(WINKEL) * 250, 300);
const ws = schraeg && Math.atan2(schraeg.d[1], schraeg.d[0]) * 180 / Math.PI;
ok(schraeg && Math.abs(Math.abs(ws) - 12.5) < 0.02, `schräge Kante ${ws && ws.toFixed(4)}° (12,5°)`);
const unten = F.elementAnKlick(G, W, H, schw, 'linie', 400, 520, 300);
const m1 = F.mass(schraeg, rechts), m2 = F.mass(kreis, rechts), m3 = F.mass(kreis), m4 = F.mass(unten, F.elementAnKlick(G, W, H, schw, 'linie', 400, 520.5, 300));
ok(m1.art === 'winkel' && Math.abs(m1.wert - 77.5) < 0.03, `Winkel schräg/senkrecht ${m1.wert.toFixed(3)}° (77,5)`);
ok(m2.art === 'abstand' && Math.abs(m2.wert - (700 - KX)) < 0.05, `Kreismitte zur Kante ${m2.wert.toFixed(3)} (${(700 - KX).toFixed(3)})`);
ok(m3.art === 'durchmesser' && Math.abs(m3.wert - 2 * KR) < 0.1, `Durchmesser ${m3.wert.toFixed(3)} px`);
ok(m4.art === 'abstand' && m4.wert < 0.05, 'gleiche Kante zweimal: Abstand ∥ ≈ 0');
ok(F.elementAnKlick(G, W, H, schw, 'kreis', 60, 60, 50) === null, 'Klick ins Leere → null');
// DPI: PNG mit pHYs 600 dpi (23622 px/m) und JPEG mit JFIF 300 dpi
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 0x5c, 0x46, 0, 0, 0x5c, 0x46, 1, 0, 0, 0, 0]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 1, 44, 1, 44, 0, 0, 0xff, 0xda]);
ok(Math.abs(F.dpiAus(png.buffer) - 600) < 0.1 && F.dpiAus(jpg.buffer) === 300, `dpi: PNG ${F.dpiAus(png.buffer).toFixed(2)}, JPEG ${F.dpiAus(jpg.buffer)}`);
const dxf = F.export2d([kreis, rechts], 25.4 / 600, H, 'dxf'), svg = F.export2d([kreis, rechts], 25.4 / 600, H, 'svg');
ok(dxf.includes('CIRCLE') && dxf.includes('LINE') && svg.includes('<circle') && svg.includes('mm"'), 'Export DXF + SVG');
const r40 = Number(dxf.split('\r\n')[dxf.split('\r\n').indexOf('40') + 1]);
ok(Math.abs(r40 - KR * 25.4 / 600) < 0.002, `DXF-Radius in mm ${r40} (${(KR * 25.4 / 600).toFixed(4)})`);
console.log(fehler ? `\n${fehler} Fehler` : '\nAlle Prüfungen bestanden'); process.exit(fehler ? 1 : 0);
