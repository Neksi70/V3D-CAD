// Regressionstest ⊕ Auf Fläche setzen (_afs*/_ebeneRegion): Box (Bohrung) per echtem Klick mittig auf die
// schräge Oberseite eines STL-Imports setzen, an den Kanten ausgerichtet, bündig versenkt; Aufsetzen/Tiefe/↻;
// „Gleich abziehen“ ergibt die Tasche (Volumen).
// Start: python3 volme3d_server.py 8877 --dev  →  node tests/auf_flaeche_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8877/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _afsStart === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); localStorage.setItem('v3d_umsteiger_hinweis', '1'); document.getElementById('umsteiger-hinweis')?.remove(); });
await pg.evaluate(async () => { await _mfInit(); });

// Platte 60×40×10 mm, um Z 25° gedreht und um X 15° gekippt, als STL importiert; Box 10×6×4 mm als Bohrung
const pre = await pg.evaluate(() => {
  _newCreate(false);
  const g = new THREE.BoxGeometry(60, 40, 10).toNonIndexed();
  g.rotateZ(25 * Math.PI / 180); g.rotateX(15 * Math.PI / 180); g.translate(0, 0, 30);
  _addImportedStl(_geoToBinaryStl(g), 'platte.stl', false);
  const platte = objects[0];
  addShape('box'); const box = objects[1];
  // Box auf 10×6×4 mm (Szene: x=Breite, y=Höhe, z=Tiefe)
  box.scale.set(1, 1, 1); box.updateMatrixWorld(true);
  const s = getMeshBox(box).getSize(new THREE.Vector3());
  box.scale.set(1.0 / s.x, 0.4 / s.y, 0.6 / s.z); box.position.set(5, 0.2, 5); box.updateMatrixWorld(true);
  selectObjs([box]); setObjMode('hole');
  // Oberseite der Platte: Normale + Mitte in Welt (Szene) berechnen
  platte.updateMatrixWorld(true);
  const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), 15 * Math.PI / 180);   // mm Z-up
  const toScene = v => new THREE.Vector3(v.x, v.z, -v.y);
  const cMm = new THREE.Vector3(0, 0, 5).applyAxisAngle(new THREE.Vector3(1, 0, 0), 15 * Math.PI / 180).add(new THREE.Vector3(0, 0, 30));
  const bbP = getMeshBox(platte); const yOff = bbP.min.y;   // Import wurde auf die Platte gesetzt (y verschoben)
  return { nS: toScene(n).toArray(), cS: toScene(cMm.clone().multiplyScalar(0.1)).toArray(), platteId: platte.userData.id, volVor: null };
});
// Mitte der Oberseite in der Szene: die Platte wurde beim Import zentriert/abgesetzt → aus Netz bestimmen
const ziel = await pg.evaluate(() => {
  const p = objects[0]; const t = _moldCollectTris(p);   // mm Z-up
  const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), 15 * Math.PI / 180);
  let best = -1e9; for (let i = 0; i < t.length; i += 3) best = Math.max(best, t[i] * n.x + t[i+1] * n.y + t[i+2] * n.z);
  const top = []; for (let i = 0; i < t.length; i += 3) if (Math.abs(t[i] * n.x + t[i+1] * n.y + t[i+2] * n.z - best) < 1e-3) top.push([t[i], t[i+1], t[i+2]]);
  const c = top.reduce((a, q) => a.add(new THREE.Vector3(...q)), new THREE.Vector3()).divideScalar(top.length);
  const cs = new THREE.Vector3(c.x / 10, c.z / 10, -c.y / 10);
  fitToObjects(objects);
  _afsStart();
  const sc = _worldToScreen(cs.x, cs.y, cs.z);
  const r = renderer.domElement.getBoundingClientRect();
  return { cMm: c.toArray(), nMm: n.toArray(), d: best, sx: sc.x + vpEl.getBoundingClientRect().left, sy: sc.y + vpEl.getBoundingClientRect().top };
});
await pg.mouse.click(ziel.sx + 20, ziel.sy + 15);   // nicht genau die Mitte – das Ergebnis muss trotzdem mittig sein
await pg.waitForSelector('#afs-modal.show', { timeout: 5000 });
const mess = () => pg.evaluate(({ nMm, cMm, d }) => {
  const box = objects[1]; const t = _moldCollectTris(box);
  const n = new THREE.Vector3(...nMm); let mx = -1e9, mn = 1e9; const c = new THREE.Vector3(); let k = 0;
  for (let i = 0; i < t.length; i += 3) { const s = t[i] * n.x + t[i+1] * n.y + t[i+2] * n.z; mx = Math.max(mx, s); mn = Math.min(mn, s); c.add(new THREE.Vector3(t[i], t[i+1], t[i+2])); k++; }
  c.divideScalar(k);
  const off = c.clone().sub(new THREE.Vector3(...cMm)); off.addScaledVector(n, -off.dot(n));   // seitlicher Versatz zur Flächenmitte
  // Ausrichtung: lokale X-Achse der Box gegen die lange Plattenkante (25° um Z, 15° um X)
  const kante = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), 25 * Math.PI / 180).applyAxisAngle(new THREE.Vector3(1, 0, 0), 15 * Math.PI / 180);
  const xs = new THREE.Vector3(1, 0, 0).applyQuaternion(box.quaternion); const xMm = new THREE.Vector3(xs.x, -xs.z, xs.y);
  return { oben: +(mx - d).toFixed(3), unten: +(mn - d).toFixed(3), seitlich: +off.length().toFixed(3), kantenWinkel: +(Math.acos(Math.min(1, Math.abs(xMm.dot(kante)))) * 180 / Math.PI).toFixed(2),
    info: document.getElementById('afs-info').textContent };
}, ziel);
let m = await mess();
ok('Panel zeigt Flächengröße 60 × 40', /60 × 40 mm/.test(m.info), m.info);
ok('mittig (seitlicher Versatz < 0,01 mm)', m.seitlich < 0.01, m.seitlich);
ok('Bohrung bündig versenkt: oben = Fläche, unten 4 mm tief', Math.abs(m.oben) < 0.01 && Math.abs(m.unten + 4) < 0.01, m);
ok('an der Kante ausgerichtet (X oder Y entlang langer Kante)', m.kantenWinkel < 0.1 || Math.abs(m.kantenWinkel - 90) < 0.1, m.kantenWinkel);
await pg.click('#afs-modal .vtb[data-m="auf"]'); m = await mess();
ok('Aufsetzen: unten = Fläche', Math.abs(m.unten) < 0.01 && Math.abs(m.oben - 4) < 0.01, m);
await pg.fill('#afs-mm', '2,5'); m = await mess();
ok('Tiefe 2,5 mm', Math.abs(m.unten + 2.5) < 0.01, m);
const w0 = m.kantenWinkel; await pg.click('#afs-modal button:has-text("90°")'); m = await mess();
ok('↻ 90° dreht um 90°', Math.abs(Math.abs(m.kantenWinkel - w0) - 90) < 0.1, [w0, m.kantenWinkel]);
await pg.click('#afs-modal .vtb[data-m="buendig"]');
// Undo: ein Schritt zurück stellt die alte Lage her
const u = await pg.evaluate(() => { const L = _uhLabelAt('undo', 0); return L.text; });
ok('Verlauf: ein Schritt „verschoben + gedreht“', /verschoben/.test(u) && /gedreht/.test(u), u);
// Gleich abziehen → Tasche 10×6×4 = 240 mm³ weniger
const vol = await pg.evaluate(async () => {
  const v = o => { const t = _moldCollectTris(o); let s = 0; for (let i = 0; i < t.length; i += 9) { const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.subarray(i, i + 9); s += (ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx)) / 6; } return s; };
  const vor = v(objects[0]); const boxVol = v(objects[1]); const bs = _afsLokalBox(objects[1]).getSize(new THREE.Vector3()).multiplyScalar(10);
  _afsAbziehen();
  for (let i = 0; i < 100 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 300));
  return { boxVol: +boxVol.toFixed(1), bs: bs.toArray().map(x => +x.toFixed(2)), vor: +vor.toFixed(1), nach: objects.length === 1 ? +v(objects[0]).toFixed(1) : null, n: objects.length };
});
ok('Gleich abziehen: Tasche 240 mm³ = Boxvolumen (simplify-Sicherung, schräg + gedreht)', vol.nach !== null && Math.abs(vol.vor - vol.nach - 240) < 0.5 && Math.abs(vol.boxVol - 240) < 0.5, vol);
await pg.screenshot({ path: '/tmp/auf_flaeche.png' });
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
