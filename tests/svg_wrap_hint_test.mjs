// Josy 12.9.26: "jetzt ist es nicht ganz drauf, lässt sich nicht ganz drauf legen".
// Nachgemessen an ihrer Lichthülle: Die App bietet das Wickeln auf dem ganzen
// Körper an — NUR auf den obersten Millimetern nicht, wo sich die Kuppel
// wegwölbt (dort ist die Flächennormale nicht mehr radial, um eine Achse
// wickeln geht da grundsätzlich nicht). Dort blieb das Motiv flach, und flach
// auf einer Wölbung liegt es nun einmal nur in der Mitte auf.
// Der Fehler war: Die App sagte dazu nichts — am Zeiger stand kommentarlos
// "📌 Auf Fläche heften". Jetzt steht der Grund dabei.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL_ = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('hint-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL_).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) {}
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL_, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

await pg.evaluate(() => {
  // Lichthülle mit RUNDER Kuppel oben — wie Josys Modell: unten fast senkrechte
  // Wand (wickelbar), oben eine Wölbung (nicht wickelbar).
  window._huelle = (ovalFaktor) => {
    if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
    const H = 110, R0 = 55, SEG = 96, pts = [];
    for (let z = 0; z <= H; z += 2.5) pts.push(new THREE.Vector2(R0 - 6 * Math.pow(z / H, 2), z));
    for (let a = 0; a <= 90; a += 6) {                     // Kuppel: Viertelkreis
      const r = 25, cx = R0 - 6 - r;
      pts.push(new THREE.Vector2(cx + r * Math.cos(a * Math.PI / 180), H + r * Math.sin(a * Math.PI / 180)));
    }
    for (let i = pts.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(Math.max(0.5, pts[i].x - 2), pts[i].y));
    pts.push(pts[0].clone());                              // Profil schließen
    const geo = new THREE.LatheGeometry(pts, SEG).toNonIndexed();
    geo.rotateX(Math.PI / 2);                              // Z-up wie ein STL
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x66cccc, side: THREE.DoubleSide }));
    m.scale.set(0.1 * (ovalFaktor || 1), 0.1, 0.1);
    m.rotation.x = -Math.PI / 2;                           // wie _addImportedGeo
    m.userData = { id: idCtr++, name: 'Lichthülle', type: 'import', shapeType: 'import', _origGeo: geo };
    scene.add(m); objects.push(m); m.updateMatrixWorld(true);
    return m;
  };
  // Zeiger-Hinweis an einem Weltpunkt abfragen — genau der Weg, den auch das
  // Ziehen nimmt (_svgSnapDetect schießt vom Cursor aus).
  window._hinweisAn = (svgMesh, weltPunkt) => {
    const r = renderer.domElement.getBoundingClientRect();
    const p = weltPunkt.clone().project(camera);
    const ev = { clientX: r.left + (p.x * 0.5 + 0.5) * r.width,
                 clientY: r.top + (-p.y * 0.5 + 0.5) * r.height };
    _svgSnapDetect(svgMesh, ev);
    const h = document.getElementById('text-snap-hint');
    return { text: h.style.display === 'none' ? '(nichts)' : h.textContent,
             art: _textSnapTarget ? _textSnapTarget.type : null };
  };
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100"><path d="M30,4 C10,30 8,70 30,96 C52,70 50,30 30,4 Z"/></svg>`;

