// Josy 20.10. (WA0006/0008): breites Motiv auf eine eckige Dose mit runden Kanten →
// nur „Auf Fläche heften“, Motiv steht an der Rundung vorne über. Jetzt: „↪ Um die
// Kanten legen“ — Motiv läuft entlang des Umrisses und liegt überall an der Wand.
// Prüft am hohlen Vierkant-Gefäß (80×60, R12, Import wie STL) je Motiv-Ecke den
// Abstand zur Außenwand (analytisch): außen höchstens 0,5 mm, innen in der Wand,
// und dass das Motiv bis auf die Rundung reicht. Gegenprobe: scharfkantiger
// Quader bleibt beim flachen Heften. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); if (process.env.LOG) pg.on('console', m => { const t = m.text(); if (/manifold|Manifold|BSP|OCCT|Abzug|engine|Engine|CSG/i.test(t)) console.log('   [log]', t.slice(0, 200)); });
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
if (process.env.OHNE_SPERRE) await pg.evaluate(() => { window._svgWickelUnrund = () => false; });
const lauf = (szene, breite, loch, hoehe, folge) => pg.evaluate(async ([szene, breite, loch, hoehe, folge]) => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0; hideStarter(); setShapeMode('solid');
  const W = szene.startsWith('dose') ? 123.2 : 80, D = szene.startsWith('dose') ? 123.2 : 60, R = szene.startsWith('dose') ? 11.4 : 12;
  let K;
  if (szene === 'dose36') {
    // wie Josys „Vase“: 36 Ecken je Umlauf auf dem Umriss eines abgerundeten Quadrats
    // (halbe Breite 61,6, Ecken R11,4), unten 10 % schmaler, massiv. Grob genug, dass die
    // Rundungserkennung eine Achse findet.
    const rq = th => { const c = Math.cos(th), s2 = Math.sin(th); let lo = 0, hi = 200; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2;
      const qx = Math.abs(m * c) - (W / 2 - R), qz = Math.abs(m * s2) - (D / 2 - R); const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R; if (d > 0) hi = m; else lo = m; } return lo; };
    const N = 36, H = 170, pts = [], ring = (z, f) => { const r = []; for (let k = 0; k < N; k++) { const th = k / N * 2 * Math.PI, rr = rq(th) * f; r.push([rr * Math.cos(th), rr * Math.sin(th), z]); } return r; };
    const unten = ring(0, 0.9), oben = ring(H, 1), tri = [];
    const P = (a) => tri.push(...a);
    for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; P(unten[k]); P(unten[k2]); P(oben[k2]); P(unten[k]); P(oben[k2]); P(oben[k]); P([0, 0, 0]); P(unten[k2]); P(unten[k]); P([0, 0, H]); P(oben[k]); P(oben[k2]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3)); g.computeVertexNormals();
    _addImportedGeo(g, 'dose36.stl', true, null, false); K = objects[objects.length - 1];
  } else if (szene === 'gefaess' || szene === 'dose') {
    const rr = (w, d, r) => { const s = new THREE.Shape(), x = w / 2, y = d / 2; s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0); s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2); s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI); s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5); return s; };
    const aussen = rr(W, D, R), lochP = rr(W - 4, D - 4, R - 2); aussen.holes.push(new THREE.Path(lochP.getPoints(24).reverse()));
    const wand = new THREE.ExtrudeGeometry(aussen, { depth: 100, bevelEnabled: false, curveSegments: 16 });
    const boden = new THREE.ExtrudeGeometry(rr(W, D, R), { depth: 2, bevelEnabled: false, curveSegments: 16 });
    const g = THREE.BufferGeometryUtils.mergeBufferGeometries((folge ? [wand.toNonIndexed()] : [wand.toNonIndexed(), boden.toNonIndexed()]).map(x => { x.deleteAttribute('uv'); x.deleteAttribute('normal'); return x; }));
    if (szene === 'dose') { const pp = g.attributes.position; for (let i = 0; i < pp.count; i++) { const f = 1 + 0.1 * pp.getZ(i) / 100; pp.setX(i, pp.getX(i) * f); pp.setY(i, pp.getY(i) * f); } }
    g.computeVertexNormals(); _addImportedGeo(g, 'gefaess.stl', true, null, false); K = objects[objects.length - 1];
  } else { addShape('box'); K = objects[objects.length - 1]; selectObjs([K]); numChanged('sw', W); numChanged('sd', D); numChanged('sh', 100); }
  K.updateMatrixWorld(true);
  _text3dMode = 'free'; _text3dModeTouched = true; addTextShape();
  await new Promise(r => setTimeout(r, 300));
  document.getElementById('text3d-input').value = 'Winterzeit'; document.getElementById('text3d-input').dispatchEvent(new Event('input'));
  [...document.querySelectorAll('#text3d-modal button')].filter(x => /Erstellen/.test(x.textContent)).pop().click();
  for (let i = 0; i < 40 && !objects.some(o => o.userData.shapeType === 'svg'); i++) await new Promise(r => setTimeout(r, 250));
  const t = objects.find(o => o.userData.shapeType === 'svg');
  selectObjs([t]); const f = breite / ((new THREE.Box3().setFromObject(t).max.x - new THREE.Box3().setFromObject(t).min.x) * 10);
  t.scale.x *= f; t.scale.z *= f; t.updateMatrixWorld(true);       // proportional breiter (Breite + Tiefe)
  if (loch) setObjMode('hole');
  K.updateMatrixWorld(true);
  const kb = new THREE.Box3().setFromObject(K), cx = (kb.min.x + kb.max.x) / 2, cz = (kb.min.z + kb.max.z) / 2;
  // wie beim Ziehen: Treffer vorne in der Mitte, Erkennung + Loslassen
  const rc = new THREE.Raycaster(new THREE.Vector3(cx, hoehe / 10, kb.max.z + 3), new THREE.Vector3(0, 0, -1));
  const h = rc.intersectObject(K, false)[0];
  raycaster.set(rc.ray.origin, rc.ray.direction);
  _svgSnapHit = h;
  const nW = h.face.normal.clone().transformDirection(K.matrixWorld).normalize();
  // denselben Entscheid wie _svgSnapDetect treffen, ohne Bildschirmkoordinaten
  const probe = _svgWrapProbe(K, h.point, { normalW: nW });
  const eben = _svgSnapIstEben(h, t);
  let wrapP = probe;
  if (wrapP) { const c0 = wrapP.axisPt.clone().addScaledVector(wrapP.axisDir, h.point.clone().sub(wrapP.axisPt).dot(wrapP.axisDir)); if (Math.abs(nW.dot(h.point.clone().sub(c0).normalize())) <= 0.94) wrapP = null; }
  if (wrapP && Math.abs(nW.y) < 0.3 && _svgWickelUnrund(h, t, wrapP)) wrapP = null;
  const umlauf = !wrapP && Math.abs(nW.y) < 0.3 && _svgUmlaufNoetig(h, t, nW);
  window._probeGefunden = !!probe;
  if (folge === "abziehen-feld") { _svgSchmiegApply(t, h, { umlauf: false }); } else
  _applySvgSnap(t, { obj: K, type: umlauf ? 'schmieg' : 'surface', wrap: null, umlauf });
  t.updateMatrixWorld(true);
  const sdf = (x, z) => { const qx = Math.abs(x) - (W / 2 - R), qz = Math.abs(z) - (D / 2 - R);
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R; };
  const p = t.geometry.attributes.position, v = new THREE.Vector3();
  let aussenMax = -1e9, innenMin = 1e9, auf = 0, ueberRund = 0, xMin = 1e9, xMax = -1e9;
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(t.matrixWorld);
    const fy = szene === 'dose' ? 1 + 0.1 * (v.y * 10) / 100 : szene === 'dose36' ? 0.9 + 0.1 * (v.y * 10) / 170 : 1;
    const x = (v.x - cx) * 10 / fy, z = (v.z - cz) * 10 / fy, d = sdf(x, z) * fy;
    aussenMax = Math.max(aussenMax, d); innenMin = Math.min(innenMin, d); xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    if (Math.abs(x) > W / 2 - R) ueberRund++; }
  const ud = t.userData;
  const vol = o => { o.updateMatrixWorld(true); const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, pp = g.attributes.position, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(); let V = 0;
    const km = new Map(), kk = w => [w.x, w.y, w.z].map(x => Math.round(x * (window._kkF || 1e4))).join(',');
    for (let i = 0; i < pp.count; i += 3) { A.fromBufferAttribute(pp, i).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(pp, i + 1).applyMatrix4(o.matrixWorld); C.fromBufferAttribute(pp, i + 2).applyMatrix4(o.matrixWorld);
      V += A.dot(B.clone().cross(C)) / 6; const ks = [kk(A), kk(B), kk(C)]; for (let j = 0; j < 3; j++) { const e = [ks[j], ks[(j + 1) % 3]].sort().join('|'); km.set(e, (km.get(e) || 0) + 1); } }
    let offen = 0; km.forEach(n => { if (n !== 2) offen++; });
    // zweite Zählung: verschweißen (0,0001 mm) und über Indizes zählen — unabhängig von Rundungsgrenzen
    const gw = g.clone(); gw.applyMatrix4(o.matrixWorld); for (const k of Object.keys(gw.attributes)) if (k !== 'position') gw.deleteAttribute(k);
    const mw = THREE.BufferGeometryUtils.mergeVertices(gw, 1e-5), ix = mw.index.array, em = new Map();
    for (let i = 0; i < ix.length; i += 3) for (let j = 0; j < 3; j++) { const a = ix[i + j], c = ix[i + (j + 1) % 3]; if (a === c) continue; const e = a < c ? a + '_' + c : c + '_' + a; em.set(e, (em.get(e) || 0) + 1); }
    let offen2 = 0; em.forEach(n => { if (n !== 2) offen2++; });
    return { offen2, V: +(Math.abs(V) * 1000).toFixed(0), offen }; };
  let folgeErg = null; window._kkF = 1e4;
  if (folge) {
    const v0 = vol(K); const vt = vol(t); window._wzOffen = vt.offen; window._wzOffen2 = vt.offen2;
    selectObjs([K, t]);
    if (folge.startsWith("abziehen")) { _engravePreset = { depth: 1, wantInlay: false, through: false }; await subtractHoles(); }
    else { _svgRaise(t, 2, K); selectObjs([K, t]); await unionSelected(); }
    for (let i = 0; i < 160 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 500));
    const e = objects.length === 1 ? vol(objects[0]) : null;
    folgeErg = { werkzeugOffen2: window._wzOffen2, nachherOffen2: e && e.offen2, werkzeugOffen: window._wzOffen, offenVorher: v0.offen, vorher: v0.V, nachher: e && e.V, offen: e && e.offen, objekte: objects.length };
  }
  return { probeGefunden: window._probeGefunden, folgeErg, umlauf: !!(ud._svgSchmieg && ud._svgSchmieg.umlauf), schmieg: !!ud._svgSchmieg, geheftet: !!ud._snapNormal, eben,
    aussenMax: +aussenMax.toFixed(2), innenMin: +innenMin.toFixed(2), xSpanne: [+xMin.toFixed(1), +xMax.toFixed(1)], aufRundung: ueberRund, ecken: p.count };
}, [szene, breite, loch, hoehe, folge || '']);
let fehler = 0;
const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
for (const [loch, hoehe] of [[true, 50], [false, 50], [true, 20]]) {
  const r = await lauf('gefaess', 100, loch, hoehe);
  console.log(`Gefäß, Motiv 100 mm, ${loch ? 'Bohrung' : 'erhaben'}, Höhe ${hoehe}:`, JSON.stringify(r));
  ok('um die Kanten gelegt', r.umlauf);
  ok('liegt außen an (≤ 0,5 mm)', r.aussenMax <= 0.5 && r.aussenMax > 0, r.aussenMax);
  ok('reicht in die Wand', r.innenMin < -0.3, r.innenMin);
  ok('läuft auf die Rundung', r.aufRundung > 50, r.aufRundung);
}
for (const [folge, br] of (process.env.NUR ? [[process.env.NUR, +process.env.BR]] : [['abziehen', 100], ['vereinen', 100]])) {
  const r = await lauf('gefaess', br, folge.startsWith('abziehen'), 50, folge);
  console.log(`Gefäß + ${folge}:`, JSON.stringify(r.folgeErg));
  // Gestreifte Werkzeuge (Wickeln/Anschmiegen) bringen nach dem Verschweißen ein paar Splitterkanten mit,
  // das bisherige Anschmiegen landet hier bei 8 — Grenze nur gegen echte Löcher
  ok(`${folge}: ein Teil, keine Löcher`, r.folgeErg && r.folgeErg.objekte === 1 && r.folgeErg.nachherOffen2 <= 30, r.folgeErg);
  ok(`${folge}: Volumen ${folge === 'abziehen' ? 'kleiner' : 'größer'}`, r.folgeErg && r.folgeErg.nachher && (folge === 'abziehen' ? r.folgeErg.nachher < r.folgeErg.vorher : r.folgeErg.nachher > r.folgeErg.vorher), r.folgeErg);
}
{ const r = await lauf('dose36', 106, true, 85);
  console.log('Dose mit 36 Ecken (wie Josys Vase), Motiv 106 mm:', JSON.stringify(r));
  ok('Dose: nicht um einen Zylinder gewickelt, sondern um die Kanten gelegt', r.umlauf, r);
  ok('Dose: liegt außen an (≤ 0,5 mm)', r.aussenMax <= 0.5 && r.aussenMax > 0, r.aussenMax);
  ok('Dose: reicht überall in die Wand', r.innenMin < -0.3, r.innenMin); }
const q = await lauf('quader', 60, true, 50);
console.log('Quader scharfkantig, Motiv 60 mm:', JSON.stringify(q));
ok('Quader bleibt flach geheftet', q.geheftet && !q.schmieg);
const q2 = await lauf('gefaess', 30, true, 50);
console.log('Gefäß, Motiv 30 mm (passt auf die Fläche):', JSON.stringify(q2));
ok('schmales Motiv bleibt flach geheftet', q2.geheftet && !q2.schmieg);
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
