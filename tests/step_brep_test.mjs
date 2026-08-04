// Regressionstest: STEP-Import behält die echte Form (B-Rep).
//
// Vorher endete ein STEP sofort als Dreiecksnetz — einzelne Kanten ließen sich
// daran nicht bearbeiten, der Kanten-Modus bot nur aus dem Netz geratene
// Segmente an, und Runden/Fasen fiel auf „An diesem Teil lassen sich Kanten
// nicht einzeln bearbeiten" zurück.
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK  ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
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

console.log('\n=== 1. Kanten direkt aus der STEP-Datei ===');
const r1 = await pg.evaluate(async () => {
  const oc = await _loadOCCT();
  // Echte Quader-STEP schreiben (40 × 20 × 10 mm) — kein vernähtes Netz,
  // sondern eine saubere B-Rep mit 12 Kanten und 6 Flächen.
  const bm = new oc.BRepPrimAPI_MakeBox_1(40, 20, 10);
  const shape = bm.Shape();
  const w = new oc.STEPControl_Writer_1();
  w.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  w.Write('/t.step');
  w.delete();
  const bytes = oc.FS.readFile('/t.step');
  try { oc.FS.unlink('/t.step'); } catch (e) {}
  window.__stepBytes = bytes;
  const r = _brepEdgesOf(oc, bytes);
  const gerade = r.edges.filter(e => !e.circle);
  return { n: r.edges.length, gesamt: r.gesamt, bytes: bytes.length,
           laengen: [...new Set(gerade.map(e => +e.len.toFixed(2)))].sort((a, c) => a - c) };
});
console.log('   ', JSON.stringify(r1));
ok('Quader liefert genau 12 Kanten (Doppelbesuche entfernt)', r1.n === 12, r1.n);
ok('Kantenlängen sind 10/20/40 mm', JSON.stringify(r1.laengen) === '[10,20,40]', r1.laengen);

console.log('\n=== 2. Import behält die echte Form ===');
const r2 = await pg.evaluate(async () => {
  const stl = await _stepImportLocal(window.__stepBytes.buffer);
  _addImportedStl(stl, 'pruefquader.stl', false, window.__stepBytes);
  const o = window._getObjects().slice(-1)[0];
  for (let i = 0; i < 100 && !o.userData._brepEdges; i++) await new Promise(r => setTimeout(r, 100));
  const bb = getMeshBox(o), s = bb.getSize(new THREE.Vector3());
  return { typ: o.userData.shapeType, hatStep: !!o.userData._brepStep,
           kanten: o.userData._brepEdges ? o.userData._brepEdges.length : 0,
           masse: [s.x, s.y, s.z].map(v => +(v * 10).toFixed(1)).sort((a, c) => a - c) };
});
console.log('   ', JSON.stringify(r2));
ok('Import trägt die STEP-Bytes', r2.hatStep);
ok('12 echte Kanten am importierten Teil', r2.kanten === 12, r2.kanten);
ok('Maße stimmen (10 × 20 × 40 mm)', JSON.stringify(r2.masse) === '[10,20,40]', r2.masse);

console.log('\n=== 3. Kanten-Modus zeigt die echten Kanten ===');
const r3 = await pg.evaluate(() => {
  const o = window._getObjects().slice(-1)[0];
  selectObjs([o]);
  enterEdgeMode(true);
  const dyn = o.userData._dynamicEdges || [];
  const bb = getMeshBox(o);
  // Alle Kanten-Endpunkte müssen auf der Hülle des Teils liegen
  let drin = 0;
  const eps = 1e-3;
  for (const e of dyn) for (const p of [e.worldA, e.worldB])
    if (p[0] >= bb.min.x-eps && p[0] <= bb.max.x+eps && p[1] >= bb.min.y-eps &&
        p[1] <= bb.max.y+eps && p[2] >= bb.min.z-eps && p[2] <= bb.max.z+eps) drin++;
  const ausBrep = dyn.every(e => e.brep);
  return { n: dyn.length, drin, soll: dyn.length * 2, ausBrep };
});
console.log('   ', JSON.stringify(r3));
ok('12 wählbare Kanten', r3.n === 12, r3.n);
ok('alle Endpunkte liegen am Teil (Welttransformation stimmt)', r3.drin === r3.soll, [r3.drin, r3.soll]);
ok('Kanten stammen aus der B-Rep, nicht aus dem Netz', r3.ausBrep);

