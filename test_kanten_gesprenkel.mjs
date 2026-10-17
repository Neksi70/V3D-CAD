// Kantenlinien-Gesprenkel (_edgeDespeckle): Scan-artiges Netz verliert die
// Mini-Knick-Linien, CAD-Körper behalten JEDE Kante (Vergleich mit rohem
// EdgesGeometry). Volker 17.10.: Kühlerfigur nach Neuladen schwarz gesprenkelt.
// Dichtes Rauschen (AMP=0.012+, ganze Flächen schraffiert) bleibt bewusst stehen —
// per Verzweigung nicht sicher von Waben-/Gittermustern zu trennen.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8874;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let ok = true;
const chk = (n, c, i) => { console.log((c ? '✓ ' : '✗ ') + n, JSON.stringify(i)); if (!c) ok = false; };
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof _edgeDespeckle === 'function');
  await pg.evaluate(() => { hideStarter(); _newCreate(false); });
  const zaehl = () => pg.evaluate(() => objects.map(o => {
    const roh = new THREE.EdgesGeometry(o.geometry, (o.userData && o.userData.edgeAngle) || 30).attributes.position.count / 2;
    const l = o.children.find(c => c.userData && c.userData.isEdgeLines);
    return { name: o.userData.name, roh, jetzt: l ? l.geometry.attributes.position.count / 2 : null };
  }));
  // CAD-Körper
  const cad = await pg.evaluate(async () => {
    for (const t of ['box', 'cylinder', 'tube', 'cone', 'pyramid', 'torus', 'sphere', 'star', 'heart', 'text', 'wedge', 'polygon'])
      try { addShape(t); } catch (e) {}
    // Platte mit zwei Löchern (abgezogen) + Rundung über Neuaufbau
    addShape('box'); const box = objects[objects.length - 1]; addShape('cylinder'); const c1 = objects[objects.length - 1];
    box.scale.set(5, 0.5, 2); box.position.set(20, 0.5, 0); c1.scale.set(0.05, 1, 0.05); c1.position.set(20, 0.5, 0); c1.userData.isHole = true;
    selectObjs([box, c1]); subtractHoles();
    for (let i = 0; i < 300 && objects.includes(box); i++) await new Promise(r => setTimeout(r, 200));
    objects.forEach(o => _updateObjEdgeLines(o));   // wie nach dem Neuladen
    return objects.length;
  });
  const zc = await zaehl();
  const verloren = zc.filter(z => z.jetzt !== null && z.jetzt !== z.roh);
  chk('CAD-Körper: keine Kante verloren (' + cad + ' Körper)', verloren.length === 0, verloren.length ? verloren : zc.map(z => z.name + ':' + z.roh).join(' '));
  // Scan-artiges Netz: Ikosaeder-Kugel (gleichmäßige Dreiecke wie vom Scanner),
  // jeder Punkt leicht verrauscht, dazu ein CAD-Sockel mit scharfem Rand
  await pg.evaluate(() => _newCreate(false));
  const zs = await pg.evaluate(AMP => {
    addShape('sphere'); const o = objects[objects.length - 1];
    const g = new THREE.IcosahedronGeometry(3, 70);   // ~100k Dreiecke
    const P = g.attributes.position, h = new Map();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < P.count; i++) {
      const k = P.getX(i).toFixed(5) + P.getY(i).toFixed(5) + P.getZ(i).toFixed(5);
      if (!h.has(k)) h.set(k, 1 + AMP * (rnd() - 0.5));
      const f = h.get(k); P.setXYZ(i, P.getX(i) * f, P.getY(i) * f * 1.6, P.getZ(i) * f);
    }
    g.computeVertexNormals();
    o.geometry.dispose(); o.geometry = g; o.userData.shapeType = 'custom'; o.userData.type = 'custom';
    o.position.set(0, 5, 0);
    addShape('cylinder'); const c = objects[objects.length - 1]; c.scale.set(2, 0.5, 2); c.position.set(0, 0.5, 0);
    objects.forEach(x => _updateObjEdgeLines(x));
    selectObjs([]); fitToObjects(objects);
    const roh = new THREE.EdgesGeometry(o.geometry, 30).attributes.position.count / 2;
    const l = o.children.find(x => x.userData && x.userData.isEdgeLines);
    const lc = c.children.find(x => x.userData && x.userData.isEdgeLines);
    return { tris: g.attributes.position.count / 3, roh, jetzt: l ? l.geometry.attributes.position.count / 2 : null, sockel: lc ? lc.geometry.attributes.position.count / 2 : null };
  }, +(process.env.AMP || 0.006));
  chk('Scan: Gesprenkel weg', zs.roh > 200 && zs.jetzt < zs.roh * 0.05, zs);
  chk('Sockel daneben behält seine Kanten', zs.sockel === 64, zs.sockel);
  await pg.mouse.click(5, 790); await pg.waitForTimeout(800);
  await pg.screenshot({ path: process.argv[2] || '/tmp/gesprenkel.png' });
} finally { console.log('errs', errs.slice(0, 3)); console.log(ok ? 'OK ✓' : 'FEHLER ✗'); await b.close(); srv.kill(); }
