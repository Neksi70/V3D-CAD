// Worker-Prozess für /api/occt-hollow-lid. Läuft als eigener Node-Prozess,
// damit der Hauptserver ihn bei einem hängenden Boolean per SIGKILL beenden kann
// (synchroner WASM-Code ist im selben Prozess nicht unterbrechbar).
//
// Aufruf:  node occt-hollow-worker.js <inFile.json> <outFile.json>
//   inFile  = { stlBase64, wall, cutAt, lipDepth, clear, boreDia, ringLip, ... }
//   outFile = { bodyStlBase64, lidStlBase64 } | { error }
//
// require('./occt-server.js') startet KEINEN Listener (require.main !== module).
const fs = require('fs');
const { getOC, computeHollowLid } = require('./occt-server.js');

(async () => {
  const [, , inFile, outFile] = process.argv;
  const write = obj => { try { fs.writeFileSync(outFile, JSON.stringify(obj)); } catch (_) {} };
  try {
    const opts = JSON.parse(fs.readFileSync(inFile, 'utf8'));
    const oc = await getOC();
    const result = await computeHollowLid(oc, opts);
    write(result);
    process.exit(0);
  } catch (e) {
    write({ error: 'Worker: ' + (e.message || String(e)) });
    process.exit(1);
  }
})();
