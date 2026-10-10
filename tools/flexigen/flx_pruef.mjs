import Module from '/home/v3da/lib/manifold.js';
import fs from 'fs';
const w = await Module(); w.setup();
eval(fs.readFileSync(new URL('./flx_core.js', import.meta.url), 'utf8').replace(/^function (\w+)/gm, 'globalThis.$1 = function $1'));
const M = w.Manifold, CS = w.CrossSection;
// Herz 100 × 90 mm, 6 mm dick
const pts = [];
for (let i = 0; i < 200; i++) { const t = i / 200 * Math.PI * 2; const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); pts.push([x * 3.1, y * 3.1]); }
const herz = new CS([pts.reverse()]).extrude(6);
const P = JSON.parse(process.argv[2] || '{}');
const t0 = Date.now();
const { teile, info } = _flxBuild(w, herz, { n: 8, clr: 0.4, ...P });
console.log('Bauzeit', Date.now() - t0, 'ms', 'Glieder', teile.length, 'T', info.T, 'r', info.r, 'Stift-r', info.rp.toFixed(2), 'Bänder', info.bands);
let fehler = 0;
teile.forEach((t, i) => { const n = t.decompose().length; if (n !== 1) { console.log('  Glied', i, 'zerfällt in', n); fehler++; } });
const vol0 = herz.volume(), volS = teile.reduce((s, t) => s + t.volume(), 0);
console.log('Volumen Original', vol0.toFixed(0), 'Summe Glieder', volS.toFixed(0), `(${(100 * volS / vol0).toFixed(1)} %)`);
for (let i = 0; i < teile.length; i++) for (let j = i + 1; j < teile.length; j++) {
  const ov = M.intersection(teile[i], teile[j]).volume();
  const gap = teile[i].minGap(teile[j], 2);
  if (ov > 1e-6 || gap < 0.15) { console.log(`  Glieder ${i}/${j}: Überlappung ${ov.toFixed(4)} mm³, Abstand ${gap.toFixed(3)} mm`); fehler++; }
}
// Beweglichkeit: Glied 1 um ±25° um seine Gelenkachse drehen → darf Glied 0 nicht schneiden
const xk = info.cuts[0], zc = info.r;
for (const deg of [-25, 25, 60]) {
  const rot = teile[1].translate([-xk, 0, -zc]).rotate([0, deg, 0]).translate([xk, 0, zc]);
  const ov = M.intersection(teile[0], rot).volume();
  console.log(`  Glied 1 um ${deg}° gedreht: Überlappung mit Glied 0 = ${ov.toFixed(3)} mm³`);
  if (ov > 0.05) fehler++;
}
console.log(fehler ? `${fehler} Probleme` : 'alles sauber');
if (process.argv[3]) { const all = M.union(teile); const mesh = all.getMesh(); fs.writeFileSync(process.argv[3], JSON.stringify({ n: mesh.numTri })); }
