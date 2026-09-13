// Josy 13.9.26: "wenn ich ihn wegziehe, ist er schief und in der Luft — er legt
// sich nicht wieder flach auf den Boden. Und dann heftet er sich schief an."
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,40 H95 V60 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const lage = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  m.updateMatrixWorld(true);
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion).normalize();
  const bb = new THREE.Box3().setFromObject(m);
  return { normaleNachOben: +n.y.toFixed(3), untenY: +bb.min.y.toFixed(2),
           wrap: !!m.userData._svgWrap, winkelZuY: +(Math.acos(Math.min(1, Math.abs(n.y))) * 180 / Math.PI).toFixed(1) };
});

await pg.evaluate((svgText) => {
  addShape('tube'); const t = objects[objects.length - 1];
  t.scale.set(3, 4, 3); t.position.set(0, 4, 0); t.userData.name = 'Rohr';
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'Motiv' });
  t.position.set(0, 4, 0); m.position.set(0, 0.2, 10);
  objects.forEach(o => o.updateMatrixWorld(true));
}, SVG);
const l0 = await lage();
console.log('frisch eingefügt: ', JSON.stringify(l0));
ok('liegt flach auf der Platte', Math.abs(l0.normaleNachOben - 1) < 0.02 && l0.untenY < 0.3, l0);

// wickeln, dann abnehmen (Flatten)
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const t = objects.find(o => o.userData.name === 'Rohr');
  const hit = new THREE.Vector3(3, 4, 0);
  const p = _svgWrapProbe(t, hit); _svgWrapApply(m, p, hit);
});
const l1 = await lage();
console.log('gewickelt:        ', JSON.stringify(l1));
ok('ist gewickelt', l1.wrap, l1);

await pg.evaluate(() => { const m = objects.find(o => o.userData.shapeType === 'svg'); _svgWrapFlatten(m); });
const l2 = await lage();
console.log('nach dem Abnehmen:', JSON.stringify(l2));
ok('liegt wieder flach (nicht schief in der Luft)',
   Math.abs(l2.normaleNachOben - 1) < 0.02 && l2.untenY < 0.3, l2);
// Teil 2: FLACH geheftetes Motiv von einer senkrechten Wand wegziehen
await pg.evaluate(() => {
  addShape('box'); const box = objects[objects.length - 1];
  box.scale.set(3, 4, 2); box.position.set(-10, 4, 0); box.userData.name = 'Wand';
  objects.forEach(o => o.updateMatrixWorld(true));
  const m = objects.find(o => o.userData.shapeType === 'svg');
  // auf die Vorderwand heften (über den echten Snap-Weg)
  const rc = new THREE.Raycaster();
  rc.set(new THREE.Vector3(-10, 5, 8), new THREE.Vector3(0, 0, -1));
  const hit = rc.intersectObject(box, true).find(h => h.face);
  _svgSnapHit = hit; selectObjs([m]);
  _applySvgSnap(m, { obj: box, type: 'surface', wrap: null });
});
const l3 = await lage();
console.log('an die Wand geheftet:', JSON.stringify(l3));
ok('hängt an der Wand (Normale waagerecht)', Math.abs(l3.normaleNachOben) < 0.1, l3);

// jetzt mit der Maus weit wegziehen
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
await pg.evaluate(() => { orbitTarget.set(0, 4, 0); sph.theta = 0; sph.phi = 1.15; sph.r = 46; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]); });
await pg.waitForTimeout(200);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
const von = await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const c = _svgCenterWorld(m).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  const bx = r.left + (c.x * 0.5 + 0.5) * r.width, by = r.top + (-c.y * 0.5 + 0.5) * r.height;
  const cv = renderer.domElement;
  for (let d = 0; d <= 50; d += 4) for (const [ox, oy] of [[0,0],[d,0],[-d,0],[0,d],[0,-d]]) {
    if (document.elementFromPoint(bx+ox, by+oy) !== cv) continue;
    const hits = pickObjects({ clientX: bx+ox, clientY: by+oy });
    if (!hits.length) continue;
    let p = hits[0].object; while (p && !objects.includes(p)) p = p.parent;
    if (p === m) return { x: bx+ox, y: by+oy };
  }
  return { x: bx, y: by };
});
const nach = await scr([12, 7, 6]);
await pg.mouse.move(von.x, von.y); await pg.mouse.down();
for (let i = 1; i <= 16; i++) { await pg.mouse.move(von.x + (nach.x-von.x)*i/16, von.y + (nach.y-von.y)*i/16); await pg.waitForTimeout(20); }
await pg.mouse.up(); await pg.waitForTimeout(250);
const l4 = await lage();
console.log('weggezogen:        ', JSON.stringify(l4));
ok('landet wieder flach auf der Platte (schwebt nicht)',
   Math.abs(l4.normaleNachOben - 1) < 0.05 && l4.untenY < 0.3, l4);

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 2));
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
