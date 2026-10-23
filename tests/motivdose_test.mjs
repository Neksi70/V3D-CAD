// 🥫 Dose mit Motiv (_mds*, 23.10.26): Netz dicht + Volumen stimmt, Motiv läuft um die
// Kanten und wird vertieft / erhaben / durchbrochen eingearbeitet. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('console', m => { const t = m.text(); if (/subtract|union|Manifold|übersprungen|Fehler/i.test(t) && !/404/.test(t)) console.log('  [log]', t.slice(0, 160)); });
await pg.goto(URL); await pg.waitForFunction(() => typeof _mdsOpen === 'function', null, { timeout: 30000 });
let fehler = 0;
const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
// 1) Netz allein
const netz = await pg.evaluate(async () => {
  const p = { ..._MDS_DEF, breite: 80, tiefe: 60, hoehe: 100, eckR: 12, wand: 2, boden: 2, konisch: 100 };
  const g = _mdsGeoMm(p), w = await _mfInit();
  const tris = new Float32Array(g.index.count * 3), P = g.attributes.position, I = g.index.array;
  for (let i = 0; i < I.length; i++) { tris[i * 3] = P.getX(I[i]); tris[i * 3 + 1] = P.getY(I[i]); tris[i * 3 + 2] = P.getZ(I[i]); }
  const mf = _mfFromSoup(w, tris);
  const rr = (W, D, R) => W * D - (4 - Math.PI) * R * R;
  const soll = rr(80, 60, 12) * 100 - rr(76, 56, 10) * 98;
  return { vol: +mf.volume().toFixed(0), soll: +soll.toFixed(0), genus: mf.genus() };
});
console.log('Netz:', JSON.stringify(netz));
ok('Dosen-Netz dicht (Manifold) und Volumen stimmt (±1 %)', Math.abs(netz.vol - netz.soll) < netz.soll * 0.01, netz);
// 2) Generator ganz durchlaufen
for (const art of ['tief', 'hoch', 'durch']) {
  const r = await pg.evaluate(async (art) => {
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0; hideStarter();
    _mdsOpen(); await new Promise(r => setTimeout(r, 300));
    Object.assign(_mdsP, { breite: 80, tiefe: 60, hoehe: 100, eckR: 12, wand: 2.4, boden: 2, konisch: 100, quelle: 'text', text: 'Weihnachtszeit', motivH: 14, lage: 50, anzahl: 1, art, mtiefe: art === 'hoch' ? 1.5 : 0.8 });
    const leer = (() => { const g = _mdsGeoMm(_mdsP); return g; })();
    await _mdsCreate();
    const o = objects.find(x => /Dose mit Motiv/.test(x.userData.name || ''));
    if (!o) return { fehlt: true, namen: objects.map(x => x.userData.name) };
    o.updateMatrixWorld(true);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, pp = g.attributes.position, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    let V = 0, aufRundung = 0; const bb = new THREE.Box3().setFromObject(o), cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    for (let i = 0; i < pp.count; i += 3) { A.fromBufferAttribute(pp, i).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(pp, i + 1).applyMatrix4(o.matrixWorld); C.fromBufferAttribute(pp, i + 2).applyMatrix4(o.matrixWorld); V += A.dot(B.clone().cross(C)) / 6; }
    // Motiv-Ecken auf der Rundung: Netzpunkte vorne außerhalb der ebenen Fläche (|x| > 28 mm), auf Motivhöhe, nicht auf dem Umriss
    const rr = (W, D, R) => W * D - (4 - Math.PI) * R * R;
    const v0 = (rr(80, 60, 12) * 100 - rr(75.2, 55.2, 9.6) * 98) / 1000;   // cm³ ohne Motiv
    for (let i = 0; i < pp.count; i++) { A.fromBufferAttribute(pp, i).applyMatrix4(o.matrixWorld); const x = (A.x - cx) * 10, y = A.y * 10, z = (A.z - cz) * 10;
      if (Math.abs(x) > 28 && z > 15 && y > 42 && y < 58) aufRundung++; }
    return { objekte: objects.length, name: o.userData.name, volCm3: +(Math.abs(V)).toFixed(3), leerCm3: +v0.toFixed(3), aufRundung, params: !!o.userData.motivDoseParams };
  }, art);
  console.log(art + ':', JSON.stringify(r));
  if (r.fehlt) { ok(art + ': Ergebnis vorhanden', false, r); continue; }
  ok(`${art}: ein Teil „Dose mit Motiv“`, r.objekte === 1 && r.params, r);
  if (art === 'hoch') ok(`${art}: Volumen größer als leere Dose`, r.volCm3 > r.leerCm3 + 0.05, r);
  else ok(`${art}: Volumen kleiner als leere Dose`, r.volCm3 < r.leerCm3 - 0.05, r);
  ok(`${art}: Motiv läuft auf die Rundung`, r.aufRundung > 20, r.aufRundung);
}
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
