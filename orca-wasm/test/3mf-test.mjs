// M5-Fix-Test: 3MF-Import (LoadStrategy::LoadModel) — cube20.3mf slicen
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const createOrcaSlicer = (await import(join(here, '../OrcaSlicer/build-wasm/src/wasm/orca-slicer.js'))).default;
const orca = await createOrcaSlicer();
const overrides = `layer_height = 0.2
initial_layer_print_height = 0.2
nozzle_diameter = 0.4
filament_diameter = 1.75
printable_area = 0x0,240x0,240x240,0x240
printable_height = 250
enable_support = 0
enable_arc_fitting = 0
use_relative_e_distances = 0`;
const gcode = orca.sliceModel(new Uint8Array(readFileSync(join(here, 'cube20.3mf'))), 'cube20.3mf', [], overrides);
if (!gcode) { console.error('3MF-FEHLER:', orca.lastError()); process.exit(1); }
console.log(`3MF-Slice OK: ${(gcode.match(/^;( CHANGE_LAYER|LAYER_CHANGE)/gm) || []).length} Layer, ${gcode.length} Zeichen`);
