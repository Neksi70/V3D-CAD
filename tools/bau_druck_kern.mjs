// Baut druckcheck-kern.js für V3D CAD aus dem Rechenkern des V3D Druckchecks
// (orca-wasm/web/print-check.js, ES-Modul; dieselbe Datei nutzen der V3D Slicer
// und ~/v3ddruckcheck) → klassisches Skript mit window.V3D_DRUCKCHECK.
// EINE Quelle: Änderungen nur in print-check.js machen, build.js baut neu.
import fs from 'fs';
import path from 'path';
const HOME = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const quelle = path.join(HOME, 'orca-wasm/web/print-check.js'), ziel = path.join(HOME, 'druckcheck-kern.js');
const NAMEN = ['LEVEL', 'LEVEL_ICONS', 'CAT_ICONS', 'analyzeMesh', 'checkSettings', 'summarize', 'verdict',
  'applyFixes', 'fixRows', 'keyLabel', 'valueText', 'printFacts', 'cfgStr', 'cfgNum'];
export function bau() {
  const code = fs.readFileSync(quelle, 'utf8');
  if (/^\s*import\s/m.test(code)) throw new Error('print-check.js hat Importe – Einbetten nicht möglich');
  for (const n of NAMEN) if (!new RegExp(`^export\\s+(async\\s+)?(function|const|let)\\s+${n}\\b`, 'm').test(code))
    throw new Error('print-check.js exportiert ' + n + ' nicht mehr');
  return `// GENERIERT aus orca-wasm/web/print-check.js durch tools/bau_druck_kern.mjs – NICHT von Hand ändern\n`
    + `window.V3D_DRUCKCHECK = (function () {\n${code.replace(/^export\s+/gm, '')}\nreturn { ${NAMEN.join(', ')} };\n})();\n`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  fs.writeFileSync(ziel, bau());
  console.log('druckcheck-kern.js geschrieben');
}
