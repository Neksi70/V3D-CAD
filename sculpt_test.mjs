// Headless-Check des Skulptier-Pinsels gegen den --dev-Server (Port 8766).
// Prüft: Verschweißen (Nahtstellen reißen nicht auf), Hub in mm, Falloff,
// Abtragen/Glätten/Flach, Symmetrie, Verfeinern, Undo-Cache, Parametrik-Ablösung.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 400)));
await page.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.openSculptTool === 'function', null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { document.querySelectorAll('.g3dm.show,#start-modal.show').forEach(m => m.classList.remove('show')); });

const res = await page.evaluate(() => {
  const out = {};

  // Kanten-Bilanz auf VERSCHWEISSTEN Positionen + Volumen
  function shell(mesh) {
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
    const triN = (idx ? idx.count : pos.count) / 3, pa = pos.array;
    const key = new Map(), gid = new Int32Array(pos.count);
    let G = 0;
    for (let i = 0; i < pos.count; i++) {
      const k = Math.round(pa[i*3]*1e4)+'_'+Math.round(pa[i*3+1]*1e4)+'_'+Math.round(pa[i*3+2]*1e4);
      let id = key.get(k); if (id === undefined) { id = G++; key.set(k, id); }
      gid[i] = id;
    }
    const e = new Map();
    let vol = 0;
    for (let t = 0; t < triN; t++) {
      const i0 = idx ? idx.getX(t*3) : t*3, i1 = idx ? idx.getX(t*3+1) : t*3+1, i2 = idx ? idx.getX(t*3+2) : t*3+2;
      const a = gid[i0], b = gid[i1], c = gid[i2];
      for (const [u, v] of [[a,b],[b,c],[c,a]]) {
        const k = u < v ? u+':'+v : v+':'+u;
        e.set(k, (e.get(k) || 0) + 1);
      }
      const ax=pa[i0*3],ay=pa[i0*3+1],az=pa[i0*3+2], bx=pa[i1*3],by=pa[i1*3+1],bz=pa[i1*3+2], cx=pa[i2*3],cy=pa[i2*3+1],cz=pa[i2*3+2];
      vol += (ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx)) / 6;
    }
    let open = 0, nm = 0;
    for (const n of e.values()) { if (n === 1) open++; else if (n > 2) nm++; }
    return { tris: triN, verts: pos.count, groups: G, open, nm, vol: +vol.toFixed(4) };
  }
  const dupCount = (mesh) => {   // Vertices, die auf einer schon belegten Position sitzen
    const pa = mesh.geometry.attributes.position.array, n = mesh.geometry.attributes.position.count;
    const s = new Set();
    for (let i = 0; i < n; i++) s.add(Math.round(pa[i*3]*1e4)+'_'+Math.round(pa[i*3+1]*1e4)+'_'+Math.round(pa[i*3+2]*1e4));
    return n - s.size;
  };
  const snap = (m) => Array.from(m.geometry.attributes.position.array);
  const maxShiftMm = (a, b) => {
    let m = 0;
    for (let i = 0; i < a.length; i += 3) m = Math.max(m, Math.hypot(a[i]-b[i], a[i+1]-b[i+1], a[i+2]-b[i+2]));
    return m * 10;
  };
  // mittlere lokale Rauheit (|p − Mittel der Nachbarn|) im Pinsel, in mm
  const localRough = (mesh, c, r) => {
    const sc = mesh.geometry.userData._sc, pa = mesh.geometry.attributes.position.array;
    let s = 0, cnt = 0;
    for (let gi = 0; gi < sc.G; gi++) {
      const vi = sc.gRep[gi];
      if (Math.hypot(pa[vi*3]-c.x, pa[vi*3+1]-c.y, pa[vi*3+2]-c.z) > r) continue;
      let ax=0, ay=0, az=0, n=0;
      for (let k = sc.nStart[gi]; k < sc.nStart[gi+1]; k++) { const nv = sc.gRep[sc.nList[k]]; ax+=pa[nv*3]; ay+=pa[nv*3+1]; az+=pa[nv*3+2]; n++; }
      if (!n) continue;
      s += Math.hypot(ax/n-pa[vi*3], ay/n-pa[vi*3+1], az/n-pa[vi*3+2]); cnt++;
    }
    return cnt ? +(s/cnt*10).toFixed(4) : 0;
  };
  const surfaceHit = (mesh, from, dir) => {
    const rc = new THREE.Raycaster();
    rc.set(from, dir.clone().normalize());
    const h = rc.intersectObject(mesh, true).filter(x => x.object.isMesh);
    return h.length ? h[0] : null;
  };

  // ── Testkörper 1: Übertopf (indiziert, glatt, feines Netz)
  Object.assign(_oplP, _OPL_DEFAULTS, { saucer: 0, h: 100, dia: 100 });
  _createOplPlanter();
  const pot = objects[objects.length - 1];
  pot.updateMatrixWorld(true);
  out.potBefore = shell(pot);
  out.potParametricBefore = { type: pot.userData.type, shapeType: pot.userData.shapeType };

  openSculptTool();
  _sculptSetRadius(15); _sculptSetStrength(1.0); _sculptSetMode('raise');

  const bb = new THREE.Box3().setFromObject(pot);
  const yMid = (bb.min.y + bb.max.y) / 2;
  const hit = surfaceHit(pot, new THREE.Vector3(bb.max.x * 3, yMid, 0), new THREE.Vector3(-1, 0, 0));
  out.hitFound = !!hit;
  const P = hit.point.clone();

  // 1) Ein Abdruck „Aufbauen" mit 1,0 mm Stärke → Spitzenhub ≈ 1,0 mm
  const p0 = snap(pot);
  _sculptApplyAt(pot, P, 'raise', false);
  const p1 = snap(pot);
  out.raiseMaxMm = +maxShiftMm(p0, p1).toFixed(3);
  out.potAfterRaise = shell(pot);

  // 2) Falloff: am Pinselrand darf fast nichts mehr passieren
  {
    let nah = 0, rand = 0;
    for (let i = 0; i < p0.length; i += 3) {
      const d = Math.hypot(p0[i]-P.x, p0[i+1]-P.y, p0[i+2]-P.z);
      const mv = Math.hypot(p1[i]-p0[i], p1[i+1]-p0[i+1], p1[i+2]-p0[i+2]);
      if (d < 0.3) nah = Math.max(nah, mv);
      if (d > 1.35 && d < 1.5) rand = Math.max(rand, mv);
    }
    out.falloff = { nahMm: +(nah*10).toFixed(3), randMm: +(rand*10).toFixed(4) };
  }

  // 3) „Abtragen" muss die Richtung umkehren
  _sculptApplyAt(pot, P, 'lower', false);
  {
    const pa = pot.geometry.attributes.position.array;
    let dot = 0, back = 0, n = 0;
    for (let i = 0; i < p0.length; i += 3) {
      const d1 = [p1[i]-p0[i], p1[i+1]-p0[i+1], p1[i+2]-p0[i+2]];
      const d2 = [pa[i]-p1[i], pa[i+1]-p1[i+1], pa[i+2]-p1[i+2]];
      dot += d1[0]*d2[0] + d1[1]*d2[1] + d1[2]*d2[2];
      if (Math.hypot(...d1) > 1e-7) { back += Math.hypot(pa[i]-p0[i], pa[i+1]-p0[i+1], pa[i+2]-p0[i+2]); n++; }
    }
    out.lower = { gegenlaeufig: dot < 0, restMm: n ? +(back/n*10).toFixed(4) : -1 };
  }

  // 4) Glätten senkt die lokale Rauheit
  _sculptSetStrength(1.0);
  _sculptApplyAt(pot, P, 'raise', false);      // erst wieder eine Beule
  out.smoothVorher = localRough(pot, P, 0.5);   // gut innerhalb des 15-mm-Pinsels messen
  for (let k = 0; k < 8; k++) _sculptApplyAt(pot, P, 'smooth', false);
  out.smoothNachher = localRough(pot, P, 0.5);
  out.potAfterSmooth = shell(pot);

  // 5) Flach: Streuung der Abstände zur Anstichebene muss sinken
  _sculpt.planeP = P.clone();
  _sculpt.planeN = new THREE.Vector3(1, 0, 0);
  const spread = () => {
    const pa = pot.geometry.attributes.position.array;
    let s = 0, c = 0;
    for (let i = 0; i < pa.length; i += 3) {
      if (Math.hypot(pa[i]-P.x, pa[i+1]-P.y, pa[i+2]-P.z) > 0.9) continue;
      s += Math.abs(pa[i] - P.x); c++;
    }
    return c ? +(s/c*10).toFixed(4) : 0;
  };
  out.flatVorher = spread();
  _sculptSetStrength(1.5);
  for (let k = 0; k < 10; k++) _sculptApplyAt(pot, P, 'flatten', false);
  out.flatNachher = spread();

  // 6) Symmetrie
  _sculpt.symX = true; _sculptSetStrength(1.0);
  const p3 = snap(pot);
  _sculptApplyAt(pot, P, 'raise', false);
  {
    const pa = pot.geometry.attributes.position.array;
    let plus = 0, minus = 0;
    for (let i = 0; i < p3.length; i += 3) {
      if (Math.hypot(pa[i]-p3[i], pa[i+1]-p3[i+1], pa[i+2]-p3[i+2]) > 1e-6) { if (p3[i] > 0) plus++; else minus++; }
    }
    out.symmetry = { plusX: plus, minusX: minus };
  }
  _sculpt.symX = false;

  // 7) Parametrik gelöst + JSON-Cache verworfen (sonst sichert Undo den alten Stand)
  out.potParametricAfter = { type: pot.userData.type, shapeType: pot.userData.shapeType };
  out.cacheFresh = _cachedGeoJSON(pot.geometry).data.attributes.position.array.length / 3
                   === pot.geometry.attributes.position.count;

  // ── Testkörper 2: Würfel — grob, nicht indiziert, MIT doppelten Vertices an
  //    jeder Kante. Genau der Fall, bei dem ein Pinsel ohne Verschweißen aufreißt.
  addShape('box');
  const box = objects[objects.length - 1];
  box.updateMatrixWorld(true);
  _sculpt.target = box;
  out.boxBefore = shell(box);
  out.boxDupBefore = dupCount(box);
  _sculptSetRadius(6);
  _sculptRefine();
  out.boxAfter = shell(box);
  out.boxDupAfterRefine = dupCount(box);

  const bb2 = new THREE.Box3().setFromObject(box);
  const hit2 = surfaceHit(box, new THREE.Vector3(bb2.max.x * 4, (bb2.min.y+bb2.max.y)/2, 0), new THREE.Vector3(-1, 0, 0));
  _sculptSetStrength(0.8);
  // direkt auf eine Würfelkante zielen — dort liegen die doppelten Vertices
  const edgeP = new THREE.Vector3(bb2.max.x, bb2.max.y, 0);
  _sculptApplyAt(box, hit2 ? hit2.point : edgeP, 'raise', false);
  _sculptApplyAt(box, edgeP, 'raise', false);
  out.boxSculpted = shell(box);
  out.boxDupAfterSculpt = dupCount(box);

  _sculptClose();
  return out;
});

