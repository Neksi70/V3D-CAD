// Scan schneiden → Schnittfläche zu (Volker 11.11.: Stuhlbein vom Scan abgeschnitten, Teil innen hohl).
// Scans haben Lücken; dann schließen sich die Schnittkanten nicht zum Ring und ✂ Schneiden ließ den
// Deckel ganz weg. Nachgestellt mit einem echten Scan (Colani-Stummel), an der Schnittebene werden
// Dreiecke herausgenommen.
//   1. Schneiden am heilen Scan: Deckelfläche = Referenz
//   2. Schneiden am Scan mit Lücken: Deckel trotzdem da (≥ 90 % der Referenz), Lücken überbrückt
//   3. 🩹 Reparieren an einem offen abgeschnittenen Teil (Deckel entfernt): Loch eben verschlossen,
//      Deckelfläche ≈ Querschnitt (keine Fächer-Überlappung), Teil danach wasserdicht
// Start: python3 volme3d_server.py 8874 --dev  →  node tests/scan_schnitt_deckel_test.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8874/volme3d.html';
const STL = readFileSync(new URL('./fixtures/scan_stummel.stl', import.meta.url)).toString('base64');
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP); await pg.waitForFunction(() => typeof openCutTool === 'function' && typeof _meshFromStlB64 === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
await pg.evaluate((stl) => {
  window.__stl = stl;
  // Fläche der Dreiecke, die in der Ebene y = yE liegen (Deckel), und offene Kanten
  window.__deckel = (m, yE) => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, P = g.attributes.position; let A = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < P.count; i += 3) { a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
      if ([a, b, c].every(v => Math.abs(v.y - yE) < 1e-3)) A += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2; }
    return A; };
  window.__offen = (m) => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, P = g.attributes.position, E = new Map();
    const K = i => Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4);
    for (let i = 0; i < P.count; i += 3) for (let j = 0; j < 3; j++) { const p = K(i + j), q = K(i + (j + 1) % 3); if (p === q) continue; const k = p < q ? p + '|' + q : q + '|' + p; E.set(k, (E.get(k) || 0) + 1); }
    let n = 0; for (const v of E.values()) if (v === 1) n++; return n; };
  // Scan laden, stehend, Schnitt quer bei 40 % Höhe; optional Lücken an der Schnittebene
  window.__schnitt = (luecken) => {
    _newCreate(false);
    const m = _meshFromStlB64(__stl, 'Scan', true); m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m), yE = bb.min.y + (bb.max.y - bb.min.y) * 0.4;
    if (luecken) {   // jedes 15. Dreieck, das die Ebene kreuzt, herausnehmen
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(), P = g.attributes.position, out = [], v = new THREE.Vector3(); let k = 0, weg = 0;
      for (let i = 0; i < P.count; i += 3) { const ys = [0, 1, 2].map(j => v.fromBufferAttribute(P, i + j).applyMatrix4(m.matrixWorld).y);
        if (Math.min(...ys) < yE && Math.max(...ys) > yE && (k++ % 15 === 0)) { weg++; continue; }
        for (let j = 0; j < 9; j++) out.push(P.array[i * 3 + j]); }
      const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); ng.computeVertexNormals();
      m.geometry = ng; window.__weg = weg;
    }
    selectObjs([m]); openCutTool(); _cutOnSlider(yE * 10);
    const lay = document.getElementById('cut-lay'); if (lay) lay.checked = false;   // Teile in Lage lassen (Deckel auf yE messen)
    return yE;
  };
}, STL);
const lauf = async (luecken) => {
  const yE = await pg.evaluate(l => __schnitt(l), luecken);
  await pg.evaluate(() => _cutExecute()); await pg.waitForTimeout(500);
  return pg.evaluate(yE => { const t = objects.filter(o => /^Teil/.test(o.userData.name));
    return { teile: t.length, yE, deckel: t.map(o => +__deckel(o, yE).toFixed(3)), offen: t.map(o => __offen(o)), weg: window.__weg }; }, yE);
};
const heil = await lauf(false);
console.log('  heil:', JSON.stringify(heil));
ok('heiler Scan: 2 Teile, beide mit Deckel, wasserdicht', heil.teile === 2 && heil.deckel.every(a => a > 0.05) && heil.offen.every(n => n === 0), heil);
const kaputt = await lauf(true);
console.log('  mit Lücken:', JSON.stringify(kaputt));
const ref = heil.deckel[0];
ok('Scan mit Lücken: Deckel trotzdem da (≥ 90 % der Fläche)', kaputt.teile === 2 && kaputt.deckel.every(a => a > ref * 0.9 && a < ref * 1.1), [ref, kaputt.deckel]);

