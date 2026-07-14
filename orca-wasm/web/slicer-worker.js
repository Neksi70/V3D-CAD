// Slicer-Worker: hält den Orca-WASM-Kern und sliced abseits des UI-Threads.
// Fortschritt kommt aus den stderr-Zeilen des Wrappers ("[orca NN%] Text")
// — printErr-Hook fängt sie ab und reicht sie als progress-Messages weiter.
import createOrcaSlicer from '/orca-slicer.js';

const orca = await createOrcaSlicer({
  printErr: (line) => {
    const m = /\[orca\s+(\d+)%\]\s*(.*)/.exec(line);
    if (m) postMessage({ type: 'progress', percent: +m[1], text: m[2] });
    const w = /\[wasm\]\s*(.*)/.exec(line);
    if (w) postMessage({ type: 'progress', percent: -1, text: w[1] });
    console.error(line);
  },
});

postMessage({ type: 'ready', version: orca.version() });

onmessage = (e) => {
  const { cmd, bytes, filename, profiles, overrides, bedCenter, transforms, filamentChains, ops, paints } = e.data;
  try {
    if (cmd === 'preview') {
      // ops (Schnitte) fließen in die Vorschau ein, damit sie = Realität ist
      const res = ops
        ? orca.previewModelOps(bytes, filename, bedCenter[0], bedCenter[1], JSON.stringify(ops))
        : orca.previewModel(bytes, filename, bedCenter[0], bedCenter[1]);
      // Views zeigen in den WASM-Heap → sofort kopieren, dann transferieren
      const objects = res.objects.map(o => ({
        name: o.name,
        verts: new Float32Array(o.verts),
        tris: new Uint32Array(o.tris),
      }));
      postMessage({ type: 'preview', objects },
                  objects.flatMap(o => [o.verts.buffer, o.tris.buffer]));
    } else {
      // paints (Mal-Werkzeug) → sliceModelPainted; ops = { cuts, adaptive }
      // → sliceModelOps; sonst der schlankere Pfad
      const gcode = paints
        ? orca.sliceModelPainted(bytes, filename, profiles, overrides, transforms, filamentChains,
                                 JSON.stringify(ops || {}), paints)
        : ops
        ? orca.sliceModelOps(bytes, filename, profiles, overrides, transforms, filamentChains, JSON.stringify(ops))
        : (filamentChains
          ? orca.sliceModelMulti(bytes, filename, profiles, overrides, transforms, filamentChains)
          : orca.sliceModelTransformed(bytes, filename, profiles, overrides, transforms));
      if (!gcode) postMessage({ type: 'error', message: orca.lastError() });
      else        postMessage({ type: 'done', gcode });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
