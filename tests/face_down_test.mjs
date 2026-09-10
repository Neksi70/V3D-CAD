// Regressionstest für „⬓ Fläche unten" (_fd*).
//
// Ralf (10.9.2026): „Ich möchte das Teil auf die flache Stelle absetzen. Beim
// Klicken auf Drehen dreht er nicht stufenlos sondern rastet." Geprüft wird
// darum genau das, was der Knopf leisten muss:
//   1. die angeklickte Fläche liegt danach PLAN unten (Normale zeigt nach −Y)
//   2. das Teil steht auf der Platte (min y = 0) und bleibt an seiner Stelle
//   3. eine schräge Fläche wird auch dann getroffen, wenn kein 22,5°-Vielfaches
//      passt (das ist der Fall, an dem Drehen/Kippen scheitern)
//   4. die Vorschau leuchtet über die ganze ebene Fläche, nicht nur ein Dreieck
//   5. liegt die Fläche schon unten, passiert nichts Schlimmes
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

// Prüfhilfen in der Seite: Objekt bauen, Fläche per Normale suchen, absetzen
await pg.evaluate(() => {
  window._fdT = {
    // Keil mit einer schrägen Fläche, deren Winkel KEIN 22,5°-Vielfaches ist
    ramp(angleDeg) {
      const a = angleDeg * Math.PI / 180;
      const w = 2, l = 6, h = l * Math.tan(a);
      // Prisma: Dreieck in XY, Tiefe in Z
      const P = [[0,0,0],[l,0,0],[l,h,0],[0,0,w],[l,0,w],[l,h,w]];
      const F = [[0,1,2],[3,5,4],[0,2,5],[0,5,3],[0,3,4],[0,4,1],[1,4,5],[1,5,2]];
      const pos = [];
      for (const f of F) for (const i of f) pos.push(...P[i]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3388ff }));
      m.userData = { id: Date.now(), type: 'mesh', shapeType: 'mesh', name: 'Rampe', color: '#3388ff', isHole: false };
      scene.add(m); objects.push(m);
      m.updateMatrixWorld(true);
      const bb = getMeshBox(m); m.position.y -= bb.min.y; m.updateMatrixWorld(true);
      return m;
    },
    // Welt-Normalen aller Dreiecke, dedupliziert
    normals(o) {
      const g = o.geometry, pos = g.attributes.position, idx = g.index;
      const n = (idx ? idx.count : pos.count) / 3, out = [];
      const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(),
            e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
      o.updateMatrixWorld(true);
      const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
      for (let t = 0; t < n; t++) {
        const i0 = idx ? idx.getX(t*3) : t*3, i1 = idx ? idx.getX(t*3+1) : t*3+1, i2 = idx ? idx.getX(t*3+2) : t*3+2;
        va.fromBufferAttribute(pos, i0); vb.fromBufferAttribute(pos, i1); vc.fromBufferAttribute(pos, i2);
        e1.subVectors(vb, va); e2.subVectors(vc, va); nn.crossVectors(e1, e2);
        if (nn.length() < 1e-12) continue;
        nn.normalize().applyMatrix3(nm).normalize();
        if (!out.some(o2 => o2.dot(nn) > 0.9995)) out.push(nn.clone());
      }
      return out.map(v => [v.x, v.y, v.z]);
    },
    box(o) { o.updateMatrixWorld(true); const b = getMeshBox(o);
      return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] }; },
  };
});

// Fläche mit gegebener Welt-Normale nach unten drehen und Kennzahlen liefern
const place = async (rampDeg, pickIdx) => pg.evaluate(({ rampDeg, pickIdx }) => {
  objects.slice().forEach(o => { scene.remove(o); });
  objects.length = 0;
  const o = window._fdT.ramp(rampDeg);
  const before = window._fdT.box(o);
  const ns = window._fdT.normals(o);
  // Zielfläche: die mit der größten Neigung gegen die Senkrechte (= die Schräge),
  // bei pickIdx>=0 stattdessen die angegebene
  let n;
  if (pickIdx >= 0) n = new THREE.Vector3(...ns[pickIdx]);
  else {
    let best = null, bestScore = -2;
    for (const a of ns) {
      const v = new THREE.Vector3(...a);
      const score = -Math.abs(v.y) + (v.y < 0 ? 0 : 0);   // möglichst waagerechte Normale = schrägste Fläche
      if (score > bestScore) { bestScore = score; best = v; }
    }
    n = best;
  }
  window._fdPlaceOnFace(o, n.clone());
  const after = window._fdT.box(o);
  // Wo zeigt die gewählte Fläche jetzt hin?
  const q = o.quaternion.clone();
  const nAfter = n.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    n.clone().normalize(), new THREE.Vector3(0, -1, 0)));
  return { before, after,
           nBefore: [n.x, n.y, n.z], nAfter: [nAfter.x, nAfter.y, nAfter.z],
           normalsNow: window._fdT.normals(o) };
}, { rampDeg, pickIdx });

