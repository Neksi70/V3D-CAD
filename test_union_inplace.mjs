// Nutzer-Fall: Scheibe mit Bohrung (Subtract), Zylinder rein, Ring hochziehen,
// Vereinen. Das Ergebnis MUSS an Ort und Stelle bleiben (vorher: _meshFromStlB64
// hat es auf Ursprung/Platte zentriert → "Ring liegt wieder auf der Platte").
// Zusätzlich: Ausrichten mit kaputter Auswahl darf keine NaN-Positionen erzeugen,
// und der Fortschrittsbalken muss Eingaben sperren.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8809;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);

const res = await page.evaluate(async () => {
  const out = {};
  if (typeof hideStarter === 'function') hideStarter();
  const bbox = o => { const b = getMeshBox(o); return { min: b.min.toArray().map(v => +v.toFixed(3)), max: b.max.toArray().map(v => +v.toFixed(3)) }; };

  // ── 1. Scheibe + Bohr-Zylinder, zentriert, Abziehen ──
  newScene(); await new Promise(r => setTimeout(r, 300));
  addShape('cylinder'); await new Promise(r => setTimeout(r, 200));
  const disc = objects[objects.length - 1];
  disc.scale.set(2.2, 0.5, 2.2);                       // größer + flacher
  disc.position.set(-1.5, 0.25, -1.0);                 // bewusst NICHT am Ursprung
  disc.updateMatrixWorld(true);
  addShape('cylinder'); await new Promise(r => setTimeout(r, 200));
  const drill = objects[objects.length - 1];
  drill.position.set(-1.5, 0.5, -1.0);                 // zentriert über der Scheibe
  drill.updateMatrixWorld(true);
  drill.userData.isHole = true;                        // als Bohrung markiert
  selectObjs([disc, drill]);
  subtractHoles();                                     // läuft async — auf Ergebnis WARTEN
  await new Promise((res2, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const last = objects[objects.length - 1];
      if (last && last.userData.isSubtract) { clearInterval(iv); res2(); }
      else if (Date.now() - t0 > 60000) { clearInterval(iv); rej(new Error('Subtract-Timeout')); }
    }, 150);
  });
  const ring = objects[objects.length - 1];
  out.subtractOk = !!ring.userData.isSubtract;
  out.ringBox = bbox(ring);

  // ── 2. Dritter Zylinder rein, Ring hochziehen, Vereinen ──
  addShape('cylinder'); await new Promise(r => setTimeout(r, 200));
  const pin = objects[objects.length - 1];
  pin.position.set(-1.5, 0.5, -1.0);                   // steckt im Loch
  pin.updateMatrixWorld(true);
  ring.position.y += 0.6;                              // Ring am Zylinder hochziehen
  ring.updateMatrixWorld(true);
  const pre = new THREE.Box3().union(getMeshBox(ring)).union(getMeshBox(pin));
  out.preBox = { min: pre.min.toArray().map(v => +v.toFixed(3)), max: pre.max.toArray().map(v => +v.toFixed(3)) };
  const nBefore = objects.length;
  selectObjs([ring, pin]);
  await unionSelected();
  await new Promise(r => setTimeout(r, 300));
  const merged = objects[objects.length - 1];
  out.unionDelta = objects.length - nBefore;           // -1: zwei weg, einer neu
  out.unionName = merged.userData.name;
  const post = getMeshBox(merged);
  out.postBox = { min: post.min.toArray().map(v => +v.toFixed(3)), max: post.max.toArray().map(v => +v.toFixed(3)) };
  // Kern der Prüfung: Box vor/nach Union nahezu identisch (kein Sprung auf Platte/Ursprung)
  const d = Math.max(
    ...['x','y','z'].map(a => Math.abs(pre.min[a] - post.min[a])),
    ...['x','y','z'].map(a => Math.abs(pre.max[a] - post.max[a])));
  out.maxShift = +d.toFixed(3);
  out.bleibtAnOrt = d < 0.05;                           // < 0,5 mm

  // ── 2b. Union mit Bohrung-markiertem Körper: darf NICHT verschwinden ──
  addShape('cylinder'); await new Promise(r => setTimeout(r, 200));
  const holeBody = objects[objects.length - 1];
  holeBody.position.set(2.5, 0.5, 1.0);
  holeBody.updateMatrixWorld(true);
  holeBody.userData.isHole = true;                     // rot markierte „Bohrung"
  addShape('box'); await new Promise(r => setTimeout(r, 200));
  const box2 = objects[objects.length - 1];
  box2.position.set(2.5, 0.25, 1.0); box2.updateMatrixWorld(true);
  const pre2 = new THREE.Box3().union(getMeshBox(holeBody)).union(getMeshBox(box2));
  selectObjs([box2, holeBody]);
  await unionSelected();
  await new Promise(r => setTimeout(r, 300));
  const merged2 = objects[objects.length - 1];
  const post2 = getMeshBox(merged2);
  const d2 = Math.max(
    ...['x','y','z'].map(a => Math.abs(pre2.min[a] - post2.min[a])),
    ...['x','y','z'].map(a => Math.abs(pre2.max[a] - post2.max[a])));
  out.holeUnionShift = +d2.toFixed(3);
  out.holeUnionOk = d2 < 0.05;                          // Bohr-Körper steckt mit im Ergebnis

  // ── 3. Ausrichten-Guard: Objekt ohne Geometrie in der Auswahl → kein NaN ──
  const ghost = new THREE.Group();                      // leere Box
  scene.add(ghost); objects.push(ghost);
  selectObjs([merged, ghost]);
  alignObjects('xcenter');
  out.nanGuard = isFinite(merged.position.x) && isFinite(merged.position.y);
  scene.remove(ghost); objects = objects.filter(o => o !== ghost);

  // ── 4. Eingabesperre: Overlay + Tastatur-Block, solange Fortschritt läuft ──
  _progressShow('Test');
  const block = [...document.body.children].find(el => el.style.zIndex === '99998');
  out.blockOverlay = !!block;
  let leaked = false;
  const probe = () => { leaked = true; };
  document.addEventListener('keydown', probe);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
  document.removeEventListener('keydown', probe);
  out.keyBlocked = !leaked;
  _progressHide();
  out.blockWeg = ![...document.body.children].some(el => el.style.zIndex === '99998');

  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('Seitenfehler:', errs.length ? errs : 'keine');

const ok = res.subtractOk && res.unionDelta === -1 && /Verschmolzen/.test(res.unionName || '')
  && res.bleibtAnOrt && res.holeUnionOk
  && res.nanGuard && res.blockOverlay && res.keyBlocked && res.blockWeg;
console.log(ok ? '\n✅ Union bleibt an Ort (auch mit Bohr-Körper), Align-NaN-Guard + Eingabesperre greifen'
              : '\n❌ Prüfung fehlgeschlagen');
await browser.close(); srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
