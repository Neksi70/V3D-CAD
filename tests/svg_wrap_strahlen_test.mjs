// Josy(?) 20.10. (WA0009): Sonne (Ring + Strahlen, als Bohrung) um eine bauchige Vase
// gewickelt → „dann sind irgendwie Strahlen weg“. Prüft je Einzelteil des gewickelten
// Motivs: reicht es in die Wand (Gravur entsteht) und schaut es außen heraus?
// Vase wie ein Import (Z-up, Kippen am Mesh), hohl, 2 mm Wand. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const N = 12; let paths = `<path fill-rule="evenodd" d="M30,50 a20,20 0 1,0 40,0 a20,20 0 1,0 -40,0 Z M34,50 a16,16 0 1,1 32,0 a16,16 0 1,1 -32,0 Z"/>`;
for (let i = 0; i < N; i++) { const a = i / N * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a), w = 2.5;
  const p = (r, t) => [50 + c * r - s * t, 50 + s * r + c * t].map(v => v.toFixed(2)).join(',');
  paths += `<path d="M${p(25, -w)} L${p(42, -w)} L${p(42, w)} L${p(25, w)} Z"/>`; }
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${paths}</svg>`;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL); await pg.waitForFunction(() => typeof window.addShape === 'function', null, { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); });
const lauf = (hMM, groesse, breitF = 1, dickF = 1) => pg.evaluate(async ([svgText, hMM, groesse, breitF, dickF, ABZ]) => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  // bauchige Vase: Radius 30 mm unten, 38 mm bei 45 mm Höhe, 28 mm oben (100 mm hoch)
  const rOut = y => 30 + 8 * Math.sin(Math.PI * Math.min(1, y / 90)) - (y > 45 ? (y - 45) / 55 * 2 : 0);
  const prof = [new THREE.Vector2(0.001, 0)];
  for (let y = 0; y <= 100; y += 2) prof.push(new THREE.Vector2(rOut(y) / 10, y / 10));
  for (let y = 100; y >= 2; y -= 2) prof.push(new THREE.Vector2((rOut(y) - 2) / 10, y / 10));
  prof.push(new THREE.Vector2(0.001, 0.2));
  let geo = new THREE.LatheGeometry(prof, 160); geo = THREE.BufferGeometryUtils.mergeVertices(geo); geo.rotateX(Math.PI / 2);
  const vase = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })); vase.rotation.x = -Math.PI / 2;
  vase.userData = { id: idCtr++, name: 'Vase', type: 'custom', shapeType: 'custom' };
  scene.add(vase); objects.push(vase); vase.updateMatrixWorld(true);
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 2, targetMM: groesse, name: 'Sonne' });
  m.userData.isHole = true; m.scale.x *= breitF; m.scale.y *= dickF; m.updateMatrixWorld(true);
  // wie beim Ziehen: Strahl von außen, Treffer + Flächennormale
  vase.updateMatrixWorld(true); const rc = new THREE.Raycaster(new THREE.Vector3(vase.position.x + 20, hMM / 10, vase.position.z), new THREE.Vector3(-1, 0, 0));
  const h0 = rc.intersectObject(vase, false)[0]; const hit = h0.point.clone();
  const nW = h0.face.normal.clone().transformDirection(vase.matrixWorld).normalize();
  const p = _svgWrapProbe(vase, hit, { normalW: nW });
  if (!p) return { gewickelt: false, grund: _svgWrapReason };
  _svgWrapApply(m, p, hit); m.updateMatrixWorld(true); window._dbg = { R: p.R, ax: p.axisDir.toArray(), ap: p.axisPt.toArray(), pos: m.position.toArray(), sc: m.scale.toArray(), inScene: !!m.parent };
  // Einzelteile (verbundene Ecken) und ihr Abstand zur Außenwand
  const pos = m.geometry.attributes.position, n = pos.count, key = new Map(), par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const f = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; }, u = (a, c) => { a = f(a); c = f(c); if (a !== c) par[a] = c; };
  for (let i = 0; i < n; i++) { const k = [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => Math.round(v * 1e5)).join(','); if (key.has(k)) u(i, key.get(k)); else key.set(k, i); }
  const idx = m.geometry.index ? m.geometry.index.array : null, nt = (idx ? idx.length : n) / 3;
  for (let t = 0; t < nt; t++) { const a = idx ? idx[t * 3] : t * 3, b2 = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2; u(a, b2); u(b2, c); }
  const teile = new Map(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); const ymm = v.y * 10, dd = Math.hypot(v.x - vase.position.x, v.z - vase.position.z) * 10 - rOut(ymm);
    const r = f(i); const e = teile.get(r) || { lo: 1e9, hi: -1e9, y: 0, k: 0, c: new THREE.Vector3() }; e.lo = Math.min(e.lo, dd); e.hi = Math.max(e.hi, dd); e.y += ymm; e.k++; e.c.add(v); teile.set(r, e); }
  let tief = null;
  if (ABZ) {
    const ax = vase.position.clone(); selectObjs([vase, m]); _engravePreset = { depth: 1, wantInlay: false, through: false };
    await subtractHoles(); for (let i = 0; i < 120 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 500));
    const erg = objects[0]; erg.updateMatrixWorld(true); tief = [];
    const kMax = Math.max(...[...teile.values()].map(e => e.k));
    for (const e of teile.values()) { if (e.k < 30 || e.k === kMax) continue;   /* Ring: Schwerpunkt liegt im Loch */ const c = e.c.clone().divideScalar(e.k); const dir = new THREE.Vector3(c.x - ax.x, 0, c.z - ax.z).normalize();
      const start = new THREE.Vector3(ax.x, c.y, ax.z).addScaledVector(dir, 10); const h = new THREE.Raycaster(start, dir.clone().negate()).intersectObject(erg, false)[0];
      const rHit = h ? Math.hypot(h.point.x - ax.x, h.point.z - ax.z) * 10 : null; tief.push({ y: +(c.y * 10).toFixed(1), tiefe: rHit == null ? null : +(rOut(c.y * 10) - rHit).toFixed(2) }); }
  }
  return { tief, dbg: window._dbg, gewickelt: true, schmieg: !!m.userData._svgSchmieg, wrap: !!m.userData._svgWrap,
    teile: [...teile.values()].map(e => ({ y: +(e.y / e.k).toFixed(1), lo: +e.lo.toFixed(2), hi: +e.hi.toFixed(2) })).sort((a, c) => c.y - a.y) };
}, [SVG, hMM, groesse, breitF, dickF, !!process.env.ABZIEHEN]);
let fehler = 0;
for (const [h, g, bf, df] of [[45, 37], [30, 37], [30, 60], [60, 60], [25, 80], [30, 37, 2], [30, 37, 2.1, 1], [45, 37, 1, 3], [30, 37, 0.6]]) {
  const r = await lauf(h, g, bf, df);
  if (!r.gewickelt) { console.log(`Höhe ${h} mm, Ø${g}: nicht gewickelt`, r.grund); fehler++; continue; }
  const schlecht = r.teile.filter(t => !(t.lo < -0.5 && t.hi > 0.05));
  console.log(`Höhe ${h} mm, Motiv ${g} mm${bf ? ' Breite×' + bf : ''}${df ? ' Dicke×' + df : ''} (${r.wrap ? 'wickeln' : r.schmieg ? 'schmiegen' : '?'}): ${r.teile.length} Teile, ${schlecht.length} ohne Gravur`, schlecht.length ? JSON.stringify(schlecht) : '');
  fehler += schlecht.length;
  if (r.tief) { const ohne = r.tief.filter(t => !(t.tiefe > 0.4)); console.log('   abgezogen:', r.tief.length, 'Teile geprüft,', ohne.length, 'ohne Vertiefung', ohne.length ? JSON.stringify(ohne) : ''); fehler += ohne.length; }
}
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
