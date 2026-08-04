// Regressionstest für die Kanten-Selektoren ("Fingerabdruck statt Index").
//
// Drei Fälle, die vorher die gespeicherten Kanten-Operationen zerrissen haben:
//   1. Nachbarkante schon gefast → unsere Kante ist getrimmt, Endpunkte weg
//   2. Körper skaliert → gespeicherte Absolut-Koordinaten zeigen ins Leere
//   3. Zweite Operation → op.idx zeigte nach dem Neuaufbau auf eine FREMDE Kante
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
pg.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

console.log('\n=== 1. Auflösung gegen echte OCCT-Geometrie ===');
const r1 = await pg.evaluate(async () => {
  const oc = await _loadOCCT();
  const sx = 1, sy = 1, sz = 1;             // Box 2×2×2 Szene-Einheiten
  const diag = 2 * Math.hypot(sx, sy, sz);
  const base = _buildOCCTBaseShape(oc, 'box', sx, sy, sz);

  // Kante entlang X bei y=0,z=0 …
  const wantX = _efpFromPts([0, 0, 0], [2, 0, 0]);
  const plain = _efpResolveEdges(oc, base, wantX, diag, 'ungefast');

  // … jetzt eine SENKRECHTE Nachbarkante fasen. Danach ist unsere X-Kante
  // an beiden Enden gekürzt: der exakte Endpunkt-Vergleich findet sie nicht mehr.
  const ch = new oc.BRepFilletAPI_MakeChamfer(base);
  for (const e of _efpResolveEdges(oc, base, _efpFromPts([0, 0, 0], [0, 2, 0]), diag, 'nachbar').edges)
    ch.Add_2(0.4, e);
  ch.Build();
  const cut = ch.Shape();

  const exact = _findAllOCCTEdges(oc, cut, 0, 0, 0, 2, 0, 0, 0.01);            // alter Weg
  const viaFp = _findAllOCCTEdges(oc, cut, 0, 0, 0, 2, 0, 0, 0.01, wantX, diag); // neuer Weg
  const fpGeo = viaFp.length ? _efpOfEdge(oc, viaFp[0]) : null;

  // Falsche Kante darf NICHT gewinnen: Anfrage nach einer Kante, die es nicht gibt
  const nonsense = _efpResolveEdges(oc, cut, _efpFromPts([0, 0.7, 0.9], [2, 0.7, 0.9]), diag, 'unsinn');

  return {
    adaptor: _efpAdaptor,
    plainN: plain.edges.length,
    exactN: exact.length,
    fpN: viaFp.length,
    fpDir: fpGeo && fpGeo.dir.map(v => +v.toFixed(3)),
    fpMid: fpGeo && fpGeo.mid.map(v => +v.toFixed(3)),
    fpLen: fpGeo && +fpGeo.len.toFixed(3),
    nonsenseN: nonsense.edges.length,
    diag: _efpDiag.slice(-4)
  };
});
console.log('   ', JSON.stringify(r1));
ok('BRepAdaptor_Curve-Binding vorhanden (Kreiskanten-Anreicherung)', r1.adaptor === 1, r1.adaptor);
// OCCT besucht jede Kante einmal pro angrenzender Fläche → 2 Treffer für dieselbe
// Kante. Genau das lieferte der exakte Weg vorher auch, das Verhalten bleibt gleich.
ok('ungefaste Box: X-Kante gefunden (2× = beide Flächen)', r1.plainN === 2, r1.plainN);
ok('nach Nachbarfase findet der EXAKTE Weg nichts mehr (der alte Bug)', r1.exactN === 0, r1.exactN);
ok('Fingerabdruck findet die getrimmte Kante', r1.fpN >= 1, r1.fpN);
ok('… und es ist wirklich die X-Kante', r1.fpDir && Math.abs(r1.fpDir[0]) === 1);
ok('… gekürzt (Länge < 2)', r1.fpLen < 2 && r1.fpLen > 1, r1.fpLen);
ok('frei erfundene Kante wird abgelehnt statt geraten', r1.nonsenseN === 0, r1.nonsenseN);

