// Prüft den Suchbaum-Raycast (three-mesh-bvh): gleiche Treffer wie der normale
// three-Raycast (Abstand, Punkt, faceIndex, face.a/b/c) für indizierte und nicht
// indizierte Netze, gedreht/skaliert, DoubleSide, firstHitOnly, nach Verformung
// (refit) und nach Geometrie-Tausch — die echte Geometrie bleibt unverändert.
// Aufruf: node tests/bvh_raycast_test.mjs
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8953;
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch();
const pg = await br.newPage();
const fehler = []; pg.on('pageerror', e => fehler.push(String(e)));
let ok = true; const check = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) ok = false; };
try {
  await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof hideStarter === 'function' && typeof objects !== 'undefined', null, { timeout: 30000 });
  check(await pg.evaluate(() => !!window.MeshBVHLib && typeof window._bvhInfo === 'function'), 'Bibliothek geladen, Raycast umgestellt');
  const r = await pg.evaluate(() => {
    hideStarter();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const vergleiche = (mesh, n, firstHit) => {
      const rc = new THREE.Raycaster(); rc.firstHitOnly = !!firstHit; mesh.updateMatrixWorld(true);
      const bs = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());
      let diff = 0, treffer = 0, tB = 0, tA = 0;
      for (let i = 0; i < n; i++) {
        const o = new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).normalize().multiplyScalar(bs.radius * 3).add(bs.center);
        const z = new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).multiplyScalar(bs.radius).add(bs.center);
        rc.set(o, z.sub(o).normalize());
        window._bvhAus = true; let t = performance.now(); const A = rc.intersectObject(mesh, false); tA += performance.now() - t;
        window._bvhAus = false; t = performance.now(); const B = rc.intersectObject(mesh, false); tB += performance.now() - t;
        const a = A[0], b = B[0];
        if (!a && !b) continue;
        treffer++;
        if (!a || !b || Math.abs(a.distance - b.distance) > 1e-6 || a.point.distanceTo(b.point) > 1e-6 || a.faceIndex !== b.faceIndex ||
            a.face.a !== b.face.a || a.face.b !== b.face.b || a.face.c !== b.face.c || (!firstHit && A.length !== B.length)) diff++;
      }
      return { treffer, diff, msAlt: tA / n, msNeu: tB / n };
    };
    const out = {};
    const gIdx = new THREE.SphereGeometry(5, 700, 500);   // ~700k Dreiecke, indiziert
    const m1 = new THREE.Mesh(gIdx, new THREE.MeshStandardMaterial());
    m1.position.set(3, 2, -1); m1.rotation.set(0.4, 1.1, -0.3); m1.scale.set(1.3, 0.8, 1.1);
    scene.add(m1);
    const idx0 = gIdx.index.array.slice(0, 30);
    m1.updateMatrixWorld(true); const rc0 = new THREE.Raycaster(new THREE.Vector3(30, 2, -1), new THREE.Vector3(-1, 0, 0));
    let t0 = performance.now(); rc0.intersectObject(m1); out.aufbauMs = performance.now() - t0;   // Suchbaum einmalig bauen
    out.tris = gIdx.index.count / 3;
    out.idx = vergleiche(m1, 150);
    out.idxUnveraendert = idx0.every((v, i) => v === gIdx.index.array[i]);
    out.first = vergleiche(m1, 100, true);
    m1.material.side = THREE.DoubleSide; out.doppel = vergleiche(m1, 100); m1.material.side = THREE.FrontSide;
    // Verformung → refit
    const P = gIdx.attributes.position; for (let i = 0; i < P.count; i += 7) P.setY(i, P.getY(i) * 1.25); P.needsUpdate = true; gIdx.computeBoundingSphere(); gIdx.computeBoundingBox();   // sonst verwirft der ALTE Raycast an der veralteten Box
    out.verformt = vergleiche(m1, 100);
    // nicht indiziert
    const gN = new THREE.SphereGeometry(4, 400, 300).toNonIndexed();
    const m2 = new THREE.Mesh(gN, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
    m2.position.set(-6, 0, 2); scene.add(m2);
    out.nichtIdx = vergleiche(m2, 150);
    out.ohneIndex = gN.index === null;
    // Geometrie getauscht
    m2.geometry = new THREE.TorusKnotGeometry(3, 1, 800, 120).toNonIndexed();
    out.getauscht = vergleiche(m2, 100);
    scene.remove(m1); scene.remove(m2);
    return out;
  });
  console.log(`Aufbau Suchbaum für ${r.tris} Dreiecke: ${r.aufbauMs.toFixed(0)} ms (einmalig)`);
  for (const [k, v] of Object.entries(r)) if (typeof v === 'object')
    console.log(`${k.padEnd(10)} Treffer ${v.treffer}, Abweichungen ${v.diff}, Raycast alt ${v.msAlt.toFixed(2)} ms → neu ${v.msNeu.toFixed(3)} ms`);
  for (const k of ['idx', 'first', 'doppel', 'verformt', 'nichtIdx', 'getauscht'])
    check(r[k].diff === 0 && r[k].treffer > 20, `${k}: identische Treffer`);
  check(r.idxUnveraendert && r.ohneIndex, 'echte Geometrie unverändert (Index nicht umsortiert, kein Index angehängt)');
  check(r.idx.msNeu * 20 < r.idx.msAlt, `deutlich schneller (${(r.idx.msAlt / r.idx.msNeu).toFixed(0)}× bei allen Treffern, ${(r.first.msAlt / r.first.msNeu).toFixed(0)}× bei erstem Treffer)`);
  const vor = await pg.evaluate(async () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(3, 300, 200), new THREE.MeshStandardMaterial());
    m.userData = { id: idCtr++, name: 'BVH-Test', type: 'custom' }; scene.add(m); objects.push(m);
    const vorher = !!window._bvhInfo(m.geometry);
    await new Promise(r => setTimeout(r, 6000));
    const nachher = window._bvhInfo(m.geometry);
    scene.remove(m); objects.splice(objects.indexOf(m), 1);
    return { vorher, nachher: !!nachher };
  });
  check(!vor.vorher && vor.nachher, 'großes Netz bekommt seinen Suchbaum im Leerlauf (ohne Klick)');
  check(!fehler.length, 'keine Seitenfehler' + (fehler.length ? ': ' + fehler[0] : ''));
} catch (e) { console.error(e); ok = false; }
await br.close(); srv.kill();
console.log(ok ? 'ALLES OK' : 'FEHLER');
process.exit(ok ? 0 : 1);
