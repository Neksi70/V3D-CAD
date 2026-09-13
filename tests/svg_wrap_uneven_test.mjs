// Josy 13.9.26: "es sind immer Ecken, die dann nicht drauf sind."
// Misst, wie weit ein gewickeltes Motiv von der Wand absteht — auf einer exakt
// runden Vase und auf einer leicht unrunden/welligen (wie echte Modelle).
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,5 H95 V95 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// welligkeit: 0 = exakt rund, sonst Amplitude in mm (ueber den Umfang)
const test = (welligkeit, name) => pg.evaluate(async ([welligkeit, name, svgText]) => {
  objects.slice().forEach(o => { scene.remove(o); objects.splice(objects.indexOf(o), 1); });
  // Vase: bauchiges Profil, optional leicht unrund
  const H = 120, NR = 128, NH = 40;
  const rAt = (t) => 24 + 10 * Math.sin(Math.PI * t);            // bauchig über die Höhe
  const verts = [], idx = [];
  for (let i = 0; i <= NH; i++) {
    const t = i / NH, y = -H / 2 + t * H;
    for (let j = 0; j <= NR; j++) {
      const th = j / NR * Math.PI * 2;
      const r = rAt(t) + welligkeit * Math.sin(5 * th);           // 5 sanfte Wellen
      verts.push(r * Math.cos(th), y, r * Math.sin(th));
    }
  }
  for (let i = 0; i < NH; i++)
    for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j, b2 = a + 1, c = a + NR + 1, d = c + 1;
      idx.push(a, c, b2, b2, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const vase = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x5bc, side: THREE.DoubleSide }));
  vase.scale.set(0.1, 0.1, 0.1); vase.position.set(0, 6, 0);
  vase.userData = { id: idCtr++, name: 'Vase', type: 'import', shapeType: 'import' };
  scene.add(vase); objects.push(vase); vase.updateMatrixWorld(true);

  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: 45, name: 'Motiv' });
  m.userData.isHole = true;
  vase.position.set(0, 6, 0); vase.updateMatrixWorld(true);
  const hit = new THREE.Vector3(rAt(0.5) / 10, 6, 0);
  const p = _svgWrapProbe(vase, hit);
  if (!p) return { name, gewickelt: false };
  window._wrapDbg = [];
  _svgWrapApply(m, p, hit);
  m.updateMatrixWorld(true);

  // Abstand zur echten Vasenwand — per Strahl gegen das NETZ, nicht gegen die
  // Formel: nur so misst man, was der Nutzer sieht.
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  const rc = new THREE.Raycaster();
  const achse = vase.position.clone();
  let maxAb = -Infinity, minAb = Infinity, ueber05 = 0, gezaehlt = 0, wo = null;
  const schritt = Math.max(1, Math.floor(pos.count / 400));   // Stichprobe reicht
  for (let i = 0; i < pos.count; i += schritt) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const dx = v.x - achse.x, dz = v.z - achse.z;
    const r = Math.hypot(dx, dz);
    if (r < 1e-6) continue;
    const dir = new THREE.Vector3(dx / r, 0, dz / r);
    // von weit außen nach innen strahlen, auf gleicher Höhe
    rc.set(new THREE.Vector3(achse.x, v.y, achse.z).addScaledVector(dir, r + 3), dir.clone().negate());
    const h = rc.intersectObject(vase, true).find(t2 => t2.face);
    if (!h) continue;
    const rw = Math.hypot(h.point.x - achse.x, h.point.z - achse.z);
    const d = (r - rw) * 10;
    if (d > maxAb) maxAb = d;
    if (d < minAb) minAb = d;
    if (d > 0.5) { ueber05++; if (!wo || d > wo.d) wo = { d: +d.toFixed(2), y: +v.y.toFixed(2),
      thGrad: +(Math.atan2(dz, dx) * 180 / Math.PI).toFixed(1), rMM: +(r*10).toFixed(2), rwMM: +(rw*10).toFixed(2) }; }
    gezaehlt++;
  }
  return { name, gewickelt: true, maxUeberstandMM: +maxAb.toFixed(2), tiefsteMM: +minAb.toFixed(2),
           punkte: gezaehlt, ueber05mm: ueber05, schlimmster: wo,
           warpMitFeld: (window._wrapDbg||[]).filter(r => r[7]).length,
           warpGesamt: (window._wrapDbg||[]).length,
           feldImSpec: !!(m.userData._svgWrap && m.userData._svgWrap.feld),
           // Gegenprobe: die Punkte, die der Warp AUSGEGEBEN hat, in die Welt
           // transformieren und genauso messen
           warpDirekt: (() => {
             const D = window._wrapDbg || [];
             const rc2 = new THREE.Raycaster();
             let mx = -Infinity;
             for (let i = 0; i < D.length; i += Math.max(1, Math.floor(D.length / 200))) {
               const [u, h, d, th, Rh, rr] = D[i];
               const lp = new THREE.Vector3(rr * Math.cos(th), h, rr * Math.sin(th));
               const wp = lp.applyMatrix4(m.matrixWorld);
               const dx2 = wp.x - achse.x, dz2 = wp.z - achse.z;
               const r2 = Math.hypot(dx2, dz2);
               const dir2 = new THREE.Vector3(dx2 / r2, 0, dz2 / r2);
               rc2.set(new THREE.Vector3(achse.x, wp.y, achse.z).addScaledVector(dir2, r2 + 3), dir2.clone().negate());
               const h2 = rc2.intersectObject(vase, true).find(t3 => t3.face);
               if (!h2) continue;
               const rw2 = Math.hypot(h2.point.x - achse.x, h2.point.z - achse.z);
               mx = Math.max(mx, (r2 - rw2) * 10);
             }
             return +mx.toFixed(2);
           })(),
           // schlimmster Warp-Punkt MIT allen Zwischenwerten
           detail: (() => {
             const D = window._wrapDbg || [];
             const rc3 = new THREE.Raycaster();
             const F = m.userData._svgWrap.feld;
             let best = null;
             for (let i = 0; i < D.length; i += Math.max(1, Math.floor(D.length / 300))) {
               const [u, h, d, th, Rh, rr] = D[i];
               const lp = new THREE.Vector3(rr * Math.cos(th), h, rr * Math.sin(th));
               const wp = lp.clone().applyMatrix4(m.matrixWorld);
               const dx2 = wp.x - achse.x, dz2 = wp.z - achse.z, r2 = Math.hypot(dx2, dz2);
               const dir2 = new THREE.Vector3(dx2 / r2, 0, dz2 / r2);
               rc3.set(new THREE.Vector3(achse.x, wp.y, achse.z).addScaledVector(dir2, r2 + 3), dir2.clone().negate());
               const h3 = rc3.intersectObject(vase, true).find(t4 => t4.face);
               if (!h3) continue;
               const rw3 = Math.hypot(h3.point.x - achse.x, h3.point.z - achse.z);
               const ab = (r2 - rw3) * 10;
               if (!best || ab > best.abMM)
                 best = { abMM: +ab.toFixed(2), uMM: +(u*10).toFixed(1), hMM: +(h*10).toFixed(1),
                          dMM: +(d*10).toFixed(2), thGrad: +(th*180/Math.PI).toFixed(1),
                          RhMM: +(Rh*10).toFixed(2), feldMM: +(_svgWrapFieldR(F, h, th)*10).toFixed(2),
                          netzMM: +(rw3*10).toFixed(2), weltY: +wp.y.toFixed(2),
                          c0y: +m.position.y.toFixed(2) };
             }
             return best;
           })() };
}, [welligkeit, name, SVG]);

const rund = await test(0, 'exakt rund');
console.log(JSON.stringify(rund));
ok('exakt runde Vase: Motiv liegt an (Überstand ≈ 0,2 mm)',
   rund.gewickelt && Math.abs(rund.maxUeberstandMM - 0.2) < 0.6, rund);

const wellig = await test(1.5, 'leicht unrund (±1,5 mm)');
console.log(JSON.stringify(wellig));
ok('leicht unrunde Vase: Motiv liegt trotzdem an', wellig.gewickelt && Math.abs(wellig.maxUeberstandMM - 0.2) < 0.8, wellig);
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
