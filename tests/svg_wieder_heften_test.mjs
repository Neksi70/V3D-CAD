// Josy(?) 20.10. (WA0007): Motiv an die Wand geheftet, wieder heruntergezogen, erneut
// angeheftet → sitzt nicht mehr richtig („verseucht“), frisch hochgeladen geht es.
// Prüft: Lage zur Wand (Tiefe vor/hinter der Fläche, Dicke) beim 1. und 2. Anheften gleich.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html', LOCH = process.env.LOCH !== '0', SZENE = process.env.SZENE || 'quader', BREIT = +(process.env.BREIT || 0);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);
await pg.goto(URL);
await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
await pg.evaluate((SZENE) => { hideStarter(); _newCreate(false); setShapeMode('solid');
  let o;
  if (SZENE === 'gefaess') {   // hohles Vierkant-Gefäß mit runden senkrechten Kanten (mm, Z oben → wie STL-Import)
    const rr = (w, d, r) => { const s = new THREE.Shape(), x = w / 2, y = d / 2; s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0); s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2); s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI); s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5); return s; };
    const aussen = rr(80, 60, 12), loch = rr(76, 56, 10); aussen.holes.push(new THREE.Path(loch.getPoints(24).reverse()));
    const wand = new THREE.ExtrudeGeometry(aussen, { depth: 100, bevelEnabled: false, curveSegments: 16 });
    const boden = new THREE.ExtrudeGeometry(rr(80, 60, 12), { depth: 2, bevelEnabled: false, curveSegments: 16 });
    const g = THREE.BufferGeometryUtils.mergeBufferGeometries([wand.toNonIndexed(), boden.toNonIndexed()].map(x => { x.deleteAttribute('uv'); x.deleteAttribute('normal'); return x; }));
    g.computeVertexNormals(); _addImportedGeo(g, 'gefaess.stl', true, null, false); o = objects[0];
  } else { addShape('box'); o = objects[0]; selectObjs([o]); numChanged('sw', 80); numChanged('sd', 80); numChanged('sh', 100); }
  o.updateMatrixWorld(true); window._K = o; deselect(); setView('iso'); fitView(); }, SZENE);
await pg.mouse.click(1490, 400);
await pg.evaluate(() => { _text3dMode = 'free'; _text3dModeTouched = true; addTextShape(); });
await pg.waitForTimeout(300);
await pg.fill('#text3d-input', 'Winter');
await pg.locator('#text3d-modal button', { hasText: 'Erstellen' }).last().click();
await pg.waitForFunction(() => objects.some(o => o.userData.shapeType === 'svg'), null, { timeout: 20000 });
await pg.waitForTimeout(400);
if (BREIT) await pg.evaluate(w => { const t = objects.find(o => o.userData.shapeType === 'svg'); selectObjs([t]); numChanged('sw', w); }, BREIT);
if (LOCH) await pg.evaluate(() => { const t = objects.find(o => o.userData.shapeType === 'svg'); selectObjs([t]); setObjMode('hole'); });
await pg.evaluate(() => { setView('iso'); fitView(); deselect(); }); await pg.waitForTimeout(400);
const bild = (x, y, z) => pg.evaluate(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).project(camera); const r = canvas.getBoundingClientRect();
  return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, [x, y, z]);
// greift den Text dort, wo der Strahl ihn trifft
const greif = () => pg.evaluate(() => { deselect(); const t = objects.find(o => o.userData.shapeType === 'svg'); t.updateMatrixWorld(true); const r = canvas.getBoundingClientRect();
  const c = new THREE.Box3().setFromObject(t).getCenter(new THREE.Vector3()).project(camera); const x0 = r.left + (c.x + 1) / 2 * r.width, y0 = r.top + (1 - c.y) / 2 * r.height;
  for (let d = 0; d < 80; d += 2) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) { const x = x0 + dx, y = y0 + dy;
    mousev.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); raycaster.setFromCamera(mousev, camera);
    const h = raycaster.intersectObjects(objects, true).filter(h => h.object.isMesh && !h.object.userData.isEdgeLines)[0]; if (h && h.object === t) return [x, y]; }
  return [x0, y0]; });
const zieh = async (von, nach) => { await pg.evaluate(() => deselect()); await pg.waitForTimeout(100); await pg.mouse.move(von[0], von[1]); await pg.mouse.down();
  for (let i = 1; i <= 15; i++) { await pg.mouse.move(von[0] + (nach[0] - von[0]) * i / 15, von[1] + (nach[1] - von[1]) * i / 15); await pg.waitForTimeout(25); }
  await pg.mouse.up(); await pg.waitForTimeout(700); };
