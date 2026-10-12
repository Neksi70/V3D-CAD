// Druck-Check-Kern (web/print-check.js): Regeln an erzeugten Körpern + echten Dateien
// Start: node test/print-check-test.mjs
import fs from 'fs';
import * as P from '../web/print-check.js';

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
const ids = F => F.map(f => f.id);

// Quader als indiziertes Netz (Normalen nach außen)
function boxes(...bs) {
  const pos = [], index = [];
  for (const [x0, y0, z0, x1, y1, z1] of bs) {
    const o = pos.length / 3;
    for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]) pos.push(x, y, z);
    for (const t of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]])
      index.push(o + t[0], o + t[1], o + t[2]);
  }
  return { pos: new Float32Array(pos), index: new Uint32Array(index) };
}
const an = (m, name = 'Test') => P.analyzeMesh(m.pos, m.index, { name });
const base = (o = {}) => P.baselineConfig({ material: 'PLA', ...o });

console.log('Modell-Regeln');
{
  const m = an(boxes([0, 0, 0, 20, 20, 5], [0, 0, 10, 20, 20, 15]));
  ok(m.islands.length === 1 && Math.abs(m.islands[0] - 10) < 1e-3, `schwebender Quader = 1 Insel bei 10 mm (${m.islands})`);
  const F = P.checkSettings(base(), { models: [m] });
  const s = F.find(f => f.id === 'stuetzen_an');
  ok(s && s.level === P.LEVEL.ERROR, 'Insel → Fehler „Stützen nötig“');
  ok(s && s.fixes.some(x => x.key === 'enable_support' && x.value === '1'), 'Fix schaltet Stützen ein');
}
{
  const m = an(boxes([0, 0, 0, 20, 20, 5], [0, 0, 5, 20, 20, 10]));   // gestapelt, berührend
  ok(m.islands.length === 0, 'aufgestapelter Quader ist keine Insel');
  ok(!ids(P.checkSettings(base(), { models: [m] })).includes('stuetzen_an'), 'gestapelt → keine Stützen');
}
{
  const m = an(boxes([0, 0, 0, 20, 20, 20]));
  const F = P.checkSettings(base({ support: true }), { models: [m] });
  ok(ids(F).includes('stuetzen_aus'), 'Würfel mit Stützen → „vermutlich unnötig“');
  ok(!ids(P.checkSettings(base(), { models: [m] })).length, `Würfel + passende Grundwerte → keine Befunde (${ids(P.checkSettings(base(), { models: [m] }))})`);
}
{
  const m = an(boxes([0, 0, 0, 30, 0.3, 10]));
  ok(P.thinFraction(m.thick, 0.38) > 0.9, `0,3-mm-Wand gemessen (${P.thinFraction(m.thick, 0.38).toFixed(2)})`);
  ok(ids(P.checkSettings(base(), { models: [m] })).includes('zudünn'), '0,3 mm Wand → „dünner als die Düse“');
  const m2 = an(boxes([0, 0, 0, 30, 0.6, 10]));
  const F2 = P.checkSettings(base(), { models: [m2] });
  ok(ids(F2).includes('dünn') && !ids(F2).includes('zudünn'), '0,6 mm Wand → Arachne-Hinweis');
  ok(F2.find(f => f.id === 'dünn').fixes[0].value === 'arachne', 'Fix = Arachne');
}
{
  const m = an(boxes([0, 0, 0, 5, 5, 60]));
  const F = P.checkSettings(base({ brim: 'no_brim' }), { models: [m] });
  ok(ids(F).includes('kippen'), 'Turm 5×5×60 ohne Rand → kippen');
  ok(!ids(P.checkSettings(base(), { models: [m] })).includes('kippen'), 'mit Auto-Rand kein Kipp-Befund');
}
{
  const m = an(boxes([0, 0, 0, 120, 120, 10]));
  const F = P.checkSettings(base({ material: 'ASA', brim: 'no_brim' }), { models: [m] });
  ok(ids(F).includes('warping'), 'großer ASA-Druck ohne Rand → Warping');
  const F2 = P.checkSettings(base({ printable: [100, 100, 100] }), { models: [m] });
  ok(ids(F2).includes('bauraum'), '120 mm auf 100-mm-Bett → Bauraum-Fehler');
}

console.log('Einstellungs-Regeln');
{
  const c = base({ material: 'ASA', bedType: 'Cool Plate' });
  ok(ids(P.checkSettings(c, {})).includes('platte0'), 'ASA auf Cool Plate → Fehler');
  const c2 = { ...base(), nozzle_temperature: '250' };
  const f = P.checkSettings(c2, {}).find(x => x.id === 'nozzle_temperature0');
  ok(f && f.fixes[0].value === '225', `PLA 250 °C → auf 225 °C (${f && f.fixes[0].value})`);
  const c3 = { ...base(), layer_height: '0.36' };
  ok(P.checkSettings(c3, {}).find(x => x.id === 'lh_hoch')?.level === P.LEVEL.ERROR, '0,36 mm auf 0,4-Düse → Fehler');
  const c4 = { ...base(), top_shell_layers: '2' };
  ok(P.checkSettings(c4, {}).find(x => x.id === 'top')?.fixes[0].value === '4', '2 Deckschichten à 0,2 → 4');
  const c5 = { ...base(), fan_max_speed: '30' };
  ok(ids(P.checkSettings(c5, {})).includes('fanlow0'), 'PLA mit 30 % Lüfter → Warnung');
  const c6 = { ...base(), filament_type: 'PLA-CF', nozzle_type: 'brass' };
  ok(ids(P.checkSettings(c6, {})).includes('abrasiv0'), 'PLA-CF + Messing → Warnung');
}

