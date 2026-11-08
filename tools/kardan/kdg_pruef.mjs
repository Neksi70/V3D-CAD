import Module from '/home/v3da/lib/manifold.js';
import fs from 'fs';
const w = await Module(); w.setup();
eval(fs.readFileSync(new URL('./kdg_core.js', import.meta.url), 'utf8').replace(/^function (\w+)/gm, 'globalThis.$1 = function $1'));
const M = w.Manifold, CS = w.CrossSection;
const form = process.argv[3] || 'stab';
let M0;
if (form === 'stab') M0 = M.cube([120, 16, 14]);                         // Stab 120×16×14
else if (form === 'rund') M0 = M.cylinder(120, 9, 9, 64).rotate([0, 90, 0]).translate([0, 0, 9]);   // Rundstab Ø18
else if (form === 'flach') M0 = M.cube([140, 40, 10]);
const P = JSON.parse(process.argv[2] || '{}');
const t0 = Date.now();
const { teile, kreuze, info } = _kdgBuild(w, M0, { n: 4, clr: 0.4, grad: 30, ...P });
console.log(form, 'Bauzeit', Date.now() - t0, 'ms · Glieder', teile.length, '· Kreuze', kreuze.length);
const g = info.gel[0]; console.log('Gelenk', Object.fromEntries(Object.entries(g).map(([k, v]) => [k, +v.toFixed(2)])));
let fehler = 0; const alle = [...teile, ...kreuze];
alle.forEach((t, i) => { const n = t.decompose().length; if (n !== 1) { console.log('  Teil', i, 'zerfällt in', n); fehler++; } });
for (let i = 0; i < alle.length; i++) for (let j = i + 1; j < alle.length; j++) {
  const ov = M.intersection(alle[i], alle[j]).volume(); if (ov < 1e-6 && alle[i].minGap(alle[j], 1) > 0.15) continue;
  const gap = alle[i].minGap(alle[j], 2); console.log(`  ${i}/${j}: Überlappung ${ov.toFixed(4)}, Abstand ${gap.toFixed(3)}`); fehler++;
}
const zb = Math.min(...alle.map(t => t.boundingBox().min[2]));
kreuze.forEach((k, i) => console.log('  Kreuz', i, 'Unterkante', k.boundingBox().min[2].toFixed(2), 'über Platte'));
// unterste Arme: Kontakt zur Platte?
for (const [nm, dn, ds] of [['hoch', 1, 0], ['runter', -1, 0], ['seitlich', 0, 1], ['diagonal', 0.7071, 0.7071]])
  console.log(`  frei ${nm}: ${_kdgFrei(w, teile, kreuze, g, 0, dn, ds)}°`);
// Kreuz darf nicht herausfallen: Kreuz 20 mm verschieben → muss Glieder schneiden
for (const d of [[0, 0, 3], [0, 3, 0], [3, 0, 0], [0, 0, -3]]) {
  const ov = M.intersection(kreuze[0].translate(d), M.union(teile[0], teile[1])).volume(); if (ov < 0.1) { console.log('  Kreuz lose in Richtung', d); fehler++; }
}
console.log(fehler ? `✗ ${fehler} Fehler` : '✓ ok');
