// Regressionstest „Alles verbessern“ wird nie schlechter (Volker 9.11.: 86 → 78 Punkte).
// Fall: flaches Dach → Vorschlag Schichthöhe 0,2 → 0,12 mm; mit 3 Bodenschichten wäre der Boden dann
// nur 0,36 mm → neuer Befund „Boden zu dünn“. improveAll muss die Folge-Änderung (Bodenschichten) mitnehmen.
// Zusätzlich: an echten Modellen nachher ≥ vorher. Start: node tests/druckcheck_verbessern_test.mjs
import * as PC from '/home/v3da/orca-wasm/web/print-check.js';
import { readFileSync, existsSync } from 'fs';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const V = [[0,0,0],[100,0,0],[100,100,0],[0,100,0],[0,0,20],[100,0,20],[100,100,20],[0,100,20],[50,50,30]];
const T = [[0,2,1],[0,3,2],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7],[4,5,8],[5,6,8],[6,7,8],[7,4,8]];
const models = [PC.analyzeMesh(new Float32Array(V.flat()), new Uint32Array(T.flat()), { name: 'Dach' })];
const cfg = { ...PC.baselineConfig({ material: 'PLA', printable: [256, 256, 256] }), layer_height: '0.2', bottom_shell_layers: '3', bottom_shell_thickness: '0', top_shell_layers: '5', top_shell_thickness: '0' };
const chk = c => PC.checkSettings(c, { models });
const f0 = chk(cfg), alle = f0.flatMap(f => f.fixes || []);
const alt = PC.summarize(chk(PC.applyFixes(cfg, alle))).score;
const res = PC.improveAll(cfg, f0, alle, chk);
ok('Ausgangslage: Vorschlag 0,12 mm', alle.some(x => x.key === 'layer_height' && x.value === '0.12'), alle.map(x => x.key + '=' + x.value));
ok('alter Weg wurde schlechter (Nachweis des Fehlers)', alt < res.before, { vorher: res.before, alt });
ok('neu: nachher ≥ vorher', res.after >= res.before, { vorher: res.before, nachher: res.after });
ok('Folge-Änderung Bodenschichten mitgenommen', res.fixes.some(x => x.key === 'bottom_shell_layers' && +x.value >= 5), res.fixes.map(x => x.key + '=' + x.value));
// Nie-schlechter-Sicherung: künstlicher „Fix“, der einen Fehler erzeugt, wird weggelassen
const boese = { key: 'v3d_test_schaden', value: '1' };
const chk2 = c => [...chk(c), ...(c.v3d_test_schaden === '1' ? [{ id: 'test_fehler', level: PC.LEVEL.ERROR, title: 'Testfehler', fixes: [] }] : [])];
const r2 = PC.improveAll(cfg, f0, [...alle, boese], chk2);
ok('schädliche Änderung wird weggelassen', r2.dropped.includes(boese) && r2.after >= r2.before, { dropped: r2.dropped.map(x => x.key), vorher: r2.before, nachher: r2.after });
for (const f of ['/home/v3da/orca-wasm/test/stress.stl', '/home/v3da/orca-wasm/test/vase.stl', '/home/v3da/orca-wasm/test/double.3mf']) {
  if (!existsSync(f)) continue;
  const r = await PC.loadAny(f.split('/').pop(), new Uint8Array(readFileSync(f)));
  const ms = r.meshes.map(m => PC.analyzeMesh(m.pos, m.index, { name: m.name }));
  const c = r.cfg && Object.keys(r.cfg).length ? r.cfg : PC.baselineConfig({ material: 'PLA', printable: [256, 256, 256] });
  const ch = x => PC.checkSettings(x, { models: ms }), ff = ch(c), rr = PC.improveAll(c, ff, ff.flatMap(x => x.fixes || []), ch);
  ok(f.split('/').pop() + ': nachher ≥ vorher', rr.after >= rr.before, [rr.before, rr.after]);
}
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