console.log('\n=== 2. Zwei Rundungen nacheinander (Merge über den Index war der Bug) ===');
const r2 = await pg.evaluate(async () => {
  addShape('box');
  const objs = window._getObjects();
  const box = objs[objs.length - 1];
  box.scale.set(2, 1.5, 1);
  box.position.set(0, 1.5, 0);
  box.updateWorldMatrix(true, true);
  window._getSelectedObjs().length = 0;
  window._getSelectedObjs().push(box);
  selectObjs([box]);

  enterEdgeMode(true);
  _edgeSel.clear(); _edgeSel.add(0);
  await _applyEdgeHandleValue(-0.2);            // negativ = Rundung
  let cur = window._getObjects().slice(-1)[0];
  const ops1 = cur.userData._occtParams ? cur.userData._occtParams.ops.length : 0;
  const verts1 = cur.geometry.attributes.position.count;

  selectObjs([cur]);
  enterEdgeMode(true);
  _edgeSel.clear(); _edgeSel.add(5);
  await _applyEdgeHandleValue(-0.2);
  cur = window._getObjects().slice(-1)[0];
  const p = cur.userData._occtParams;
  return { ops1, verts1, ops2: p ? p.ops.length : 0,
           kinds: p ? p.ops.map(o => o.type) : [],
           hatFp: p ? p.ops.every(o => !!o.fp && !!o.dim) : false,
           verts: cur.geometry.attributes.position.count };
});
console.log('   ', JSON.stringify(r2));
ok('erste Rundung gespeichert', r2.ops1 === 1, r2.ops1);
ok('zweite Rundung kommt DAZU (nicht überschrieben)', r2.ops2 === 2, r2.ops2);
ok('beide Operationen tragen Fingerabdruck + Größe', r2.hatFp);
ok('Geometrie ist gerundet (mehr als 24 Box-Vertices)', r2.verts > 24, r2.verts);
ok('die ZWEITE Rundung steckt wirklich in der Geometrie', r2.verts > r2.verts1, [r2.verts1, r2.verts]);

console.log('\n=== 3. Runden → skalieren → nochmal runden ===');
const r3 = await pg.evaluate(async () => {
  window._getObjects().length = 0;
  scene.children.filter(c => c.isMesh && c.userData && c.userData.id != null).forEach(c => scene.remove(c));
  addShape('box');
  let box = window._getObjects().slice(-1)[0];
  box.scale.set(1.5, 1.5, 1.5); box.position.set(0, 1.5, 0);
  box.updateWorldMatrix(true, true);
  selectObjs([box]);

  enterEdgeMode(true);
  _edgeSel.clear(); _edgeSel.add(0);
  await _applyEdgeHandleValue(-0.25);
  let cur = window._getObjects().slice(-1)[0];
  const vorher = cur.userData._occtParams.ops.length;
  const dimVorher = { ...cur.userData._occtParams };

  // Körper in X strecken — genau das macht der Größen-Regler mit _occtParams
  cur.scale.x *= 2;
  cur.updateWorldMatrix(true, true);
  const bb = getMeshBox(cur), s = bb.getSize(new THREE.Vector3());
  cur.userData._occtParams.sx = s.x / 2;
  cur.userData._occtParams.sy = s.y / 2;
  cur.userData._occtParams.sz = s.z / 2;
  cur.userData._occtParams.geoOff = { x: bb.min.x, y: bb.min.y, z: bb.min.z };
  cur.scale.set(1, 1, 1);   // Geometrie wird beim Replay in neuer Größe gebaut

  selectObjs([cur]);
  enterEdgeMode(true);
  _edgeSel.clear(); _edgeSel.add(3);
  await _applyEdgeHandleValue(-0.25);
  cur = window._getObjects().slice(-1)[0];
  const p = cur.userData._occtParams;
  const bb2 = getMeshBox(cur), s2 = bb2.getSize(new THREE.Vector3());
  return { vorher, nachher: p ? p.ops.length : 0,
           dims: p ? p.ops.map(o => +o.dim.sx.toFixed(2)) : [],
           breite: +s2.x.toFixed(2), hoehe: +s2.y.toFixed(2),
           verts: cur.geometry.attributes.position.count,
           diag: _efpDiag.slice(-3) };
});
console.log('   ', JSON.stringify(r3));
ok('erste Rundung vor dem Skalieren da', r3.vorher === 1, r3.vorher);
ok('nach dem Skalieren bleibt sie erhalten und die zweite kommt dazu', r3.nachher === 2, r3.nachher);
ok('Operationen merken sich die Größe, bei der sie entstanden', r3.dims.length === 2 && r3.dims[0] !== r3.dims[1], r3.dims);
ok('gestreckte Box ist doppelt so breit wie hoch', Math.abs(r3.breite / r3.hoehe - 2) < 0.05, [r3.breite, r3.hoehe]);

console.log('\n=== Seitenfehler ===');
const echteFehler = pageErrors.filter(e => !/favicon|firebase|net::ERR|Failed to load resource/i.test(e));
ok('keine JS-Fehler', echteFehler.length === 0, echteFehler.slice(0, 3));

await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLGESCHLAGEN: ' + fails.join(' | ') : '\nAlle Prüfungen bestanden.');
process.exit(fails.length ? 1 : 0);
