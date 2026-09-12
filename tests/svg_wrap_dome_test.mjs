// Josys „Lichthülle" (STL, 12.9.26): Hohlkuppel, 120 mm breit, 130 mm hoch,
// 2 mm Wand, perfekter Rotationskörper. Beim Verschieben eines Motivs sprang
// der Wickelradius (gemessen: 58 → 46 → 70 mm statt gleichmäßig kleiner zu
// werden, bis 34 mm daneben).
//
// Ursache: _svgWrapProbe nahm die ERSTE Achse, an der ein Ring gefunden wurde.
// Ein Schnitt SENKRECHT zur echten Drehachse sieht durch eine Kuppel aber
// ebenfalls kreisrund aus — bei einer Kugel ist er sogar ein exakter Kreis.
// Stellenweise gewann so die falsche Achse. Jetzt werden alle drei Achsen
// bewertet: Bei der echten liegt die Kreismitte in jeder Höhe an derselben
// Stelle, bei einer falschen wandert sie.
//
// Die zweite Falle steckt in der Probe selbst: Misst man die Nachbarhöhe mit
// Radius-Vorgabe, findet man an einer KUGEL ausgerechnet für die richtige Achse
// nichts (der Radius ändert sich zu schnell) — die falsche gewönne jedes Mal.
// Darum wird dort nur die Mitte bestimmt, ohne Radiusfilter.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('dome-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

// Hohlkuppel als Import nachbauen: Rotationsprofil, außen wie Josys Hülle
// (R 60 unten → 28 oben, 130 hoch), 2 mm Wand, unten offen.
await pg.evaluate(() => {
  window._domeBuild = (wand) => {
    if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
    const H = 130, SEG = 96, N = 40;
    const rAussen = z => 60 - 32 * Math.pow(z / H, 1.7);      // gleichmäßig fallend
    const pts = [];
    for (let i = 0; i <= N; i++) { const z = H * i / N; pts.push(new THREE.Vector2(rAussen(z), z)); }
    for (let i = N; i >= 0; i--) { const z = H * i / N; pts.push(new THREE.Vector2(Math.max(0.5, rAussen(z) - wand), z)); }
    const lathe = new THREE.LatheGeometry(pts, SEG);
    const geo = lathe.toNonIndexed();
    // WICHTIG: genau wie ein importiertes STL aufsetzen. Ein STL steht Z-up, und
    // _addImportedGeo kippt es NICHT in der Geometrie, sondern nur am Mesh
    // (rotation.x). Die Drehachse ist damit die lokale Z-Achse — und die prüft
    // _svgWrapProbe ZULETZT. Baut man den Körper stattdessen in App-Koordinaten
    // (Achse = lokal Y), gewinnt die richtige Achse sofort und der Fehler tritt
    // gar nicht auf. Genau daran ist mein erster Nachbau vorbeigelaufen.
    geo.rotateX(Math.PI / 2);                                  // Lathe (Y-up) → Z-up wie ein STL
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide }));
    mesh.scale.setScalar(0.1);
    mesh.rotation.x = -Math.PI / 2;                            // wie _addImportedGeo bei zUp
    mesh.userData = { id: idCtr++, name: 'Lichthülle', type: 'import', shapeType: 'import',
                      color: '#dddddd', _origGeo: geo };
    scene.add(mesh); objects.push(mesh); mesh.updateMatrixWorld(true);
    return mesh;
  };
  // Soll-Wandradius in der Höhe des Motivs — ANALYTISCH aus dem Profil, mit dem
  // der Körper gebaut wurde. Ein Messstrahl taugt hier nicht: Bei einem Hohlkörper
  // erwischt er je nach Richtung die Innenwand, und dann misst man die Wandstärke
  // statt eines Fehlers (2,00 mm daneben — genau die Wandstärke, das war der
  // Hinweis).
  window._domeSollR = (m, k) => {
    const bb = new THREE.Box3().setFromObject(k);
    const z = (m.position.y - bb.min.y) * 10;                  // Höhe über der Unterkante, mm
    if (z < 0 || z > 130) return null;
    return +(60 - 32 * Math.pow(z / 130, 1.7)).toFixed(2);
  };
});

// ── 1) Die Drehachse wird auf jeder Höhe richtig erkannt ───────────────────
const achsen = await pg.evaluate(() => {
  const k = _domeBuild(2);
  const bb = new THREE.Box3().setFromObject(k);
  const R = [];
  for (let f = 0.05; f <= 0.9; f += 0.07) {
    const y = bb.min.y + (bb.max.y - bb.min.y) * f;
    const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(200, y, 0), new THREE.Vector3(-1, 0, 0));
    const h = rc.intersectObject(k, true).find(x => x.face);
    if (!h) continue;
    const wahr = Math.hypot(h.point.x, h.point.z) * 10;
    const p = _svgWrapProbe(k, h.point.clone());
    R.push({ hoehe: +((y - bb.min.y) * 10).toFixed(0), erkannt: !!p,
             achse: p && p.ax, R: p && +(p.R * 10).toFixed(2), wahr: +wahr.toFixed(2),
             achsRichtung: p && p.axisDir.toArray().map(v => +v.toFixed(2)) });
  }
  return R;
});
ok('Rundung wird auf jeder Höhe erkannt', achsen.every(r => r.erkannt), achsen.filter(r => !r.erkannt));
ok('immer dieselbe Drehachse (die senkrechte)',
   achsen.every(r => Math.abs(r.achsRichtung[1]) > 0.99),
   achsen.map(r => r.achsRichtung).filter(v => Math.abs(v[1]) <= 0.99));
