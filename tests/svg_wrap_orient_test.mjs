// Josy 10.9.26: "der Apfel ist verkehrt" + "dreht sich wieder" beim Verschieben.
// Prueft die AUSRICHTUNG eines gewickelten Motivs: oben/unten und links/rechts
// aus Betrachtersicht — flach geheftet (bekannt richtig) als Referenz.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
// Marker-SVG: kleines Quadrat OBEN LINKS, langer Balken UNTEN — voellig asymmetrisch.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,5 H30 V30 H5 Z"/><path d="M5,80 H95 V95 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// Messung: wo liegt das kleine Quadrat (Marker) relativ zur Motivmitte?
// hoch  = entlang Weltvertikale (bzw. Zylinderachse nach oben)
// rechts= aus Betrachtersicht vor der Wand:  rechts = achseHoch × aussenNormale
const mess = await pg.evaluate((svg) => {
  const out = {};
  // Marker finden: der kleine Block ist das Cluster mit den wenigsten Punkten
  function markerPos(mesh) {
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
    const pts = [];
    for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).clone());
    return pts;
  }
  // Silhouette: das Motiv hat OBEN ein kleines Quadrat und UNTEN einen breiten
  // Balken. Steht es kopfueber, ist die obere Haelfte breiter als die untere.
  function lage(mesh, aussen) {
    const pts = markerPos(mesh);
    const bb = new THREE.Box3().setFromPoints(pts), c = bb.getCenter(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0);
    const rechts = new THREE.Vector3().crossVectors(up, aussen).normalize();
    const br = ps => { let lo = Infinity, hi = -Infinity;
      for (const p of ps) { const d = p.clone().sub(c).dot(rechts); if (d < lo) lo = d; if (d > hi) hi = d; }
      return ps.length ? +(hi - lo).toFixed(2) : 0; };
    const obenPts = pts.filter(p => p.y > c.y + 0.2), untenPts = pts.filter(p => p.y < c.y - 0.2);
    const kleinPts = obenPts.length ? obenPts : [];
    const seite = kleinPts.reduce((a, p) => a + p.clone().sub(c).dot(rechts), 0) / Math.max(1, kleinPts.length);
    return { breiteOben: br(obenPts), breiteUnten: br(untenPts), markerRechtsWert: +seite.toFixed(2),
             motivOben: +new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).y.toFixed(2) };
  }
  // ── A) flach auf einen Quader heften (Referenz) ────────────────────────
  addShape('box'); const box = objects[objects.length - 1]; box.scale.set(3, 3, 3); box.position.set(-8, 3, 0); box.userData.name = 'Quader';
  const m1 = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'M1' });
  box.updateMatrixWorld(true);
  const hitP = new THREE.Vector3(-8, 3, 3);                     // Vorderwand (+z)
  const rc = new THREE.Raycaster(); rc.set(hitP.clone().add(new THREE.Vector3(0, 0, 5)), new THREE.Vector3(0, 0, -1));
  const h1 = rc.intersectObject(box, true).find(h => h.face);
  _svgSnapHit = h1; _applySvgSnap(m1, { obj: box, type: 'surface', wrap: null });
  out.flach = lage(m1, new THREE.Vector3(0, 0, 1));
  // ── B) auf ein aufrechtes Rohr wickeln (eigener Koerper) ───────────────
  addShape('tube'); const tube = objects[objects.length - 1]; tube.scale.set(3, 3, 3); tube.position.set(8, 3, 0); tube.userData.name = 'Rohr';
  tube.updateMatrixWorld(true);
  const m2 = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'M2' });
  const hit2 = new THREE.Vector3(8, 3, 3);
  const p2 = _svgWrapProbe(tube, hit2);
  out.rohrProbe = !!p2;
  if (p2) {
    _svgWrapApply(m2, p2, hit2);
    out.rohr = lage(m2, new THREE.Vector3(0, 0, 1));
  }
  // ── C) importiertes STL, um 180° gekippt (lokale +Y zeigt nach UNTEN) ──
  const g = new THREE.CylinderGeometry(30, 30, 100, 48, 1, true);
  const imp = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x88a }));
  imp.scale.set(0.1, 0.1, 0.1); imp.rotation.x = Math.PI;        // auf den Kopf gestellt
  imp.position.set(24, 5, 0);
  imp.userData = { id: idCtr++, name: 'ImportKopf', type: 'import', shapeType: 'import', color: '#8888aa' };
  scene.add(imp); objects.push(imp); imp.updateMatrixWorld(true);
  const m3 = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'M3' });
  const hit3 = new THREE.Vector3(24, 5, 3);
  const p3 = _svgWrapProbe(imp, hit3);
  out.impProbe = !!p3;
  if (p3) {
    _svgWrapApply(m3, p3, hit3);
    out.importKopf = lage(m3, new THREE.Vector3(0, 0, 1));
  }
  return out;
}, SVG);
console.log(JSON.stringify(mess, null, 1));
// Referenz flach: schmales Quadrat OBEN, breiter Balken UNTEN, Quadrat LINKS
const schmalOben = m => m && m.breiteUnten > m.breiteOben * 1.8;
ok('flach: steht richtig herum (Referenz)', schmalOben(mess.flach), mess.flach);
ok('flach: Marker links (Referenz)', mess.flach.markerRechtsWert < 0, mess.flach);
ok('Rohr: steht richtig herum (nicht kopfüber)', schmalOben(mess.rohr), mess.rohr);
ok('Rohr: nicht gespiegelt',
   mess.rohr && Math.sign(mess.rohr.markerRechtsWert) === Math.sign(mess.flach.markerRechtsWert), mess.rohr);
ok('Import kopfüber: Motiv-Hochachse zeigt nach oben', mess.importKopf && mess.importKopf.motivOben > 0, mess.importKopf);
ok('Import kopfüber: steht richtig herum', schmalOben(mess.importKopf), mess.importKopf);
ok('Import kopfüber: nicht gespiegelt',
   mess.importKopf && Math.sign(mess.importKopf.markerRechtsWert) === Math.sign(mess.flach.markerRechtsWert), mess.importKopf);
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length + ' Abweichung(en)' : '✅ alles wie erwartet');
await b.close();
