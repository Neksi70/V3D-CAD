// „Fläche unten" an Scans: robuste Flächennormale + automatisch an den Achsen ausrichten
// (Volker 21.10.: Scan lag nach dem Hinlegen schief/verdreht). Optional echter Scan:
// SCAN=/pfad/scan.3mf node tests/flaeche_unten_ausrichten_test.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import { chromium } from '@playwright/test';
const PORT = 8930;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _fdAlignYaw === 'function' && typeof hideStarter === 'function');
  await page.evaluate(() => { try { hideStarter(); } catch (e) {} });

  // Hilfen im Browser: Unterseite von unten anpeilen, dann wie ein Klick ablaufen lassen
  await page.evaluate(() => {
    window._tClickBottom = (o) => {
      const b = getMeshBox(o), c = b.getCenter(new THREE.Vector3());
      // Strahl von schräg unten auf die Unterseite (etwas neben der Mitte)
      const from = new THREE.Vector3(c.x + (b.max.x - c.x) * 0.2, b.min.y - 5, c.z + (b.max.z - c.z) * 0.15);
      const rc = new THREE.Raycaster(from, new THREE.Vector3(0, 1, 0));
      const hit = rc.intersectObject(o, true).find(h => h.face);
      raycaster.ray.direction.set(0, 1, 0);   // _fdWorldNormal orientiert an der Blickrichtung
      const wn = _fdRobustNormal(o, hit, _fdWorldNormal(hit));
      _fdPlaceOnFace(o, wn);
      return { yaw: _fdAlignYaw(o), wn: wn.toArray() };
    };
    // Kennzahlen: Kippung der Unterseite (Winkel der großen Bodenfläche zur Platte) + Restdrehung
    window._tMeasure = (o) => {
      let C = 0, S = 0, W = 0, nb = new THREE.Vector3();
      _fdEachWorldTri(o, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); if (!l) return;
        if (Math.hypot(nx, nz) / l > 0.9) { const t = Math.atan2(nz, nx) * 4; C += l * Math.cos(t); S += l * Math.sin(t); W += l; }
        if (-ny / l > 0.95) nb.add(new THREE.Vector3(nx, ny, nz));   // nach unten zeigende Flächen
      });
      nb.normalize();
      return { restYaw: Math.atan2(S, C) / 4 * 180 / Math.PI, tilt: Math.acos(Math.min(1, -nb.y)) * 180 / Math.PI, minY: getMeshBox(o).min.y };
    };
  });

  // 1) verrauschter „Scan" eines Quaders mit Stufe, um 23° gedreht + 7° gekippt
  const r1 = await page.evaluate(() => {
    const g = new THREE.BoxGeometry(4, 2, 2.5, 160, 80, 100).toNonIndexed();   // 40×20×25 mm, fein
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { // Rauschen ±0,05 mm (App-Einheit 1 = 10 mm), Stufe oben
      const n = () => (Math.random() - 0.5) * 0.01;
      p.setXYZ(i, p.getX(i) + n(), p.getY(i) + n() + (p.getY(i) > 0.99 && p.getX(i) > 0 ? 0.3 : 0), p.getZ(i) + n());
    }
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, new THREE.MeshStandardMaterial()); o.userData = { id: idCtr++, type: 'import', shapeType: 'import', name: 'Quader-Scan' };
    o.rotation.set(7 * Math.PI / 180, 23 * Math.PI / 180, 0); o.position.y = 3;
    scene.add(o); objects.push(o); o.updateMatrixWorld(true);
    const t0 = performance.now(); const r = _tClickBottom(o); const ms = performance.now() - t0;
    // exakt über die bekannte Lage: lokale Unterseite (−Y) und Seitenachse (X) in Welt
    const dn = new THREE.Vector3(0, -1, 0).applyQuaternion(o.quaternion), ax = new THREE.Vector3(1, 0, 0).applyQuaternion(o.quaternion);
    const tiltTrue = Math.acos(Math.min(1, -dn.y)) * 180 / Math.PI;
    let yawTrue = Math.atan2(ax.z, ax.x) * 180 / Math.PI; yawTrue = ((yawTrue % 90) + 135) % 90 - 45;
    return { ...r, ms: Math.round(ms), ..._tMeasure(o), tiltTrue, yawTrue };
  });
  console.log('INFO Quader: ' + JSON.stringify(r1));
  ok(r1.tiltTrue < 0.3, `Quader: Unterseite liegt plan (Restkippung ${r1.tiltTrue.toFixed(2)}°, 7° gekippt + Rauschen ±0,05 mm)`);
  ok(Math.abs(r1.yawTrue) < 0.3, `Quader: an den Achsen ausgerichtet (Rest ${r1.yawTrue.toFixed(2)}°, gedreht ${r1.yaw.toFixed(1)}°)`);
  ok(Math.abs(r1.minY) < 1e-6, 'Quader: steht auf der Platte');

  // 2) Kugel: keine klare Wandrichtung → nicht drehen
  const r2 = await page.evaluate(() => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(1.5, 64, 48), new THREE.MeshStandardMaterial());
    o.userData = { id: idCtr++, type: 'import', shapeType: 'import', name: 'Kugel' }; o.rotation.y = 0.4; o.position.set(8, 1.5, 0);
    scene.add(o); objects.push(o); o.updateMatrixWorld(true);
    const before = o.quaternion.clone(); const yaw = _fdAlignYaw(o);
    return { yaw, same: o.quaternion.angleTo(before) < 1e-9 };
  });
  ok(r2.yaw === 0 && r2.same, 'Kugel: wird nicht verdreht');

  // 3) glatter CAD-Würfel: exakte Normale, keine Abweichung
  const r3 = await page.evaluate(() => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
    o.userData = { id: idCtr++, type: 'box', shapeType: 'box', name: 'Würfel' }; o.rotation.set(0.3, 0.5, 0.2); o.position.set(-8, 3, 0);
    scene.add(o); objects.push(o); o.updateMatrixWorld(true);
    const r = _tClickBottom(o); return { ...r, ..._tMeasure(o) };
  });
  ok(r3.tilt < 0.01 && Math.abs(r3.restYaw) < 0.01, `CAD-Würfel: exakt plan + ausgerichtet (${r3.tilt.toFixed(4)}° / ${r3.restYaw.toFixed(4)}°)`);

  // 4) echter Scan (optional)
  if (process.env.SCAN) {
    await page.route('**/__scan', r => r.fulfill({ body: fs.readFileSync(process.env.SCAN) }));
    const r4 = await page.evaluate(async () => {
      const buf = await (await fetch('/__scan')).arrayBuffer();
      const parts = await _p3mfParseAsync(buf);
      const red = await _vfSimplifyAsync(parts[0].pos, { tol: BIGMESH_TOL_MM, give: true });
      const n0 = objects.length; _addImportedGeo(_soupGeo(red.pos), 'scan.3mf', true, null, false);
      const o = objects[n0];
      o.rotation.y += 31 * Math.PI / 180; o.updateMatrixWorld(true);   // wie zufällig hingelegt
      const pre = _tMeasure(o);
      const t0 = performance.now(); const r = _tClickBottom(o); const ms = performance.now() - t0;
      const b = getMeshBox(o).getSize(new THREE.Vector3());
      await new Promise(r => setTimeout(r, 50)); fitToObjects([o]); selectObjs([o]);
      return { pre, ...r, ms: Math.round(ms), ..._tMeasure(o), footprint: [b.x * 10, b.z * 10].map(v => +v.toFixed(1)), tris: red.outTris };
    });
    console.log('INFO Scan: ' + JSON.stringify(r4));
    ok(Math.abs(r4.restYaw) < 1, `Scan: an den Achsen ausgerichtet (Rest ${r4.restYaw.toFixed(2)}°, ${r4.ms} ms bei ${r4.tris} Dreiecken)`);
  }
  ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
