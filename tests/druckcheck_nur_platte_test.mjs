// Regressionstest Druckcheck „Nur auf Druckplatte“ (Volker 9.11., Piston Skull: Bambu meldete
// „Nicht unterstützte Überhänge … Stützstruktur nur auf Druckplatte“). Überhänge ÜBER DEM MODELL
// werden erkannt und das Abschalten vorgeschlagen; Überhänge über der Platte nicht.
// Start: node tests/druckcheck_nur_platte_test.mjs
import * as PC from '/home/v3da/orca-wasm/web/print-check.js';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const quader = (boxes) => { const V = [], T = [];
  for (const [x0, y0, z0, x1, y1, z1] of boxes) { const o = V.length;
    V.push([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    for (const t of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) T.push(t.map(i => i + o)); }
  return PC.analyzeMesh(new Float32Array(V.flat()), new Uint32Array(T.flat()), { name: 'm' }); };
// Pilz: Sockel 80×80×5, Säule 10×10 bis 30, Hut 50×50 von 30 bis 36 → Hutunterseite über dem Sockel
const pilz = quader([[0, 0, 0, 80, 80, 5], [35, 35, 5, 45, 45, 30], [15, 15, 30, 65, 65, 36]]);
// Wandhalter Γ: Arm hängt über der Platte (kein Modell darunter)
const halter = quader([[0, 0, 0, 20, 60, 40], [20, 0, 34, 80, 60, 40]]);
ok('Pilz: Überhang über dem Modell gemessen', pilz.overModelArea > 1000, Math.round(pilz.overModelArea));
ok('Halter: kein Überhang über dem Modell', halter.overModelArea < 1, Math.round(halter.overModelArea));
const basis = { ...PC.baselineConfig({ material: 'PLA', printable: [256, 256, 256], support: true }), support_type: 'tree(auto)', support_on_build_plate_only: '1' };
const ids = (m, c) => PC.checkSettings(c, { models: [m] }).map(f => f.id);
ok('Pilz + nur Druckplatte → Befund nur_platte mit Abschalt-Fix', (() => { const f = PC.checkSettings(basis, { models: [pilz] }).find(x => x.id === 'nur_platte'); return f && f.fixes.some(x => x.key === 'support_on_build_plate_only' && x.value === '0'); })());
ok('Pilz ohne „nur Druckplatte“ → kein Befund', !ids(pilz, { ...basis, support_on_build_plate_only: '0' }).includes('nur_platte'));
ok('Halter + nur Druckplatte → kein Befund', !ids(halter, basis).includes('nur_platte'), ids(halter, basis));
// Stützen aus + nur Druckplatte: „Alles verbessern“ schaltet Stützen an UND „nur Druckplatte“ ab (Folge-Änderung)
const aus = { ...basis, enable_support: '0' };
const chk = c => PC.checkSettings(c, { models: [pilz] }), f0 = chk(aus);
const res = PC.improveAll(aus, f0, f0.flatMap(f => f.fixes || []), chk);
ok('Folge-Änderung: Stützen an → „Nur auf Druckplatte“ aus', res.fixes.some(x => x.key === 'enable_support' && x.value === '1') && res.fixes.some(x => x.key === 'support_on_build_plate_only' && x.value === '0'), res.fixes.map(x => x.key + '=' + x.value));
ok('Punkte nachher ≥ vorher', res.after >= res.before, [res.before, res.after]);
ok('Bezeichnung wie in Bambu Studio', PC.keyLabel('support_on_build_plate_only') === 'Nur auf Druckplatte (On build plate only)', PC.keyLabel('support_on_build_plate_only'));
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
