// Drehen-Werkzeug: Live-Maß beim Zeichnen (Ø/H/Länge am Zeiger), Maßfeld für den
// gerade gesetzten Punkt, und „Muster auf Rundung" landet auf dem fertigen
// Drehteil AUSSEN (Volker 9.10.: „Muster innen" auf dem Drehteil).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8876;
const URL = process.env.V3D_URL || `http://localhost:${PORT}/volme3d.html`;
const srv = process.env.V3D_URL ? null : spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(URL);
await page.waitForFunction(() => typeof enterRevolveMode === 'function' && typeof _rmpApply === 'function', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { hideStarter?.(); _newCreate(false); enterRevolveMode(); });
await page.waitForTimeout(500);
// Bildschirmpunkt zu Profilkoordinaten (r, h in App-Einheiten = 10 mm)
const scr = (r, h) => page.evaluate(([r, h]) => { const v = _revolveWorld(r, h).project(camera), rc = vpEl.getBoundingClientRect();
  return [rc.left + (v.x + 1) / 2 * rc.width, rc.top + (-v.y + 1) / 2 * rc.height]; }, [r, h]);
const live = () => page.evaluate(() => { const el = document.getElementById('rev-live'); return el.style.display === 'none' ? null : el.textContent; });
const prof = [[0, 0], [2.5, 0], [3.5, 3], [2, 5.5], [2.4, 7]];
const beob = [];
for (let i = 0; i < prof.length; i++) {
  const [x, y] = await scr(...prof[i]);
  await page.mouse.move(x - 30, y - 10); await page.mouse.move(x, y, { steps: 4 });
  await page.waitForTimeout(80);
  beob.push({ vorKlick: await live() });
  await page.mouse.click(x, y);
  await page.waitForTimeout(80);
  beob[i].dimSichtbar = await page.evaluate(() => document.getElementById('rev-dim').style.display !== 'none');
  beob[i].dimD = await page.evaluate(() => document.getElementById('rev-dim-d').value);
}
// Ziehen eines gesetzten Punkts zeigt ebenfalls das Maß
const [px, py] = await scr(3.5, 3);
await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 20, py, { steps: 5 });
const beimZiehen = await live();
await page.mouse.up();
// Ø im Maßfeld eintippen → Punkt springt
await page.evaluate(() => _revolveSelect(1));
await page.fill('#rev-dim-d', '60'); await page.press('#rev-dim-d', 'Enter');
const nachEintippen = await page.evaluate(() => _revolvePoints[1].r * 20);
const res = await page.evaluate(async () => {
  finishRevolve(); await new Promise(r => setTimeout(r, 300));
  const liveWeg = document.getElementById('rev-live').style.display === 'none';
  const o = objects[objects.length - 1]; selectObjs([o]); o.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(o), cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const hs = [0.3, 0.5, 0.7].map(f => bb.min.y + (bb.max.y - bb.min.y) * f);
  const aussen = () => { o.updateMatrixWorld(true);
    const m = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.matrixWorld.copy(o.matrixWorld);
    const rc = new THREE.Raycaster();
    return hs.map(h => { let rmax = 0; for (let t = 0; t < 72; t++) { const th = t / 72 * 2 * Math.PI, d = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
      rc.set(new THREE.Vector3(cx, h, cz).addScaledVector(d, 10), d.clone().negate()); const a = rc.intersectObject(m)[0];
      if (a) rmax = Math.max(rmax, (10 - a.distance) * 10); } return rmax; }); };
  const vor = aussen();
  _rmpApply('wabe'); await new Promise(r => setTimeout(r, 200));
  for (let k = 0; k < 200 && o.userData.displacementPattern !== 'rmp'; k++) await new Promise(r => setTimeout(r, 50));
  const nach = aussen();
  return { liveWeg, typ: o.userData.shapeType, vor, nach };
});
console.log(JSON.stringify({ beob, beimZiehen, nachEintippen, res }, null, 1));
const checks = [
  ['Live-Maß vor dem ersten Klick (Ø + H)', /Ø/.test(beob[0].vorKlick || '') && /H/.test(beob[0].vorKlick || '')],
  ['Live-Maß mit Länge ab dem zweiten Punkt', beob.slice(1).every(b => /↔/.test(b.vorKlick || ''))],
  ['waagerechter Abschnitt wird als waagerecht angezeigt', /waagerecht/.test(beob[1].vorKlick || '')],
  ['nach jedem Klick Maßfeld des neuen Punkts', beob.every(b => b.dimSichtbar)],
  ['Maßfeld zeigt Ø des 2. Punkts (50 mm)', beob[1].dimD === '50'],
  ['Live-Maß beim Ziehen', /Ø/.test(beimZiehen || '')],
  ['Ø eintippen setzt den Punkt (60 mm)', Math.abs(nachEintippen - 60) < 0.01],
  ['nach „Fertig" ist das Live-Maß weg', res.liveWeg],
  ['Drehteil entstanden', res.typ === 'revolve'],
  ...res.vor.map((v, k) => [`Muster auf Drehteil außen, Höhe ${k} (+0,8…1,6 mm)`, res.nach[k] - v > 0.8 && res.nach[k] - v < 1.6]),
  ['keine Seitenfehler', errs.length === 0],
];
let fail = 0;
for (const [n, ok] of checks) { console.log((ok ? '✓ ' : '✗ ') + n); if (!ok) fail++; }
if (errs.length) console.log(errs.slice(0, 5));
await browser.close(); srv && srv.kill();
process.exit(fail ? 1 : 0);
