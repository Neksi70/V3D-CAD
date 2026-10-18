// Josy 18.10.26: "eine Schicht Tannen drauf, verschmelzen, die nächste Schicht
// soll dann dicker oder dünner rausstechen". Nachgestellt: Tannen-SVG auf die
// Vorderwand eines Kastens heften (2 mm erhaben), vereinen, zweite Tannen-Reihe
// (4 mm) auf dieselbe Wand, vereinen. Gemessen wird, wie weit jede Schicht aus
// der Wand ragt — die zweite muss von der WAND aus zählen, nicht von Schicht 1.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const TANNE = (x0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">` +
  [0, 1, 2].map(i => { const x = x0 + i * 60; return `<path d="M${x},100 L${x + 20},0 L${x + 40},100 Z"/>`; }).join('') + `</svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const r = await pg.evaluate(async ([svgA, svgB]) => {
  addShape('box'); const box = objects[objects.length - 1];
  await new Promise(r => setTimeout(r, 800));   // addShape setzt den Körper verzögert ab
  box.scale.set(5, 5, 2.5); box.position.set(0, 5, 0); box.updateMatrixWorld(true);   // 100×100×50 mm
  const wandZ = new THREE.Box3().setFromObject(box).max.z;
  const msgs = []; const _n = window.notify; window.notify = (t, ...a) => { msgs.push(String(t)); return _n(t, ...a); };

  const heften = (m, ziel, punkt) => {
    ziel.updateMatrixWorld(true);
    const zb = new THREE.Box3().setFromObject(ziel), zc = zb.getCenter(new THREE.Vector3());
    const rc = new THREE.Raycaster(new THREE.Vector3(zc.x + punkt.x, zb.min.y + punkt.y, zb.max.z + 10), new THREE.Vector3(0, 0, -1));
    const hits = rc.intersectObject(ziel, true).filter(h => h.object.isMesh && !h.object.userData.isEdgeLines);
    _svgSnapHit = hits[0];
    _applySvgSnap(m, { obj: ziel, type: 'face' });
    m.updateMatrixWorld(true);
    return hits[0] && hits[0].point.z;
  };
  const erhaben = (m, mm) => { selectObjs([m]); numChanged('sh', mm); m.updateMatrixWorld(true); };
  const vorZ = o => new THREE.Box3().setFromObject(o).max.z;

  // Schicht 1: Tannen unten links, 2 mm
  const s1 = _importSvgConfirm({ svgText: svgA, mode: 'extrude', depthMM: 3, targetMM: 60, name: 'Tannen1' });
  box.position.set(0, 5, 0); box.updateMatrixWorld(true);
  const hit1 = heften(s1, box, { x: -2, y: 3 });
  erhaben(s1, 2);
  const s1z = vorZ(s1);
  selectObjs([box, s1]); await unionSelected();
  const k1 = objects.find(o => /^Verschmolzen/.test(o.userData.name));
  if (!k1) return { stufe: 1, msgs, names: objects.map(o => o.userData.name) };
  const k1z = vorZ(k1);

  // Schicht 2: versetzte Tannen, teils ÜBER Schicht 1, 4 mm
  const s2 = _importSvgConfirm({ svgText: svgB, mode: 'extrude', depthMM: 3, targetMM: 60, name: 'Tannen2' });
  k1.updateMatrixWorld(true);
  const hit2 = heften(s2, k1, { x: 1, y: 3.5 });
  const s2zVor = vorZ(s2);
  erhaben(s2, 4);
  const s2z = vorZ(s2);
  const s2min = new THREE.Box3().setFromObject(s2).min.z;
  selectObjs([k1, s2]); await unionSelected();
  const k2 = objects.find(o => /^Verschmolzen/.test(o.userData.name) && o !== k1);
  // Schicht 3 direkt AUF eine Tanne von Schicht 1 gelegt (Mitte von Tanne 2, unteres Drittel)
  const s3 = _importSvgConfirm({ svgText: svgA, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'Tannen3' });
  k2.updateMatrixWorld(true);
  // Punkt suchen, an dem der Strahl auf dem 2-mm-Relief von Schicht 1 landet
  let ziel3 = null;
  { const zb = new THREE.Box3().setFromObject(k2), zc = zb.getCenter(new THREE.Vector3());
    for (let x = -5; x <= 0 && !ziel3; x += 0.05) for (let y = 0.5; y <= 6 && !ziel3; y += 0.05) {
      const rc = new THREE.Raycaster(new THREE.Vector3(zc.x + x, zb.min.y + y, zb.max.z + 10), new THREE.Vector3(0, 0, -1));
      const h = rc.intersectObject(k2, true).filter(h => h.object.isMesh && !h.object.userData.isEdgeLines)[0];
      if (h && Math.abs(h.point.z - (wandZ + 0.2)) < 0.005) ziel3 = { x, y };
    } }
  const hit3 = ziel3 ? heften(s3, k2, ziel3) : null;
  erhaben(s3, 3);
  const s3z = vorZ(s3), s3min = new THREE.Box3().setFromObject(s3).min.z;
  const s3D = s3.userData._snapFaceD;
  const ft = _svgFlatTarget(s3);                       // so findet das Gleiten die Fläche wieder
  const s3ftOk = !!ft && Math.abs(ft.planeD - s3D) < 1e-6;
  const s3zNachFt = vorZ(s3);

  // Gegenprobe Namensschild: erhabene Platte (5 mm) mit kleinem Schriftzug darauf
  // → der Schriftzug passt ganz aufs Schild und muss dort bleiben.
  const sch = _importSvgConfirm({ svgText: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M0,0 H100 V40 H0 Z"/></svg>', mode: 'extrude', depthMM: 3, targetMM: 50, name: 'Schild' });
  k2.updateMatrixWorld(true);
  heften(sch, k2, { x: 2.5, y: 7.5 }); erhaben(sch, 5);
  selectObjs([k2, sch]); await unionSelected();
  const k3 = objects.find(o => /^Verschmolzen/.test(o.userData.name) && o !== k1 && o !== k2);
  const txt = _importSvgConfirm({ svgText: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><path d="M0,0 H30 V20 H0 Z M40,0 H70 V20 H40 Z"/></svg>', mode: 'extrude', depthMM: 3, targetMM: 30, name: 'Name' });
  let ziel4 = null;
  { const zb = new THREE.Box3().setFromObject(k3), zc = zb.getCenter(new THREE.Vector3());
    for (let x = 0; x <= 6 && !ziel4; x += 0.1) for (let y = 5; y <= 10 && !ziel4; y += 0.1) {
      const rc = new THREE.Raycaster(new THREE.Vector3(zc.x + x, zb.min.y + y, zb.max.z + 10), new THREE.Vector3(0, 0, -1));
      const h = rc.intersectObject(k3, true).filter(h => h.object.isMesh && !h.object.userData.isEdgeLines)[0];
      if (h && Math.abs(h.point.z - (wandZ + 0.5)) < 0.005) ziel4 = { x, y };
    } }
  const hit4 = ziel4 ? heften(txt, k3, ziel4) : null;
  const txtMin = new THREE.Box3().setFromObject(txt).min.z, txtSurf = txt.localToWorld(txt.userData._snapSurfaceLocal.clone()).z;
  window.notify = _n;
  return { hit3, s3z, s3min, s3ftOk, s3zNachFt, hit4, txtSurf, txtMin, wandZ, hit1, s1z, k1z, hit2, s2zVor, s2z, s2min, k2z: k2 && vorZ(k2), k2: !!k2, msgs };
}, [TANNE(0), TANNE(30)]);
console.log(JSON.stringify(r, null, 1));
const mm = v => +((v - r.wandZ) * 10).toFixed(2);
ok('Schicht 1 ragt 2 mm aus der Wand', r.s1z != null && Math.abs(mm(r.s1z) - 2) < 0.1, mm(r.s1z));
ok('vereint 1', r.k1z != null && Math.abs(mm(r.k1z) - 2) < 0.1, r.k1z != null && mm(r.k1z));
ok('Schicht 2 ragt 4 mm aus der WAND (nicht aus Schicht 1)', r.s2z != null && Math.abs(mm(r.s2z) - 4) < 0.1, r.s2z != null && mm(r.s2z));
ok('Schicht 2 sitzt auf der Wand', r.s2min != null && mm(r.s2min) <= 0.05, r.s2min != null && mm(r.s2min));
ok('vereint 2', r.k2 && Math.abs(mm(r.k2z) - 4) < 0.1, r.k2z != null && mm(r.k2z));
ok('Schicht 3 auf Tanne gelegt: Treffer lag auf dem Relief (Testaufbau)', r.hit3 != null && mm(r.hit3) > 1.5, r.hit3 != null && mm(r.hit3));
ok('Schicht 3 zählt trotzdem von der Wand: 3 mm', r.s3z != null && Math.abs(mm(r.s3z) - 3) < 0.1, r.s3z != null && mm(r.s3z));
ok('Schicht 3 sitzt auf der Wand', r.s3min != null && mm(r.s3min) < 0, r.s3min != null && mm(r.s3min));
ok('Gleiten findet die Wand hinter dem Relief wieder', r.s3ftOk && Math.abs(mm(r.s3zNachFt) - 3) < 0.1, { ok: r.s3ftOk, z: mm(r.s3zNachFt) });
ok('Namensschild: Treffer auf dem Schild (Testaufbau)', r.hit4 != null && Math.abs(mm(r.hit4) - 5) < 0.05, r.hit4 != null && mm(r.hit4));
ok('Namensschild: Schriftzug bleibt auf dem Schild', r.txtSurf != null && Math.abs(mm(r.txtSurf) - 5) < 0.05, mm(r.txtSurf));
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
