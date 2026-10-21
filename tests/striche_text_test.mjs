// Ralf 9.10.: Name „Simone“ vertieft in die schräge Lehne eines Handyständers →
// schwarze Striche von den Buchstaben zu den Plattenecken, „er druckt das mit“.
// Prüft nach dem Anbringen: Kanten-Linien auf der Lehnen-Vorderseite + Dreiecke
// außerhalb der Ebene (echte Grate) + entartete Splitter.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = +(process.env.PORT || 8863), KIPP = +(process.env.KIPP ?? 20), ART = process.env.ART || 'tief', SZENE = process.env.SZENE || 'nativ';
const URL = process.env.V3D_URL || `http://localhost:${PORT}/volme3d.html`;
let srv = null;
if (!process.env.V3D_URL) { srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500)); }
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); if (process.env.LOG) pg.on('console', m => { const t = m.text(); if (/subtract|Manifold|OCCT|BSP|Fehler|Abzug|fail|error/i.test(t)) console.log('  [log]', t.slice(0, 220)); });
const log = (...a) => console.log(...a);
let fehler = 0;
try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
  await pg.evaluate(([KIPP, SZENE]) => {
    hideStarter(); _newCreate(false); setShapeMode('solid');
    let L;
    if (SZENE === 'import') {
      // Lehne als STL (mm, Z oben) — wie ein heruntergeladener Handyständer
      const g = new THREE.BoxGeometry(80, 6, 100); g.rotateX(-KIPP * Math.PI / 180); g.translate(0, 0, 50);
      const ng = g.toNonIndexed(), pp = ng.attributes.position, n = pp.count / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
      dv.setUint32(80, n, true);
      for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) dv.setFloat32(84 + t * 50 + 12 + k * 12 + c * 4, pp.array[(t * 3 + k) * 3 + c], true);
      _addImportedStl(buf, 'staender.stl', false); L = objects[objects.length - 1];
    } else {
      addShape('box'); L = objects[objects.length - 1]; selectObjs([L]);
      numChanged('sw', 80); numChanged('sd', 6); numChanged('sh', 100);
      if (KIPP) { updateTFInputs(); document.getElementById('rx').value = KIPP; applyTF(); }
    }
    L.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(L); L.position.y -= bx.min.y; L.updateMatrixWorld(true);
    if (SZENE === 'rund') {   // Lehne mit gerollter Oberkante, vereint und als STL wieder importiert
      const lb = new THREE.Box3().setFromObject(L);
      addShape('cylinder'); const Z = objects[objects.length - 1]; selectObjs([Z]); numChanged('sw', 12); numChanged('sd', 12); numChanged('sh', 80);
      Z.rotation.z = Math.PI / 2; Z.updateMatrixWorld(true);
      const zb = new THREE.Box3().setFromObject(Z), top = new THREE.Vector3(0, lb.max.y, 0);
      // Rolle an die Oberkante der Lehne
      const ec = []; { const p = L.geometry.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(L.matrixWorld); ec.push(v.clone()); } }
      const topPts = ec.filter(v => v.y > lb.max.y - 0.05), cz = topPts.reduce((s, v) => s + v.z, 0) / topPts.length;
      Z.position.x += 0 - (zb.min.x + zb.max.x) / 2; Z.position.y += (lb.max.y - 0.3) - (zb.min.y + zb.max.y) / 2; Z.position.z += cz - (zb.min.z + zb.max.z) / 2; Z.updateMatrixWorld(true);
      window._rundTodo = [L, Z];
    }
    { // Vorderseite (zur Kamera, +Z) samt Ausdehnung in der Ebene merken
      const g = L.geometry.index ? L.geometry.toNonIndexed() : L.geometry, p = g.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let best = null; const tri = [];
      for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i).applyMatrix4(L.matrixWorld); b.fromBufferAttribute(p, i + 1).applyMatrix4(L.matrixWorld); c.fromBufferAttribute(p, i + 2).applyMatrix4(L.matrixWorld);
        const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize(); tri.push([a.clone(), b.clone(), c.clone(), n]); if (!best || n.z > best.z) best = n; }
      const nF = best.clone(), U = new THREE.Vector3(1, 0, 0), V = nF.clone().cross(U).normalize(), fb = [1e9, -1e9, 1e9, -1e9];
      for (const [a, b, c, n] of tri) if (n.dot(nF) > 0.999) for (const v of [a, b, c]) { const u = v.dot(U), w = v.dot(V); fb[0] = Math.min(fb[0], u); fb[1] = Math.max(fb[1], u); fb[2] = Math.min(fb[2], w); fb[3] = Math.max(fb[3], w); }
      window._nF = nF; window._U = U; window._V = V; window._fb = fb;
    }
    window._L = L; deselect(); setView('front'); fitView();
  }, [KIPP, SZENE]);
  if (SZENE === 'rund') {
    await pg.evaluate(() => { selectObjs(window._rundTodo); return unionSelected(); });
    for (let i = 0; i < 60 && await pg.evaluate(() => objects.length !== 1); i++) await pg.waitForTimeout(500);
    await pg.evaluate(async () => { const r = _buildStlBlob([objects[0]]); const blob = r.blob || r; const buf = await blob.arrayBuffer();
      const o = objects[0]; scene.remove(o); objects.length = 0; _addImportedStl(buf, 'staender.stl', false); const L = objects[0];
      L.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(L); L.position.y -= bx.min.y; L.updateMatrixWorld(true);
      const g = L.geometry.index ? L.geometry.toNonIndexed() : L.geometry, p = g.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      let best = null; const tri = [];
      for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i).applyMatrix4(L.matrixWorld); b.fromBufferAttribute(p, i + 1).applyMatrix4(L.matrixWorld); c.fromBufferAttribute(p, i + 2).applyMatrix4(L.matrixWorld);
        const n = b.clone().sub(a).cross(c.clone().sub(a)); const ar = n.length(); n.normalize(); tri.push([a.clone(), b.clone(), c.clone(), n]); if (ar > 1 && (!best || n.z > best.z)) best = n; }
      const nF = best.clone(), U = new THREE.Vector3(1, 0, 0), V = nF.clone().cross(U).normalize(), fb = [1e9, -1e9, 1e9, -1e9];
      const dF = Math.max(...tri.filter(t => t[3].dot(nF) > 0.999).map(t => t[0].dot(nF)));
      for (const [a, b, c, n] of tri) if (n.dot(nF) > 0.999 && Math.abs(a.dot(nF) - dF) < 0.002) for (const v of [a, b, c]) { const u = v.dot(U), w = v.dot(V); fb[0] = Math.min(fb[0], u); fb[1] = Math.max(fb[1], u); fb[2] = Math.min(fb[2], w); fb[3] = Math.max(fb[3], w); }
      window._nF = nF; window._U = U; window._V = V; window._fb = fb; window._L = L; deselect(); setView('front'); fitView(); });
  }
  await pg.mouse.click(1490, 400); await pg.waitForTimeout(300);
  await pg.evaluate(() => addTextShape()); await pg.waitForTimeout(400);
  await pg.fill('#text3d-input', 'Simone');
  await pg.locator('#text3d-modal button', { hasText: 'Erstellen' }).last().click();
  await pg.waitForFunction(() => objects.some(o => o.userData.shapeType === 'svg'), null, { timeout: 20000 });
  await pg.waitForTimeout(400);
  // Punkt oben auf der Lehnen-Vorderseite (Normale = Lehnen-Front) per Raycast suchen
  await pg.evaluate(() => { setView('front'); fitView(); }); await pg.waitForTimeout(500);
  const ziel = await pg.evaluate(() => { const L = _L; L.updateMatrixWorld(true); const r = canvas.getBoundingClientRect();
    const nF = _nF; let best = null;
    for (let y = r.top + 5; y < r.bottom; y += 6) for (let x = r.left + 5; x < r.right; x += 6) {
      mousev.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); raycaster.setFromCamera(mousev, camera);
      const h = raycaster.intersectObject(L, false)[0]; if (!h) continue;
      const n = h.face.normal.clone().transformDirection(L.matrixWorld); if (n.dot(nF) < 0.99) continue;
      if (!best || h.point.y > best.y) best = { x, y: h.point.y, sy: y, px: h.point.x };
    }
    if (!best) return null;
    // ~25 mm unter der Oberkante, mittig
    let z = null; for (let y = best.sy; y < r.bottom; y += 3) { mousev.set((best.x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); raycaster.setFromCamera(mousev, camera);
      const h = raycaster.intersectObject(L, false)[0]; if (h && best.y - h.point.y > 2.5) { z = [best.x, y]; break; } }
    // mittig in X
    const cx = (() => { const v = new THREE.Vector3(L.position.x, 0, 0); for (let x = r.left; x < r.right; x += 3) { mousev.set((x - r.left) / r.width * 2 - 1, -(z[1] - r.top) / r.height * 2 + 1); raycaster.setFromCamera(mousev, camera); const h = raycaster.intersectObject(L, false)[0]; if (h && h.point.x >= L.position.x) return x; } return z[0]; })();
    return [cx, z[1]]; });
  await pg.mouse.move(ziel[0], ziel[1]); await pg.waitForTimeout(200); await pg.mouse.click(ziel[0], ziel[1]); await pg.waitForTimeout(800);
  if (process.env.DBG) { await pg.screenshot({ path: "/tmp/ralf/dbg.png" }); log("ziel", ziel, JSON.stringify(await pg.evaluate(([x,y]) => ({ pick: !!_lblPick, el: document.elementFromPoint(x,y).id, toast: [...document.querySelectorAll(".notif,.toast,#notify,[class*=notif]")].map(e=>e.innerText).join("/"), lblpop: document.getElementById("lbl-pop").style.display }), ziel))); }
  if (ART === 'hoch') await pg.evaluate(() => { const r = document.querySelector('#lbl-pop [data-art="hoch"], #lbl-pop input[value="hoch"]'); if (r) r.click(); else _lblArt = 'hoch'; });
  if (ART === 'durch') {
    // wie Ralf (Video 21.10.): Text als Bohrung, Abziehen → Dialog „Durchbruch“
    await pg.evaluate(async () => { _lblClose(); const t = objects.find(o => o.userData.shapeType === 'svg'), K = objects.find(o => o !== t);
      t.userData.isHole = true; selectObjs([K, t]); _engravePreset = { depth: 0.6, wantInlay: false, through: true }; await subtractHoles();
      for (let i = 0; i < 240 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 500)); });
  } else await pg.locator('#lbl-pop button', { hasText: 'Anbringen' }).click();
  for (let i = 0; i < 60 && await pg.evaluate(() => objects.some(o => o.userData.shapeType === 'svg')); i++) await pg.waitForTimeout(1000);
  const analyse = (seite) => pg.evaluate((seite) => {
    const o = objects[0]; o.updateMatrixWorld(true);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.attributes.position;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    // Vorderseite = Normale ≈ Lehnen-Normale −Z lokal
    const nF = _nF.clone().multiplyScalar(seite);
    let dMax = -1e9; for (let i = 0; i < p.count; i++) { A.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); dMax = Math.max(dMax, A.dot(nF)); }
    let entartet = 0, langEntartet = 0, entLang = 0, schief = 0, ausserhalb = 0, maxAbw = 0; const bsp = [];
    for (let i = 0; i < p.count; i += 3) {
      A.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(p, i + 1).applyMatrix4(o.matrixWorld); C.fromBufferAttribute(p, i + 2).applyMatrix4(o.matrixWorld);
      const ab = B.clone().sub(A), ac = C.clone().sub(A), n = ab.clone().cross(ac), fl = n.length() / 2;
      const ds = [A, B, C].map(v => dMax - v.dot(nF));
      const aufFront = ds.filter(d => Math.abs(d) < 0.02).length >= 2;     // ≥2 Ecken in der Frontebene (±0,2 mm)
      if (!aufFront) continue;
      const lmax = Math.max(ab.length(), ac.length(), B.distanceTo(C));
      if (fl < 1e-7 || fl / (lmax * lmax) < 1e-5) { entartet++; if (lmax > 0.3) langEntartet++; entLang = Math.max(entLang, lmax * 10); continue; }
      n.normalize(); const w = Math.acos(Math.min(1, Math.abs(n.dot(nF)))) * 180 / Math.PI;
      const abw = Math.max(...ds.map(Math.abs)) * 10;
      if (ds.every(d => Math.abs(d) < 0.02) && w > 1) { schief++; maxAbw = Math.max(maxAbw, abw); if (bsp.length < 6) bsp.push({ w: +w.toFixed(1), abw_mm: +abw.toFixed(4), lang_mm: +(lmax * 10).toFixed(1) }); }
    }
    const eg = new THREE.EdgesGeometry(o.geometry, 30); const ep = eg.attributes.position; let langeLinien = 0;
    for (let i = 0; i < ep.count; i += 2) { A.fromBufferAttribute(ep, i).applyMatrix4(o.matrixWorld); B.fromBufferAttribute(ep, i + 1).applyMatrix4(o.matrixWorld);
      if (Math.abs(dMax - A.dot(nF)) < 0.002 && Math.abs(dMax - B.dot(nF)) < 0.002 && A.distanceTo(B) > 1.5) { const m = A.clone().add(B).multiplyScalar(0.5), u = m.dot(_U), w = m.dot(_V); if (u > _fb[0] + 0.05 && u < _fb[1] - 0.05 && w > _fb[2] + 0.05 && w < _fb[3] - 0.05) langeLinien++; } }
    const kk = v => [v.x, v.y, v.z].map(x => Math.round(x * 1e5)).join(','), km = new Map();
    for (let i = 0; i < p.count; i += 3) { const vs = [0, 1, 2].map(j => kk(A.fromBufferAttribute(p, i + j))); for (let j = 0; j < 3; j++) { const e = [vs[j], vs[(j + 1) % 3]].sort().join('|'); km.set(e, (km.get(e) || 0) + 1); } }
    let offen = 0; km.forEach(n => { if (n !== 2) offen++; });
    return { offeneKanten: offen, objekte: objects.length, typ: o.userData.shapeType, dreiecke: p.count / 3, entartet, langEntartet, entLang_mm: +entLang.toFixed(2), schief, maxAbw_mm: +maxAbw.toFixed(4), bsp, langeLinienAufFront: langeLinien };
  }, seite);
  const r = await analyse(1), rh = await analyse(-1);
  log('Ergebnis vorne:', JSON.stringify(r));
  log('Ergebnis hinten:', JSON.stringify({ entartet: rh.entartet, langEntartet: rh.langEntartet, entLang_mm: rh.entLang_mm, schief: rh.schief, bsp: rh.bsp, langeLinien: rh.langeLinienAufFront }));
  // sichtbar sind nur LANGE Splitter (Ralfs Striche liefen über Zentimeter); Restsplitter < 3 mm aus dem Boolean sind harmlos
  if (rh.langEntartet > 0 || rh.langeLinienAufFront > 0 || rh.maxAbw_mm > 0.01) { fehler++; log('FEHLER: Rückseite hat Striche (lange Splitter/Kantenlinien)'); }
  if (r.langEntartet > 0) { fehler++; log('FEHLER: lange Splitter auf der Vorderseite'); }
  await pg.evaluate(() => { selectObjs([]); setView('front'); fitView(); }); await pg.waitForTimeout(500);
  await pg.screenshot({ path: `/tmp/ralf/striche_${KIPP}_${ART}_${SZENE}.png` });
  // BILD_HINTEN: Rückseite schräg von hinten, wie in Ralfs Video
  await pg.evaluate(() => { selectObjs([]); const o = objects[0]; _updateObjEdgeLines(o); const bb = new THREE.Box3().setFromObject(o); orbitTarget.copy(bb.getCenter(new THREE.Vector3())); sph.theta = Math.PI * 0.8; sph.phi = 1.2; sph.r = 25; sph2cam(); });
  await pg.mouse.move(700, 500); await pg.waitForTimeout(800);
  await pg.screenshot({ path: `/tmp/ralf/striche_${KIPP}_${ART}_${SZENE}_hinten.png` });
  if (r.maxAbw_mm > 0.01) { fehler++; log('FEHLER: schiefe Dreiecke auf der Vorderseite (echter Grat)'); }
  if (r.offeneKanten > 0) { fehler++; log('FEHLER: offene Kanten / T-Stöße (Slicer!)'); }
  if (r.langeLinienAufFront > 0) { fehler++; log('FEHLER: lange Kantenlinien quer über die Vorderseite'); }
  log('Seitenfehler:', errs);
} finally { await b.close(); if (srv) srv.kill(); }
process.exit(fehler ? 1 : 0);