// ── 1) Bauch = wickeln, Kuppel = Hinweis ───────────────────────────────────
const r1 = await pg.evaluate(async (svg) => {
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 1.5, targetMM: 35, name: 'Blatt' });
  const k = _huelle(1);
  const bb = new THREE.Box3().setFromObject(k);
  // Kamera von vorn, damit die Trefferpunkte auch sichtbar sind
  orbitTarget.set(0, (bb.min.y + bb.max.y) / 2, 0);
  sph.theta = 0; sph.phi = 1.45; sph.r = 40; sph2cam(); camera.updateMatrixWorld(true);
  const treffer = (hProzent) => {
    const y = bb.min.y + (bb.max.y - bb.min.y) * hProzent;
    const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(200, y, 0), new THREE.Vector3(-1, 0, 0));
    const h = rc.intersectObject(k, true).find(x => x.face);
    return h && h.point.clone();
  };
  // Die Wölbung liegt auf der SCHULTER (Viertelkreis oben). Ein Strahl von oben
  // fiele durch die Öffnung — wie bei Josys Hülle, die oben offen ist.
  const R = {};
  for (const [name, pt] of [['bauch_30', treffer(0.30)], ['bauch_60', treffer(0.60)],
                            ['schulter', treffer(0.95)], ['scheitel', treffer(0.99)]]) {
    R[name] = pt ? _hinweisAn(m, pt) : null;
  }
  return R;
}, SVG);
ok('Bauch unten: bietet Wickeln an', /Um Rundung wickeln/.test(r1.bauch_30.text), r1.bauch_30);
ok('Bauch oben: bietet Wickeln an', /Um Rundung wickeln/.test(r1.bauch_60.text), r1.bauch_60);
// Seit v1.18.24 wird auf der Wölbung nicht mehr kommentarlos geheftet, sondern
// ANGESCHMIEGT (Höhenfeld der Wand, Bogenlängen) — der Hinweis nennt das.
const woelbung = [r1.schulter, r1.scheitel].filter(x => x && !/Um Rundung wickeln/.test(x.text));
ok('Wölbung oben: dort wird nicht gewickelt (richtig so)', woelbung.length > 0,
   { schulter: r1.schulter, scheitel: r1.scheitel });
ok('Wölbung: bietet Anschmiegen an statt flach zu heften',
   woelbung.length > 0 && woelbung.every(x => /anschmiegen/.test(x.text) && x.art === 'schmieg'), woelbung);

// ── 2) Zu ovaler Körper sagt weiterhin „zu oval" ───────────────────────────
const r2 = await pg.evaluate(async (svg) => {
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 1.5, targetMM: 35, name: 'Blatt' });
  const k = _huelle(1.35);                       // 35 % in X gestaucht → zu oval
  const bb = new THREE.Box3().setFromObject(k);
  orbitTarget.set(0, (bb.min.y + bb.max.y) / 2, 0);
  sph.theta = 0; sph.phi = 1.45; sph.r = 50; sph2cam(); camera.updateMatrixWorld(true);
  const y = bb.min.y + (bb.max.y - bb.min.y) * 0.4;
  const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(300, y, 0), new THREE.Vector3(-1, 0, 0));
  const h = rc.intersectObject(k, true).find(x => x.face);
  return h ? _hinweisAn(m, h.point.clone()) : null;
}, SVG);
// Seit 1.18.222: fast senkrechte ovale Wand → „↪ Um die Kanten legen“ (Abwicklung entlang des Umrisses),
// das ist dort genauer als das Höhenfeld des Anschmiegens. Beides legt das Motiv an statt flach zu heften.
ok('zu ovaler Körper: legt das Motiv an (statt „zu oval" zu heften)', r2 && /anschmiegen|Kanten legen/.test(r2.text) && r2.art === 'schmieg', r2);

// ── 3) Flache Wand bleibt schlicht „Auf Fläche heften" ─────────────────────
const r3 = await pg.evaluate(async (svg) => {
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 1.5, targetMM: 25, name: 'Blatt' });
  addShape('box'); const k = objects[objects.length - 1];
  k.scale.set(4, 4, 4); k.position.set(0, 2, 0); k.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(k);
  orbitTarget.copy(bb.getCenter(new THREE.Vector3()));
  sph.theta = 0; sph.phi = 1.45; sph.r = 30; sph2cam(); camera.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(0, 2, 200), new THREE.Vector3(0, 0, -1));
  const h = rc.intersectObject(k, true).find(x => x.face);
  return h ? _hinweisAn(m, h.point.clone()) : null;
}, SVG);
ok('flache Wand: schlicht „Auf Fläche heften", kein Zusatz',
   r3 && r3.text.trim() === '📌 Auf Fläche heften', r3);

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Zeiger-Hinweis-Tests bestanden.');
process.exit(fails.length ? 1 : 0);