console.log(JSON.stringify(res, null, 2));

let fail = 0;
const t = (name, ok, info) => { if (!ok) { fail++; console.log('FAIL ' + name + '   ' + (info||'')); } else console.log('ok   ' + name + '   ' + (info||'')); };

t('Oberflächenpunkt getroffen', res.hitFound);
t('Topf vorher wasserdicht', res.potBefore.open === 0 && res.potBefore.nm === 0);
t('Hub entspricht der Stärke (1,0 mm)', Math.abs(res.raiseMaxMm - 1.0) < 0.05, res.raiseMaxMm + ' mm');
t('Aufbauen lässt das Netz geschlossen', res.potAfterRaise.open === 0 && res.potAfterRaise.nm === 0,
  'open=' + res.potAfterRaise.open + ' nm=' + res.potAfterRaise.nm);
t('Falloff: Pinselrand bewegt sich kaum', res.falloff.randMm < res.falloff.nahMm * 0.05,
  'Mitte ' + res.falloff.nahMm + ' mm vs. Rand ' + res.falloff.randMm + ' mm');
t('Abtragen läuft gegenläufig', res.lower.gegenlaeufig);
// Restversatz kommt daher, dass die Normalen nach dem Aufbauen neu berechnet
// werden — das Abtragen folgt also der neuen Oberfläche. 5 % vom Hub sind ok.
t('Abtragen hebt Aufbauen praktisch auf', res.lower.restMm < 0.05, 'Restversatz ø ' + res.lower.restMm + ' mm bei 1 mm Hub');
t('Glätten senkt die Rauheit', res.smoothNachher < res.smoothVorher * 0.5,
  res.smoothVorher + ' → ' + res.smoothNachher + ' mm');