// 3. Reparieren an offen abgeschnittenem Teil (Deckel-Dreiecke entfernt)
const r3 = await pg.evaluate(async (ref) => {
  const yE = __schnitt(false); await _cutExecute();
  const t = objects.filter(o => /^Teil/.test(o.userData.name))[0];
  const g = t.geometry.index ? t.geometry.toNonIndexed() : t.geometry, P = g.attributes.position, out = [];
  for (let i = 0; i < P.count; i += 3) { if ([0, 1, 2].every(j => Math.abs(P.getY(i + j) - yE) < 1e-3)) continue; for (let j = 0; j < 9; j++) out.push(P.array[i * 3 + j]); }
  const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); ng.computeVertexNormals(); t.geometry = ng;
  const vor = { offen: __offen(t), deckel: __deckel(t, yE) };
  selectObjs([t]); await repairSelected();
  return { vor, nach: { offen: __offen(t), deckel: +__deckel(t, yE).toFixed(3) }, ref };
}, ref);
console.log('  Reparieren:', JSON.stringify(r3));
ok('offen abgeschnitten: vorher offen, ohne Deckel', r3.vor.offen > 10 && r3.vor.deckel < 1e-6, r3.vor);
ok('🩹 Reparieren: Loch eben verschlossen, Fläche ≈ Querschnitt, wasserdicht', r3.nach.offen === 0 && Math.abs(r3.nach.deckel - ref) / ref < 0.03, r3.nach);
// 4. L-förmiger Querschnitt (z. B. Schnitt durch Sitz + Bein): Fächer vom Mittelpunkt ragte über den Rand
const r4 = await pg.evaluate(async () => {
  _newCreate(false);
  const sh = new THREE.Shape([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]].map(([x, y]) => new THREE.Vector2(x, y)));
  const g0 = new THREE.ExtrudeGeometry(sh, { depth: 2, bevelEnabled: false, curveSegments: 1 }); g0.rotateX(-Math.PI / 2);   // Oberseite y = 2
  const g = g0.toNonIndexed(), P = g.attributes.position, out = [];
  for (let i = 0; i < P.count; i += 3) { if ([0, 1, 2].every(j => Math.abs(P.getY(i + j) - 2) < 1e-6)) continue; for (let j = 0; j < 9; j++) out.push(P.array[i * 3 + j]); }
  const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); ng.computeVertexNormals();
  const m = new THREE.Mesh(ng, new THREE.MeshStandardMaterial()); m.userData = { id: idCtr++, name: 'L', type: 'custom', color: '#888888' };
  scene.add(m); objects.push(m); selectObjs([m]); await repairSelected();
  // Volumen (wasserdicht + richtig gewickelt → 7 × 2 = 14)
  const Q = m.geometry.attributes.position; let vol = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < Q.count; i += 3) { a.fromBufferAttribute(Q, i); b.fromBufferAttribute(Q, i + 1); c.fromBufferAttribute(Q, i + 2); vol += a.dot(b.clone().cross(c)) / 6; }
  return { deckel: +__deckel(m, 2).toFixed(4), offen: __offen(m), vol: +vol.toFixed(4) };
});
ok('L-Querschnitt: Deckel = 7 cm², wasserdicht, Volumen 14 (richtig gewickelt)', Math.abs(r4.deckel - 7) < 1e-3 && r4.offen === 0 && Math.abs(r4.vol - 14) < 1e-3, r4);
ok('keine Seitenfehler', !errs.length, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
