// Test des Strebe→Spline-Rechenkerns gegen den künstlichen Kanzel-Scan mit bekannter Soll-Kammlinie.
//   node tests/strebenspline_kern_test.mjs
import { createRequire } from 'node:module';
import { makeTestScan, trueCrest, center, MISALIGN } from './strebenspline_testscan.mjs';
const require = createRequire(import.meta.url);
const K = require('../lib/strebenspline-kern.js');

let fehler = 0;
const ok = (bed, txt) => { console.log((bed ? '  ✓ ' : '  ✗ ') + txt); if (!bed) fehler++; };
const t0 = Date.now(), zeit = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s';

const scan = makeTestScan();
console.log('Testscan:', scan.nTri, 'Dreiecke');
const prm = Object.assign({}, K.PARAM_DEFAULT);

// 0 Ausrichtung
let mesh = K.makeMesh(scan.positions);
const al = K.ausrichten(mesh);
console.log('0 Ausrichtung', zeit(), 'rms', al.rms.toFixed(2), 'mm, Anteil', (al.anteil * 100).toFixed(0) + ' %');
// Soll: aligned = R⁻¹ (scan − t)  → prüfen über bekannte Punkte
const Rt = scan.R, tv = scan.t;
const toScan = p => [0, 1, 2].map(a => Rt[a][0] * p[0] + Rt[a][1] * p[1] + Rt[a][2] * p[2] + tv[a]);
// Die Symmetrie legt X (Mitte) und den Ursprung fest; die Drehung IN der Ebene (Nicken)
// kommt aus der Scan-Hochachse bzw. dem Parameter "nickWinkel" → hier nick-unabhängig prüfen.
const toAl = pTrue => K.M4.apply(al.matrix, toScan(pTrue));
{
  const o = toAl([0, 0, 0]); ok(Math.hypot(...o) < 3, `Spitze im Ursprung (${Math.hypot(...o).toFixed(2)} mm daneben)`);
  for (const pTrue of [[0, 0, 1000], [300, 200, 1500], center(0.5, -1), center(1, -1)]) {
    const pAl = toAl(pTrue);
    ok(Math.abs(Math.abs(pAl[0]) - Math.abs(pTrue[0])) < 2, `X von ${pTrue.map(v => v.toFixed(0)).join('/')}: ${pAl[0].toFixed(2)} statt ${pTrue[0].toFixed(2)}`);
  }
  const nick = Math.atan2(toAl([0, 0, 1000])[1], toAl([0, 0, 1000])[2]) * 180 / Math.PI;
  console.log('  Nicken gegen Soll-Hochachse:', nick.toFixed(2), '° (kommt aus der Scan-Hochachse)');
}
mesh = K.makeMesh(K.transformTris(scan.positions, al.matrix));

// 1 Streben
const st = K.strebenFinden(mesh, prm);
console.log('1 Streben', zeit(), 'links', st.links.tri.length, 'Dr. bis Z', st.links.zMax.toFixed(0), '| rechts', st.rechts.tri.length, 'bis Z', st.rechts.zMax.toFixed(0));
ok(st.links.vorzeichen === -1, 'längere Strebe (bis Z 2100) als links erkannt');
{ const zL = toAl(trueCrest(1, -1))[2], zR = toAl(trueCrest(0.68, 1))[2];
  ok(Math.abs(st.links.zMax - zL) < 80 && Math.abs(st.rechts.zMax - zR) < 80, `Z-Bereiche plausibel (Soll ${zL.toFixed(0)} / ${zR.toFixed(0)})`); }
ok(st.links.laenge > 1800, 'Grobpfad links durchgehend (' + st.links.laenge.toFixed(0) + ' mm) – über Löcher hinweg');

// 2 Kamm
const tAt = (p, side) => {   // nächster Sollpunkt (mit/ohne Buckel)
  let best = null;
  for (let t = 0; t <= 1; t += 0.0001) { const q = toAl(trueCrest(t, side)); const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (!best || d < best.d) best = { t, d }; }
  return best;
};
const kamm = {};
for (const [name, side] of [['links', -1], ['rechts', 1]]) {
  const k = K.kammZweiPass(mesh, st[name], prm);
  kamm[name] = k;
  const g = k.filter(q => q.ok), grunde = {};
  k.filter(q => !q.ok).forEach(q => { grunde[q.grund] = (grunde[q.grund] || 0) + 1; });
  const ds = g.map(q => tAt(q.p, side).d).sort((a, b) => a - b);
  const p95 = ds[Math.floor(ds.length * 0.95)], mx = ds[ds.length - 1];
  console.log(`2 Kamm ${name}`, zeit(), g.length, 'gültig von', k.length, JSON.stringify(grunde), 'Abstand Soll: p95', p95.toFixed(2), 'max', mx.toFixed(2));
  ok(p95 < 1.0, `${name}: 95 % der Kammpunkte < 1 mm am Soll-Kamm`);
  ok(mx < 3.0, `${name}: kein gültiger Kammpunkt > 3 mm daneben`);
  ok((grunde.loch || 0) >= 3, `${name}: Löcher erkannt`);
}

