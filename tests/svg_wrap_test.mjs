// Test: SVG um eine Rundung wickeln (Windlicht-Gravur)
//   1. Rundung erkennen: Radius am Trefferpunkt, nicht der Mittelwert Innen/Außen
//   2. Wickeln: alle Punkte liegen radial zwischen (R − Tiefe) und (R + Überstand),
//      Bogenlänge = Motivbreite, Höhe unverändert
//   3. Tiefe nachträglich ändern / Durchbruch
//   4. Erhaben (negative Tiefe) baut nach außen auf
//   5. Speichern → Laden reproduziert die gebogene Geometrie
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

const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M10,10 H90 V40 H10 Z"/>
  <path d="M20,60 H80 V90 H20 Z M40,70 V80 H60 V70 Z"/>
</svg>`;

// ── Aufbau: Rohr (Windlicht-Wand) + SVG-Motiv ────────────────────────────
const setup = await pg.evaluate((svg) => {
  addShape('tube');                                  // Hohlzylinder = Windlichtwand
  const cyl = objects[objects.length - 1];
  cyl.scale.set(3, 3, 3);                            // Ø ~60 mm
  cyl.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(cyl);
  const mesh = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 5, targetMM: 30, name: 'WrapTest' });
  mesh.userData.isHole = true;
  cyl.position.set(0, 2, 0);      // erst jetzt: der Import rückt Objekte zurecht
  cyl.updateMatrixWorld(true);
  return { nObj: objects.length, cylId: cyl.userData.id, svgId: mesh.userData.id,
           cylTop: bb.max.y, cylR: (bb.max.x - bb.min.x) / 2 };
}, TEST_SVG);
ok('Aufbau: Rohr + SVG in der Szene', setup.nObj === 2, setup);

// ── 1. Rundung erkennen ──────────────────────────────────────────────────
const probe = await pg.evaluate(() => {
  const cyl = objects[0];
  cyl.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(cyl);
  const rOuter = (bb.max.x - bb.min.x) / 2;
  const yMid = (bb.min.y + bb.max.y) / 2;
  if (Math.abs(bb.max.x - rOuter) > 1e-6) throw new Error('Zylinderachse nicht bei x=0');
  // Punkt auf der Außenwand (+X) und Punkt auf dem oberen Rand
  const pMantel = new THREE.Vector3(rOuter, yMid, 0);
  const pDeckel = new THREE.Vector3(rOuter * 0.9, bb.max.y, 0);
  const a = _svgWrapProbe(cyl, pMantel);
  const c = _svgWrapProbe(cyl, pDeckel);
  return {
    rOuter, gefunden: !!a, R: a ? a.R : null,
    achse: a ? [a.axisDir.x, a.axisDir.y, a.axisDir.z].map(v => +v.toFixed(3)) : null,
    achsPunktRadius: a ? +Math.hypot(a.axisPt.x, a.axisPt.z).toFixed(4) : null,
    deckelR: c ? c.R : null
  };
});
ok('Rundung erkannt', probe.gefunden, probe);
ok('Radius = Außenwand (nicht Mittel aus Innen/Außen)',
   probe.R != null && Math.abs(probe.R - probe.rOuter) < 0.02,
   { R: probe.R?.toFixed(3), rOuter: probe.rOuter.toFixed(3) });
ok('Achse ist die Zylinderachse (+Y)', probe.achse && probe.achse[1] > 0.999, probe.achse);
ok('Achsenpunkt liegt auf der Achse', probe.achsPunktRadius < 1e-3, probe.achsPunktRadius);

// ── 2. Wickeln ───────────────────────────────────────────────────────────
const wrapped = await pg.evaluate(() => {
  const cyl = objects[0], svgM = objects[1];
  cyl.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(cyl);
  const rOuter = (bb.max.x - bb.min.x) / 2, yMid = (bb.min.y + bb.max.y) / 2;
  const flatBB = new THREE.Box3().setFromObject(svgM);
  const flatW = (flatBB.max.x - flatBB.min.x) * 10, flatH = (flatBB.max.z - flatBB.min.z) * 10;
  const p = _svgWrapProbe(cyl, new THREE.Vector3(rOuter, yMid, 0));
  const done = _svgWrapApply(svgM, p, new THREE.Vector3(rOuter, yMid, 0));
  svgM.updateMatrixWorld(true);
  // Alle Vertices in Zylinderkoordinaten prüfen
  const pos = svgM.geometry.attributes.position;
  const v = new THREE.Vector3();
  let rMin = Infinity, rMax = -Infinity, thMin = Infinity, thMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(svgM.matrixWorld);
    const r = Math.hypot(v.x - 0, v.z - 0);
    const th = Math.atan2(v.z, v.x);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    thMin = Math.min(thMin, th); thMax = Math.max(thMax, th);
    yMin = Math.min(yMin, v.y); yMax = Math.max(yMax, v.y);
  }
  return { done, rOuter, yMid, flatW, flatH,
           rMinMM: rMin * 10, rMaxMM: rMax * 10,
           bogenMM: (thMax - thMin) * rOuter * 10,
           hoeheMM: (yMax - yMin) * 10, yMitteMM: ((yMax + yMin) / 2 - yMid) * 10,
           depth: svgM.userData._svgWrap?.depthMm, scale: svgM.scale.x,
           tris: pos.count };
});
ok('Wickeln ausgeführt', wrapped.done === true, wrapped);
ok('Außenfläche steht 0,2 mm über der Wand',
   Math.abs(wrapped.rMaxMM - (wrapped.rOuter * 10 + 0.2)) < 0.05,
   { rMax: wrapped.rMaxMM?.toFixed(3), soll: (wrapped.rOuter * 10 + 0.2).toFixed(3) });
ok('Innenfläche liegt exakt auf Tiefe (svgDepth = 5 mm)',
   Math.abs(wrapped.rMinMM - (wrapped.rOuter * 10 - 5)) < 0.05,
   { rMin: wrapped.rMinMM?.toFixed(3), soll: (wrapped.rOuter * 10 - 5).toFixed(3) });
ok('Bogenlänge = Motivbreite (30 mm Vorgabe)',
   Math.abs(wrapped.bogenMM - wrapped.flatW) < 0.3,
   { bogen: wrapped.bogenMM?.toFixed(2), flach: wrapped.flatW?.toFixed(2) });
ok('Motivhöhe unverändert', Math.abs(wrapped.hoeheMM - wrapped.flatH) < 0.2,
   { hoch: wrapped.hoeheMM?.toFixed(2), flach: wrapped.flatH?.toFixed(2) });
ok('Motiv sitzt auf Anker-Höhe', Math.abs(wrapped.yMitteMM) < 0.2, wrapped.yMitteMM?.toFixed(3));
ok('Skalierung ist in die Geometrie gewandert', wrapped.scale === 1, wrapped.scale);

// ── 3. Tiefe ändern + Durchbruch ─────────────────────────────────────────
const reshape = await pg.evaluate(() => {
  const svgM = objects[1];
  const rad = () => {
    const pos = svgM.geometry.attributes.position, v = new THREE.Vector3();
    let rMin = Infinity, rMax = -Infinity;
    svgM.updateMatrixWorld(true);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(svgM.matrixWorld);
      const r = Math.hypot(v.x, v.z);
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    }
    return { min: rMin * 10, max: rMax * 10 };
  };
  const R = svgM.userData._svgWrap.R * 10;
  _svgWrapReshape(svgM, 1.2);      const g = rad();
  _svgWrapReshape(svgM, 'through'); const t = rad();
  _svgWrapReshape(svgM, -1.5);     const e = rad();
  _svgWrapReshape(svgM, 1.2);      // für den Rest der Tests wieder Gravur
  return { R, g, t, e };
});
ok('Gravur 1,2 mm: Innenfläche 1,2 mm unter der Wand',
   Math.abs(reshape.g.min - (reshape.R - 1.2)) < 0.05, { ist: reshape.g.min?.toFixed(3), soll: (reshape.R - 1.2).toFixed(3) });
ok('Durchbruch reicht fast bis zur Achse, bleibt aber davor',
   reshape.t.min < reshape.R * 0.05 && reshape.t.min > 0,
   { min: reshape.t.min?.toFixed(3), R: reshape.R.toFixed(3) });
ok('Erhaben: Motiv steht 1,5 mm aus der Wand',
   Math.abs(reshape.e.max - (reshape.R + 1.5)) < 0.05 && reshape.e.min > reshape.R - 0.3,
   { max: reshape.e.max?.toFixed(3), min: reshape.e.min?.toFixed(3), R: reshape.R.toFixed(3) });

// ── 4. Speichern → Laden ─────────────────────────────────────────────────
const roundtrip = await pg.evaluate(() => {
  const svgM = objects[1];
  const before = new THREE.Box3().setFromObject(svgM);
  const data = JSON.parse(JSON.stringify(objectToData(svgM)));
  const rebuilt = buildObjectFromData(data);
  rebuilt.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(rebuilt);
  return { hatWrap: !!data._svgWrap, ohneGeo: !data.geometry,
           dMin: before.min.distanceTo(after.min) * 10,
           dMax: before.max.distanceTo(after.max) * 10,
           wrapUd: !!rebuilt.userData._svgWrap };
});
ok('Biege-Parameter werden gespeichert', roundtrip.hatWrap && roundtrip.wrapUd, roundtrip);
ok('Gebogene Form nach dem Laden identisch',
   roundtrip.dMin < 0.05 && roundtrip.dMax < 0.05,
   { dMin: roundtrip.dMin?.toFixed(4), dMax: roundtrip.dMax?.toFixed(4) });

// ── 5. Der Weg, den Josy nimmt: Magnet-Hinweis beim Ziehen ───────────────
const trigger = await pg.evaluate(() => {
  const cyl = objects[0], svgM = objects[1];
  cyl.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(cyl);
  // Kamera frontal auf die Wandmitte, damit ein Bildschirmpunkt sicher trifft
  const ziel = new THREE.Vector3(0, (bb.min.y + bb.max.y) / 2, bb.max.z);
  camera.position.set(0, ziel.y, bb.max.z + 20);
  camera.lookAt(ziel); camera.updateMatrixWorld(true);
  const scr = ziel.clone().project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const ev = { clientX: rect.left + (scr.x * 0.5 + 0.5) * rect.width,
               clientY: rect.top  + (-scr.y * 0.5 + 0.5) * rect.height };
  selectObjs([svgM]);
  _detectTextSnapWhileDragging(ev);
  const hint = document.getElementById('text-snap-hint');
  const treffer = { text: hint.textContent, sichtbar: hint.style.display,
                    typ: _textSnapTarget && _textSnapTarget.type };
  // Loslassen → wickelt wirklich
  const vorher = svgM.geometry.attributes.position.count;
  _applyTextSnapOnDrop();
  return { ...treffer, gewickelt: !!svgM.userData._svgWrap,
           R: svgM.userData._svgWrap ? +(svgM.userData._svgWrap.R * 10).toFixed(2) : null, vorher };
});
ok('Ziehen auf die Rundung zeigt „Um Rundung wickeln"',
   trigger.text === '↩ Um Rundung wickeln' && trigger.typ === 'wrap' && trigger.sichtbar === 'block', trigger);
ok('Loslassen wickelt das Motiv', trigger.gewickelt && Math.abs(trigger.R - 30) < 0.2, trigger);

// ── 6. Gekippter, versetzter Zylinder ────────────────────────────────────
const gekippt = await pg.evaluate(() => {
  const cyl = objects[0];
  cyl.rotation.set(0.4, 0, 0.25);
  cyl.position.set(4, 3, -2);
  cyl.updateMatrixWorld(true);
  const svgM = objects[1];
  // Trefferpunkt auf der Mantelfläche: Achse + radial
  const a = new THREE.Vector3(0, 1, 0).transformDirection(cyl.matrixWorld).normalize();
  const c = cyl.localToWorld(new THREE.Vector3(0, 0, 0));
  const ref = new THREE.Vector3(1, 0, 0).sub(a.clone().multiplyScalar(a.x)).normalize();
  const rOuter = 3;                                  // lokal 1 × scale 3
  const hit = c.clone().addScaledVector(ref, rOuter);
  const p = _svgWrapProbe(cyl, hit);
  if (!p) return { probe: false };
  _svgWrapApply(svgM, p, hit);
  _svgWrapReshape(svgM, 1.2);
  svgM.updateMatrixWorld(true);
  // radialer Abstand aller Punkte zur ECHTEN Achse messen
  const pos = svgM.geometry.attributes.position, v = new THREE.Vector3();
  let rMin = Infinity, rMax = -Infinity, achsAbw = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(svgM.matrixWorld).sub(c);
    const along = v.dot(a);
    const r = v.clone().addScaledVector(a, -along).length();
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    achsAbw = Math.max(achsAbw, Math.abs(along));
  }
  return { probe: true, R: p.R * 10, rMinMM: rMin * 10, rMaxMM: rMax * 10, achsAbwMM: achsAbw * 10 };
});
ok('Rundung auch bei gekipptem, versetztem Zylinder erkannt', gekippt.probe, gekippt);
ok('Tiefe 1,2 mm entlang der gekippten Achse korrekt',
   gekippt.probe && Math.abs(gekippt.rMinMM - (gekippt.R - 1.2)) < 0.05
                 && Math.abs(gekippt.rMaxMM - (gekippt.R + 0.2)) < 0.05,
   { rMin: gekippt.rMinMM?.toFixed(3), rMax: gekippt.rMaxMM?.toFixed(3), R: gekippt.R?.toFixed(3) });

// ── 7. Nachträglich skaliert: Größe wandert in die Biegung ───────────────
const skaliert = await pg.evaluate(() => {
  const svgM = objects[1];
  // Höhe im lokalen Frame messen (Y = Zylinderachse) — die Welt-BBox eines
  // gekippten Motivs sagt nichts über die Motivhöhe aus.
  const lokalH = () => { svgM.geometry.computeBoundingBox();
                         const g = svgM.geometry.boundingBox; return (g.max.y - g.min.y) * 10; };
  const hV = lokalH() / 10;
  svgM.scale.set(1, 2, 2);          // lokal: Y = Achse (Höhe), Z = Umfang (Breite)
  svgM.updateMatrixWorld(true);
  _svgWrapReshape(svgM, 1.2);
  svgM.updateMatrixWorld(true);
  return { hVor: hV * 10, hNach: lokalH(), scale: svgM.scale.toArray() };
});
ok('Doppelte Höhe wird beim Neu-Biegen übernommen',
   Math.abs(skaliert.hNach - skaliert.hVor * 2) < 0.3 && skaliert.scale.every(v => v === 1), skaliert);

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER: ${fails.join(', ')}` : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
