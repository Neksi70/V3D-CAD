// M3-Smoke-Test: 20mm-Würfel durch orca-slicer.wasm slicen (Node)
// Aufruf: node slice-test.mjs [pfad/zur/orca-slicer.js]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const modPath = process.argv[2] ??
  join(here, '../OrcaSlicer/build-wasm/src/wasm/orca-slicer.js');

const createOrcaSlicer = (await import(modPath)).default;
console.log('Lade WASM-Modul …');
const orca = await createOrcaSlicer();
console.log('Orca-Kern geladen, Version:', orca.version());
orca.setLogLevel(5);

const stl = readFileSync(join(here, 'cube20.stl'));

const overrides = `
layer_height = 0.2
initial_layer_print_height = 0.2
nozzle_diameter = 0.4
filament_diameter = 1.75
printable_area = 0x0,240x0,240x240,0x240
printable_height = 250
sparse_infill_density = 15%
enable_support = 0
use_relative_e_distances = 0
`;

console.log('Slice startet …');
const t0 = Date.now();
const gcode = orca.sliceSTL(new Uint8Array(stl), overrides);
const dt = ((Date.now() - t0) / 1000).toFixed(1);

if (!gcode || gcode.length === 0) {
  console.error(`FEHLER nach ${dt}s:`, orca.lastError());
  process.exit(1);
}

const layers = (gcode.match(/^;( CHANGE_LAYER|LAYER_CHANGE)/gm) || []).length;
writeFileSync(join(here, 'cube20.gcode'), gcode);
console.log(`OK: ${gcode.length} Zeichen G-Code, ${layers} Layer in ${dt}s → cube20.gcode`);
