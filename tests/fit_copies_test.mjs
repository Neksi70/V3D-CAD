// Aufmaß für Kopien nur einmal rechnen (_fitGrowAll): 10 Taschen müssen zusammen genau
// das 10-fache EINER einzeln gerechneten Tasche wegnehmen, wasserdicht — bei verschobenen
// (Reihen) UND um die Hochachse gedrehten Kopien (dicht). Gekippte Teile dürfen NICHT
// übernommen werden. Das Testteil hat bewusst ein feines Netz mit entarteten Dreiecken
// (wie Volkers Halter): Es muss vor dem Aufmaß geflickt werden, sonst greift der
// langsame, zackige Netz-Offset.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const fails = [];
const ok = (name, cond, extra) => { console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); if (!cond) fails.push(name); };
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
const logs = []; const T0 = Date.now(); page.on('console', m => { if (/\[fit\]|\[subtract\]|\[mf\]/.test(m.text())) { logs.push(m.text()); if (process.env.DEBUG) console.log('   ', ((Date.now() - T0) / 1000).toFixed(1) + 's', m.text().slice(0, 160)); } });
await page.goto(process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.addShape === 'function', null, { timeout: 60000 });
await page.evaluate(() => {
  hideStarter(); document.getElementById('auth-overlay')?.classList.add('hidden');
  window._tSetup = (modus, kippen, anzahl) => {
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0; deselect();
    addShape('box'); const plate = objects[0];
    let bb = getMeshBox(plate);
    plate.scale.x *= 31 / (bb.max.x - bb.min.x); plate.scale.z *= 42 / (bb.max.z - bb.min.z); plate.scale.y *= 2 / (bb.max.y - bb.min.y);
    plate.position.y -= getMeshBox(plate).min.y; plate.updateMatrixWorld(true);
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(55, 0); s.absarc(55, 14, 14, -Math.PI/2, Math.PI/2, false); s.lineTo(30, 28);
    s.lineTo(22, 28); s.absarc(15, 28, 7, 0, Math.PI, true); s.lineTo(0, 28); s.lineTo(0, 0);
    for (const [x, y] of [[8,6],[8,22],[18,13],[28,6],[28,22],[40,14],[52,14],[60,14]]) { const h = new THREE.Path(); h.absarc(x, y, 2.5, 0, Math.PI*2, true); s.holes.push(h); }
    const geo = new THREE.ExtrudeGeometry(s, { depth: 8, bevelEnabled: false, curveSegments: 400 }).toNonIndexed();
    geo.computeVertexNormals();
    _addImportedGeo(geo, 'halter.stl', true, null, false);
    const part = objects[objects.length-1]; part.userData.isHole = true;
    window._tTri = part.geometry.attributes.position.count / 3;
    selectObjs([plate, part]);
    document.getElementById('pat-fill-mode') && (document.getElementById('pat-fill-mode').value = modus);
    _applyFillPlate(3, 5, true, anzahl || 10, true, 5);
    // „dense": jede zweite Kopie um 180° um die Hochachse drehen (um ihre eigene Mitte,
    // damit sie am Platz bleibt) — so wie die dichte Anordnung Teile gegeneinander dreht
    if (modus === 'dense') objects.filter(o => o.userData.isHole).forEach((o, i) => {
      if (i % 2 === 0) return;
      const c = getMeshBox(o).getCenter(new THREE.Vector3());
      o.position.sub(c).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).add(c);
      o.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      o.updateMatrixWorld(true);
    });
    if (kippen) { const o = objects[objects.length-1]; o.rotation.x += 0.2; o.updateMatrixWorld(true); }
    window._tRot = objects.filter(o => o.userData.isHole).map(o => { const v = new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion); return Math.round(Math.atan2(-v.z, v.x) * 180 / Math.PI); });
    selectObjs(objects.slice());
  };
  window._tRes = () => {
    const o = objects[0], g = o.geometry, pos = g.attributes.position;
    const key = i => Math.round(pos.getX(i)*1e4) + ',' + Math.round(pos.getY(i)*1e4) + ',' + Math.round(pos.getZ(i)*1e4);
    const E = new Map(); let vol = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      const k = [key(t), key(t+1), key(t+2)];
      for (let e = 0; e < 3; e++) { const p = k[e], q = k[(e+1)%3]; const kk = p < q ? p+'|'+q : q+'|'+p; E.set(kk, (E.get(kk)||0) + (p < q ? 1 : -1)); }
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t+1); c.fromBufferAttribute(pos, t+2); vol += a.dot(b.clone().cross(c)) / 6;
    }
    let offen = 0; E.forEach(v => { if (v !== 0) offen++; });
    return { n: objects.length, offen, volMm3: Math.round(vol * 1000) };
  };
});
const lauf = async (modus, anzahl, kippen) => {
  await page.evaluate(([m, n, k]) => _tSetup(m, k, n), [modus, anzahl, kippen]);
  logs.length = 0;
  if (process.env.DEBUG) console.log('   ', ((Date.now() - T0) / 1000).toFixed(1) + 's Setup fertig, Löcher:', await page.evaluate(() => objects.filter(o => o.userData.isHole).length + ' fillFit ' + objects.filter(o => o.userData.fillFit).length));
  const t0 = Date.now();
  page.evaluate(() => subtractHoles());
  await page.waitForSelector('#fit-dialog', { timeout: 60000 });
  await page.click('#fit-dialog ._fit-unit[data-u="mm"]');
  await page.fill('#fit-dialog ._fit-val', '0.5');
  await page.click('#fit-dialog ._fit-ok');
  await page.waitForFunction(() => objects.length === 1, null, { timeout: 180000 });
  const ms = Date.now() - t0;
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ ..._tRes(), rot: _tRot, tri: _tTri }));
  return { ...r, ms, gerechnet: logs.filter(l => /Aufmaß 0.5 mm/.test(l)).length, uebernommen: logs.find(l => /übernommen/.test(l)) || '' };
};
const V0 = 310 * 20 * 420;
for (const modus of ['rows', 'dense']) {
  const e = await lauf(modus, 1), k = await lauf(modus, 10);
  const eine = V0 - e.volMm3, zehn = V0 - k.volMm3;
  console.log(`  [${modus}] Teil ${k.tri} Dreiecke, Drehungen ${JSON.stringify([...new Set(k.rot)])} — 10 Teile in ${k.ms} ms`);
  ok(`${modus}: Aufmaß 1 × gerechnet, 9 × übernommen`, k.gerechnet === 1 && /für 9 Kopie/.test(k.uebernommen), { gerechnet: k.gerechnet, log: k.uebernommen });
  ok(`${modus}: Ergebnis wasserdicht`, k.offen === 0 && e.offen === 0, { zehn: k.offen, eine: e.offen });
  ok(`${modus}: 10 Taschen = 10 × eine Tasche (±0,5 %)`, eine > 5000 && Math.abs(zehn - 10 * eine) < 0.005 * 10 * eine, { eine, zehn });
}
const g = await lauf('rows', 10, true);
ok('gekipptes Teil wird nicht übernommen (nur 8 Kopien)', /für 8 Kopie/.test(g.uebernommen), g.uebernommen);
ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
