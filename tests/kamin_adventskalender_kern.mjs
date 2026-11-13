// Node-Test des Kamin-Kerns (tools/kamin-adventskalender/kak_core.js) gegen die Formeln der .scad:
// Maße (Turm 104×104×480, Schieber mit Griffscheibe, Feuerstelle 192×147×112), jedes Teil geschlossen
// (Manifold-Status + Kantenprüfung), Kollision Stein/Blindstein ↔ Turm in jedem Schlitz, Krone ↔ Turm,
// Turm ↔ Feuerstelle, Turm-Teilung (Segmente ≤ Bauhöhe, Falz passt, stützfrei).
import Module from '/home/v3da/node_modules/manifold-3d/manifold.js';
import fs from 'fs';
const w = await Module(); w.setup();
const K = new Function('module', fs.readFileSync(new URL('../tools/kamin-adventskalender/kak_core.js', import.meta.url), 'utf8') + '; return { KAK_DEF, KAK_DRUCKER, kakMasse, kakBelegung, kakEtagen, kakFalzHoehe, kakSegmente, kakBuild };')(undefined);
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
const turm = B.tower(), stein = B.stone_body(1, true), feuer = B.base(), krone = B.cap(), aufsatz = B.cap_top(), blind = B.stone_body(0, false);
console.log('Bauzeit', Date.now() - t0, 'ms');
const H = P.margin_b + (P.slots - 1) * P.pitch + P.slot_h + P.margin_t;
ok(gleich(groesse(turm), [112, 92, H]) && H === 447, `Turm 112 × 92 × ${H} (2 Schächte, 36 Etagen à 12 mm): ` + groesse(turm).join(' × '));
const sp = groesse(B.stone_print(1));
ok(gleich(sp, [P.hals + P.griff_t + P.wall + m.schacht_w - P.clr, P.in_d + 2 * P.gd - 2 * P.clr, 2 * P.griff_r]), `Tages-Schieber ${sp.join(' × ')} (lang × breit × Zapfen-Ø)`);
const feuerGanz = w.Manifold.union([feuer, B.schneeKante(), B.bogenRing()]);
ok(gleich(groesse(feuerGanz), [176, 135, 112]), 'Feuerstelle mit Einlagen 176 × 135 × 112: ' + groesse(feuerGanz).join(' × '));
// Deko: Einlagen überschneiden die Feuerstelle nicht, Flamme/Socken geschlossen und frei
{ const bog = B.bogenRing(), sch = B.schneeKante(), F = B.flamme_print(), V2 = (a, b) => w.Manifold.intersection(a, b).volume();
  ok(V2(feuer, bog) < 1e-3 && V2(feuer, sch) < 1e-3 && bog.volume() > 1000 && sch.volume() > 1000, `Bogenrahmen (${bog.volume().toFixed(0)} mm³) und Schnee (${sch.volume().toFixed(0)} mm³) als Einlage ohne Überschneidung`);
  const fl = B.flamme_lage(F.aussen), fb = fl.boundingBox();
  ok(dicht(F.aussen) && dicht(F.innen) && V2(feuer, fl) < 1e-3 && fb.max[2] < m.fb_top, `Flamme geschlossen, steht frei an der Rückwand (Oberkante ${fb.max[2].toFixed(1)} < Feuerraum ${m.fb_top})`);
  for (const L of [true, false]) { const S = B.socke_print('', L), sl = B.socke_lage(S.rot, L);
    ok(dicht(S.rot) && S.rot.decompose().length === 1 && V2(feuer, sl) < 1e-3 && V2(feuer, sl.translate([0, 0.1, 0])) > 0.1, `Socke ${L ? 'links' : 'rechts'}: 1 Stück, liegt an der Simsfront an (0,1 mm weiter stößt an)`); }
}
for (const [n, mf] of [['Turm', turm], ['Schieber', B.stone_print(1)], ['Feuerstelle', feuer], ['Krone', B.cap_print()], ['Aufsatz', aufsatz], ['Blindstopfen', B.blank_print()]])
  ok(dicht(mf) && mf.volume() > 0 && mf.decompose().length === 1, `${n} geschlossen, 1 Stück, ${(mf.volume() / 1000).toFixed(1)} cm³, Genus ${mf.genus()}`);