console.log('Urteil, Steckbrief, Stellen');
{
  const m = an(boxes([0, 0, 0, 20, 20, 5], [0, 0, 10, 20, 20, 15]));
  const F = P.checkSettings(base(), { models: [m] });
  const s = F.find(f => f.id === 'stuetzen_an');
  ok(s.loc && s.loc.pts.length && Math.abs(s.loc.pts[0][2] - 10) < 0.01, 'Stützen-Befund zeigt auf die Insel (z = 10)');
  ok(P.verdict(P.summarize(F)).text.startsWith('So lieber nicht'), 'Urteil bei Fehler');
  ok(P.verdict(P.summarize([])).emoji === '🎉', 'Urteil ohne Befund');
  const thin = an(boxes([0, 0, 0, 30, 0.3, 10]));
  const t = P.checkSettings(base(), { models: [thin] }).find(f => f.id === 'zudünn');
  ok(t.loc && t.loc.pts.length > 0, 'Dünnwand-Befund hat Stellen');
  const fa = P.printFacts({ ...base(), filament_cost: '25', filament_density: '1.24' }, null, [an(boxes([0, 0, 0, 20, 20, 20]))]);
  ok(fa.weightEst && fa.weightG > 2 && fa.weightG < 10 && fa.costEur > 0, `Gewicht geschätzt (${fa.weightG.toFixed(1)} g, ${fa.costEur.toFixed(2)} €)`);
  const big = an(boxes([0, 0, 0, 200, 100, 10]));
  ok(!ids(P.checkSettings(base({ printable: [256, 256, 256] }), { models: [big] })).includes('bauraum'), '200×100 passt auf 256er Bett');
  ok(ids(P.checkSettings(base({ printable: [180, 300, 180] }), { models: [an(boxes([0, 0, 0, 250, 100, 10]))] })).includes('bauraum') === false, '250×100 passt gedreht auf 180×300');
}

console.log('Fixes anwenden');
{
  const c = { nozzle_temperature: ['200', '210'], fan: '100,100', t: 'PLA;PETG', x: '1' };
  const o = P.applyFixes(c, [{ key: 'nozzle_temperature', value: '220', idx: 1 }, { key: 'fan', value: '80' }, { key: 't', value: 'ASA', idx: 0 }, { key: 'x', value: '0' }]);
  ok(JSON.stringify(o.nozzle_temperature) === '["200","220"]', 'Array: nur Index 1 geändert');
  ok(o.fan === '80,80' && o.t === 'ASA;PETG' && o.x === '0', `Strings behalten Form (${o.fan} | ${o.t})`);
}

console.log('Echte Dateien');
{
  const g = P.parseGcode(fs.readFileSync(new URL('./cube20.stl.gcode', import.meta.url), 'utf8'));
  ok(g.cfg.layer_height === '0.2' && g.stats.layers === 100, 'Orca-G-Code: Config + Schichtzahl');
  ok(g.features['Outer wall'] > 0, 'Merkmale (;TYPE:) gezählt');
  ok(P.cfgStr(g.cfg, 'filament_type', 1) === 'PLA', 'Vektor-Wert „PLA;PLA“ Index 1');
}
{
  const u8 = new Uint8Array(fs.readFileSync(new URL('./adaptive-relief.stl.gcode.3mf', import.meta.url)));
  const r = await P.loadAny('x.gcode.3mf', u8);
  ok(r.source === 'gcode3mf' && r.cfg && r.gcode.stats.layers > 0, '.gcode.3mf: project_settings + G-Code gelesen');
  const blob = await P.patched3mf(r.zip, r.cfg, [{ key: 'layer_height', value: '0.12' }, { key: 'enable_support', value: '1' }]);
  const r2 = await P.loadAny('y.3mf', new Uint8Array(await blob.arrayBuffer()));
  ok(r2.source === '3mf' && P.cfgStr(r2.cfg, 'layer_height') === '0.12' && P.cfgStr(r2.cfg, 'enable_support') === '1',
    'korrigiertes 3MF: Werte drin, alter Slice entfernt');
}
const bambu = '/tmp/bs/out/stecker.gcode.3mf';
if (fs.existsSync(bambu)) {
  const r = await P.loadAny(bambu, new Uint8Array(fs.readFileSync(bambu)));
  const models = r.meshes.map(m => P.analyzeMesh(m.pos, m.index, { name: m.name }));
  ok(models.length === 1 && models[0].tris > 1000, 'Bambu-3MF: Netz aus 3D/Objects gelesen');
  ok(r.gcode.stats.timeS === 989 && Math.abs(r.gcode.stats.weightG - 6.38) < 0.01, 'Bambu-Kopf: Zeit + Gewicht');
  const F = P.checkSettings(r.cfg, { models, gcode: r.gcode, usedFilaments: r.gcode.usedFilaments });
  ok(!F.some(f => f.level >= P.LEVEL.WARN), `real gut gedruckter Gartenstecker ohne Warnung (${ids(F)})`);
}

console.log(fail ? `\n${fail} FEHLGESCHLAGEN` : '\nalle grün');
process.exit(fail ? 1 : 0);