ok('Radius stimmt überall mit der echten Wand überein (≤ 0,5 mm)',
   achsen.every(r => Math.abs(r.R - r.wahr) < 0.5),
   achsen.filter(r => Math.abs(r.R - r.wahr) >= 0.5).map(r => ({ h: r.hoehe, R: r.R, wahr: r.wahr })));
ok('Radius fällt monoton (kein Springen)',
   achsen.every((r, i) => i === 0 || r.R <= achsen[i-1].R + 0.3),
   achsen.map(r => r.R));

// ── 2) Motiv die Wand hinaufschieben — bleibt es dran? ─────────────────────
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M2,5 H98 V35 H2 Z"/></svg>`;
const lauf = await pg.evaluate((svg) => {
  // Motiv ZUERST importieren — der Import rückt vorhandene Körper beiseite
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 2, targetMM: 45, name: 'Motiv' });
  const k = _domeBuild(2);
  const bb = new THREE.Box3().setFromObject(k);
  const y = bb.min.y + (bb.max.y - bb.min.y) * 0.25;
  const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(200, y, 0), new THREE.Vector3(-1, 0, 0));
  const h = rc.intersectObject(k, true).find(x => x.face);
  const p = _svgWrapProbe(k, h.point.clone());
  if (!p) return { fehler: 'keine Rundung' };
  _svgWrapApply(m, p, h.point.clone()); m.updateMatrixWorld(true); _svgWrapTarget(m); selectObjs([m]);
  const out = [{ mm: 0, R: +(p.R * 10).toFixed(2), wand: _domeSollR(m, k) }];
  const ax = p.axisDir.clone();
  for (let i = 1; i <= 7; i++) {
    m.position.addScaledVector(ax, 1.0);                 // je 10 mm höher
    m.updateMatrixWorld(true);
    _svgWrapFollowWall(m);
    out.push({ mm: i * 10, R: +(m.userData._svgWrap.R * 10).toFixed(2), wand: _domeSollR(m, k) });
  }
  return { out, gewickelt: !!m.userData._svgWrap };
}, SVG);
ok('Motiv bleibt über den ganzen Weg gewickelt', lauf.gewickelt, lauf.fehler);
ok('Wickelradius folgt dem Profil (≤ 0,5 mm Abweichung)',
   lauf.out.every(r => r.wand != null && Math.abs(r.R - r.wand) < 0.5),
   lauf.out.filter(r => r.wand == null || Math.abs(r.R - r.wand) >= 0.5));
ok('Wickelradius fällt monoton mit der Höhe',
   lauf.out.every((r, i) => i === 0 || r.R < lauf.out[i-1].R + 0.3), lauf.out.map(r => r.R));

// ── 3) Kugel: JEDE Achse wäre gültig — es muss die senkrechte bleiben ──────
// Ohne die Bevorzugung der aufrechten Achse wickelt sich das Motiv plötzlich
// um die Querachse, sobald man es ein Stück hochschiebt.
const kugel = await pg.evaluate(() => {
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  addShape('sphere'); const k = objects[objects.length-1];
  k.scale.set(2.3, 2.3, 2.3); k.position.set(0, 0, 0); k.updateMatrixWorld(true);
  const R = [];
  for (const hMM of [0, 6, 12, 18]) {
    const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(50, hMM/10, 0), new THREE.Vector3(-1, 0, 0));
    const h = rc.intersectObject(k, true).find(x => x.face);
    const p = _svgWrapProbe(k, h.point.clone());
    R.push({ hoehe: hMM, achse: p && p.axisDir.toArray().map(v => +v.toFixed(2)),
             R: p && +(p.R * 10).toFixed(2), soll: +Math.sqrt(23*23 - hMM*hMM).toFixed(2) });
  }
  return R;
});
ok('Kugel: immer die senkrechte Achse', kugel.every(r => r.achse && Math.abs(r.achse[1]) > 0.99), kugel);
ok('Kugel: Radius folgt der Höhe (√(R²−h²))',
   kugel.every(r => Math.abs(r.R - r.soll) < 0.4), kugel);

// ── 4) Dünnere und dickere Wand ────────────────────────────────────────────
const waende = await pg.evaluate(() => {
  const R = {};
  for (const wand of [1, 2, 4]) {
    const k = _domeBuild(wand);
    const bb = new THREE.Box3().setFromObject(k);
    let schlimmste = 0, erkannt = 0, n = 0;
    for (let f = 0.05; f <= 0.85; f += 0.1) {
      const y = bb.min.y + (bb.max.y - bb.min.y) * f;
      const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(200, y, 0), new THREE.Vector3(-1, 0, 0));
      const h = rc.intersectObject(k, true).find(x => x.face);
      if (!h) continue;
      n++;
      const p = _svgWrapProbe(k, h.point.clone());
      if (!p) continue;
      erkannt++;
      schlimmste = Math.max(schlimmste, Math.abs(p.R*10 - Math.hypot(h.point.x, h.point.z)*10));
    }
    R['wand' + wand] = { erkannt, n, schlimmste: +schlimmste.toFixed(2) };
  }
  return R;
});
ok('Hohlkörper mit 1/2/4 mm Wand werden überall erkannt',
   Object.values(waende).every(r => r.erkannt === r.n), waende);
ok('Radius stimmt bei jeder Wandstärke (≤ 0,5 mm)',
   Object.values(waende).every(r => r.schlimmste < 0.5), waende);

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Hohlkuppel-Tests bestanden.');
process.exit(fails.length ? 1 : 0);