console.log('\n=== 4. Einzelne Kante runden — das ging vorher gar nicht ===');
const r4 = await pg.evaluate(async () => {
  let o = window._getObjects().slice(-1)[0];
  const vorher = o.geometry.attributes.position.count;
  _edgeSel.clear(); _edgeSel.add(0);
  await _applyEdgeHandleValue(-0.15);           // negativ = Rundung, 1,5 mm
  o = window._getObjects().slice(-1)[0];
  const p = o.userData._occtParams;
  const bb = getMeshBox(o), s = bb.getSize(new THREE.Vector3());
  return { occtShape: o.userData.occtShape, ops: p ? p.ops.length : 0,
           hatFp: p ? p.ops.every(op => !!op.fp) : false,
           vorher, nachher: o.geometry.attributes.position.count,
           kantenNeu: o.userData._brepEdges ? o.userData._brepEdges.length : 0,
           masse: [s.x, s.y, s.z].map(v => +(v * 10).toFixed(1)).sort((a, c) => a - c) };
});
console.log('   ', JSON.stringify(r4));
ok('läuft über den B-Rep-Weg', r4.occtShape === 'brep', r4.occtShape);
ok('eine Operation gespeichert, mit Fingerabdruck', r4.ops === 1 && r4.hatFp, [r4.ops, r4.hatFp]);
ok('Geometrie hat sich verändert (Rundung ist drin)', r4.nachher !== r4.vorher, [r4.vorher, r4.nachher]);
ok('Außenmaße bleiben 10 × 20 × 40 mm', JSON.stringify(r4.masse) === '[10,20,40]', r4.masse);
ok('Kantenliste ist nachgezogen (Rundung erzeugt neue Kanten)', r4.kantenNeu > 12, r4.kantenNeu);

console.log('\n=== 5. Zweite Kante — Fingerabdruck trägt über den Neuaufbau ===');
const r5 = await pg.evaluate(async () => {
  let o = window._getObjects().slice(-1)[0];
  selectObjs([o]);
  enterEdgeMode(true);
  const dyn = o.userData._dynamicEdges || [];
  // Eine WIRKLICH andere Kante wählen: die längste ist nach dem Runden eine
  // Kante der Rundungsfläche — die zeigt auf dieselbe Grundkante zurück (s. 5b).
  // Also die am weitesten entfernte lange Kante nehmen.
  const op0 = o.userData._occtParams.ops[0], off = o.userData._occtParams.geoOff;
  const m0 = [op0.fp.mid[0]+off.x, op0.fp.mid[1]+off.y, op0.fp.mid[2]+off.z];
  let pick = -1, best = -1;
  dyn.forEach((e, i) => {
    const L = Math.hypot(e.worldA[0]-e.worldB[0], e.worldA[1]-e.worldB[1], e.worldA[2]-e.worldB[2]);
    if (L < 0.5) return;
    const mx = (e.worldA[0]+e.worldB[0])/2, my = (e.worldA[1]+e.worldB[1])/2, mz = (e.worldA[2]+e.worldB[2])/2;
    const d = Math.hypot(mx-m0[0], my-m0[1], mz-m0[2]);
    if (d > best) { best = d; pick = i; }
  });
  _edgeSel.clear(); _edgeSel.add(pick);
  await _applyEdgeHandleValue(-0.15);
  o = window._getObjects().slice(-1)[0];
  const p = o.userData._occtParams;
  const bb = getMeshBox(o), s = bb.getSize(new THREE.Vector3());
  return { ops: p ? p.ops.length : 0, pick,
           verts: o.geometry.attributes.position.count,
           kanten: o.userData._brepEdges ? o.userData._brepEdges.length : 0,
           masse: [s.x, s.y, s.z].map(v => +(v * 10).toFixed(1)).sort((a, c) => a - c),
           kosten: _efpDiag.slice(-3) };
});
console.log('   ', JSON.stringify(r5));
ok('zweite Rundung kommt dazu (erste bleibt erhalten)', r5.ops === 2, r5.ops);
ok('Teil ist noch heil (Maße unverändert)', JSON.stringify(r5.masse) === '[10,20,40]', r5.masse);
ok('zweite Rundung ist wirklich in der Geometrie', r5.verts > r4.nachher, [r4.nachher, r5.verts]);
ok('Kantenliste weiter gewachsen', r5.kanten > r4.kantenNeu, [r4.kantenNeu, r5.kanten]);

