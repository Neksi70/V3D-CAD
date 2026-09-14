// Josy 14.9.26 (Kugelschale): "hier Rundung wickeln" gab es nur am Aequator, sonst nur
// "Auf Flaeche heften". Die Probe nahm immer die senkrechte Achse; oben und unten steht
// die Kugelwand dazu nicht mehr radial (Tor |n·radial| > 0,8). Eine Kugel ist aber um
// JEDE Achse rund — mit der Flaechennormale waehlt die Probe jetzt eine Achse, um die
// sich hier wickeln laesst (Querachse), und das Motiv startet trotzdem aufrecht.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
// "T": Querbalken OBEN — daran erkennt man, ob das Motiv aufrecht steht
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="47" y="15" width="6" height="80"/><rect x="20" y="5" width="60" height="10"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const test = (hRel) => pg.evaluate(async ([hRel, svgText]) => {
  objects.slice().forEach(o => { scene.remove(o); objects.splice(objects.indexOf(o), 1); });
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: 25, name: 'T' }); m.userData.isHole = true;
  addShape('sphericalshell'); const vase = objects.find(o => o !== m); selectObjs([]);
  vase.scale.set(7, 7, 7); vase.position.set(0, 7, 0); vase.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(vase); const C = bb.getCenter(new THREE.Vector3()); const Rk = (bb.max.x - bb.min.x) / 2;
  const yHit = bb.min.y + (bb.max.y - bb.min.y) * hRel;
  const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(C.x + 30, yHit, C.z), new THREE.Vector3(-1, 0, 0));
  const hh = rc.intersectObject(vase, true).find(t => t.face); if (!hh) return { hRel, fehler: 'kein Wandtreffer' };
  const hit = hh.point.clone();
  const nW = hh.face.normal.clone().transformDirection(vase.matrixWorld).normalize();
  const p = _svgWrapProbe(vase, hit, { normalW: nW });
  if (!p) return { hRel, gewickelt: false, grund: window._svgWrapReason };
  const c0 = p.axisPt.clone().addScaledVector(p.axisDir, hit.clone().sub(p.axisPt).dot(p.axisDir));
  const radial = hit.clone().sub(c0).normalize();
  const tor = Math.abs(nW.dot(radial));
  if (tor <= 0.8) return { hRel, gewickelt: false, tor: +tor.toFixed(2), ax: p.ax };
  _svgWrapApply(m, p, hit); m.updateMatrixWorld(true);
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  let aussenMax = -Infinity, innenMin = Infinity, yMin = Infinity, yMax = -Infinity;
  const pts = [];
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); pts.push(v.clone());
    const d = (v.distanceTo(C) - Rk) * 10; aussenMax = Math.max(aussenMax, d); innenMin = Math.min(innenMin, d); yMin = Math.min(yMin, v.y); yMax = Math.max(yMax, v.y); }
  // Aufrecht: seitliche Breite oben (Querbalken) deutlich groesser als unten (Fuss)
  const mid = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
  const radW = mid.clone().sub(C); radW.y = 0; radW.normalize();
  const seit = new THREE.Vector3(0, 1, 0).cross(radW).normalize();
  let oben = 0, unten = 0;
  for (const q of pts) { const s = Math.abs(q.clone().sub(mid).dot(seit)); const t = (q.y - yMin) / Math.max(1e-6, yMax - yMin); if (t > 0.75) oben = Math.max(oben, s); if (t < 0.25) unten = Math.max(unten, s); }
  return { hRel, gewickelt: true, ax: p.ax, tor: +tor.toFixed(2), rot0Grad: +((m.userData._svgWrap.rotRad || 0) * 180 / Math.PI).toFixed(1),
           aussenMaxMM: +aussenMax.toFixed(2), innenMinMM: +innenMin.toFixed(2), breiteObenMM: +(oben * 20).toFixed(1), breiteUntenMM: +(unten * 20).toFixed(1) };
}, [hRel, SVG]);

for (const hRel of [0.85, 0.15, 0.5]) {
  const r = await test(hRel);
  console.log(JSON.stringify(r));
  ok(`Kugelschale bei ${Math.round(hRel * 100)} % Hoehe: wickelbar`, r.gewickelt, r);
  ok(`… Motiv liegt an (0,2 mm aussen, 3 mm tief)`, r.gewickelt && r.aussenMaxMM < 0.6 && r.aussenMaxMM > 0 && r.innenMinMM < -2.5, r);
  ok(`… und steht aufrecht (Querbalken oben)`, r.gewickelt && r.breiteObenMM > 2 * r.breiteUntenMM, r);
  if (hRel !== 0.5) ok(`… um eine Querachse (nicht die senkrechte)`, r.gewickelt && r.ax !== 1, r);
}
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