// 3 Spline
const sp = {};
for (const name of ['links', 'rechts']) {
  const g = kamm[name].filter(q => q.ok);
  sp[name] = K.ausgleichSpline(g.map(q => q.p), prm);
  // gegen die Soll-Kurve OHNE Buckel: Ausgleichsspline soll die Buckel glätten
  const side = name === 'links' ? -1 : 1, poly = K.bsSample(sp[name], 600);
  let mx = 0; for (let t = 0.03; t <= (side < 0 ? 0.97 : 0.66); t += 0.01) { const q = toAl(trueCrest(t, side, false)); mx = Math.max(mx, K.naechsterPunkt(poly, q).d); }
  const ab = K.abweichung(sp[name], kamm[name]);
  console.log(`3 Spline ${name}: max Abstand zur glatten Soll-Kurve ${mx.toFixed(2)} mm; Kamm-Abweichung max +${ab.max.wert.toFixed(2)} / min ${ab.min.wert.toFixed(2)} mm`);
  ok(mx < 2.0, `${name}: Ausgleichsspline < 2 mm an der glatten Soll-Kurve`);
}
// Buckel bei t=0.20 (+3) und Delle bei t=0.40 (−2,5) müssen als Beule/Delle sichtbar sein
{
  const ab = K.abweichung(sp.links, kamm.links);
  const bei = tt => { const q = toAl(trueCrest(tt, -1)); let b = null; for (const w of ab.werte) { const d = Math.hypot(w.p[0] - q[0], w.p[1] - q[1], w.p[2] - q[2]); if (!b || d < b.d) b = { d, w }; } return b.w.wert; };
  const b20 = bei(0.20), b40 = bei(0.40);
  console.log('5 Abweichung links: Buckel t=0,20 →', b20.toFixed(2), 'mm; Delle t=0,40 →', b40.toFixed(2), 'mm');
  ok(b20 > 1.5, 'Buckel als Beule (+) erkannt');
  ok(b40 < -1.2, 'Delle als Delle (−) erkannt');
}
// Stützpunkte
{
  const v = K.stuetzpunkteVorschlagen(kamm.links, prm);
  const ip = K.interpolSpline(v.map(x => x.p));
  const poly = K.bsSample(ip, 600);
  let mx = 0; for (let t = 0.05; t <= 0.95; t += 0.01) mx = Math.max(mx, K.naechsterPunkt(poly, toAl(trueCrest(t, -1, false))).d);
  console.log('3b Stützpunkte', v.length, 'Störung', v.map(x => x.stoerung.toFixed(2)).join(' '), '→ max Abstand glatte Soll', mx.toFixed(2), 'mm');
  ok(v.length === prm.stuetzpunkte, '6 Stützpunkte vorgeschlagen');
  ok(mx < 8, 'Stützpunkt-Spline folgt dem Bogen (< 8 mm)');
  const p0 = K.bsEval(ip, 0); ok(Math.hypot(...p0.map((x, i) => x - v[0].p[i])) < 1e-6, 'Spline geht exakt durch den 1. Stützpunkt');
}
// 4 Symmetrie
{
  const sy = K.symmetrie(sp.links, sp.rechts, prm);
  console.log('4 Symmetrie: Vergleich', sy.stat.von.toFixed(0), '…', sy.stat.bis.toFixed(0), 'mm von', sy.stat.laengeL.toFixed(0), '; max', sy.stat.max.toFixed(2), 'mittel', sy.stat.mittel.toFixed(2));
  ok(sy.stat.max < 4, 'Testscan ist symmetrisch → Abweichung < 4 mm');
  ok(sy.stat.bis < sy.stat.laengeL - 300, 'Vergleich endet am kürzeren rechten Spline');
  const gm = K.gemittelt(sp.links, sp.rechts, prm);
  const L1 = K.bogenlaengen(K.bsSample(gm.links, 800)).pop();
  ok(Math.abs(L1 - sy.stat.laengeL) < 30, `gemittelter Spline behält volle Länge (${L1.toFixed(0)} mm)`);
}
// 6 Export
{
  const step = K.exportSTEP({ links: sp.links, rechts: sp.rechts });
  ok(/B_SPLINE_CURVE_WITH_KNOTS\('links',3/.test(step) && step.includes('END-ISO-10303-21'), 'STEP enthält B-Spline-Kurven');
  const csv = K.exportCSV({ links: sp.links }); ok(csv.split('\n').length > 10, 'CSV erzeugt');
  const pl = K.exportPolylinie({ links: sp.links }); ok(pl.split('\n').length > 500, 'Polylinie erzeugt');
  (await import('node:fs')).mkdirSync('tests/out', { recursive: true });
  (await import('node:fs')).writeFileSync('tests/out/leitkurven_test.step', step);
}
console.log(fehler ? `\n✗ ${fehler} Fehler` : '\n✓ alles grün', zeit());
process.exit(fehler ? 1 : 0);
