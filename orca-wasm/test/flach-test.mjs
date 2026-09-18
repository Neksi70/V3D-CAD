// Logo-Fall: Platte mit flach abgeschrägter Oberseite (3°, fein tesselliert) auf 0,2-mm-Düse.
// Erwartung: Schichthöhen laufen ruhig (kein Hin- und Herspringen), keine Einrast-Kanten
// auf der Schräge (sie ist nicht waagerecht), Schrägen-Bereich fein.
import { computeLayerPlan } from '../web/adaptive-layers.js';
const pos = [];
const tri = (a, b, c) => pos.push(...a, ...b, ...c);
// Grundkörper 60×30, Höhe 8 an der Kante, oben 3° Dach zur Mitte hin (First bei x=30)
const H0 = 8, slope = Math.tan(3 * Math.PI / 180), N = 60;
const zTop = (x) => H0 + slope * (30 - Math.abs(x - 30));
for (let i = 0; i < N; i++) {
  const x0 = i, x1 = i + 1;
  for (let j = 0; j < 30; j++) {   // Dach, fein in 1-mm-Streifen
    const y0 = j, y1 = j + 1;
    tri([x0, y0, zTop(x0)], [x1, y0, zTop(x1)], [x1, y1, zTop(x1)]); tri([x0, y0, zTop(x0)], [x1, y1, zTop(x1)], [x0, y1, zTop(x0)]);
    tri([x0, y0, 0], [x1, y1, 0], [x1, y0, 0]); tri([x0, y0, 0], [x0, y1, 0], [x1, y1, 0]);
  }
  tri([x0, 0, 0], [x1, 0, 0], [x1, 0, zTop(x1)]); tri([x0, 0, 0], [x1, 0, zTop(x1)], [x0, 0, zTop(x0)]);
  tri([x0, 30, 0], [x1, 30, zTop(x1)], [x1, 30, 0]); tri([x0, 30, 0], [x0, 30, zTop(x0)], [x1, 30, zTop(x1)]);
}
const opts = { hBase: 0.1, hFirst: 0.1, hMin: 0.04, hMax: 0.14, nozzle: 0.2 };
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
for (const q of [0.5, 1]) {
  const p = computeLayerPlan(new Float32Array(pos), null, { ...opts, quality: q });
  const top = p.layers.filter(L => L.z0 >= H0);
  let jumps = 0, maxJump = 0;
  for (let i = 1; i < top.length; i++) { const r = top[i].h / top[i - 1].h; maxJump = Math.max(maxJump, Math.max(r, 1 / r)); if (Math.abs(r - 1) > 0.25) jumps++; }
  console.log(`q=${q}: ${p.nLayers} Schichten, Schrägbereich ${top.length} Schichten, Höhen ${[...new Set(top.map(L => L.h.toFixed(3)))].slice(0, 10).join(' ')}, Kanten ${p.snaps.length}, Sprünge >25 %: ${jumps}, max. Faktor ${maxJump.toFixed(2)}`);
  ok(p.snaps.length <= 1, 'keine Einrast-Kanten auf der 3°-Schräge');
  ok(jumps === 0, 'Schichthöhen ohne Sprünge > 25 %');
  if (q === 1) ok(top.every(L => L.h <= 0.04 * 1.15), 'Schrägbereich am Minimum 0,04 mm (Rest zum Dach ≤ +15 %)');
}
console.log(fails ? `❌ ${fails} fehlgeschlagen` : '✅ FLACH-TEST OK');
process.exit(fails ? 1 : 0);