// ── 1) Schräge Fläche mit „krummem" Winkel (kein 22,5°-Vielfache) ───────────
for (const deg of [31, 17.5, 63.2]) {
  const r = await place(deg, -1);
  console.log('\n— Rampe ' + deg + '° —');
  // die gewählte Fläche zeigt jetzt exakt nach unten
  ok(deg + '°: gewählte Fläche zeigt nach unten', Math.abs(r.nAfter[1] + 1) < 1e-6, r.nAfter);
  // und es gibt sie im Objekt auch wirklich als (0,−1,0)
  const hasDown = r.normalsNow.some(n => n[1] < -0.9999);
  ok(deg + '°: Objekt hat danach eine waagerechte Fläche unten', hasDown);
  ok(deg + '°: steht auf der Platte (min y = 0)', Math.abs(r.after.min[1]) < 1e-6, r.after.min[1]);
  const cxB = (r.before.min[0] + r.before.max[0]) / 2, cxA = (r.after.min[0] + r.after.max[0]) / 2;
  const czB = (r.before.min[2] + r.before.max[2]) / 2, czA = (r.after.min[2] + r.after.max[2]) / 2;
  ok(deg + '°: bleibt an seiner Stelle stehen', Math.abs(cxA - cxB) < 1e-4 && Math.abs(czA - czB) < 1e-4,
     { dx: +(cxA - cxB).toFixed(6), dz: +(czA - czB).toFixed(6) });
}

// ── 2) Fläche, die schon unten liegt → darf nichts kaputt machen ────────────
{
  const r = await pg.evaluate(() => {
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
    const o = window._fdT.ramp(31);
    const before = window._fdT.box(o);
    window._fdPlaceOnFace(o, new THREE.Vector3(0, -1, 0));
    const after = window._fdT.box(o);
    return { before, after };
  });
  console.log('\n— Fläche liegt schon unten —');
  const same = ['min','max'].every(k => r.before[k].every((v, i) => Math.abs(v - r.after[k][i]) < 1e-6));
  ok('unverändert', same, r);
}

// ── 3) Vorschau: leuchtet über die ganze ebene Fläche ───────────────────────
{
  const r = await pg.evaluate(() => {
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
    const o = window._fdT.ramp(31);
    o.updateMatrixWorld(true);
    // Strahl von schräg oben auf die Oberseite der Rampe
    const geo = o.geometry, pos = geo.attributes.position;
    // Dreieck der großen Schrägfläche suchen (Index 2 oder 3 der Facelist)
    const tri = (t) => [0,1,2].map(k => new THREE.Vector3().fromBufferAttribute(pos, t*3+k));
    let bestT = 0, bestArea = 0, bestN = null;
    for (let t = 0; t < pos.count/3; t++) {
      const [a,b,c] = tri(t);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const ar = n.length()/2; n.normalize();
      const ay = Math.abs(n.y);
      if (ay > 0.05 && ay < 0.999 && ar > bestArea) { bestArea = ar; bestT = t; bestN = n.clone(); }
    }
    const [a,b,c] = tri(bestT);
    const hit = { face: { normal: bestN, a: bestT*3, b: bestT*3+1, c: bestT*3+2 }, faceIndex: bestT, object: o };
    const g = window._fdCoplanarGeo(o, hit);
    return { tris: g ? g.attributes.position.count/3 : 0, total: pos.count/3 };
  });
  console.log('\n— Vorschau-Umfang —');
  ok('Vorschau umfasst mehr als ein Dreieck der Schrägfläche', r.tris >= 2, r);
  ok('Vorschau umfasst nicht das ganze Objekt', r.tris < r.total, r);
}

// ── 4) Modus lässt sich öffnen und mit Esc wieder schließen ─────────────────
{
  const r = await pg.evaluate(async () => {
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
    const o = window._fdT.ramp(31);
    selectObjs([o]);
    window.toggleFaceDown();
    const on = window._fdDbg().mode === true;
    const hintShown = document.getElementById('hint').classList.contains('show');
    window.exitFaceDownMode();
    return { on, hintShown, off: window._fdDbg().mode === false,
             hintHidden: !document.getElementById('hint').classList.contains('show') };
  });
  console.log('\n— Modus an/aus —');
  ok('Modus lässt sich einschalten', r.on);
  ok('Hinweisleiste erscheint', r.hintShown);
  ok('Modus lässt sich beenden', r.off);
  ok('Hinweisleiste verschwindet', r.hintHidden);
}

