import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const createOrcaSlicer = (await import(join(here, '../OrcaSlicer/build-wasm/src/wasm/orca-slicer.js'))).default;
const orca = await createOrcaSlicer();
const f = process.env.MODEL || 'offset.3mf';
const res = orca.previewModel(new Uint8Array(readFileSync(join(here, f))), f, 128, 128);
for (const o of res.objects) {
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (let i = 0; i < o.verts.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], o.verts[i+k]); mx[k] = Math.max(mx[k], o.verts[i+k]);
    }
  console.log(o.name, 'bbox min', mn.map(v=>v.toFixed(1)), 'max', mx.map(v=>v.toFixed(1)));
}
