// Node-Test des Adventskalender-Kerns: beide Formen bauen, Teile prüfen (1 Stück, Volumen, Bett)
import Module from '/home/v3da/node_modules/manifold-3d/manifold.js';
import fs from 'fs';
const w = await Module(); w.setup();
const src = fs.readFileSync(new URL('./adv_core.js', import.meta.url), 'utf8');
const K = new Function(src + '; return { _ADV_GEMEIN, _ADV_FORMEN, _advBergMasse, _advBallGeo, _advGramm };')();
const nur = process.argv[2];
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
for (const F of K._ADV_FORMEN) {
  if (nur && F.id !== nur) continue;
  const p = {}; for (const q of [...K._ADV_GEMEIN, ...F.params]) p[q.k] = q.def; p.mischen = 1; p.seed = 7;
  const t0 = Date.now(); const r = F.build(w, p, null); const dt = Date.now() - t0;
  console.log(`\n== ${F.name}: ${r.teile.length} Teile in ${dt} ms`); r.info.zeilen.forEach(z => console.log('   ' + z)); r.info.warn.forEach(z => console.log('   ⚠ ' + z));
  let vol = 0;
  for (const t of r.teile) {
    const d = t.d, b = d.boundingBox(), sz = [0, 1, 2].map(i => b.max[i] - b.min[i]), parts = d.decompose(), v = d.volume();
    vol += K._advGramm(d); parts.forEach(x => x.delete());
    const passt = sz.every(x => x <= p.bett) && Math.abs(b.min[2]) < 0.01;
    const einzeln = t.art === 'stift' || parts.length === 1;
    if (!passt || !einzeln || process.env.V) console.log(`   ${t.name.padEnd(26)} ${sz.map(x => x.toFixed(0)).join('×')} mm  ${(v / 1000).toFixed(0)} cm³  Stücke ${parts.length}  genus ${d.genus()}`);
    ok(passt && einzeln && v > 0, `${t.name}: passt aufs Bett, ${parts.length} Stück`);
    if (t.m) { const mb = t.m.boundingBox(); t.mb = mb; }
  }
  const ms = r.teile.filter(t => t.m), mn = [0, 1, 2].map(i => Math.min(...ms.map(t => t.mb.min[i]))), mx = [0, 1, 2].map(i => Math.max(...ms.map(t => t.mb.max[i])));
  console.log(`   zusammengebaut: ${mx.map((x, i) => (x - mn[i]).toFixed(0)).join(' × ')} mm (x × y × z), steht bei y=${mn[1].toFixed(2)}; Filament ≈ ${vol.toFixed(0)} g`);
  ok(Math.abs(mn[1]) < 0.5, 'steht auf y = 0');
  ok(Math.abs((mx[1] - mn[1]) - p.hoehe) < 0.06 * p.hoehe, `Höhe ≈ ${p.hoehe}`);
  // Überschneidungen Fach/Stöpsel ↔ Rahmen in Gebrauchslage
  const rahmen = w.Manifold.union(r.teile.filter(t => t.art === 'rahmen').map(t => t.m));
  let maxU = 0, wo = '';
  for (const t of r.teile.filter(t => t.art === 'fach')) { const x = rahmen.intersect(t.m), v = x.volume(); x.delete(); if (v > maxU) { maxU = v; wo = t.name; } }
  ok(maxU < 5, `Fächer kollidieren nicht mit dem Rahmen (max ${maxU.toFixed(1)} mm³ ${wo})`);
  rahmen.delete();
  for (const t of r.teile) { t.d.delete(); t.m && t.m.delete(); }
}
console.log(fail ? `\n${fail} Fehler` : '\nalles grün'); process.exit(fail ? 1 : 0);
