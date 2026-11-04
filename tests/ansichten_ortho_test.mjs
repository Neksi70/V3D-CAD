// Regressionstest echte Ansichten (Volker 4.11.): OBEN/UNTEN/VORNE/HINTEN/LINKS/RECHTS genau gerade + automatisch
// orthogonal → von oben sieht man NUR die Oberseite (Seitenwände unsichtbar); Wegdrehen → wieder perspektivisch;
// ISO perspektivisch; Würfel-Flächen genauso; Umschalter von Hand erzwingt, Ansicht-Knopf → wieder automatisch.
// Start: python3 volme3d_server.py 8879 --dev  →  node tests/ansichten_ortho_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8879/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof setView === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); localStorage.setItem('v3d_umsteiger_hinweis', '1'); document.getElementById('umsteiger-hinweis')?.remove(); _newCreate(false); addShape('box'); deselect(); });

// Sichtbare Seitenwände zählen: Würfel-Seitenflächen, deren Normale zur Kamera zeigt (Blickrichtung je Punkt bei Perspektive!)
const sichtbar = () => pg.evaluate(() => {
  const o = objects[0]; o.updateMatrixWorld(true);
  const c = getMeshBox(o).getCenter(new THREE.Vector3()), h = getMeshBox(o).getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const flaechen = { oben: [0, 1, 0], unten: [0, -1, 0], vorne: [0, 0, 1], hinten: [0, 0, -1], rechts: [1, 0, 0], links: [-1, 0, 0] };
  const out = [];
  for (const [name, n] of Object.entries(flaechen)) {
    const N = new THREE.Vector3(...n), mitte = c.clone().add(new THREE.Vector3(n[0] * h.x, n[1] * h.y, n[2] * h.z));
    // Blickstrahl zur Flächenmitte (perspektivisch) bzw. Kamerarichtung (orthogonal)
    const blick = _camIsPerspective ? mitte.clone().sub(camera.position).normalize() : camera.getWorldDirection(new THREE.Vector3());
    if (N.dot(blick) < -1e-6) out.push(name);
  }
  return { sichtbar: out, ortho: !_camIsPerspective, phi: +sph.phi.toFixed(6) };
});
for (const [knopf, erwartet] of [['OBEN', 'oben'], ['UNTEN', 'unten'], ['VORNE', 'vorne'], ['HINTEN', 'hinten'], ['LINKS', 'links'], ['RECHTS', 'rechts']]) {
  await pg.click(`#vcs .vcb:has-text("${knopf}")`);
  const r = await sichtbar();
  ok(knopf + ': orthogonal, nur „' + erwartet + '“ sichtbar', r.ortho && r.sichtbar.length === 1 && r.sichtbar[0] === erwartet, r);
}
await pg.click('#vcs .vcb:has-text("ISO")');
let r = await sichtbar();
ok('ISO: perspektivisch, 3 Seiten', !r.ortho && r.sichtbar.length === 3, r);
// OBEN, dann wegdrehen (Maus ziehen im Bild) → wieder perspektivisch
await pg.click('#vcs .vcb:has-text("OBEN")');
const vp = await pg.evaluate(() => { const q = vpEl.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
const vorher = await pg.evaluate(() => ({ ortho: !_camIsPerspective }));
await pg.mouse.move(vp.x + 200, vp.y + 150); await pg.mouse.down({ button: 'right' }).catch(() => {});
await pg.evaluate(() => { sph.phi += 0.3; sph.theta += 0.2; sph2cam(); });   // Drehen wie per Maus
await pg.mouse.up({ button: 'right' }).catch(() => {});
r = await sichtbar();
ok('OBEN war orthogonal, nach Wegdrehen perspektivisch', vorher.ortho && !r.ortho, { vorher, r });
// Würfel: oberste Fläche anklicken
await pg.click('#vcs .vcb:has-text("ISO")');
const wuerfel = await pg.evaluate(() => { const c = document.querySelector('#vcube-wrap canvas').getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height * 0.3 }; });
await pg.mouse.click(wuerfel.x, wuerfel.y);
await pg.waitForTimeout(500);
r = await sichtbar();
ok('Würfel-Fläche „oben“: genau von oben + orthogonal', r.ortho && r.phi === 0 && r.sichtbar.join() === 'oben', r);
// Umschalter von Hand: erzwingt perspektivisch auch in OBEN; neuer Ansicht-Knopf → wieder automatisch
await pg.evaluate(() => toggleCameraMode());
r = await sichtbar(); ok('von Hand: perspektivisch trotz Ansicht von oben', !r.ortho, r);
await pg.evaluate(() => { sph.r *= 0.9; sph2cam(); });
r = await sichtbar(); ok('bleibt beim Zoomen perspektivisch', !r.ortho, r);
await pg.click('#vcs .vcb:has-text("VORNE")');
r = await sichtbar(); ok('Ansicht-Knopf → wieder automatisch orthogonal', r.ortho && r.sichtbar.join() === 'vorne', r);
// Zoomen in orthogonaler Ansicht ändert den Ausschnitt
const z = await pg.evaluate(() => { const a = camera.top; sph.r *= 0.5; sph2cam(); return [a, camera.top, !_camIsPerspective]; });
ok('Zoom in orthogonaler Ansicht wirkt', z[2] && Math.abs(z[1] - z[0] / 2) < 1e-6, z);
// Klick ins Bild trifft in orthogonaler Ansicht das Objekt
await pg.click('#vcs .vcb:has-text("OBEN")');
await pg.mouse.click(vp.x, vp.y); await pg.waitForTimeout(200);
const sel = await pg.evaluate(() => selectedObjs.length);
ok('Auswahl per Klick in der Draufsicht', sel === 1, sel);
await pg.screenshot({ path: '/tmp/ansicht_oben.png' });
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
