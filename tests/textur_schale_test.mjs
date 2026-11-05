// Josy 5.11.2026: Kasten mit „Schale“ ausgehöhlt, dann Textur → das Muster „lässt was
// weg“ bzw. fast nichts kommt an. Ursache: nach der Schale ist der Körper 'custom'
// ohne _origGeo; die Textur baute auf _buildHighResGeo('custom') = Standard-Quader
// auf → Schale weg, Muster auf falschem Körper. Jetzt: aktuelle Form = Basis.
// Prüft: hohl bleibt, Außenwand voll gemustert, „keine“ stellt die Schale wieder her,
// Speichern/Laden + Musterwechsel prägt nicht doppelt. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
const r = await pg.evaluate(async () => {
  hideStarter(); setShapeMode('solid'); addShape('box'); let o = objects[0]; selectObjs([o]);
  fpApplyDim('w', 100); fpApplyDim('d', 100); fpApplyDim('h', 150);
  o.updateMatrixWorld(true); const bb0 = new THREE.Box3().setFromObject(o), c0 = bb0.getCenter(new THREE.Vector3());
  enterShellMode(); _shellThickness = 2;
  const rc0 = new THREE.Raycaster(new THREE.Vector3(c0.x, bb0.max.y + 2, c0.z), new THREE.Vector3(0, -1, 0)); raycaster.set(rc0.ray.origin, rc0.ray.direction);
  _shellToggleFace(rc0.intersectObject(o, false)[0]); await applyShell(); o = objects[0]; selectObjs([o]);
  const tris = x => (x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position.count) / 3;
  const mess = (x) => {
    x.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(x), c = bb.getCenter(new THREE.Vector3());
    const amp = x.userData.displacementAmp || 0.5, rc = new THREE.Raycaster();
    const hm = new THREE.Raycaster(new THREE.Vector3(c.x, bb.max.y + 1, c.z), new THREE.Vector3(0, -1, 0)).intersectObject(x, false)[0];
    // Vorderwand: 16×10 Zellen, je Zelle Höhenspanne; tiefste Stelle = Prägetiefe
    let leer = 0, tief = 0; const W = 90 / 10, H = 130 / 10;
    for (let j = 0; j < 10; j++) for (let i = 0; i < 16; i++) { let lo = 1e9, hi = -1e9;
      for (let a = 0; a < 6; a++) for (let q = 0; q < 6; q++) {
        rc.set(new THREE.Vector3(c.x - W / 2 + W * (i + a / 6) / 16, c.y - H / 2 + H * (j + q / 6) / 10, bb.max.z + 1), new THREE.Vector3(0, 0, -1));
        const h = rc.intersectObject(x, false)[0]; if (h) { const d = (bb0.max.z - h.point.z) * 10; lo = Math.min(lo, d); hi = Math.max(hi, d); } }
      if ((hi - lo) / amp < 0.15) leer++; tief = Math.max(tief, hi); }
    return { hohlMm: hm ? +((bb.max.y - hm.point.y) * 10).toFixed(1) : null, leer, tief: +tief.toFixed(2), b: +((bb.max.x - bb.min.x) * 10).toFixed(1) };
  };
  const out = { schaleTris: tris(o) };
  applyDisplacement('pattern', 'wellen'); applyDisplacement('freq', 10);
  out.wellen = mess(o);
  applyDisplacement('pattern', 'diamant');
  out.diamant = mess(o);
  applyDisplacement('pattern', 'keine');
  out.keine = { tris: tris(o), ...mess(o) };
  applyDisplacement('pattern', 'wellen');
  // Speichern/Laden, dann Muster wechseln: Basis muss die Schale sein, nicht das gemusterte Netz
  const d = JSON.parse(JSON.stringify(objectToData(o)));
  scene.remove(o); objects.length = 0;
  const l = buildObjectFromData(d); scene.add(l); objects.push(l); selectObjs([l]);
  out.geladen = mess(l);
  applyDisplacement('pattern', 'diamant');
  out.geladenWechsel = mess(l);
  // Wächter: anderes Netz untergeschoben (wie nach einer weiteren Schale) → neue Form zählt
  const neu = new THREE.BoxGeometry(2, 2, 2); l.geometry = neu; l.updateMatrixWorld(true);
  applyDisplacement('pattern', 'wellen');
  out.waechterVoll = mess(l).hohlMm;
  return out;
});
console.log(JSON.stringify(r));
const checks = [
  ['Schale bleibt bei Textur hohl', r.wellen.hohlMm > 140 && r.diamant.hohlMm > 140],
  ['Wellen: ganze Vorderwand gemustert', r.wellen.leer === 0],
  ['Diamant: ganze Vorderwand gemustert', r.diamant.leer <= 4],
  ['Prägung nicht tiefer als Texturhöhe', r.wellen.tief <= 0.56 && r.diamant.tief <= 0.56],
  ['Maße bleiben (100 mm)', Math.abs(r.wellen.b - 100) < 0.1],
  ['„keine“ stellt die Schale wieder her', r.keine.tris === r.schaleTris && r.keine.hohlMm > 140 && r.keine.tief < 0.05],
  ['nach Laden noch hohl + gemustert', r.geladen.hohlMm > 140 && r.geladen.leer === 0],
  ['nach Laden Musterwechsel ohne Doppelprägung', r.geladenWechsel.tief <= 0.56 && r.geladenWechsel.hohlMm > 140],
  ['ersetztes Netz wird neue Basis', r.waechterVoll != null && r.waechterVoll < 1],
  ['keine Seitenfehler', errs.length === 0],
];
let ok = true; for (const [n, v] of checks) { console.log((v ? '✔ ' : '✘ ') + n); ok = ok && v; }
if (errs.length) console.log(errs);
await b.close(); process.exit(ok ? 0 : 1);