// Druckorientierung: alles ab z = 0, Platte unten
ok([B.stone_print(1), B.blank_print()].every(mf => Math.abs(mf.boundingBox().min[2]) < 1e-6), 'Schieber/Stopfen liegen in Drucklage auf z = 0');
// Lage im Turm: links = wie gebaut, rechts = 180° um die Turmachse gedreht (gleiches Teil)
const R = mf => mf.translate([-m.out_w / 2, -m.out_d / 2, 0]).rotate([0, 0, 180]).translate([m.out_w / 2, m.out_d / 2, 0]);
const an = (mf, i) => mf.translate([0, 0, m.slot_z(i)]), V = (a, b) => w.Manifold.intersection(a, b).volume();
let mx = 0, mb = 0;
for (let i = 0; i < P.slots; i++) { for (const mf of [stein, R(stein)]) mx = Math.max(mx, V(turm, an(mf, i))); for (const mf of [blind, R(blind)]) mb = Math.max(mb, V(turm, an(mf, i))); }
ok(mx < 1e-3, `Schieber links/rechts in allen ${P.slots} Etagen kollisionsfrei mit dem Turm (max ${mx.toExponential(1)} mm³)`);
ok(mb < 0.05, `Blindstopfen: nur die Klemmnoppen drücken gewollt an die Schlitzdecke (${mb.toFixed(4)} mm³ je Stopfen)`);
ok(V(turm, an(stein, 5).translate([0, 0, 0.4])) > 1, 'Schieber sitzt satt im Schlitz (0,4 mm höher stößt an)');
ok(V(an(stein, 7), an(R(blind), 7)) < 1e-3 && V(an(R(stein), 7), an(blind, 7)) < 1e-3 && V(an(stein, 7), an(R(stein), 7)) < 1e-3, 'Schieber rechts + links auf derselben Etage (je eigener Schacht) und Stopfen berühren sich nicht');
ok(V(an(stein, 7), an(blind, 8)) < 1e-3 && V(an(stein, 7), an(stein, 8)) < 1e-3, 'Zapfen stößt weder an den Stopfen noch an den Schieber direkt darüber (Fach = 1 Etage möglich)');
ok(V(turm, an(stein, 7).translate([0.5, 0, 0])) > 0.1, 'Gegenprobe: 0,5 mm weiter hinein stößt der Zapfen an die Wand (Anschlag)');
ok(V(krone.translate([0, 0, m.tower_h]), an(stein, P.slots - 1)) < 1e-3 && V(krone.translate([0, 0, m.tower_h]), an(R(stein), P.slots - 1)) < 1e-3, 'Griffscheibe in der obersten Etage stößt nicht an die Krone');
const amTurm = mf => mf.translate([m.tower_x, m.tower_y, P.base_h - m.sock]);
ok(V(feuer, amTurm(an(stein, 0))) < 1e-3 && V(feuer, amTurm(an(R(stein), 0))) < 1e-3, 'Unterste Griffscheiben stoßen nicht an den Sims');
// Krone ↔ Turm (Krone sitzt bei z = tower_h), Turm ↔ Feuerstelle (Turm steht bei z = base_h − sock)
ok(w.Manifold.intersection(turm, krone.translate([0, 0, m.tower_h])).volume() < 1e-3, 'Kronen-Steckrand kollisionsfrei im Turm');
ok(w.Manifold.intersection(feuer, turm.translate([m.tower_x, m.tower_y, P.base_h - m.sock])).volume() < 1e-3, 'Turm steht kollisionsfrei in der Sims-Aufnahme');
ok(w.Manifold.intersection(feuer, turm.translate([m.tower_x, m.tower_y, P.base_h - m.sock - 0.1])).volume() > 1, 'Turm steht auf dem Boden der Aufnahme (0,1 mm tiefer stößt an)');
// Trichter: 45° links/rechts (Höhe = (fb_w − in_w)/2 = 17)
ok((m.fb_w - P.in_w) / 2 > 0 && (m.fb_d - P.in_d) / 2 > 0, `Trichter verjüngt sich vom Feuerraum (${m.fb_w} × ${m.fb_d}) auf den Schacht (${P.in_w} × ${P.in_d}) – keine Absätze`);
// Belegung (Vorschau): gleichmäßig, aufsteigend, Seiten wechseln → gleiche Seite ≥ 2 Etagen Abstand
const bel = K.kakEtagen(24, P.slots, 1);
ok(bel.length === 24 && bel.every((x, i) => x < P.slots && (i < 2 || x > bel[i - 2])), `Belegung 24 Tage / 2 × ${P.slots} Etagen (je Schacht aufsteigend): ${bel.join(',')}`);
// Turm teilen: H2C (325) und K3 (260)
for (const dr of ['h2c', 'k3']) {
  const bett = K.KAK_DRUCKER[dr].bett, B2 = K.kakBuild(w, { ...K.KAK_DEF, bett, teilen: 1 }, null), T = B2.turmTeile();
  const hs = T.teile.map(s => groesse(s.mf)[2]), Z = T.Z, fugeOk = Z.slice(1, -1).every(z => { const i = (z - P.margin_b - P.slot_h / 2 - P.pitch / 2) / P.pitch; return Math.abs(i - Math.round(i)) < 1e-6; });
  let fit = 0; for (let s = 0; s + 1 < T.teile.length; s++) fit = Math.max(fit, w.Manifold.intersection(T.teile[s].mf, T.teile[s + 1].mf).volume());
  const innen = w.Manifold.cube([P.in_w - 1, P.in_d - 1, m.tower_h], false).translate([P.wall + 0.5, P.wall + 0.5, 0]).subtract(w.Manifold.cube([P.wall + 1, P.in_d + 2, m.tower_h], false).translate([m.out_w / 2 - P.wall / 2 - 0.5, P.wall - 1, 0]));
  const frei = T.teile.reduce((a, s) => Math.max(a, w.Manifold.intersection(s.mf, innen).volume()), 0);
  ok(frei < 1e-3, `${K.KAK_DRUCKER[dr].name}: Schacht an der Teilung frei (kein Deckel; ${frei.toFixed(3)} mm³ im Schacht)`);
  ok(T.teile.length >= 2 && hs.every(h => h <= bett[2]) && fugeOk && fit < 1e-3 && T.teile.every(s => dicht(s.mf) && s.mf.decompose().length === 1),
     `${K.KAK_DRUCKER[dr].name}: ${T.teile.length} Segmente ${hs.join(' / ')} mm ≤ ${bett[2]}, Teilung auf Mauerfuge, Falz kollisionsfrei`);
  B2.aufraeumen();
}
B.aufraeumen();
console.log(fail ? `\n${fail} FEHLER` : '\nalles grün'); process.exit(fail ? 1 : 0);
