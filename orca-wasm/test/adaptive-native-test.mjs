// Server-Kern (orca_native): explizites Schichtprofil aus dem Rechenkern
// übergeben → G-Code muss GENAU diese Schichten haben (Kanten exakt).
// Zweiter Durchlauf: dasselbe Profil als 3MF (Metadata/layer_heights_profile.txt,
// wie Bambu Studio/Orca es lesen) OHNE ops → der 3MF-Importer muss es übernehmen.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeLayerPlan, build3mf } from '../web/adaptive-layers.js';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '../OrcaSlicer/build-native/src/wasm/orca_native');
const RESOURCES = join(here, '../OrcaSlicer/resources');
const STL = process.argv[2] || join(here, 'adaptive-relief.stl');
const OUT = process.env.OUT_DIR || '/tmp';

const stl = readFileSync(STL), nt = stl.readUInt32LE(80), pos = new Float32Array(nt * 9);
for (let t = 0; t < nt; t++) for (let k = 0; k < 9; k++) pos[t * 9 + k] = stl.readFloatLE(84 + t * 50 + 12 + k * 4);
const LH = { hBase: 0.2, hFirst: 0.2, hMin: 0.08, hMax: 0.28, nozzle: 0.4, quality: 0.5 };
const plan = computeLayerPlan(pos, null, LH);
console.log(`Plan: ${plan.nLayers} Schichten (fest: ${plan.nUniform}), Kanten ${plan.snaps.join(', ')}`);

const overrides = `layer_height = 0.2
initial_layer_print_height = 0.2
min_layer_height = 0.08
max_layer_height = 0.28
nozzle_diameter = 0.4
printable_area = 0x0,240x0,240x240,0x240
printable_height = 250
enable_support = 0
enable_arc_fitting = 0
use_relative_e_distances = 1
layer_change_gcode = G92 E0`;

async function slice(model, filename, adaptive) {
  const job = { id: 1, model, filename, profiles: [], overrides, transforms: null,
                filament_chains: [], paints: null, cuts: [], adaptive };
  const proc = spawn(BIN, [], { env: { ...process.env, SLIC3R_RESOURCES: RESOURCES } });
  let out = '', err = '';
  proc.stdout.on('data', d => { out += d; });
  proc.stderr.on('data', d => { err += d; if (process.env.VERBOSE) process.stderr.write(d); });
  proc.stdin.write(JSON.stringify(job) + '\n'); proc.stdin.end();
  await new Promise(r => proc.on('exit', r));
  const lines = out.trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const done = lines.find(l => l.done), e = lines.find(l => l.error);
  if (e || !done || !existsSync(done.gcode)) throw new Error((e && e.error) || 'kein G-Code');
  const g = readFileSync(done.gcode, 'utf8');
  const zs = [...g.matchAll(/^;Z:([\d.]+)/gm)].map(m => +m[1]);
  return { zs, log: err.split('\n').filter(l => l.includes('[adaptive]')) };
}

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const expTops = plan.layers.map(L => L.z0 + L.h);
const cmp = (zs) => zs.length === expTops.length && zs.every((z, i) => Math.abs(z - expTops[i]) < 0.0015);

const flat = await slice(STL, 'adaptive-relief.stl', null);
console.log(`ohne Profil: ${flat.zs.length} Schichten`);
ok(flat.zs.length === plan.nUniform, 'ohne Profil = feste 0,2');

const a = await slice(STL, 'adaptive-relief.stl', { mode: 'auto', profiles: [plan.profile] });
console.log(`mit Profil: ${a.zs.length} Schichten · ${a.log.join(' | ')}`);
ok(cmp(a.zs), 'G-Code-Schichten = Plan (±1,5 µm, G-Code rundet auf 3 Stellen)');
ok([3, 3.6].every(k => a.zs.some(z => Math.abs(z - k) < 1e-6)), 'Schichtgrenzen exakt bei 3,0 und 3,6 mm');

// 3MF-Weg (Studio/Orca-Importer): Geometrie + Profil, keine ops
const blob = await build3mf([{ name: 'Relief', pos, profile: plan.profile }], { title: 'test' });
const f3 = join(OUT, 'adaptive-relief_adaptiv.3mf');
writeFileSync(f3, Buffer.from(await blob.arrayBuffer()));
const b = await slice(f3, 'adaptive-relief_adaptiv.3mf', null);
console.log(`3MF-Import: ${b.zs.length} Schichten`);
ok(cmp(b.zs), '3MF-Importer übernimmt das Profil (gleiche Schichten)');

console.log(fails ? `❌ ${fails} fehlgeschlagen` : 'ADAPTIVE-NATIVE-TEST OK ✅');
process.exit(fails ? 1 : 0);
