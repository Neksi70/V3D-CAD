// M4b-Test: STEP-Import über OCCT-WASM — cube20.step slicen (Node)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const createOrcaSlicer = (await import(join(here, '../OrcaSlicer/build-wasm/src/wasm/orca-slicer.js'))).default;
const orca = await createOrcaSlicer();
console.log('Version:', orca.version());

const step = readFileSync(join(here, 'cube20.step'));
const overrides = `layer_height = 0.2
initial_layer_print_height = 0.2
nozzle_diameter = 0.4
filament_diameter = 1.75
printable_area = 0x0,240x0,240x240,0x240
printable_height = 250
enable_support = 0
enable_arc_fitting = 0`;

const t0 = Date.now();
const gcode = orca.sliceModel(new Uint8Array(step), 'cube20.step', [], overrides);
if (!gcode) { console.error('FEHLER:', orca.lastError()); process.exit(1); }
const layers = (gcode.match(/^; CHANGE_LAYER/gm) || []).length;
console.log(`STEP-Slice OK: ${layers} Layer, ${gcode.length} Zeichen in ${((Date.now()-t0)/1000).toFixed(1)}s`);
