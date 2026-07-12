// M4b-Test: SVG-Import (nanosvg + OCCT-Extrusion) — square.svg slicen (Node)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const createOrcaSlicer = (await import(join(here, '../OrcaSlicer/build-wasm-main/src/wasm/orca-slicer.js'))).default;
const orca = await createOrcaSlicer();

const svg = readFileSync(join(here, 'square.svg'));
const overrides = `layer_height = 0.2
initial_layer_print_height = 0.2
nozzle_diameter = 0.4
filament_diameter = 1.75
printable_area = 0x0,240x0,240x240,0x240
printable_height = 250
enable_support = 0
enable_arc_fitting = 0
use_relative_e_distances = 0`;

const t0 = Date.now();
const gcode = orca.sliceModel(new Uint8Array(svg), 'square.svg', [], overrides);
if (!gcode) { console.error('SVG-FEHLER:', orca.lastError()); process.exit(1); }
const layers = (gcode.match(/^;( CHANGE_LAYER|LAYER_CHANGE)/gm) || []).length;
console.log(`SVG-Slice OK: ${layers} Layer, ${gcode.length} Zeichen in ${((Date.now()-t0)/1000).toFixed(1)}s`);
