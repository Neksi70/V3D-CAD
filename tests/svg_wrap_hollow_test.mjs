// Josy 13.9.26 (Lichthuelle, 2 mm Wand): Motiv sah nach dem Wickeln zerstueckelt aus,
// auch klein. Ursache: Der Ebenenschnitt liefert bei Hohlkoerpern Innen- UND
// Aussenwand, und die Winkelzellen des Radiusfelds sind feiner als das Netz — je
// Zelle entschied der Zufall, welche Wand drin lag (29 von 105 Zellen innen).
// Jetzt zaehlt nur die Wandseite, deren Dreiecksnormale zum Klick passt.
// Pruefkoerper: hohle Kuppel wie ein Import (Z-up-Geometrie, Kippen nur am Mesh),
// grobe Reihen (8 mm), 2 mm Wand — Reihenabstand > Zellbreite ist der Ausloeser.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="48" y="5" width="3" height="90" transform="rotate(12 50 50)"/><rect x="25" y="38" width="35" height="3" transform="rotate(-40 42 40)"/><rect x="45" y="62" width="35" height="3" transform="rotate(35 62 63)"/><circle cx="22" cy="28" r="3.5"/><circle cx="80" cy="78" r="3.5"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const test = (hRel, motivMM, innen) => pg.evaluate(async ([hRel, motivMM, innen, svgText]) => {
  objects.slice().forEach(o => { scene.remove(o); objects.splice(objects.indexOf(o), 1); });
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: motivMM, name: 'Zweig' });
  m.userData.isHole = true;
  // Hohle Kuppel: Aussenprofil r(z) = 60 → 30 ueber 130 mm, Innenwand 2 mm dahinter, 8-mm-Reihen
  const R = z => 60 - 30 * Math.pow(z / 130, 2.2);
  const NR = 480, rows = []; for (let z = 0; z <= 130; z += 8) rows.push(z);
  const posA = [];
  const ring = (z, r, k) => { const out = []; for (let i = 0; i < NR; i++) { const a = 2 * Math.PI * i / NR; out.push([r * Math.cos(a), r * Math.sin(a), z]); } return out; };
  const quad = (p0, p1, p2, p3, flip) => { const t = flip ? [p0, p2, p1, p1, p2, p3] : [p0, p1, p2, p1, p3, p2]; for (const q of t) posA.push(...q); };
  for (let s = 0; s + 1 < rows.length; s++) {
    const zA = rows[s], zB = rows[s + 1];
    const oA = ring(zA, R(zA)), oB = ring(zB, R(zB)), iA = ring(zA, R(zA) - 2), iB = ring(zB, R(zB) - 2);
    for (let i = 0; i < NR; i++) { const j = (i + 1) % NR;
      quad(oA[i], oA[j], oB[i], oB[j], false);   // aussen: Normale nach aussen
      quad(iA[i], iA[j], iB[i], iB[j], true);    // innen: Normale zur Achse
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3)); g.computeVertexNormals();
  const vase = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2aa8c0, side: THREE.DoubleSide }));
  vase.rotation.x = -Math.PI / 2; vase.scale.setScalar(0.1); vase.position.set(0, 0, 0);
  vase.userData = { id: idCtr++, name: 'Huelle', type: 'import', shapeType: 'import' };
  scene.add(vase); objects.push(vase); vase.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(vase);
  const yHit = bb.min.y + (bb.max.y - bb.min.y) * hRel;
  const achse = new THREE.Vector3((bb.min.x + bb.max.x) / 2, 0, (bb.min.z + bb.max.z) / 2);
  const rc = new THREE.Raycaster();
  // Klick von aussen (Normalfall) oder von innen (in den Becher hinein gewickelt)
  let hit;
  if (!innen) { rc.set(new THREE.Vector3(achse.x + 10, yHit, achse.z), new THREE.Vector3(-1, 0, 0)); hit = rc.intersectObject(vase, true).find(t => t.face).point.clone(); }
  else { rc.set(new THREE.Vector3(achse.x, yHit, achse.z), new THREE.Vector3(1, 0, 0)); hit = rc.intersectObject(vase, true).find(t => t.face).point.clone(); }
  const p = _svgWrapProbe(vase, hit);
  if (!p) return { hRel, motivMM, innen, gewickelt: false, grund: window._svgWrapReason };
  _svgWrapApply(m, p, hit); m.updateMatrixWorld(true);
  // Aussenflaechen-Dreiecke des Motivs gegen die angeklickte Wand (Strahl von der Klickseite)
  const pos = m.geometry.attributes.position, idx = m.geometry.index; const nTri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), cen = new THREE.Vector3();
  let nOuter = 0, sunk = 0, dMin = Infinity, dMax = -Infinity;
  for (let t = 0; t < nTri; t++) {
    const i0 = idx ? idx.getX(3*t) : 3*t, i1 = idx ? idx.getX(3*t+1) : 3*t+1, i2 = idx ? idx.getX(3*t+2) : 3*t+2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld); q.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
    nrm.subVectors(q, a).cross(c.clone().sub(a)).normalize(); cen.addVectors(a, q).add(c).multiplyScalar(1/3);
    const dx = cen.x - achse.x, dz = cen.z - achse.z, rr = Math.hypot(dx, dz); const rad = new THREE.Vector3(dx / rr, 0, dz / rr);
    if (Math.abs(nrm.dot(rad)) < 0.8) continue;
    let d;
    if (!innen) { rc.set(new THREE.Vector3(achse.x, cen.y, achse.z).addScaledVector(rad, rr + 5), rad.clone().negate()); const h = rc.intersectObject(vase, true).find(x => x.face); if (!h) continue; d = (rr - Math.hypot(h.point.x - achse.x, h.point.z - achse.z)) * 10; }
    else { rc.set(new THREE.Vector3(achse.x, cen.y, achse.z), rad); const h = rc.intersectObject(vase, true).find(x => x.face); if (!h) continue; d = (Math.hypot(h.point.x - achse.x, h.point.z - achse.z) - rr) * 10; }
    if (d < -1.5) continue;                 // gegenueberliegende Motivflaeche (Tiefe 3 mm)
    nOuter++; dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); if (d < -0.05) sunk++;
  }
  return { hRel, motivMM, innen, gewickelt: true, seite: p.seite, aussenDreiecke: nOuter, versunkenAnteil: +(sunk / nOuter).toFixed(3), dMin: +dMin.toFixed(2), dMax: +dMax.toFixed(2) };
}, [hRel, motivMM, innen, SVG]);

// innen=true (in den Becher hinein) ist KEIN gueltiger Fall: der Gravurkeil baut immer radial
// nach aussen aus dem Koerper heraus. Die Seitenerkennung sichert nur, dass Klick und Messung
// dieselbe Wand meinen — auch bei umgestuelpten STLs.
for (const [hRel, mm, innen] of [[0.65, 30, false], [0.3, 30, false], [0.8, 15, false], [0.45, 60, false]]) {
  const r = await test(hRel, mm, innen);
  console.log(JSON.stringify(r));
  ok(`${innen ? 'innen' : 'aussen'} bei ${Math.round(hRel * 100)} % Hoehe, ${mm} mm: Motiv liegt auf der angeklickten Wand`,
     r.gewickelt && r.versunkenAnteil === 0 && r.dMin > 0 && r.dMax < 0.6, r);
}
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