// ── 5) ohne Auswahl: freundliche Absage statt Absturz ──────────────────────
{
  const r = await pg.evaluate(() => {
    deselect();
    window.toggleFaceDown();
    return window._fdDbg().mode === true;
  });
  ok('ohne Auswahl kein Modus', r === false);
}

// ── 6) ECHTER Klickweg: Knopf → Zeiger über die Fläche → Klick ─────────────
// Nicht nur die Rechen-Funktion prüfen, sondern die Verdrahtung: dass der
// Knopf den Modus startet, der Zeiger die Fläche hervorhebt und der Klick
// wirklich dreht. (Tote Verdrahtung hat hier schon einmal Stunden gekostet.)
{
  console.log('\n— Klickweg im Fenster —');
  // Rampe hinstellen, Kamera schräg von vorn/oben auf die Schrägfläche
  const setup = await pg.evaluate(() => {
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
    const o = window._fdT.ramp(31);
    selectObjs([o]);
    // Größtes Dreieck der Schrägfläche suchen (weder waagerecht noch senkrecht)
    const pos = o.geometry.attributes.position;
    let bestT = -1, bestArea = 0, bestN = null;
    for (let t = 0; t < pos.count/3; t++) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, t*3),
            b = new THREE.Vector3().fromBufferAttribute(pos, t*3+1),
            c = new THREE.Vector3().fromBufferAttribute(pos, t*3+2);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const ar = n.length()/2; n.normalize();
      const ay = Math.abs(n.y);
      if (ay > 0.05 && ay < 0.999 && ar > bestArea) { bestArea = ar; bestT = t; bestN = n.clone(); }
    }
    const ctr = new THREE.Vector3();
    for (let k = 0; k < 3; k++) ctr.add(new THREE.Vector3().fromBufferAttribute(pos, bestT*3+k));
    ctr.divideScalar(3); o.localToWorld(ctr);
    // Kamera GENAU vor die Fläche stellen, sonst steht die Stirnwand im Weg und
    // der Strahl trifft in der Bildmitte gar nicht die gemeinte Fläche
    const wn = bestN.clone().transformDirection(o.matrixWorld).normalize();
    if (wn.y < 0) wn.negate();
    camera.position.copy(ctr.clone().addScaledVector(wn, 14));
    camera.lookAt(ctr); camera.updateMatrixWorld(true);
    if (typeof controls !== 'undefined' && controls) { controls.target.copy(ctr); controls.update(); }
    const v = ctr.clone().project(camera);
    const r = document.getElementById('vp').getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height,
             boxBefore: window._fdT.box(o),
             targetN: [wn.x, wn.y, wn.z] };
  });

  await pg.click('button[onclick="toggleFaceDown()"]');
  ok('Knopf startet den Modus', (await pg.evaluate(() => window._fdDbg().mode)) === true);

  await pg.mouse.move(setup.x, setup.y);
  await pg.mouse.move(setup.x + 1, setup.y);          // zweite Bewegung: pointermove sicher auslösen
  const hov = await pg.evaluate(() => window._fdDbg());
  ok('Zeiger über der Fläche hebt sie hervor', hov.highlight === true, hov);
  // Die Schräge besteht aus zwei Dreiecken — die Vorschau muss beide zeigen,
  // sonst sieht Ralf nicht, was tatsächlich auf der Platte landet
  ok('Vorschau deckt die GANZE ebene Fläche ab (nicht nur ein Dreieck)', hov.hlTris >= 2, hov);

  await pg.mouse.down(); await pg.mouse.up();
  const after = await pg.evaluate(() => {
    const o = objects[objects.length - 1];
    return { box: window._fdT.box(o), normals: window._fdT.normals(o), mode: window._fdDbg().mode };
  });
  ok('Klick dreht das Teil (Fläche liegt jetzt unten)',
     after.normals.some(n => n[1] < -0.9999), after.normals.map(n => n.map(v => +v.toFixed(3))));
  ok('Klick setzt es auf die Platte', Math.abs(after.box.min[1]) < 1e-6, after.box.min[1]);
  ok('Modus endet nach dem Klick', after.mode === false);
  const cxB = (setup.boxBefore.min[0] + setup.boxBefore.max[0]) / 2;
  const cxA = (after.box.min[0] + after.box.max[0]) / 2;
  ok('bleibt an seiner Stelle', Math.abs(cxA - cxB) < 1e-3, { dx: +(cxA - cxB).toFixed(5) });
}

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log('\n' + (fails.length ? '❌ ' + fails.length + ' Fehler: ' + fails.join(' | ') : '✅ alles grün'));
process.exit(fails.length ? 1 : 0);
