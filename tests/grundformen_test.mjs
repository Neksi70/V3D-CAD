// Neue Grundformen (Herz, Satteldach, Runddach, Halbkugel, Edelstein, Kapsel, Pfeil):
// wasserdicht + Normalen außen, liegen auf dem Boden, Abziehen per Manifold klappt,
// Speichern/Laden, Menü-Eintrag + Icon
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8966;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
const TYPES = ['heart','roof','roundroof','hemisphere','gem','capsule','arrow'];
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof addShape === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} });
  for (const ty of TYPES) {
    const r = await p.evaluate(ty => {
      _newCreate(false);
      addShape(ty);
      const o = objects[objects.length - 1];
      o.updateMatrixWorld(true);
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      for (const n in g.attributes) if (n !== 'position') g.deleteAttribute(n);
      const m = THREE.BufferGeometryUtils.mergeVertices(g, 1e-4);
      const P = m.attributes.position, I = m.index.array, edges = new Map();
      let vol = 0, degen = 0;
      const v = i => new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i));
      for (let i = 0; i < I.length; i += 3) {
        const a = I[i], b = I[i+1], c = I[i+2];
        if (a === b || b === c || a === c) { degen++; continue; }
        const A = v(a), B = v(b), C = v(c); vol += A.dot(B.clone().cross(C)) / 6;
        for (const [x, y] of [[a,b],[b,c],[c,a]]) { const k = x < y ? x + '_' + y : y + '_' + x; edges.set(k, (edges.get(k) || 0) + 1); }
      }
      let bad = 0; for (const n of edges.values()) if (n !== 2) bad++;
      const box = getMeshBox(o);
      return { name: o.userData.name, bad, vol, minY: box.min.y, size: box.getSize(new THREE.Vector3()).toArray().map(x => +(x*10).toFixed(1)) };
    }, ty);
    ok(r.bad === 0 && r.vol > 0, `${ty} (${r.name}): wasserdicht, Normalen außen (offene Kanten ${r.bad}, Vol ${r.vol.toFixed(3)}) Maße ${r.size}`);
    ok(Math.abs(r.minY) < 1e-3, `${ty}: steht auf dem Boden (minY ${r.minY.toFixed(4)})`);
    // Abziehen: Box mittig als Bohrung durch die Form
    const sub = await p.evaluate(async ty => {
      const o = objects[0];
      const bb = getMeshBox(o), c = bb.getCenter(new THREE.Vector3());
      shapeMode = 'hole'; addShape('cylinder'); shapeMode = 'solid';
      const h = objects[objects.length - 1];
      h.scale.set(0.15, 2, 0.15); h.position.set(c.x, c.y, c.z); h.updateMatrixWorld(true);
      selectObjs([o, h]);
      const v0 = (() => { const s = bb.getSize(new THREE.Vector3()); return s.x * s.y * s.z; })();
      subtractHoles();
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) { await new Promise(r => setTimeout(r, 200)); if (objects.length === 1 && !objects[0].userData.isHole && objects[0] !== o) break; }
      return { n: objects.length, changed: objects[0] !== o, tri: objects[0].geometry.attributes.position.count };
    }, ty);
    ok(sub.n === 1 && sub.changed, `${ty}: Abziehen klappt (${sub.n} Objekt, ${sub.tri} Ecken)`);
    // Speichern/Laden
    const rt = await p.evaluate(ty => {
      _newCreate(false); addShape(ty);
      const o = objects[0]; o.scale.set(1.5, 0.8, 1.2); o.updateMatrixWorld(true);
      const s0 = getMeshBox(o).getSize(new THREE.Vector3());
      const d = JSON.parse(JSON.stringify(objectToData(o)));
      const o2 = buildObjectFromData(d); o2.updateMatrixWorld(true);
      const s1 = getMeshBox(o2).getSize(new THREE.Vector3());
      return { same: s0.distanceTo(s1) < 1e-3, type: o2.userData.shapeType };
    }, ty);
    ok(rt.same && rt.type === ty, `${ty}: Speichern/Laden gleich`);
  }
  // Menü + Icons
  const menu = await p.evaluate(TYPES => TYPES.map(t => !!document.querySelector(`#shape-dd-list .shp[data-icon="${t}"]`)), TYPES);
  ok(menu.every(Boolean), 'alle 7 im Formen-Menü');
  await p.evaluate(() => { localStorage.removeItem('v3d_shape_icons_v2'); _shapeIconsStarted = false; return _genShapeIcons(); });
  const icons = await p.evaluate(TYPES => TYPES.map(t => !!document.querySelector(`#shape-dd-list .shp[data-icon="${t}"] img`)), TYPES);
  ok(icons.every(Boolean), '3D-Icons gerendert (' + icons + ')');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 2).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
