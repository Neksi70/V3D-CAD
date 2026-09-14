// Josy 10.9.26: "wenn ich den aufdrehe und dann wieder hochziehe, dreht er sich wieder".
// Selbst gesetzte Drehung muss ein spaeteres Verschieben ueberleben — beim Gleiten
// UND beim Zug am Pfeil-Gizmo (das heftet/wickelt beim Loslassen neu).
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,5 H30 V30 H5 Z"/><path d="M5,80 H95 V95 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// importiertes STL-Rohr (Geometrie in mm, scale 0.1) — Josys Fall
await pg.evaluate((svg) => {
  const g = new THREE.CylinderGeometry(30, 30, 100, 48, 1, true);
  const imp = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x88a }));
  imp.scale.set(0.1, 0.1, 0.1); imp.position.set(8, 5, 0);
  imp.userData = { id: idCtr++, name: 'ImportRohr', type: 'import', shapeType: 'import', color: '#8888aa' };
  scene.add(imp); objects.push(imp); imp.updateMatrixWorld(true);
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 25, name: 'Motiv' });
  m.position.set(-8, 0.15, 12);
  objects.forEach(o => o.updateMatrixWorld(true));
  orbitTarget.set(0, 3, 0); sph.theta = 0.0; sph.phi = 1.15; sph.r = 45; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
}, SVG);
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const cr = await pg.evaluate(() => { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.95 }; });
async function drag(from, to, steps = 12) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  const hint = await pg.evaluate(() => { const h = document.getElementById('text-snap-hint'); return h.style.display === 'block' ? h.textContent : '(kein Hinweis)'; });
  const sel = await pg.evaluate(() => selectedObjs.map(o => o.userData.name));
  await pg.mouse.up(); await pg.waitForTimeout(120);
  console.log('   [drag]', hint, JSON.stringify(sel));
}
const ctrW = () => pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.shapeType === 'svg')).toArray());
// Drehung des Motivs auf der Wand (0° = aufrecht). Seit v1.18.18 wandert eine
// Quaternion-Drehung um die Wandnormale beim naechsten Nachfuehren in die Wicklung
// (rotRad) — das Quaternion steht dann wieder auf der Grundlage. Beides zaehlt.
const kipp = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);   // Motiv-Hochachse
  const q = Math.acos(Math.min(1, Math.abs(up.dot(new THREE.Vector3(0, 1, 0))))) * 180 / Math.PI;
  const w = m.userData._svgWrap;
  return +(q + Math.abs((w && w.rotRad || 0) * 180 / Math.PI)).toFixed(1);
});

await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(150);
await drag(await scr(await ctrW()), await scr([8, 5, 3]));
const gewickelt = await pg.evaluate(() => !!objects.find(o => o.userData.shapeType === 'svg').userData._svgWrap);
ok('auf das importierte Rohr gewickelt', gewickelt, { kipp: await kipp() });

// Nutzer dreht das Motiv um 25° (wie mit dem Dreh-Gizmo: um die Wandnormale)
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const n = new THREE.Vector3(1, 0, 0).applyQuaternion(m.quaternion);     // radial = Wandnormale
  m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(n, 25 * Math.PI / 180));
  m.updateMatrixWorld(true);
});
const k1 = await kipp();
ok('Motiv um 25° gedreht', Math.abs(k1 - 25) < 1.5, { kipp: k1 });

// jetzt auf der Rundung verschieben (Gleiten).
// Greifpunkt suchen: das Motiv ragt nur 0,2 mm aus der Wand — mitten auf der
// Mitte erwischt der Klick sonst das Rohr dahinter.
await pg.mouse.click(cr.x, cr.y); await pg.waitForTimeout(120);
const griff = await pg.evaluate(() => {
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
ok('gewickeltes Motiv ist mit der Maus greifbar', !!griff, griff);
if (griff) await drag(griff, { x: griff.x - 70, y: griff.y - 55 });
const k2 = await kipp();
ok('Drehung überlebt das Verschieben (Gleiten)', Math.abs(k2 - k1) < 2, { vorher: k1, nachher: k2 });

// und am Pfeil-Gizmo ziehen (heftet beim Loslassen neu)
await pg.evaluate(() => { const m = objects.find(o => o.userData.shapeType === 'svg'); selectObjs([m]); });
await pg.waitForTimeout(200);
const gz = await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const p = _svgCenterWorld(m).clone(); p.y += 1.2;                        // oberhalb: Y-Pfeil
  const s = p.project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (s.x * 0.5 + 0.5) * r.width, y: r.top + (-s.y * 0.5 + 0.5) * r.height };
});
await drag(gz, { x: gz.x, y: gz.y - 60 }, 10);
const k3 = await kipp();
ok('Drehung überlebt den Zug am Gizmo', Math.abs(k3 - k1) < 2, { vorher: k1, nachher: k3 });
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
