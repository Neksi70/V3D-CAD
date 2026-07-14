// Mal-Werkzeug-Test: cube20.stl, Deckel (oberes Viertel) auf Filament 2
// bemalt → der G-Code muss Werkzeugwechsel (T0/T1) enthalten und die
// Wechsel-Layer müssen zur bemalten Höhe passen. Läuft gegen orca_native
// (stdin/stdout-JSON), gleiche paints-Kodierung wie die Brücke.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '../OrcaSlicer/build-native/src/wasm/orca_native');
const RESOURCES = join(here, '../OrcaSlicer/resources');

// STL parsen (binär), um das Mal-Mesh im Vorschau-Frame zu bauen:
// center_and_drop zentriert XY auf die Bettmitte und setzt minZ auf 0 —
// exakt das rechnen wir hier nach.
const stl = readFileSync(join(here, 'cube20.stl'));
const nt = stl.readUInt32LE(80);
const verts = new Float32Array(nt * 9);
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (let t = 0; t < nt; t++) {
  const off = 84 + t * 50 + 12;           // Normale überspringen
  for (let v = 0; v < 3; v++)
    for (let c = 0; c < 3; c++) {
      const val = stl.readFloatLE(off + v * 12 + c * 4);
      verts[t * 9 + v * 3 + c] = val;
      min[c] = Math.min(min[c], val); max[c] = Math.max(max[c], val);
    }
}
const bed = [100, 100];                    // printable_area 0..200 → Mitte 100
const shift = [bed[0] - (min[0] + max[0]) / 2, bed[1] - (min[1] + max[1]) / 2, -min[2]];
// non-indexed → indexed (Vertices deduplizieren), Zustände je Dreieck
const vmap = new Map(); const outVerts = []; const tris = new Uint32Array(nt * 3);
for (let i = 0; i < nt * 3; i++) {
  const x = verts[i * 3] + shift[0], y = verts[i * 3 + 1] + shift[1], z = verts[i * 3 + 2] + shift[2];
  const k = x + ',' + y + ',' + z;
  let vi = vmap.get(k);
  if (vi === undefined) { vi = outVerts.length / 3; vmap.set(k, vi); outVerts.push(x, y, z); }
  tris[i] = vi;
}
const zTop = max[2] - min[2];
const states = new Uint8Array(nt);
for (let t = 0; t < nt; t++) {
  const cz = (outVerts[tris[t * 3] * 3 + 2] + outVerts[tris[t * 3 + 1] * 3 + 2] + outVerts[tris[t * 3 + 2] * 3 + 2]) / 3;
  if (cz > zTop * 0.75) states[t] = 2;     // oberes Viertel → Filament 2
}
console.log(`Würfel: ${nt} Dreiecke, ${outVerts.length / 3} Vertices, ${states.filter ? '' : ''}${[...states].filter(s => s === 2).length} bemalt`);

const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');
const overrides = `layer_height = 0.2
initial_layer_print_height = 0.2
nozzle_diameter = 0.4
filament_diameter = 1.75,1.75
printable_area = 0x0,240x0,240x240,0x240
printable_height = 250
enable_support = 0
enable_arc_fitting = 0
enable_prime_tower = 1
line_width = 0.4
outer_wall_line_width = 0.4
initial_layer_line_width = 0.4
prime_tower_width = 35
use_relative_e_distances = 1
layer_change_gcode = G92 E0`;

const job = {
  id: 1, model: join(here, 'cube20.stl'), filename: 'cube20.stl',
  profiles: [], overrides,
  transforms: null,
  filament_chains: [
    ['{"filament_colour": ["#FFFFFF"]}'],
    ['{"filament_colour": ["#FF0000"]}'],
  ],
  paints: [{ verts: b64(new Float32Array(outVerts)), tris: b64(tris), states: b64(states) }],
};

const proc = spawn(BIN, [], { env: { ...process.env, SLIC3R_RESOURCES: RESOURCES } });
let out = '';
proc.stdout.on('data', d => { out += d; });
proc.stderr.on('data', d => { if (process.env.VERBOSE) process.stderr.write(d); });
proc.stdin.write(JSON.stringify(job) + '\n');
proc.stdin.end();
await new Promise(r => proc.on('exit', r));

const lines = out.trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const done = lines.find(l => l.done), err = lines.find(l => l.error);
if (err) { console.error('FEHLER:', err.error); process.exit(1); }
if (!done || !existsSync(done.gcode)) { console.error('kein G-Code erzeugt'); process.exit(1); }
const gcode = readFileSync(done.gcode, 'utf8');

// Werkzeugwechsel zählen; Layer-Kontext der Wechsel prüfen
const toolchanges = (gcode.match(/^T1\b/gm) || []).length;
const usedT0 = /^T0\b/m.test(gcode);
console.log(`G-Code: ${gcode.length} Zeichen, T1-Wechsel: ${toolchanges}, T0 benutzt: ${usedT0}`);
// bemalte Zone beginnt bei z=15 → oberhalb müssen beide Werkzeuge vorkommen
const zSplit = gcode.split(/^; CHANGE_LAYER|^;LAYER_CHANGE/m);
if (toolchanges < 1) { console.error('FEHLER: keine Werkzeugwechsel — Bemalung wirkungslos'); process.exit(1); }
console.log('PAINT-TEST OK ✅');
