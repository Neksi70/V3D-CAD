// Josy 30.9.26: „Bekomme das Bild auf der glatten Leo-Lampe nicht weiter runter,
// unten an den Rand springt es immer wieder nach oben.“
// Ursache: Beim Gleiten auf einer Rundung galt der Zug als „herunternehmen“, sobald
// der Zeiger eine Motivhöhe (mind. 5 mm) über den Rand hinaus ging oder ein anderes
// Teil traf (der Sockel steht daneben) — dann sprang das Motiv auf die Starthöhe.
// Prüft mit echtem Maus-Zug: am unteren Rand bleibt es stehen (auch mit dem Sockel
// unter dem Zeiger), ein weiter Zug zur Seite nimmt es weiterhin herunter.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const URL_ = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL_, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
// Häuserreihe mit Dächern (Spitzen oben), 9 Teile
let p = ''; for (let i = 0; i < 9; i++) { const x = i * 22; p += `<path d="M${x},60 L${x},30 L${x+9},${10 + (i%3)*6} L${x+18},30 L${x+18},60 Z"/>`; }
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">${p}</svg>`;
const MM = 40;
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
async function lauf(modus) {
await pg.evaluate(() => { if (objects.length) { selectObjs(objects.slice()); deleteSelected(); } });
const pt = await pg.evaluate(async ([svg, MM]) => {
  const orig = window.notify; window._meld = []; window.notify = (t, ...a) => { window._meld.push(String(t)); return orig(t, ...a); };
  Object.assign(_lwlP, { motif: 'glatt' });
  _lwlCreate();
  const shade = objects.find(o => /Oberteil/.test(o.userData.name));
  const base = objects.find(o => /Sockel/.test(o.userData.name));
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 1, targetMM: MM, name: 'haus' });
  shade.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(shade), c = bb.getCenter(new THREE.Vector3());
  const y = bb.min.y + (bb.max.y - bb.min.y) * 0.6;
  const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(c.x + 30, y, c.z), new THREE.Vector3(-1, 0, 0));
  const h = rc.intersectObject(shade, true).find(x => x.face);
  const pr = _svgWrapProbe(shade, h.point.clone());
  _svgWrapApply(m, pr, h.point.clone()); m.updateMatrixWorld(true); _svgWrapTarget(m);
  selectObjs([]);
  window._mm = m; window._sh = shade;
  orbitTarget.set(c.x, (bb.min.y + bb.max.y) / 2, c.z);
  sph.theta = Math.PI / 2; sph.phi = 1.35; sph.r = 45; sph2cam(); camera.updateMatrixWorld(true);
  const r = renderer.domElement.getBoundingClientRect(), rcv = new THREE.Raycaster();
  const cc = _svgGlideScreenPt(_svgCenterWorld(m));
  for (let rad = 0; rad <= 90; rad += 4) for (let a = 0; a < 16; a++) {
    const x = cc.x + rad * Math.cos(a * Math.PI/8), yy = cc.y + rad * Math.sin(a * Math.PI/8);
    if (document.elementFromPoint(x, yy) !== renderer.domElement) continue;
    rcv.setFromCamera(new THREE.Vector2(((x-r.left)/r.width)*2-1, -((yy-r.top)/r.height)*2+1), camera);
    const hh = rcv.intersectObjects(objects, true).find(t => t.face && !t.object.userData.isEdgeLines);
    if (!hh) continue;
    let o = hh.object; while (o && !objects.includes(o)) o = o.parent;
    if (o === m) return { x: Math.round(x), y: Math.round(yy), unten0: +((new THREE.Box3().setFromObject(m).min.y - bb.min.y) * 10).toFixed(1) };
  }
  return null;
}, [SVG, MM]);
console.log('start', JSON.stringify(pt));
const lage = () => pg.evaluate(() => { const bb = new THREE.Box3().setFromObject(window._sh), mb = new THREE.Box3().setFromObject(window._mm);
  const hint = document.getElementById('text-glide-hint'); return { untenMm: +((mb.min.y - bb.min.y) * 10).toFixed(1), obenMm: +((mb.max.y - bb.min.y)*10).toFixed(1), hint: hint && hint.style.display !== 'none' ? hint.textContent : '' }; });
if (pt && modus === 'sockel') {
  const info = await pg.evaluate(([x, y]) => {
    const base = objects.find(o => /Sockel/.test(o.userData.name));
    const r = renderer.domElement.getBoundingClientRect(), rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((x-r.left)/r.width)*2-1, -((y-r.top)/r.height)*2+1), camera);
    const dC = camera.position.distanceTo(new THREE.Box3().setFromObject(window._sh).getCenter(new THREE.Vector3()));
    const q = rc.ray.origin.clone().addScaledVector(rc.ray.direction, dC + 9);
    base.position.set(q.x, q.y - 2, q.z); base.updateMatrixWorld(true);
    const hits = rc.intersectObjects(objects, true).filter(t => t.face).map(t => { let o = t.object; while (o && !objects.includes(o)) o = o.parent; return o.userData.name; });
    return hits;
  }, [pt.x, pt.y + 150]);
  console.log('unter dem Zeiger bei +150px:', JSON.stringify(info));
}
if (!pt) return { pt };
  await pg.mouse.move(pt.x, pt.y); await pg.mouse.down();
  for (let i = 1; i <= 30; i++) {
    if (modus === 'seite') await pg.mouse.move(pt.x + i * 16, pt.y);
    else await pg.mouse.move(pt.x, pt.y + i * 6);
    await pg.waitForTimeout(20);
  }
  const vor = await lage();
  await pg.mouse.up(); await pg.waitForTimeout(400);
  const nach = await lage();
  const gewickelt = await pg.evaluate(() => !!window._mm.userData._svgWrap);
  return { pt, vor, nach, gewickelt };
}
for (const modus of ['frei', 'sockel']) {
  const r = await lauf(modus);
  ok(`${modus}: Motiv ist greifbar`, !!r.pt, r.pt);
  ok(`${modus}: beim Ziehen über den unteren Rand bleibt es am Rand`, r.vor && Math.abs(r.vor.untenMm) <= 0.5, r.vor);
  ok(`${modus}: nach dem Loslassen weiter am Rand und gewickelt`, r.nach && Math.abs(r.nach.untenMm) <= 0.5 && r.gewickelt, { ...r.nach, gewickelt: r.gewickelt });
}
const w = await lauf('seite');
ok('weiter Zug zur Seite nimmt das Motiv weiterhin vom Körper', w.pt && !w.gewickelt, w);
ok('keine JS-Fehler', errs.length === 0, errs);
await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER: ${fails.join(', ')}`); process.exit(1); }
console.log('\nAlles grün.');
