// Baut schicht-kern.js für V3D CAD aus dem Rechenkern des V3D Slicers
// (orca-wasm/web/adaptive-layers.js, ES-Modul) → klassisches Skript mit
// window.V3D_SCHICHT. EINE Quelle: Änderungen nur im Slicer-Kern machen und
// danach `node tools/bau_schicht_kern.mjs` laufen lassen (build.js prüft das).
import fs from 'fs';
import path from 'path';
const HOME = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const quelle = path.join(HOME, 'orca-wasm/web/adaptive-layers.js'), ziel = path.join(HOME, 'schicht-kern.js');
export function bau() {
  const code = fs.readFileSync(quelle, 'utf8');
  if (/^\s*import\s/m.test(code)) throw new Error('adaptive-layers.js hat Importe – Einbetten nicht möglich');
  return `// GENERIERT aus orca-wasm/web/adaptive-layers.js durch tools/bau_schicht_kern.mjs – NICHT von Hand ändern\n`
    + `window.V3D_SCHICHT = (function () {\n${code.replace(/^export\s+/gm, '')}\nreturn { computeLayerPlan, layerTargets, REASON_NAMES };\n})();\n`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  fs.writeFileSync(ziel, bau());
  console.log('schicht-kern.js geschrieben');
}