const lage = () => pg.evaluate(() => { const t = objects.find(o => o.userData.shapeType === 'svg'), K = _K; t.updateMatrixWorld(true);
  const kb = new THREE.Box3().setFromObject(K), tb = new THREE.Box3().setFromObject(t);
  let sdfMax = null, sdfMin = null;
  if (t.userData._svgSchmieg) { const cx = (kb.min.x + kb.max.x) / 2, cz = (kb.min.z + kb.max.z) / 2, W = 80, D = 60, R = 12;
    const sdf = (x, z) => { const qx = Math.abs(x) - (W / 2 - R), qz = Math.abs(z) - (D / 2 - R); return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R; };
    const p = t.geometry.attributes.position, v = new THREE.Vector3(); sdfMax = -1e9; sdfMin = 1e9;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(t.matrixWorld); const d = sdf((v.x - cx) * 10, (v.z - cz) * 10); sdfMax = Math.max(sdfMax, d); sdfMin = Math.min(sdfMin, d); }
    sdfMax = +sdfMax.toFixed(2); sdfMin = +sdfMin.toFixed(2); }
  return { sdfMax, sdfMin, kb: [kb.min.x, kb.max.x, kb.min.z, kb.max.z].map(x => +(x * 10).toFixed(1)), vorne: +((tb.max.z - kb.max.z) * 10).toFixed(2), hinten: +((tb.min.z - kb.max.z) * 10).toFixed(2), breite: +((tb.max.x - tb.min.x) * 10).toFixed(1),
    hoehe: +((tb.max.y - tb.min.y) * 10).toFixed(1), scale: t.scale.toArray().map(v => +v.toFixed(4)), depth: t.userData.svgDepth, geheftet: !!t.userData._snapNormal,
    wrap: !!t.userData._svgWrap, schmieg: !!t.userData._svgSchmieg, umlauf: !!(t.userData._svgSchmieg && t.userData._svgSchmieg.umlauf), hinweis: document.getElementById('text-snap-hint').textContent, raised: !!t.userData._svgRaised, loch: !!t.userData.isHole }; });
// Vorderseite des Körpers (front view schaut von +Z)
const wandPunkt = () => pg.evaluate(() => { const K = _K, r = canvas.getBoundingClientRect(); let best = null;
  for (let y = r.top + 5; y < r.bottom; y += 5) for (let x = r.left + 5; x < r.right; x += 5) {
    mousev.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); raycaster.setFromCamera(mousev, camera);
    const h = raycaster.intersectObject(K, false)[0]; if (!h) continue; const n = h.face.normal.clone().transformDirection(K.matrixWorld);
    if (n.z < 0.99 || h.point.z < new THREE.Box3().setFromObject(K).max.z - 0.05) continue; const d = Math.hypot(h.point.x, h.point.y - 6); if (!best || d < best.d) best = { d, p: [x, y] }; }
  return best && best.p; });
const heften = process.env.MAUS ? async () => { await pg.evaluate(() => fitToObjects(objects.slice())); await pg.waitForTimeout(300); await zieh(await greif(), await wandPunkt()); } : async () => { const w = await wandPunkt(); await pg.evaluate(([x, y]) => { const t = objects.find(o => o.userData.shapeType === 'svg'); selectObjs([t]);
  _svgSnapDetect(t, { clientX: x, clientY: y }); _applyTextSnapOnDrop(true); }, w); await pg.waitForTimeout(500); };
const abloesen = process.env.MAUS ? async () => { await zieh(await greif(), await bild(-2, 0, 7)); await pg.evaluate(() => fitToObjects(objects.slice())); await pg.waitForTimeout(300); } : () => pg.evaluate(() => { const t = objects.find(o => o.userData.shapeType === 'svg'); selectObjs([t]); _textSnapTarget = null;
  t.position.set(-12, t.position.y, 12); t.updateMatrixWorld(true); _applyTextSnapOnDrop(true); });
await heften();
if (process.env.HOEHE) { await pg.evaluate(h => { const t = objects.find(o => o.userData.shapeType === 'svg'); selectObjs([t]); numChanged('sh', +h); }, process.env.HOEHE); await pg.waitForTimeout(500); }
if (process.env.BREIT_NACH) { await pg.evaluate(w => { const t = objects.find(o => o.userData.shapeType === 'svg'); selectObjs([t]); numChanged('sw', +w); }, process.env.BREIT_NACH); await pg.waitForTimeout(500); }
const l1 = await lage(); log('1. Anheften:', JSON.stringify(l1));
await pg.screenshot({ path: '/tmp/heft1.png' });
await abloesen();
const l2 = await lage(); log('Heruntergezogen:', JSON.stringify(l2)); await pg.screenshot({ path: '/tmp/heft_ab.png' }); await pg.evaluate(() => { fitToObjects(objects.slice()); }); await pg.waitForTimeout(400);
await heften();
const l3 = await lage(); log('2. Anheften:', JSON.stringify(l3));
await pg.screenshot({ path: '/tmp/heft2.png' });
let fehler = 0;
if (SZENE === 'gefaess') { for (const [n, l] of [['1.', l1], ['2.', l3]]) if (l.sdfMax == null ? !(Math.abs(l.hinten + Math.abs(l.depth) / 2) <= 0.3) : !(l.sdfMax <= 0.5 && l.sdfMin < -0.3)) { fehler++; log('FEHLER:', n, 'Anheften liegt nicht an der Wand', JSON.stringify(l)); } }
else for (const k of ['vorne', 'hinten', 'breite', 'hoehe']) if (Math.abs(l1[k] - l3[k]) > 0.3) { fehler++; log('FEHLER:', k, l1[k], '→', l3[k]); }
if (SZENE === 'quader') for (const [n, l] of [['1.', l1], ['2.', l3]]) if (Math.abs(l.hinten + Math.abs(l.depth) / 2) > 0.3) { fehler++; log('FEHLER:', n, 'Anheften – Rückseite', l.hinten, 'mm statt', -Math.abs(l.depth) / 2, '(steckt in der Wand)'); }
if (!l3.geheftet && !l3.schmieg && !l3.wrap) { fehler++; log('FEHLER: beim 2. Mal nicht geheftet'); }
log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
