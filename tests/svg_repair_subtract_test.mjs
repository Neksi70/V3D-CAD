// Josy 13.9.26: "Reparieren" geht nur am Volumenkoerper, und danach scheitert das
// Abziehen trotzdem mit "kein gueltiges Werkzeug".
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20,20 H80 V80 H20 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// Motiv als BOHRUNG mit kaputtem Netz: ein Dreieck fehlt (Loch) + entartete Dreiecke
const vorher = await pg.evaluate(async (svgText) => {
  addShape('box'); const box = objects[objects.length - 1];
  box.scale.set(3, 3, 3); box.position.set(0, 3, 0); box.userData.name = 'Körper';
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 4, targetMM: 30, name: 'Motiv' });
  box.position.set(0, 3, 0); m.position.set(0, 3, 2.6);
  m.userData.isHole = true; m.material.transparent = true; m.material.opacity = .5;
  objects.forEach(o => o.updateMatrixWorld(true));
  // Netz mutwillig beschaedigen
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
  const pos = g.attributes.position;
  const arr = [];
  for (let t = 0; t < pos.count; t += 3) {
    if (t === 3) continue;                       // ein Dreieck weglassen → Loch
    for (let k = 0; k < 3; k++) arr.push(pos.getX(t+k), pos.getY(t+k), pos.getZ(t+k));
  }
  arr.push(0,0,0, 0,0,0, 0,0,0);                 // entartetes Dreieck
  const neu = new THREE.BufferGeometry();
  neu.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  neu.computeVertexNormals();
  m.geometry.dispose(); m.geometry = neu; m.updateMatrixWorld(true);
  const w = await _mfInit();
  let werkzeug = 'ok';
  try { _mfFromSoup(w, _moldCollectTris(m)); } catch (e) { werkzeug = String(e.message || e).slice(0, 60); }
  return { werkzeug, isHole: m.userData.isHole };
}, SVG);
console.log('kaputtes Motiv:', JSON.stringify(vorher));
ok('Ausgangslage: Netz ist für den Boolean unbrauchbar', vorher.werkzeug !== 'ok', vorher);

// A) Reparieren direkt an der BOHRUNG (vorher musste man erst umschalten)
const rep = await pg.evaluate(async () => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  selectObjs([m]);
  const meldungen = [];
  const orig = window.notify;
  window.notify = (t, k) => { meldungen.push(t); return orig(t, k); };
  await repairSelected();
  window.notify = orig;
  const w = await _mfInit();
  let werkzeug = 'ok';
  try { _mfFromSoup(w, _moldCollectTris(m)); } catch (e) { werkzeug = String(e.message || e).slice(0, 60); }
  return { meldungen, werkzeug, immerNochBohrung: !!m.userData.isHole };
});
console.log('nach Reparieren:', JSON.stringify(rep));
ok('Reparieren wirkt auch an einer Bohrung', rep.werkzeug === 'ok', rep);
ok('bleibt dabei eine Bohrung', rep.immerNochBohrung);
ok('meldet klar, dass es jetzt abzieh-bereit ist',
   rep.meldungen.some(t => /bereit/i.test(t)), rep.meldungen);

// B) Zweites Motiv, das NICHT von Hand repariert wurde: der Abzug muss es selbst
//    heilen, statt "kein gültiges Werkzeug" zu melden.
const abzug = await pg.evaluate(async (svgText) => {
  const box = objects.find(o => o.userData.name === 'Körper');
  const m2 = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 4, targetMM: 20, name: 'Kaputt' });
  box.position.set(0, 3, 0); m2.position.set(0, 3, 2.6); m2.userData.isHole = true;
  objects.forEach(o => o.updateMatrixWorld(true));
  // beschaedigen: entartete Dreiecke + fehlendes Dreieck
  const g = m2.geometry.index ? m2.geometry.toNonIndexed() : m2.geometry;
  const pos = g.attributes.position, arr = [];
  for (let t = 0; t < pos.count; t += 3) {
    if (t === 6) continue;
    for (let k = 0; k < 3; k++) arr.push(pos.getX(t+k), pos.getY(t+k), pos.getZ(t+k));
  }
  arr.push(1,1,1, 1,1,1, 1,1,1);
  const neu = new THREE.BufferGeometry();
  neu.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  neu.computeVertexNormals();
  m2.geometry.dispose(); m2.geometry = neu; m2.updateMatrixWorld(true);

  const w = await _mfInit();
  let roh = 'ok';
  try { _mfFromSoup(w, _moldCollectTris(m2)); } catch (e) { roh = String(e.message || e).slice(0, 50); }

  const meldungen = [];
  const orig = window.notify; window.notify = (t, k) => { meldungen.push(t); return orig(t, k); };
  let ergebnis = null, fehler = null;
  try { ergebnis = await _mfSubtractWorld([box], [m2]); }
  catch (e) { fehler = String(e.message || e).slice(0, 80); }
  window.notify = orig;
  return { roh, hatErgebnis: !!ergebnis, fehler, meldungen };
}, SVG);
console.log('Abzug mit kaputtem Motiv:', JSON.stringify(abzug));
ok('Ausgangslage: zweites Motiv ist roh unbrauchbar', abzug.roh !== 'ok', { roh: abzug.roh });
ok('Abziehen heilt das Motiv selbst statt abzubrechen', abzug.hatErgebnis, { fehler: abzug.fehler });
ok('und sagt es dazu', abzug.meldungen.some(t => /repariert/i.test(t)), abzug.meldungen);

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
