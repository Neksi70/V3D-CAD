// Josy 12.9.26: "Habe jetzt alles drauf … aber er stoppt bei 93%".
// 93 % ist der Punkt, an dem der Balken auf das OCCT-Backend WARTET. Im
// Serverprotokoll: "[pool] Auftrag auf Arbeiter 0 über 600s — Arbeiter wird
// abgeräumt". Gemessen an ihrer Lichthülle (19.528 Dreiecke) mit EINEM Motiv
// (2.334 Dreiecke): Manifold 0,7 s, OCCT 146 s — Faktor 207. Mit ihren ~15
// Motiven reißt das zwangsläufig die 600-Sekunden-Notbremse.
//
// Ursache: Der Schnellweg über Manifold griff nur ab 50.000 Dreiecken oder bei
// gewickelten Motiven. Ein aus STL importierter Körper hat aber gar keine
// B-Rep, die OCCT bewahren könnte — es näht das Netz nur zusammen und gibt am
// Ende wieder ein Netz zurück. Für solche Körper ist OCCT reine Wartezeit.
//
// Zweitens: Ein einziges nicht wasserdichtes Motiv brachte den ganzen Abzug zu
// Fall (alle Werkzeuge werden vorher vereint) — und der Rückfall war ausgerechnet
// OCCT. Jetzt werden die Motive dann einzeln abgezogen.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('grav-test','test@lokal'))"],
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

// Hohlkuppel wie Josys Lichthülle, als IMPORT aufgesetzt (Geometrie Z-up,
// Kippen nur am Mesh) — nur so greift dieselbe Weiche wie bei ihr.
await pg.evaluate(() => {
  window._huelle = () => {
    const H = 130, SEG = 96, N = 40, rA = z => 60 - 32 * Math.pow(z / H, 1.7);
    const pts = [];
    for (let i = 0; i <= N; i++) { const z = H*i/N; pts.push(new THREE.Vector2(rA(z), z)); }
    for (let i = N; i >= 0; i--) { const z = H*i/N; pts.push(new THREE.Vector2(Math.max(0.5, rA(z)-2), z)); }
    pts.push(pts[0].clone());   // Profil schliessen: sonst ist die Huelle unten offen
    const geo = new THREE.LatheGeometry(pts, SEG).toNonIndexed();
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe8e8e8, side: THREE.DoubleSide }));
    m.scale.setScalar(0.1); m.rotation.x = -Math.PI / 2;
    m.userData = { id: idCtr++, name: 'Lichthülle', type: 'import', shapeType: 'import',
                   color: '#e8e8e8', isHole: false, _origGeo: geo };
    scene.add(m); objects.push(m); m.updateMatrixWorld(true);
    return m;
  };
});

// ── 1) Die Weiche: importiertes Netz geht an Manifold, nicht an OCCT ───────
const weiche = await pg.evaluate(() => {
  const R = {};
  // Fehlt die Funktion (alter Stand), NICHT abstürzen — sonst laufen die
  // eigentlich interessanten Prüfungen weiter unten gar nicht erst an und die
  // Gegenprobe gegen den alten Stand ist wertlos.
  if (typeof _istNetzImport === 'undefined') return { fehlt: true };
  const imp = _huelle();
  R.netzimport = _istNetzImport(imp);
  addShape('box'); const box = objects[objects.length-1];
  R.box = _istNetzImport(box);
  imp.userData._brepStep = 'xx';
  R.mit_brep = _istNetzImport(imp);
  delete imp.userData._brepStep;
  imp.userData.occtShape = 'cylinder';
  R.mit_occtShape = _istNetzImport(imp);
  delete imp.userData.occtShape;
  return R;
});
ok('Weiche „Netz-Import" existiert', !weiche.fehlt, weiche);
ok('STL-Import zählt als Netz-Import', weiche.netzimport === true, weiche);
ok('in der App gebauter Körper NICHT', weiche.box === false, weiche);
ok('STEP-Import (echte B-Rep) NICHT', weiche.mit_brep === false, weiche);
ok('OCCT-Grundkörper NICHT', weiche.mit_occtShape === false, weiche);

