// Worker-Prozess für /api/occt-hollow-lid. Läuft als eigener Node-Prozess,
// damit der Hauptserver ihn per SIGKILL beenden kann, falls die Berechnung
// hängt — er blockiert den Hauptserver nie.
//
// Methode: VOXEL-Aushöhlung (voxel_hollow.js) — funktioniert auf beliebigen
// Meshes (konkav, mehrteilig, KI). Kein OpenCASCADE nötig → Start in ms.
//
// Aufruf:  node occt-hollow-worker.js <inFile.json> <outFile.json>
//   inFile  = { stlBase64, wall, cutAt, lipDepth, clear, boreDia, res, ... }
//   outFile = { bodyStlBase64, lidStlBase64, meta } | { error }
const fs = require('fs');
const { hollowLidFromStl } = require('./voxel_hollow.js');

const [, , inFile, outFile] = process.argv;
const write = obj => { try { fs.writeFileSync(outFile, JSON.stringify(obj)); } catch (_) {} };
try {
  const opts = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  if (!opts.stlBase64) { write({ error: 'stlBase64 fehlt' }); process.exit(0); }
  const stlBuf = Buffer.from(opts.stlBase64, 'base64');
  const t0 = Date.now();
  const result = hollowLidFromStl(stlBuf, opts);
  if (result.meta) console.log('[hollow-lid/voxel] OK', JSON.stringify(result.meta), 'in', Date.now()-t0, 'ms');
  else console.log('[hollow-lid/voxel] Fehler:', result.error);
  write(result);
  process.exit(0);
} catch (e) {
  write({ error: 'Worker: ' + (e.message || String(e)) });
  process.exit(1);
}
