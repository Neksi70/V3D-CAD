// Josy 4.10.26 (Foto): Häuserreihe als Linienzeichnung um ihre Lichthülle gewickelt,
// Vereinen → „Zu aufwendig: 94.380 Dreiecke in 2 Teilen … gruppiert“ — trotz
// Manifold-zuerst (v1.18.115). Die Meldung kommt nur noch, wenn Manifold scheitert.
// Prüft mit ihrer echten Lichthülle (Upload 13.9., Pfad unten) und
// einer nachgebauten Linien-Häuserreihe: Vereinen ergibt EINEN Körper, ohne Server.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const STL = process.env.STL || '/home/v3da/.claude/uploads/f8eb40d3-9ec8-57cf-ae15-dbcc2feb1f1e/33b492de-lichth_lle_uni.stl';
// Linienzeichnung: Häuser als Umriss-Streifen (0,8 breit), Fenster als eigene Umrisse,
// die die Hauswand berühren/überlappen — wie aus Illustrator mit „Kontur umwandeln“
const rahmen = (x, y, w, h, s = 0.8) =>
  `<path fill-rule="evenodd" d="M${x},${y} h${w} v${h} h${-w} Z M${x+s},${y+s} v${h-2*s} h${w-2*s} v${-(h-2*s)} Z"/>`;
let paths = '';
for (let i = 0; i < 7; i++) {
  const x = 4 + i * 22, h = 30 + (i % 3) * 8, y = 60 - h;
  paths += rahmen(x, y, 18, h);
  paths += `<path d="M${x},${y} L${x+9},${y-9} L${x+18},${y} L${x+17},${y} L${x+9},${y-7.8} L${x+1},${y} Z"/>`;   // Giebel-Linie
  for (let r = 0; r < Math.floor(h / 10); r++) for (let c = 0; c < 3; c++)
    paths += rahmen(x + 2 + c * 5.4, y + 3 + r * 9, 3.6, 5, 0.5);
  paths += rahmen(x + 7, 50, 4, 10, 0.6);                                                           // Tür steht auf der Grundlinie
}
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -12 160 74">${paths}</svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [], warn = [];
pg.on('pageerror', e => errs.push(String(e)));
pg.on('console', m => { if (/union|mf|Manifold/i.test(m.text())) warn.push(m.text().slice(0, 300)); });
let occt = 0; await pg.route('**/api/occt-union', r => { occt++; r.abort(); });
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden');
  window._toasts = []; const n0 = window.notify; window.notify = function (m) { window._toasts.push(String(m)); return n0.apply(this, arguments); }; });
const stl = [...fs.readFileSync(STL)];
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const r = await pg.evaluate(async ([bytes, svgText, depth]) => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 2, targetMM: 100, name: 'Häuser' });
  const buf = new Uint8Array(bytes).buffer;
  _addImportedGeo(parseSTL(buf), 'lichthuelle.stl', true, buf, false);
  const k = objects.find(o => o !== m && o.isMesh);
  k.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(k), C = bb.getCenter(new THREE.Vector3());
  // Treffer auf der Außenwand in 35 % Höhe, Richtung +Z
  const y = bb.min.y + (bb.max.y - bb.min.y) * 0.35;
  raycaster.set(new THREE.Vector3(C.x, y, bb.max.z + 5), new THREE.Vector3(0, 0, -1));
  const hit = raycaster.intersectObject(k)[0];
  const p = _svgWrapProbe(k, hit.point, { normalW: hit.face.normal.clone().transformDirection(k.matrixWorld) });
  if (!p) return { gewickelt: false };
  _svgWrapApply(m, p, hit.point);
  if (depth != null) { m.userData.svgDepth = depth; }
  const tris = o => { const g = o.geometry; return (g.index ? g.index.count : g.attributes.position.count) / 3; };
  const n = [tris(k), tris(m)];
  // Einzeln prüfen: nimmt Manifold die Teile an?
  const w = await _mfInit(); const einzeln = {};
  for (const [name, o] of [['Huelle', k], ['Motiv', m]]) {
    try { _mfFromSoup(w, _moldCollectTris(o)); einzeln[name] = 'ok'; }
    catch (e) { const g = _healTrisForBool(_moldCollectTris(o)); let geheilt = 'nein';
      if (g) { try { _mfFromSoup(w, g); geheilt = 'ja'; } catch (e2) { geheilt = 'scheitert: ' + (e2.message || e2); } }
      einzeln[name] = 'roh: ' + String(e.message || e).slice(0, 80) + ' | geheilt: ' + geheilt; }
  }
  window._toasts.length = 0;
  selectObjs([k, m]);
  await unionSelected();
  const res = objects.filter(o => o.visible !== false);
  return { gewickelt: true, n, einzeln, teile: res.length, namen: res.map(o => o.userData.name), toasts: window._toasts.slice() };
}, [stl, SVG, null]);
console.log(JSON.stringify(r, null, 1)); console.log(warn.join('\n'));
ok('gewickelt', r.gewickelt);
ok('Vereinen: ein verschmolzener Körper', r.teile === 1 && /^Verschmolzen/.test(r.namen[0]), r.toasts);
ok('kein Server nötig', occt === 0, occt);
ok('keine JS-Fehler', errs.length === 0, errs);
await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER`); process.exit(1); }
console.log('\nAlles grün.');
