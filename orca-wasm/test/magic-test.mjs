// ✨ Magic-Analyse: falsch hingelegte Körper müssen in die gute Lage gedreht werden,
// die Qualitätsstufe muss nahe am Optimum liegen, gute Lagen bleiben unangetastet.
import { readFileSync } from 'node:fs';
import { magicAnalyze, rotateToBed, ROT_X90, matMul, MAT_I } from '../web/adaptive-layers.js';

const stl = readFileSync(new URL('./adaptive-relief.stl', import.meta.url)), nt = stl.readUInt32LE(80);
const pos0 = new Float32Array(nt * 9);
for (let t = 0; t < nt; t++) for (let k = 0; k < 9; k++) pos0[t * 9 + k] = stl.readFloatLE(84 + t * 50 + 12 + k * 4);
const opts = { hBase: 0.2, hFirst: 0.2, hMin: 0.08, hMax: 0.28, nozzle: 0.4 };
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const fmt = (r) => `gedreht=${r.rotated} q=${r.quality} Stufe Ø${r.err.toFixed(4)} (best ${r.errBest.toFixed(4)}, fest ${r.errFixed.toFixed(4)}) ` +
  `Überhang ${Math.round(r.orientation.chosen.over)} mm² Bett ${Math.round(r.orientation.chosen.bed)} mm² · ${r.plan.nLayers} Schichten · ${r.orientation.tested} Lagen geprüft`;

for (const [name, R0, expectRot] of [
  ['richtig liegend', MAT_I, false],
  ['auf dem Kopf (Kuppel hängt nach unten)', matMul(ROT_X90, ROT_X90), true],
  ['auf der Seite', ROT_X90, true],
]) {
  const pos = rotateToBed(pos0, R0);
  const t0 = performance.now();
  const r = magicAnalyze(pos, null, { ...opts, current: MAT_I, orient: true });
  console.log(`\n${name}: ${fmt(r)} · ${Math.round(performance.now() - t0)} ms`);
  for (const t of r.tips) console.log('    ' + t.icon + ' ' + t.text);
  ok(r.rotated === expectRot, expectRot ? 'wird gedreht' : 'bleibt wie sie ist');
  const fin = rotateToBed(pos, r.R);
  let zmax = 0; for (let i = 2; i < fin.length; i += 3) zmax = Math.max(zmax, fin[i]);
  ok(Math.abs(zmax - 11) < 0.01, `Endlage = Platte unten, Kuppel oben (Höhe ${zmax.toFixed(2)} mm)`);
  ok(r.orientation.chosen.over < 30, 'Endlage ohne nennenswerten Überhang');
  ok(r.err <= r.errBest * 1.1 + 1e-4 && r.err < r.errFixed, 'Stufenfehler nahe Optimum und besser als fest 0,2');
}
// Standard (orient aus): Lage bleibt, bessere Lage nur als Vorschlag; Varianten sortiert
{
  const pos = rotateToBed(pos0, matMul(ROT_X90, ROT_X90));
  const r = magicAnalyze(pos, null, { ...opts, current: MAT_I });
  const v = r.variants;
  console.log('\nohne Drehen:', JSON.stringify(v, (k, x) => typeof x === 'number' ? +x.toFixed(3) : x));
  ok(!r.rotated && r.betterOrientation, 'Lage bleibt, bessere Lage kommt als Vorschlag');
  ok(v.best.err <= v.balanced.err && v.balanced.err <= v.fast.err && v.best.nLayers >= v.fast.nLayers, 'Varianten: beste ≥ ausgewogen ≥ schnell');
}
console.log(fails ? `\n❌ ${fails} fehlgeschlagen` : '\n✅ MAGIC-TEST OK');
process.exit(fails ? 1 : 0);
