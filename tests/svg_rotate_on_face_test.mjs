// Josy 10.9.26 (5. Meldung): "wenn die SVG auf dem Objekt ist und ich sie nach
// links/rechts verschieben oder rotieren möchte (Baum gerade draufstellen),
// geht das auch nicht."
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
// Asymmetrisch: kleines Quadrat oben links, breiter Balken unten
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,5 H30 V30 H5 Z"/><path d="M5,80 H95 V95 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

await pg.evaluate((svg) => {
  addShape('box'); const box = objects[objects.length - 1]; box.scale.set(3, 3, 3); box.userData.name = 'Quader';
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 25, name: 'Motiv' });
  box.position.set(-2, 3, 0); m.position.set(-2, 0.15, 12);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(-2, 3, 0); sph.theta = 0; sph.phi = 1.25; sph.r = 40; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
async function drag(from, to, steps = 14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return h.style.display === 'block' ? h.textContent : '(kein Hinweis)'; });
  await pg.mouse.up(); await pg.waitForTimeout(150);
  return hint;
}
const ctrW = () => pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.shapeType === 'svg')).toArray());
// Punkt suchen, an dem der Klick wirklich das MOTIV trifft (es steckt in der Wand)
const griff = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const c = _svgCenterWorld(m).project(camera);
  const r = renderer.domElement.getBoundingClientRect();
  const bx = r.left + (c.x * 0.5 + 0.5) * r.width, by = r.top + (-c.y * 0.5 + 0.5) * r.height;
  for (let d = 0; d <= 40; d += 4) for (const [ox, oy] of [[0,0],[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,-d],[d,-d],[-d,d]]) {
    const hits = pickObjects({ clientX: bx + ox, clientY: by + oy });
    if (!hits.length) continue;
    let p = hits[0].object; while (p && !objects.includes(p)) p = p.parent;
    if (p === m) return { x: bx + ox, y: by + oy };
  }
  return null;
});
// Lage: Drehwinkel des Motivs IN der Wandebene + Abstand zur Wand
const lage = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const box = objects.find(o => o.userData.name === 'Quader');
  m.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(box);
  const c = _svgCenterWorld(m);
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion).normalize();   // Motiv-Normale
  const oben = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quaternion).normalize(); // Motiv-"oben"
  return { dzWand: +(c.z - bb.max.z).toFixed(3), x: +c.x.toFixed(2), y: +c.y.toFixed(2),
           nZ: +n.z.toFixed(3),                                    // 1 = liegt flach auf der Vorderwand
           winkel: +(Math.atan2(oben.x, oben.y) * 180 / Math.PI).toFixed(1),
           aufPlatte: +(new THREE.Box3().setFromObject(m).min.y).toFixed(2) };
});

// heften
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
await drag(await scr(await ctrW()), await scr([-2, 3, 3]));
const l0 = await lage();
console.log('geheftet:', JSON.stringify(l0));
ok('liegt flach auf der Vorderwand', Math.abs(l0.nZ - 1) < 0.01 && Math.abs(l0.dzWand) < 0.01, l0);

// A) im Dreh-Modus drehen (Josy: "den Baum gerade draufstellen")
await pg.evaluate(() => { setMode('rotate'); });
await pg.waitForTimeout(150);
const g1 = await griff();
ok('Motiv ist mit der Maus greifbar', !!g1, g1);
const cs = await scr(await ctrW());
// im Bogen um die Motivmitte ziehen (wie am Drehteller)
const rad = Math.hypot(g1.x - cs.x, g1.y - cs.y) || 30;
const a0 = Math.atan2(g1.y - cs.y, g1.x - cs.x);
const zielA = a0 - 40 * Math.PI / 180;
const h1 = await drag(g1, { x: cs.x + Math.cos(zielA) * rad, y: cs.y + Math.sin(zielA) * rad });
const l1 = await lage();
console.log('nach dem Drehen:', h1, JSON.stringify(l1));
ok('Motiv hat sich in der Fläche gedreht', Math.abs(l1.winkel - l0.winkel) > 20, { vorher: l0.winkel, nachher: l1.winkel });
ok('liegt weiterhin flach an der Wand', Math.abs(l1.nZ - 1) < 0.02 && Math.abs(l1.dzWand) < 0.02, l1);
ok('ist nicht auf die Bauplatte gefallen', l1.aufPlatte > 0.5, l1);
ok('Drehung bleibt nach dem Loslassen', Math.abs(l1.winkel - l0.winkel) > 20, l1);

// B) zurück in den Verschiebe-Modus: links/rechts schieben muss weiter gehen
await pg.evaluate(() => { setMode('move'); });
await pg.waitForTimeout(150);
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const g2 = await griff();
const h2 = await drag(g2 || await scr(await ctrW()), await scr([-3.6, 4.2, 3]));
const l2 = await lage();
console.log('nach dem Verschieben:', h2, JSON.stringify(l2));
ok('lässt sich weiter auf der Fläche verschieben', Math.abs(l2.x - l1.x) > 1.0, { vorher: l1.x, nachher: l2.x });
ok('Drehung ist beim Verschieben erhalten geblieben', Math.abs(l2.winkel - l1.winkel) < 2, { vorher: l1.winkel, nachher: l2.winkel });
ok('klebt weiter sauber an der Wand', Math.abs(l2.dzWand) < 0.02, l2);

// C) Größe ziehen darf das Gleiten nicht abfangen
await pg.evaluate(() => { setMode('scale'); });
await pg.waitForTimeout(150);
const sVor = await pg.evaluate(() => objects.find(o => o.userData.shapeType === 'svg').scale.x);
const g3 = await griff();
await drag(g3 || await scr(await ctrW()), { x: (g3 ? g3.x : 0) + 90, y: (g3 ? g3.y : 0) - 60 });
const sNach = await pg.evaluate(() => objects.find(o => o.userData.shapeType === 'svg').scale.x);
console.log('Größe:', sVor, '→', sNach);
ok('Größe ziehen wirkt weiterhin', Math.abs(sNach - sVor) > 0.05, { vorher: +sVor.toFixed(3), nachher: +sNach.toFixed(3) });

console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