t('nach Glätten noch geschlossen', res.potAfterSmooth.open === 0 && res.potAfterSmooth.nm === 0);
t('Flach zieht auf die Ebene', res.flatNachher < res.flatVorher * 0.6, res.flatVorher + ' → ' + res.flatNachher + ' mm');
t('Symmetrie trifft beide Seiten', res.symmetry.plusX > 0 && res.symmetry.minusX > 0, JSON.stringify(res.symmetry));
t('Parametrik gelöst', res.potParametricAfter.type === 'custom' && !res.potParametricAfter.shapeType,
  JSON.stringify(res.potParametricBefore) + ' → ' + JSON.stringify(res.potParametricAfter));
t('Undo/Speicher-Cache aktuell', res.cacheFresh);

t('Würfel hat doppelte Vertices (Verschweißen relevant)', res.boxDupBefore > 0, res.boxDupBefore + ' doppelte Positionen');
t('Verfeinern: Würfel wird feiner', res.boxAfter.tris > res.boxBefore.tris * 10,
  res.boxBefore.tris + ' → ' + res.boxAfter.tris + ' Dreiecke');
t('Verfeinern verändert das Volumen nicht', Math.abs(res.boxAfter.vol - res.boxBefore.vol) < 1e-3,
  res.boxBefore.vol + ' → ' + res.boxAfter.vol);
t('Verfeinerter Würfel bleibt geschlossen', res.boxAfter.open === 0 && res.boxAfter.nm === 0,
  'open=' + res.boxAfter.open + ' nm=' + res.boxAfter.nm);
t('Pinsel auf der Würfelkante reißt nichts auf', res.boxSculpted.open === 0 && res.boxSculpted.nm === 0,
  'open=' + res.boxSculpted.open + ' nm=' + res.boxSculpted.nm);
t('doppelte Vertices wandern gemeinsam', res.boxDupAfterSculpt === res.boxDupAfterRefine,
  res.boxDupAfterRefine + ' → ' + res.boxDupAfterSculpt);

await browser.close();
process.exit(fail ? 1 : 0);
