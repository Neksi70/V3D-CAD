// Node-Test des Kamin-Kerns (tools/kamin-adventskalender/kak_core.js) gegen die Formeln der .scad:
// Abnahme-Maße (Turm 104×104×430, Stein 103×106,7×12,8, Feuerstelle 192×147×112), jedes Teil geschlossen
// (Manifold-Status + Kantenprüfung), Kollision Stein/Blindstein ↔ Turm in jedem Schlitz, Krone ↔ Turm,
// Turm ↔ Feuerstelle, Turm-Teilung (Segmente ≤ Bauhöhe, Falz passt, stützfrei).
import Module from '/home/v3da/node_modules/manifold-3d/manifold.js';
import fs from 'fs';
const w = await Module(); w.setup();
const K = new Function('module', fs.readFileSync(new URL('../tools/kamin-adventskalender/kak_core.js', import.meta.url), 'utf8') + '; return { KAK_DEF, KAK_DRUCKER, kakMasse, kakBelegung, kakSegmente, kakBuild };')(undefined);
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const groesse = mf => { const b = mf.boundingBox(); return [0, 1, 2].map(i => +(b.max[i] - b.min[i]).toFixed(2)); };
const gleich = (a, b, t = 0.05) => a.every((v, i) => Math.abs(v - b[i]) <= t);
// geschlossen: Manifold-Status + jede Kante genau zweimal (aus dem Netz)
const dicht = mf => { if (mf.status && mf.status() !== 'NoError' && mf.status() !== 0) return false;
  const me = mf.getMesh(), T = me.triVerts, E = new Map();
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a; E.set(key, (E.get(key) || 0) + 1); }
  for (const v of E.values()) if (v !== 2) return false; return true; };
const t0 = Date.now();
const B = K.kakBuild(w, { ...K.KAK_DEF }, null), m = B.m, P = B.p;
const turm = B.tower(), stein = B.stone_body(1, true), feuer = B.base(), krone = B.cap(), aufsatz = B.cap_top(), blind = B.blank_print();
console.log('Bauzeit', Date.now() - t0, 'ms');
ok(gleich(groesse(turm), [104, 104, 430]), 'Turm 104 × 104 × 430: ' + groesse(turm).join(' × '));
ok(gleich(groesse(stein), [103, 106.7, 12.8]), 'Stein 103 × 106,7 × 12,8: ' + groesse(stein).join(' × '));
ok(gleich(groesse(feuer), [192, 147, 112]), 'Feuerstelle 192 × 147 × 112: ' + groesse(feuer).join(' × '));
for (const [n, mf] of [['Turm', turm], ['Stein', stein], ['Feuerstelle', feuer], ['Krone', B.cap_print()], ['Aufsatz', aufsatz], ['Blindstein', blind], ['Stein Tag 2', B.stone_print(2)]])
  ok(dicht(mf) && mf.volume() > 0 && mf.decompose().length === 1, `${n} geschlossen, 1 Stück, ${(mf.volume() / 1000).toFixed(1)} cm³, Genus ${mf.genus()}`);
// Kollision: Stein / Blindstein in jedem Schlitz (Koordinaten wie im Turm: y = 0 Front, Schlitz-Unterkante = slot_z)
let maxS = 0, maxB = 0;
for (let i = 0; i < P.slots; i++) {
  maxS = Math.max(maxS, w.Manifold.intersection(turm, stein.translate([0, 0, m.slot_z(i)])).volume());
  maxB = Math.max(maxB, w.Manifold.intersection(turm, B.stone_body(0, false).translate([0, 0, m.slot_z(i)])).volume());
}
ok(maxS < 1e-3 && maxB < 1e-3, `Stein und Blindstein in allen ${P.slots} Schlitzen kollisionsfrei (max ${maxS.toExponential(1)} / ${maxB.toExponential(1)} mm³)`);
// Stein steckt wirklich im Schlitz: 0,3 mm höher stößt an
ok(w.Manifold.intersection(turm, stein.translate([0, 0, m.slot_z(5) + 0.4])).volume() > 1, 'Stein sitzt satt im Schlitz (0,4 mm höher stößt an)');
// Blindstein-Noppen klemmen (stoßen leicht an der Schlitzdecke an – gewollt, .scad: „damit er nicht rausrutscht“)
const klemm = w.Manifold.intersection(turm, B.stone_body(0, false).translate([0, 0, m.slot_z(3)])).volume();
console.log('   Blindstein-Noppen gegen Schlitzdecke:', klemm.toFixed(4), 'mm³ (Noppen 0,35 hoch, Luft über Platte', ((P.slot_h - P.pt) / 2).toFixed(2), 'mm)');
// Krone ↔ Turm (Krone sitzt bei z = tower_h), Turm ↔ Feuerstelle (Turm steht bei z = base_h − sock)
ok(w.Manifold.intersection(turm, krone.translate([0, 0, m.tower_h])).volume() < 1e-3, 'Kronen-Steckrand kollisionsfrei im Turm');
ok(w.Manifold.intersection(feuer, turm.translate([m.tower_x, m.tower_y, P.base_h - m.sock])).volume() < 1e-3, 'Turm steht kollisionsfrei in der Sims-Aufnahme');
ok(w.Manifold.intersection(feuer, turm.translate([m.tower_x, m.tower_y, P.base_h - m.sock - 0.1])).volume() > 1, 'Turm steht auf dem Boden der Aufnahme (0,1 mm tiefer stößt an)');
// Trichter: 45° links/rechts (Höhe = (fb_w − in_w)/2 = 17)
ok(Math.abs((m.fb_w - P.in_w) / 2 - 17) < 1e-9, 'Trichter links/rechts 45° (17 mm)');
// Belegung
const bel = K.kakBelegung(24, 30); ok(bel.length === 24 && bel[23] === 28, 'Belegung 24/30 = Liste der .scad');
const b31 = K.kakBelegung(31, 31), b10 = K.kakBelegung(10, 30);
ok(new Set(b31).size === 31 && new Set(b10).size === 10 && b10.every(x => x < 30), 'Belegung 31/31 und 10/30 eindeutig, im Bereich');
// Turm teilen: H2C (325) und K3 (260)
for (const dr of ['h2c', 'k3']) {
  const bett = K.KAK_DRUCKER[dr].bett, B2 = K.kakBuild(w, { ...K.KAK_DEF, bett, teilen: 1 }, null), T = B2.turmTeile();
  const hs = T.teile.map(s => groesse(s.mf)[2]), Z = T.Z, fugeOk = Z.slice(1, -1).every(z => { const i = (z - P.margin_b - P.slot_h / 2 - P.pitch / 2) / P.pitch; return Math.abs(i - Math.round(i)) < 1e-6; });
  let fit = 0; for (let s = 0; s + 1 < T.teile.length; s++) fit = Math.max(fit, w.Manifold.intersection(T.teile[s].mf, T.teile[s + 1].mf).volume());
  ok(T.teile.length >= 2 && hs.every(h => h <= bett[2]) && fugeOk && fit < 1e-3 && T.teile.every(s => dicht(s.mf) && s.mf.decompose().length === 1),
     `${K.KAK_DRUCKER[dr].name}: ${T.teile.length} Segmente ${hs.join(' / ')} mm ≤ ${bett[2]}, Teilung auf Mauerfuge, Falz kollisionsfrei`);
  B2.aufraeumen();
}
B.aufraeumen();
console.log(fail ? `\n${fail} FEHLER` : '\nalles grün'); process.exit(fail ? 1 : 0);
