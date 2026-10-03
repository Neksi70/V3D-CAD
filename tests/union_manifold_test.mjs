// Josy 3.10.26: „vorher vereinfacht, vereint dann aber trotzdem nicht“.
// Vereinen ohne gewickeltes Motiv ging an OCCT und wurde ab ~40.000 Dreiecken nur
// gruppiert (Schätzung 1 ms/Dreieck > 40 s) — auch nach dem Vereinfachen, und für
// Tester ohne erreichbaren Server ohnehin immer. Jetzt rechnet Manifold zuerst.
// Prüft: feines Netz (texturierter Zylinder + Kugel) wird OHNE Server zu EINEM
// wasserdichten Körper, auch nach „Vereinfachen“; einfache Körper ebenso.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
let occtAufrufe = 0;
await pg.route('**/api/occt-union', r => { occtAufrufe++; r.abort(); });   // Server „nicht erreichbar“
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const lauf = (fein, vereinfachen) => pg.evaluate(async ([fein, vereinfachen]) => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  addShape('cylinder'); const z = objects[objects.length - 1];
  addShape('sphere');   const k = objects[objects.length - 1];
  z.position.set(0, 1, 0); k.position.set(0, 2.2, 0); z.updateMatrixWorld(true); k.updateMatrixWorld(true);
  if (fein) { selectObjs([z]); _applyDisplacementNow('pattern', 'rauschen'); _applyDisplacementNow('freq', 12); }
  const tris = o => { const g = o.geometry; return (g.index ? g.index.count : g.attributes.position.count) / 3; };
  const vorher = tris(z) + tris(k);
  if (vereinfachen) {
    selectObjs([z, k]); openSimplifyModal();
    document.getElementById('simplify-pct').value = 50; _applySimplify();
    await new Promise(r => setTimeout(r, 1500)); _closeSimplify?.();
  }
  const nachVereinfachen = tris(z) + tris(k);
  selectObjs([z, k]);
  await unionSelected();
  const res = objects.filter(o => o.visible !== false);
  const m = res.length === 1 && res[0].isMesh ? res[0] : null;
  let offen = -1;
  if (m) {
    // wasserdicht: Manifold nimmt das Ergebnis ohne Reparatur wieder an
    try { const w = await _mfInit(); const mf = _mfFromSoup(w, _moldCollectTris(m)); offen = mf.isEmpty() ? -2 : 0; }
    catch (e) { offen = String(e.message || e).slice(0, 80); }
  }
  return { vorher, nachVereinfachen, teile: res.length, typ: res.map(o => o.userData.name), offen };
}, [fein, vereinfachen]);
for (const [fein, vereinf, name] of [[false, false, 'Zylinder + Kugel'], [true, false, 'texturierter Zylinder + Kugel'], [true, true, 'texturiert, vorher vereinfacht']]) {
  const r = await lauf(fein, vereinf);
  ok(`${name}: ein verschmolzener Körper statt Gruppe`, r.teile === 1 && /^Verschmolzen/.test(r.typ[0]), r);
  ok(`${name}: wasserdicht`, r.offen === 0, r.offen);
  if (fein) ok(`${name}: wirklich feines Netz (> 40.000 Dreiecke, alter OCCT-Weg hätte nur gruppiert)`, r.nachVereinfachen > 40000, r.nachVereinfachen);
}
ok('Server nicht gebraucht', occtAufrufe === 0, occtAufrufe);
ok('keine JS-Fehler', errs.length === 0, errs);
await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER`); process.exit(1); }
console.log('\nAlles grün.');
