// OrcaSlicer 2.5 Farbmischung (filament color mixing) im nativen Kern:
// 3 Filament-Slots — 1 Weiß, 2 Rot, 3 = Mischung aus 1+2 (50/50) — Würfel auf Slot 3.
// Erwartung: Kern zerlegt Slot 3 in Unterschichten abwechselnd T0/T1, kein T2 im G-Code.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = process.env.ORCA_NATIVE_BIN || join(here, '../OrcaSlicer-migrate/build-native/src/wasm/orca_native');
const RESOURCES = process.env.ORCA_RESOURCES || join(here, '../OrcaSlicer-migrate/resources');
const RATIO = process.env.RATIO || '0.5,0.5';

const overrides = `layer_height = 0.2
initial_layer_print_height = 0.2
nozzle_diameter = 0.4
printable_area = 0x0,240x0,240x240,0x240
printable_height = 250
enable_prime_tower = 1
enable_mixed_color_sublayer = 1
use_relative_e_distances = 1
layer_change_gcode = G92 E0`;

const job = {
  id: 1, model: join(here, 'cube20.stl'), filename: 'cube20.stl',
  profiles: [], overrides,
  transforms: [{ dx: 0, dy: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, scale: 1, filament: 3 }],
  filament_chains: [
    ['{"filament_colour": ["#FFFFFF"]}'],
    ['{"filament_colour": ["#FF0000"]}'],
    [JSON.stringify({ filament_colour: ['#FF8080'], filament_is_mixed: ['1'],
                      filament_mixed_components: ['1,2'], filament_mixed_sublayer_ratios: [RATIO] })],
  ],
};

const proc = spawn(BIN, [], { env: { ...process.env, SLIC3R_RESOURCES: RESOURCES } });
let out = '', err = '';
proc.stdout.on('data', d => { out += d; });
proc.stderr.on('data', d => { err += d; if (process.env.VERBOSE) process.stderr.write(d); });
proc.stdin.write(JSON.stringify(job) + '\n');
proc.stdin.end();
await new Promise(r => proc.on('exit', r));
const lines = out.trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const res = lines.find(l => l.done), fail = lines.find(l => l.error);
if (fail || !res) { console.log('FEHLER:', fail ? fail.error : 'kein Ergebnis', err.split('\n').slice(-5).join('\n')); process.exit(1); }
const g = readFileSync(res.gcode, 'utf8');
const tc = {}; for (const m of g.matchAll(/^T(\d+)\s*$/gm)) tc[m[1]] = (tc[m[1]] || 0) + 1;
const layers = (g.match(/^;LAYER_CHANGE/gm) || []).length;
console.log('Schichten:', layers, '| Werkzeugwechsel:', JSON.stringify(tc));
// Mischverhältnis prüfen: extrudierte Länge je Werkzeug (relative E), Turm/Wechsel-Spülen ausgenommen
const ext = {}; let tool = null, inTower = false;
for (const l of g.split('\n')) {
  const t = /^T(\d+)\s*$/.exec(l); if (t) { tool = t[1]; continue; }
  if (/^; FEATURE: (Prime tower|Wipe tower)|^;TYPE:(Prime tower|Wipe tower)/i.test(l)) inTower = true;
  else if (/^; FEATURE:|^;TYPE:/.test(l)) inTower = false;
  const e = /^G1 .*E([\d.]+)/.exec(l);
  if (e && tool !== null && !inTower) ext[tool] = (ext[tool] || 0) + +e[1];
}
const sum = Object.values(ext).reduce((a, b) => a + b, 0);
console.log('Anteil Objekt-Extrusion je Werkzeug:', Object.entries(ext).map(([k, v]) => `T${k} ${(100 * v / sum).toFixed(1)} %`).join(', '));
const ok = tc['0'] > 1 && tc['1'] > 1 && !tc['2'];
console.log(ok ? 'MIXED-COLOR-TEST OK ✅' : 'MIXED-COLOR-TEST FEHLGESCHLAGEN ❌');
process.exit(ok ? 0 : 1);
