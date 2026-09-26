// Mehrere Druckplatten (Wunsch Ralf 26.9.26: „Gibt es eigentlich die Funktion 2
// oder mehrere Platten erstellen?"). Prüft: Anlegen, Zugehörigkeit per Lage,
// Füllen auf Platte 2, Export zurück auf Plattenmitte, Speichern/Laden,
// Entfernen nur leerer Platten, Größenwechsel, Neue Szene.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof plateAdd === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });

const r = await pg.evaluate(async () => {
  const out = {};
  buildplateW = 256; buildplateH = 256; buildGrid();
  _newCreate(false);
  out.leisteStart = document.querySelectorAll('#plate-bar .pb-btn').length;   // Platte 1 + ＋
  addShape('cube');
  const a = getFirst(); a.scale.set(1.5, 0.5, 1.5); a.position.set(0, 0.5, 0); a.updateMatrixWorld(true);
  plateAdd();
  out.count = plateCount;
  out.plate2Mesh = !!_plateMesh(1);
  out.leiste = [...document.querySelectorAll('#plate-bar .pb-btn')].map(x => x.textContent.trim());
  // Teil auf Platte 2 schieben
  const P = _platePitchU();
  a.position.x = P + 3; a.updateMatrixWorld(true);
  out.plateOf = _plateOf(a);
  // Export (STL) der Platte 2: zurück auf Plattenmitte
  selectObjs([a]);
  _expShiftX = _plateShiftOf([a]);
  const stl = _buildStlBlob([a]); _expShiftX = 0;
  const dv = new DataView(await stl.blob.arrayBuffer());
  let minX = 1e9, maxX = -1e9;
  for (let t = 0, n = dv.getUint32(80, true); t < n; t++) for (let v = 0; v < 3; v++) {
    const x = dv.getFloat32(84 + t * 50 + 12 + v * 12, true); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  out.stlX = [+minX.toFixed(2), +maxX.toFixed(2)];
  // Slicer-Quelle = aktive Platte der Auswahl
  addShape('cube'); const c = getFirst(); c.position.set(0, 1, 0); c.updateMatrixWorld(true);
  selectObjs([a]); out.slicerSrc = _slicerSrc().length;
  // Füllen auf Platte 2
  selectObjs([a]);
  fillPlateTool();
  out.fillTitle = document.getElementById('pat-title').textContent;
  document.getElementById('pat-fill-gap').value = 3; document.getElementById('pat-fill-margin').value = 5;
  _applyPat();
  const x0 = P - 12.8, x1 = P + 12.8;
  const on2 = objects.filter(o => o !== c);
  out.fillN = on2.length;
  out.fillInside = on2.every(o => { const bb = getMeshBox(o); return bb.min.x >= x0 - 1e-3 && bb.max.x <= x1 + 1e-3 && bb.min.z >= -12.8 - 1e-3 && bb.max.z <= 12.8 + 1e-3; });
  out.c_unberuehrt = Math.abs(c.position.x) < 1e-6;
  // Speichern / Laden
  const snap = JSON.parse(JSON.stringify(_sceneSnapshot()));
  out.snapPlates = snap.plates;
  _newCreate(false);
  out.nachNeu = plateCount;
  _applySnapshot(snap);
  out.nachLaden = { plates: plateCount, n: objects.length, auf2: _plateObjs(1).length };
  // Entfernen: nicht-leere Platte bleibt
  plateRemove(1); out.nichtLeerBleibt = plateCount === 2;
  // Platte 3 anlegen, Teil drauf, leere Platte 2 wegräumen → Teil rückt nach
  _plateObjs(1).forEach(o => scene.remove(o)); objects = objects.filter(o => _plateOf(o) !== 1);
  plateAdd();
  addShape('cube'); const d = getFirst(); d.position.set(2 * P, 1, 0); d.updateMatrixWorld(true);
  out.dVorher = _plateOf(d);
  plateRemove(1);
  out.nachEntfernen = { plates: plateCount, dPlatte: _plateOf(d), dX: +(d.position.x - P).toFixed(4) };
  // Plattengröße ändern: Teil bleibt auf seiner Platte
  buildplateW = 350; buildplateH = 320; buildGrid();
  out.nachGroesse = _plateOf(d);
  const bb = getMeshBox(d), P2 = _platePitchU();
  out.nachGroesseInnen = bb.min.x >= P2 - 17.5 && bb.max.x <= P2 + 17.5;
  buildplateW = 256; buildplateH = 256; buildGrid();
  return out;
});
ok('Start: Leiste zeigt Platte 1 + „＋ Platte"', r.leisteStart === 2, r.leisteStart);
ok('＋ Platte legt Platte 2 an', r.count === 2 && r.plate2Mesh, r);
ok('Leiste zeigt beide Platten + Knöpfe', r.leiste.includes('▭ Platte 2') && r.leiste.some(t => /je Platte/.test(t)), r.leiste);
ok('Teil rechts drüben gehört zu Platte 2', r.plateOf === 1);
// Teil 30 mm breit, 30 mm rechts der Plattenmitte → im STL x = 15 … 45 mm
ok('STL von Platte 2 liegt relativ zur Plattenmitte', Math.abs(r.stlX[0] - 15) < 0.05 && Math.abs(r.stlX[1] - 45) < 0.05, r.stlX);
ok('Slicer bekommt nur die Platte der Auswahl', r.slicerSrc === 1, r.slicerSrc);
ok('Füllen-Titel nennt Platte 2', /Platte 2/.test(r.fillTitle), r.fillTitle);
ok('Füllen legt mehrere Kopien auf Platte 2', r.fillN >= 25, r.fillN);
ok('alle Kopien liegen auf Platte 2', r.fillInside);
ok('Teil auf Platte 1 bleibt unberührt', r.c_unberuehrt);
ok('Plattenzahl wird gespeichert', r.snapPlates === 2);
ok('Neue Szene = wieder 1 Platte', r.nachNeu === 1);
ok('Laden stellt Platten + Teile wieder her', r.nachLaden.plates === 2 && r.nachLaden.auf2 === r.fillN, r.nachLaden);
ok('Nicht-leere Platte lässt sich nicht löschen', r.nichtLeerBleibt);
ok('Leere Platte löschen: rechte Platte rückt samt Teil nach', r.dVorher === 2 && r.nachEntfernen.plates === 2 && r.nachEntfernen.dPlatte === 1 && Math.abs(r.nachEntfernen.dX) < 1e-3, r.nachEntfernen);
ok('Plattengröße ändern: Teil bleibt auf seiner Platte', r.nachGroesse === 1 && r.nachGroesseInnen, r);
ok('Keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
if (fails.length) { console.log('\nFEHLGESCHLAGEN: ' + fails.length); process.exit(1); }
console.log('\nAlle Prüfungen bestanden.');