// ── 2) Josys Fall: viele gewickelte Motive, Gravur über Manifold ───────────
const SVGS = [];
for (let i = 0; i < 8; i++) {
  const teile = [];
  for (let n = 0; n < 6; n++) {
    const cx = 14 + n*15, cy = 18 + (n % 2) * 14, r = 4 + (n % 3);
    teile.push(`M${cx-r},${cy} a${r},${r} 0 1,0 ${2*r},0 a${r},${r} 0 1,0 ${-2*r},0 Z`);
  }
  SVGS.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="${teile.join(' ')}"/></svg>`);
}
const gravur = await pg.evaluate(async (svgs) => {
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  const motive = svgs.map((s, i) => _importSvgConfirm({ svgText: s, mode: 'extrude', depthMM: 2, targetMM: 38, name: 'Motiv ' + i }));
  const k = _huelle();
  const bb = new THREE.Box3().setFromObject(k);
  let gewickelt = 0;
  motive.forEach((m, i) => {
    const y = bb.min.y + (bb.max.y - bb.min.y) * (0.15 + 0.09 * i);
    const a = i * 0.9, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const rc = new THREE.Raycaster(); rc.set(dir.clone().multiplyScalar(200).setY(y), dir.clone().negate());
    const h = rc.intersectObject(k, true).find(x => x.face);
    const p = h && _svgWrapProbe(k, h.point.clone());
    if (p) { _svgWrapApply(m, p, h.point.clone()); m.updateMatrixWorld(true); gewickelt++; }
    m.userData.isHole = true;
  });
  const tris = motive.reduce((n, m) => n + m.geometry.attributes.position.count/3, 0);
  const t0 = performance.now();
  const geo = await _mfSubtractWorld([k], motive);
  return { gewickelt, motive: motive.length, werkzeug_tris: tris,
           koerper_tris: k.geometry.attributes.position.count/3,
           ms: Math.round(performance.now() - t0), ergebnis_tris: geo.attributes.position.count/3 };
}, SVGS);
ok('alle Motive sind gewickelt', gravur.gewickelt === gravur.motive, gravur);
ok('Gravur läuft über Manifold durch', gravur.ergebnis_tris > 0, gravur);
ok('… und zwar in Sekunden, nicht Minuten (< 20 s)', gravur.ms < 20000, { ms: gravur.ms });
ok('Ergebnis hat mehr Dreiecke als der nackte Körper', gravur.ergebnis_tris > gravur.koerper_tris, gravur);

// ── 3) Ein kaputtes Motiv darf den Rest nicht mitreißen ────────────────────
const kaputt = await pg.evaluate(async (svgs) => {
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  const motive = svgs.slice(0, 3).map((s, i) => _importSvgConfirm({ svgText: s, mode: 'extrude', depthMM: 2, targetMM: 38, name: 'Motiv ' + i }));
  const k = _huelle();
  const bb = new THREE.Box3().setFromObject(k);
  motive.forEach((m, i) => {
    const y = bb.min.y + (bb.max.y - bb.min.y) * (0.2 + 0.15 * i);
    const a = i * 1.6, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const rc = new THREE.Raycaster(); rc.set(dir.clone().multiplyScalar(200).setY(y), dir.clone().negate());
    const h = rc.intersectObject(k, true).find(x => x.face);
    const p = h && _svgWrapProbe(k, h.point.clone());
    if (p) { _svgWrapApply(m, p, h.point.clone()); m.updateMatrixWorld(true); }
    m.userData.isHole = true;
  });
  // Das mittlere Motiv mutwillig zerstören: ein Loch ins Netz reißen, damit
  // es nicht mehr wasserdicht ist (genau der Fall aus dem Serverprotokoll,
  // "1 offene/degenerierte übersprungen").
  const g = motive[1].geometry, pos = g.attributes.position;
  const arr = pos.array.slice(0, pos.array.length - 9 * 40);   // 40 Dreiecke abschneiden
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  motive[1].geometry = g2; motive[1].updateMatrixWorld(true);
  const meldungen = [];
  const origNotify = window.notify;
  window.notify = (t, k2) => { meldungen.push(String(t)); };
  let res = null, fehler = null;
  try { res = await _mfSubtractWorld([k], motive); } catch (e) { fehler = String(e.message || e); }
  window.notify = origNotify;
  return { ok: !!res, fehler, meldungen,
           ergebnis_tris: res ? res.attributes.position.count/3 : 0,
           koerper_tris: k.geometry.attributes.position.count/3 };
}, SVGS);
ok('kaputtes Motiv reißt den Abzug nicht mehr mit', kaputt.ok, kaputt);
ok('die anderen Motive sind trotzdem graviert',
   kaputt.ergebnis_tris > kaputt.koerper_tris, kaputt);
// Seit v1.16.8 wird ein sperriges Motiv zuerst automatisch repariert; klappt das
// nicht, wird es übersprungen. Beides ist in Ordnung — entscheidend ist, dass der
// Abzug durchläuft und der Nutzer erfährt, welches Motiv betroffen war.
ok('der Nutzer erfährt, welches Motiv geklemmt hat',
   kaputt.meldungen.some(t => /(Übersprungen|repariert)/i.test(t) && /Motiv 1/.test(t)), kaputt.meldungen);

// ── 4) Der echte Weg über die Oberfläche: nimmt subtractHoles den Schnellweg? ─
// Das ist der Punkt, an dem Josy hängen blieb. Ohne die Weiche ginge der Auftrag
// an OCCT und käme erst nach Minuten (oder gar nicht) zurück.
const konsole = [];
pg.on('console', m => konsole.push(m.text()));
const echt = await pg.evaluate(async (svgs) => {
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  const motive = svgs.slice(0, 5).map((s, i) => _importSvgConfirm({ svgText: s, mode: 'extrude', depthMM: 2, targetMM: 38, name: 'Motiv ' + i }));
  const k = _huelle();
  const bb = new THREE.Box3().setFromObject(k);
  motive.forEach((m, i) => {
    const y = bb.min.y + (bb.max.y - bb.min.y) * (0.18 + 0.12 * i);
    const a = i * 1.2, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const rc = new THREE.Raycaster(); rc.set(dir.clone().multiplyScalar(200).setY(y), dir.clone().negate());
    const h = rc.intersectObject(k, true).find(x => x.face);
    const p = h && _svgWrapProbe(k, h.point.clone());
    if (p) { _svgWrapApply(m, p, h.point.clone()); m.updateMatrixWorld(true); }
    m.userData.isHole = true;
  });
  // Gravurtiefe-Dialog überspringen
  window._engraveDepthDialog = () => Promise.resolve({ depth: 1.2, wantInlay: false, through: false });
  const vorher = objects.length;
  selectObjs([k, ...motive]);
  const t0 = performance.now();
  await subtractHoles();
  for (let i = 0; i < 400 && objects.length >= vorher; i++) await new Promise(r => setTimeout(r, 50));
  return { ms: Math.round(performance.now() - t0), objekte: objects.length,
           tris: objects[0] ? objects[0].geometry.attributes.position.count/3 : 0 };
}, SVGS);
ok('Abziehen über die Oberfläche läuft durch', echt.objekte === 1, echt);
ok('… in Sekunden statt Minuten (< 30 s)', echt.ms < 30000, { ms: echt.ms });
ok('… und nachweislich über den Manifold-Schnellweg',
   konsole.some(t => /Manifold-Schnellweg/.test(t)),
   konsole.filter(t => /subtract/i.test(t)).slice(0, 3));

// ── 5) Josys Fall 1:1 — Durchbrüche, eines der Motive nicht wasserdicht ────
// Aus ihrem Serverprotokoll: EIN Körper, danach SIEBEN Werkzeuge nacheinander
// ("14 Shells", "12 Shells", …, "5 Shells → 4 Solids, 1 offene/degenerierte
// übersprungen") in EINEM Auftrag — also der generische Weg mit Durchbrüchen,
// nicht die Gravur-Schleife. Zusammen 277.000 Dreiecke: Manifold WURDE gewählt,
// scheiterte aber am kaputten Motiv und fiel auf OCCT zurück → 600-Sekunden-
// Notbremse, Balken bei 93 %.
const konsole2 = [];
pg.on('console', m => konsole2.push(m.text()));
const josy = await pg.evaluate(async (svgs) => {
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  const motive = svgs.slice(0, 6).map((s, i) => _importSvgConfirm({ svgText: s, mode: 'extrude', depthMM: 4, targetMM: 38, name: 'Motiv ' + i }));
  const k = _huelle();
  const bb = new THREE.Box3().setFromObject(k);
  motive.forEach((m, i) => {
    const y = bb.min.y + (bb.max.y - bb.min.y) * (0.18 + 0.1 * i);
    const a = i * 1.05, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const rc = new THREE.Raycaster(); rc.set(dir.clone().multiplyScalar(200).setY(y), dir.clone().negate());
    const h = rc.intersectObject(k, true).find(x => x.face);
    if (h) {
      // flach aufsetzen (nicht wickeln) und mittig in die Wand schieben
      const n = h.face.normal.clone().transformDirection(k.matrixWorld).normalize();
      m.position.copy(h.point);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3().crossVectors(n, new THREE.Vector3(0,1,0)).normalize(), n,
        new THREE.Vector3().crossVectors(n, new THREE.Vector3().crossVectors(n, new THREE.Vector3(0,1,0)).normalize()).normalize()));
      m.updateMatrixWorld(true);
    }
    m.userData.isHole = true;
    m.userData._cutThrough = true;          // Durchbruch — Licht soll durchscheinen
  });
  // Ein Motiv mutwillig beschädigen (wie "1 offene/degenerierte" im Protokoll)
  const g = motive[3].geometry, pos = g.attributes.position;
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(pos.array.slice(0, pos.array.length - 9 * 60), 3));
  motive[3].geometry = g2; motive[3].updateMatrixWorld(true);

  window._engraveDepthDialog = () => Promise.resolve({ depth: 1.2, wantInlay: false, through: true });
  const vorher = objects.length;
  selectObjs([k, ...motive]);
  const t0 = performance.now();
  await subtractHoles();
  for (let i = 0; i < 400 && objects.length >= vorher; i++) await new Promise(r => setTimeout(r, 50));
  return { ms: Math.round(performance.now() - t0), objekte: objects.length,
           tris: objects[0] ? objects[0].geometry.attributes.position.count/3 : 0 };
}, SVGS);
ok('Josys Fall: läuft überhaupt durch', josy.objekte === 1, josy);
ok('Josys Fall: in Sekunden statt Minuten (< 30 s)', josy.ms < 30000, { ms: josy.ms });
ok('Josys Fall: kein Rückfall auf OCCT',
   !konsole2.some(t => /Manifold-Schnellweg fehlgeschlagen[\s\S]*OCCT/.test(t)) &&
   !konsole2.some(t => /→ OCCT/.test(t)),
   konsole2.filter(t => /subtract/i.test(t)).slice(0, 4));
ok('Josys Fall: das kaputte Motiv wurde geheilt oder übersprungen — nicht ignoriert',
   konsole2.some(t => /(übersprungen|repariert)/i.test(t) && /Motiv 3/.test(t)),
   konsole2.filter(t => /(übersprungen|repariert)/i.test(t)).slice(0, 3));

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Gravur-Tests bestanden.');
process.exit(fails.length ? 1 : 0);
