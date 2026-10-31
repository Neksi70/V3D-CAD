// Achim 31.10.: Lithophane-Tüte als .v3d gespeichert, beim Öffnen war nur ein Kasten da.
// Ursache: objectToData sicherte das Netz nur für eine feste Typ-Liste. Prüft für alle
// Generator-Typen, die nicht Grundform sind: speichern → öffnen → gleiche Form. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const TYPEN = ['battery','bilderrahmen','conetube','figur','funnel','hingebox','holder','inlay','kuerbis','lampbase','lampshade','litho','planter','saucer','skadis','slotbody','tfigur','vcard','box'];
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof objectToData === 'function', null, { timeout: 30000 });
const r = await pg.evaluate(async (TYPEN) => {
  hideStarter(); objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  TYPEN.forEach((t, i) => {
    // eigene Form (Torusknoten, kein Kasten), wie ein Generator-Ergebnis
    const geo = t === 'box' ? new THREE.BoxGeometry(2, 2, 2) : new THREE.TorusKnotGeometry(1, 0.3, 64, 8);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    m.position.set(i * 4, 1.5, 0);
    m.userData = { id: idCtr++, type: t, shapeType: t === 'box' ? 'box' : 'custom', name: t, color: '#888888', isHole: false };
    scene.add(m); objects.push(m);
  });
  const vorher = objects.map(o => ({ t: o.userData.type, n: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 }));
  const json = _sceneJson();
  _loadSceneFromJSON(json, 'Test'); await new Promise(r => setTimeout(r, 1500));
  const nachher = {}; objects.forEach(o => { nachher[o.userData.name] = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return vorher.map(v => ({ t: v.t, vorher: v.n, nachher: nachher[v.t] }));
}, TYPEN);
let fehler = 0;
for (const x of r) { const ok = x.vorher === x.nachher; if (!ok) fehler++; console.log((ok ? '  OK     ' : '  FEHLER ') + x.t + ': ' + x.vorher + ' → ' + x.nachher + ' Dreiecke'); }
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
