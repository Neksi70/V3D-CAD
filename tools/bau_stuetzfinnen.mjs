// Bündelt den Stützfinnen-Worker (tools/stuetzfinnen-worker.src.js + vendor/support-fins)
// zu EINER Datei lib/stuetzfinnen-worker.js, die volme3d_server.py ausliefert.
// Aufruf: node tools/bau_stuetzfinnen.mjs
import { build } from 'esbuild-wasm';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'tools/stuetzfinnen-worker.src.js')],
  outfile: path.join(root, 'lib/stuetzfinnen-worker.js'),
  bundle: true, format: 'iife', minify: true, target: 'es2020',
  legalComments: 'none',
  banner: { js: '/* V3D CAD Stützfinnen-Worker. Rechenkern: Support Fins (printfins.com), ' +
                 'MIT License, Copyright (c) 2026 gittrahan — https://github.com/gittrahan/support-fins */' },
});
console.log('lib/stuetzfinnen-worker.js gebaut');
