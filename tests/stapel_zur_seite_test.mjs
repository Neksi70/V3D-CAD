// Oswald 10.11.2026: Ring 2 mm hoch, mittig; linear 40× mit 2 mm Abstand übereinander;
// dann einen Balken mittig angelegt → „viele Ringe auf der Fläche verteilt, nicht von
// mir, sondern vom Programm“. _pushAsideForNew schob jedes überlappende Teil EINZELN
// auf einen freien Platz. Jetzt rückt ein Stapel als Ganzes. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 60000 });
const r = await pg.evaluate(async () => {
  hideStarter(); setShapeMode('solid');
  addShape('tube'); const ring = objects[0]; selectObjs([ring]); fpApplyDim('h', 2); fpApplyDim('w', 30); fpApplyDim('d', 30);
  // Lineares Muster über das Fenster: 40 Kopien, 2 mm nach oben
  linearPatternTool();
  const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
  set('pat-lin-count', 40); set('pat-lin-dx', 0); set('pat-lin-dy', 0); set('pat-lin-dz', 2);   // Z = Höhe
  await _applyPat(); await new Promise(r => setTimeout(r, 300));
  const ringe = objects.slice();
  const lage = () => ringe.filter(o => objects.includes(o)).map(o => { o.updateMatrixWorld(true); const q = new THREE.Box3().setFromObject(o); return [+((q.min.x + q.max.x) * 5).toFixed(2), +((q.min.z + q.max.z) * 5).toFixed(2), +(q.min.y * 10).toFixed(2)]; });
  const vor = lage();
  // Balken mittig anlegen
  addShape('box'); const balken = objects[objects.length - 1]; balken.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(balken);
  const nach = lage();
  const xz = new Set(nach.map(p => p[0] + '/' + p[1]));
  const sb = new THREE.Box3(); ringe.forEach(o => sb.expandByObject(o));
  const ueberlapp = sb.min.x < bb.max.x && sb.max.x > bb.min.x && sb.min.z < bb.max.z && sb.max.z > bb.min.z;
  // Höhen bleiben gleich, Stapel-Reihenfolge erhalten
  const hoehenGleich = vor.every((p, i) => Math.abs(p[2] - nach[i][2]) < 1e-6);
  // Feld Y = Tiefe: +10 mm → Kopie liegt 10 mm weiter hinten (Szene −z), gleiche Höhe
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  addShape('box'); const q0 = objects[0]; selectObjs([q0]); linearPatternTool();
  set('pat-lin-count', 2); set('pat-lin-dx', 0); set('pat-lin-dy', 10); set('pat-lin-dz', 0);
  await _applyPat(); await new Promise(r => setTimeout(r, 200));
  const q1 = objects[objects.length - 1];
  const tiefe = { dz: +((q1.position.z - q0.position.z) * 10).toFixed(2), dy: +((q1.position.y - q0.position.y) * 10).toFixed(2) };
  return { tiefe, anzahl: ringe.length, hoeheStapel: +((sb.max.y - sb.min.y) * 10).toFixed(1), xzVorher: new Set(vor.map(p => p[0] + '/' + p[1])).size, xzNachher: xz.size, ueberlapp, hoehenGleich };
});
console.log(JSON.stringify(r));
const checks = [
  ['40 Ringe übereinander (Muster)', r.anzahl >= 40 && r.hoeheStapel > 70 && r.xzVorher === 1],
  ['nach dem Balken: Stapel beisammen (eine Lage)', r.xzNachher === 1],
  ['Stapel liegt neben dem Balken', !r.ueberlapp],
  ['Höhen unverändert', r.hoehenGleich],
  ['Feld Y = Tiefe: 10 mm nach hinten', r.tiefe.dz === -10 && r.tiefe.dy === 0],
  ['keine Seitenfehler', errs.length === 0],
];
let ok = true; for (const [n, v] of checks) { console.log((v ? '✔ ' : '✘ ') + n); ok = ok && v; }
if (errs.length) console.log(errs);
await b.close(); process.exit(ok ? 0 : 1);