console.log('\n=== 5b. Dieselbe Kante nochmal anfassen = ändern, nicht verdoppeln ===');
const r5b = await pg.evaluate(async () => {
  let o = window._getObjects().slice(-1)[0];
  const opsVor = o.userData._occtParams.ops.length;
  selectObjs([o]);
  enterEdgeMode(true);
  // Genau die Kante nehmen, auf der schon eine Rundung liegt: ihre gespeicherte
  // Referenz zeigt nach dem Kanonisieren auf die tatsächlich getroffene Kante.
  const op0 = o.userData._occtParams.ops[0];
  const off = o.userData._occtParams.geoOff;
  const w = p => [p[0]+off.x, p[1]+off.y, p[2]+off.z];
  o.userData._dynamicEdges.push({ worldA: w(op0.fp.a), worldB: w(op0.fp.b), brep: true });
  _edgeSel.clear(); _edgeSel.add(o.userData._dynamicEdges.length - 1);
  await _applyEdgeHandleValue(-0.3);          // dieselbe Kante, größerer Radius
  o = window._getObjects().slice(-1)[0];
  const ops = o.userData._occtParams.ops;
  return { vor: opsVor, nach: ops.length, radien: ops.map(x => +x.dist.toFixed(3)) };
});
console.log('   ', JSON.stringify(r5b));
ok('Anzahl der Operationen bleibt gleich (ersetzt statt verdoppelt)', r5b.nach === r5b.vor, [r5b.vor, r5b.nach]);
ok('der neue Radius ist übernommen', r5b.radien.includes(0.3), r5b.radien);

console.log('\n=== 6. Import OHNE STEP bleibt wie bisher ===');
const r6 = await pg.evaluate(async () => {
  const oc = await _loadOCCT();
  const bm = new oc.BRepPrimAPI_MakeBox_1(30, 30, 30);
  const geo = _occtShapeToThreeGeo(oc, bm.Shape(), { x: 0, y: 0, z: 0 }, 0.2);
  const stl = _geoToBinaryStl(geo);
  _addImportedStl(stl, 'ohne_step.stl', false);           // kein 4. Argument
  const o = window._getObjects().slice(-1)[0];
  selectObjs([o]);
  enterEdgeMode(true);
  return { hatStep: !!o.userData._brepStep, hatBrepKanten: !!o.userData._brepEdges,
           kanten: (o.userData._dynamicEdges || []).length };
});
console.log('   ', JSON.stringify(r6));
ok('reiner STL-Import trägt keine B-Rep', !r6.hatStep && !r6.hatBrepKanten);
ok('… bekommt aber weiterhin Kanten aus dem Netz', r6.kanten > 0, r6.kanten);

console.log('\n=== 7. Wird das Netz anderswo umgebaut, verfällt die B-Rep ===');
const r7 = await pg.evaluate(async () => {
  const stl = await _stepImportLocal(window.__stepBytes.buffer);
  _addImportedStl(stl, 'verfall.stl', false, window.__stepBytes);
  const o = window._getObjects().slice(-1)[0];
  for (let i = 0; i < 100 && !o.userData._brepEdges; i++) await new Promise(r => setTimeout(r, 100));
  const vorher = _brepOk(o);
  // Geometrie austauschen, ohne dass die B-Rep-Logik davon weiß (so verhalten
  // sich Radierer, Modellieren und die Bool-Operationen)
  o.geometry = new THREE.BoxGeometry(1, 1, 1);
  const nachher = _brepOk(o);
  selectObjs([o]);
  enterEdgeMode(true);
  const kanten = (o.userData._dynamicEdges || []).length;
  exitEdgeMode();
  return { vorher, nachher, wegGeraeumt: !o.userData._brepStep && !o.userData._brep, kanten };
});
console.log('   ', JSON.stringify(r7));
ok('vor dem Umbau ist die B-Rep gültig', r7.vorher);
ok('nach dem Geometrie-Tausch nicht mehr', !r7.nachher);
ok('… und die Reste sind aufgeräumt', r7.wegGeraeumt);
ok('Kanten-Modus fällt sauber auf das Netz zurück', r7.kanten > 0, r7.kanten);

const echteFehler = pageErrors.filter(e => !/favicon|firebase|net::ERR|Failed to load resource/i.test(e));
ok('keine JS-Fehler', echteFehler.length === 0, echteFehler.slice(0, 3));

await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLGESCHLAGEN: ' + fails.join(' | ') : '\nAlle Prüfungen bestanden.');
process.exit(fails.length ? 1 : 0);
