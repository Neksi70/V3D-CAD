// Ralf 9.11.2026: Gussform aus zwei Hälften, zum Bohren der Stiftlöcher übereinander-
// gelegt; nach dem Abziehen war alles EIN Teil und „Trennen“ ging nicht. Volker: beim
// Abziehen mit mehreren Volumenkörpern bleibt jeder ein eigenes Teil.
// Prüft: 2 Hälften + 2 Stifte durch beide → 2 Teile, jedes mit 2 Löchern (Volumen),
// Cutter weg; Cutter trifft nur eine Hälfte → andere unverändert; Rückgängig = Ausgang;
// ein Körper wie bisher. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { hideStarter(); await _mfInit(); });
const r = await pg.evaluate(async () => {
  const warte = async () => { for (let i = 0; i < 200 && objects.some(o => o.userData.isHole); i++) await new Promise(r => setTimeout(r, 150)); await new Promise(r => setTimeout(r, 900)); };
  const vol = o => { o.updateMatrixWorld(true); const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; const p = g.attributes.position.array.slice(); const v = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(o.matrixWorld); p[i] = v.x * 10; p[i + 1] = v.y * 10; p[i + 2] = v.z * 10; }
    return Math.round(_mfFromSoup(_mfWasm, p).volume()); };
  // Neue Körper schieben überlappende zur Seite → Lage erst setzen, wenn alle da sind (setze())
  const lage = new Map();
  const box = (x, y, z, w, h, d, loch) => { setShapeMode(loch ? 'hole' : 'solid'); addShape(loch ? 'cylinder' : 'box'); const o = objects[objects.length - 1]; selectObjs([o]);
    fpApplyDim('w', w); fpApplyDim('d', d); fpApplyDim('h', h); lage.set(o, [x / 10, y / 10 + h / 20, z / 10]); return o; };
  const setze = () => { for (const [o, p] of lage) { o.position.set(...p); o.updateMatrixWorld(true); } lage.clear(); };
  const neu = () => { objects.slice().forEach(o => scene.remove(o)); objects.length = 0; };
  const out = {};
  // 1) Ralf: Hälfte unten 60×40×10, Hälfte oben darauf, 2 Stifte Ø5 durch beide
  neu();
  const A = box(0, 0, 0, 60, 10, 40), B = box(0, 10, 0, 60, 10, 40); A.userData.name = 'Hälfte A'; B.userData.name = 'Hälfte B';
  const s1 = box(-20, -2, 0, 5, 24, 5, true), s2 = box(20, -2, 0, 5, 24, 5, true);
  setze(); const v0 = vol(A);
  selectObjs([A, B, s1, s2]); await subtractHoles(); await warte();
  const teile = objects.filter(o => !o.userData.isHole);
  out.ralf = { teile: teile.length, cutterWeg: !objects.some(o => o.userData.isHole), vol: teile.map(vol), v0,
    inseln: teile.map(o => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; return _mfFromSoup(_mfWasm, g.attributes.position.array.map(x => x)).decompose().length; }),
    gewaehlt: selectedObjs.length };
  // Rückgängig → wieder 2 Hälften + 2 Cutter
  undo(); await new Promise(r => setTimeout(r, 500));
  out.undo = { koerper: objects.filter(o => !o.userData.isHole).length, cutter: objects.filter(o => o.userData.isHole).length };
  // 2) Cutter trifft nur Hälfte A (kurz, nur unten)
  neu();
  const A2 = box(0, 0, 0, 60, 10, 40), B2 = box(0, 10, 0, 60, 10, 40), k = box(0, -2, 0, 6, 8, 6, true);
  setze(); const vB = vol(B2);
  selectObjs([A2, B2, k]); await subtractHoles(); await warte();
  const t2 = objects.filter(o => !o.userData.isHole);
  out.nurA = { teile: t2.length, vols: t2.map(vol).sort((a, b) => a - b), vB };
  // 3) ein Körper wie bisher
  neu();
  const C = box(0, 0, 0, 30, 10, 30), k3 = box(0, -2, 0, 6, 14, 6, true);
  setze(); selectObjs([C, k3]); await subtractHoles(); await warte();
  out.einer = { teile: objects.length, vol: vol(objects[0]) };
  return out;
});
console.log(JSON.stringify(r));
const loch = Math.PI * 2.5 * 2.5 * 10;   // ein Stiftloch je Hälfte ≈ 196 mm³ (Zylinder-Facetten etwas weniger)
const checks = [
  ['Ralf: zwei getrennte Teile', r.ralf.teile === 2],
  ['jedes Teil ist ein zusammenhängender Körper', r.ralf.inseln.every(n => n === 1)],
  ['jede Hälfte hat beide Stiftlöcher', r.ralf.vol.every(v => Math.abs(r.ralf.v0 - v - 2 * loch) < 0.06 * 2 * loch)],
  ['Cutter sind weg, beide Teile gewählt', r.ralf.cutterWeg && r.ralf.gewaehlt === 2],
  ['Rückgängig: 2 Hälften + 2 Cutter zurück', r.undo.koerper === 2 && r.undo.cutter === 2],
  ['Cutter trifft nur A: B bleibt unverändert', r.nurA.teile === 2 && r.nurA.vols[1] === r.nurA.vB && r.nurA.vols[0] < r.nurA.vB],
  ['ein Körper wie bisher', r.einer.teile === 1 && r.einer.vol < 9000],
  ['keine Seitenfehler', errs.length === 0],
];
let ok = true; for (const [n, v] of checks) { console.log((v ? '✔ ' : '✘ ') + n); ok = ok && v; }
if (errs.length) console.log(errs);
await b.close(); process.exit(ok ? 0 : 1);
