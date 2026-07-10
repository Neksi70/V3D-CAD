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
  const { bytes, filename, profiles, overrides } = e.data;
  try {
    const gcode = orca.sliceModel(bytes, filename, profiles, overrides);
    if (!gcode) postMessage({ type: 'error', message: orca.lastError() });
    else        postMessage({ type: 'done', gcode });
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
