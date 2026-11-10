import Module from '/home/v3da/node_modules/manifold-3d/manifold.js';
import fs from 'fs';
const w = await Module(); w.setup();
const K = new Function(fs.readFileSync('/home/v3da/tools/adventskalender/adv_core.js', 'utf8') + '; return { _ADV_GEMEIN, _ADV_FORMEN };')();
// Passung der Steck-/Klebeteile: berühren sich, überschneiden sich nicht (Rakete, Piratenschiff)
let fail = 0;
for (const id of ['schiff', 'rakete']) {
  const F = K._ADV_FORMEN.find(f => f.id === id), p = {}; for (const q of [...K._ADV_GEMEIN, ...F.params]) p[q.k] = q.def; p.mischen = 1; p.seed = 7;
  const r = F.build(w, p, null), T = n => r.teile.find(t => t.name.startsWith(n));
  const paar = (a, b) => { const A = T(a).m, B = T(b).m, x = A.intersect(B), v = x.volume(); x.delete();
    const bA = A.boundingBox(), bB = B.boundingBox(), gap = Math.max(...[0, 1, 2].map(i => Math.max(bA.min[i] - bB.max[i], bB.min[i] - bA.max[i])));
    const ok = v < 1 && gap <= 0.01; if (!ok) fail++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${id}: ${a} ↔ ${b}: Überschneidung ${v.toFixed(1)} mm³, Abstand ${gap.toFixed(2)} mm`); };
  if (id === 'schiff') { paar('Mast', 'Schiffsrumpf Mitte'); paar('Mast', 'Ausguck'); paar('Flagge', 'Ausguck'); paar('Segel', 'Mast'); paar('Fach 24', 'Ausguck'); }
  else { paar('Flosse rechts', 'Raketen-Rumpf unten'); paar('Flosse links', 'Raketen-Rumpf unten'); paar('Raketen-Spitze', 'Raketen-Rumpf oben'); paar('Fach 24', 'Raketen-Spitze'); }
}
console.log(fail ? fail + ' Fehler' : 'alles grün'); process.exit(fail ? 1 : 0);
