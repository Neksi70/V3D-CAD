// Josy 12.9.26: "jetzt ist es nicht ganz drauf, lässt sich nicht ganz drauf legen"
// — und auf Nachfrage: es war UNTEN, nicht oben.
//
// Nachgemessen an ihrer Lichthülle: Setzt man ein Motiv unten auf, rückt der
// Randstopp es nach oben, damit es ganz auf der Wand liegt (eingebaut am 10.9.
// auf ihre Meldung "ist er ja nur halb"). Gemessen: Klick bei 10 mm, ein
// 100-mm-Motiv landet bei 50 mm — 40 mm höher. Das passiert WORTLOS, und beim
// Ziehen bleibt das Motiv einfach stehen. Für die Nutzerin sieht beides so aus,
// als ließe es sich nicht hinlegen.
// Das Rücken selbst ist richtig. Es muss nur ankommen.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL_ = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('edge-test','test@lokal'))"],
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
  // Lichthülle wie Josys: 120 breit, 130 hoch, 2 mm Wand, unten offen.
  // Als IMPORT aufgesetzt (Geometrie Z-up, Kippen nur am Mesh).
  window._huelle = () => {
    const H = 130, N = 52, rA = z => 60 - 32 * Math.pow(z / H, 1.7), pts = [];
    for (let i = 0; i <= N; i++) { const z = H*i/N; pts.push(new THREE.Vector2(rA(z), z)); }
    for (let i = N; i >= 0; i--) { const z = H*i/N; pts.push(new THREE.Vector2(Math.max(0.5, rA(z)-2), z)); }
    pts.push(pts[0].clone());
    const geo = new THREE.LatheGeometry(pts, 96).toNonIndexed();
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x66cccc, side: THREE.DoubleSide }));
    m.scale.setScalar(0.1); m.rotation.x = -Math.PI / 2;
    m.userData = { id: idCtr++, name: 'Lichthülle', type: 'import', shapeType: 'import', _origGeo: geo };
    scene.add(m); objects.push(m); m.updateMatrixWorld(true);
    return m;
  };
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 120">
 <path d="M30,4 C10,30 8,80 30,116 C52,80 50,30 30,4 Z" fill="none" stroke="black" stroke-width="2"/></svg>`;

// ── 1) Unten aufsetzen: Motiv rückt hoch — und sagt es ─────────────────────
const auf = await pg.evaluate(async (svg) => {
  const R = [];
  const meld = [];
  const orig = window.notify;
  window.notify = t => meld.push(String(t));
  for (const [klick, gross] of [[10, 100], [10, 70], [10, 40], [65, 40]]) {
    if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
    meld.length = 0;
    const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 1.5, targetMM: gross, name: 'Blatt' });
    const k = _huelle();
    const bb = new THREE.Box3().setFromObject(k);
    const y = bb.min.y + klick / 10;
    const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(200, y, 0), new THREE.Vector3(-1, 0, 0));
    const h = rc.intersectObject(k, true).find(x => x.face);
    const p = h && _svgWrapProbe(k, h.point.clone());
    if (!p) { R.push({ klick, gross, fehler: 'keine Rundung' }); continue; }
    _svgWrapApply(m, p, h.point.clone()); m.updateMatrixWorld(true);
    const mb = new THREE.Box3().setFromObject(m);
    R.push({ klick, gross,
             gelandet: +(((mb.min.y + mb.max.y) / 2 - bb.min.y) * 10).toFixed(1),
             unterkante: +((mb.min.y - bb.min.y) * 10).toFixed(1),
             meldung: meld.filter(t => /gerückt/.test(t))[0] || null });
  }
  window.notify = orig;
  return R;
}, SVG);
const grosserSprung = auf.filter(r => r.gelandet - r.klick > 2);
ok('unten aufgesetzt rückt das Motiv nach oben (Randstopp wirkt)',
   grosserSprung.length >= 3, auf);
ok('das Rücken wird jedes Mal gemeldet',
   grosserSprung.every(r => r.meldung && /gerückt/.test(r.meldung)), auf.map(r => r.meldung));
ok('die Meldung nennt den Betrag und den Ausweg',
   grosserSprung.every(r => /\d+ mm nach oben/.test(r.meldung) && /kleiner/.test(r.meldung)),
   grosserSprung[0] && grosserSprung[0].meldung);
ok('Motiv sitzt danach wirklich ganz auf der Wand',
   auf.every(r => r.unterkante >= -0.1), auf.map(r => r.unterkante));
const mittig = auf.find(r => r.klick === 65);
ok('in der Mitte aufgesetzt wird NICHT gerückt und nichts gemeldet',
   mittig && Math.abs(mittig.gelandet - mittig.klick) < 2 && !mittig.meldung, mittig);

// ── 2) Beim Ziehen: der Randstopp zeigt sich am Zeiger ─────────────────────
const zug = await pg.evaluate(async (svg) => {
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 1.5, targetMM: 70, name: 'Blatt' });
  const k = _huelle();
  const bb = new THREE.Box3().setFromObject(k);
  const y = bb.min.y + (bb.max.y - bb.min.y) * 0.5;
  const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(200, y, 0), new THREE.Vector3(-1, 0, 0));
  const h = rc.intersectObject(k, true).find(x => x.face);
  const p = _svgWrapProbe(k, h.point.clone());
  _svgWrapApply(m, p, h.point.clone()); m.updateMatrixWorld(true); _svgWrapTarget(m);
  selectObjs([]);
  orbitTarget.set(0, (bb.min.y + bb.max.y) / 2, 0);
  sph.theta = 0; sph.phi = 1.45; sph.r = 42; sph2cam(); camera.updateMatrixWorld(true);
  // Greifpunkt auf dem Motiv finden, der wirklich auf der Leinwand liegt
  const r = renderer.domElement.getBoundingClientRect(), rcv = new THREE.Raycaster();
  const c = _svgGlideScreenPt(_svgCenterWorld(m));
  let pt = null;
  for (let rad = 0; rad <= 90 && !pt; rad += 6) for (let a = 0; a < 16; a++) {
    const x = c.x + rad * Math.cos(a * Math.PI/8), yy = c.y + rad * Math.sin(a * Math.PI/8);
    if (x < r.left+4 || x > r.right-4 || yy < r.top+4 || yy > r.bottom-4) continue;
    if (document.elementFromPoint(x, yy) !== renderer.domElement) continue;
    rcv.setFromCamera(new THREE.Vector2(((x-r.left)/r.width)*2-1, -((yy-r.top)/r.height)*2+1), camera);
    const hh = rcv.intersectObjects(objects, true).find(t => t.face && !t.object.userData.isEdgeLines);
    if (!hh) continue;
    let o = hh.object; while (o && !objects.includes(o)) o = o.parent;
    if (o === m) { pt = { x: Math.round(x), y: Math.round(yy) }; break; }
    if (rad === 0) break;
  }
  return pt;
}, SVG);
ok('Motiv ist greifbar', !!zug, zug);
const hinweise = [];
if (zug) {
  await pg.mouse.move(zug.x, zug.y);
  await pg.mouse.down();
  for (let i = 1; i <= 16; i++) {                       // kräftig nach unten ziehen
    await pg.mouse.move(zug.x, zug.y + i * 10);
    await pg.waitForTimeout(18);
    hinweise.push(await pg.evaluate(() => {
      const h = document.getElementById('text-glide-hint') || document.getElementById('text-snap-hint');
      return h && h.style.display !== 'none' ? h.textContent : '';
    }));
  }
  await pg.mouse.up();
}
ok('beim Ziehen über den Rand hinaus erscheint der Randstopp-Hinweis',
   hinweise.some(t => /Rand des Körpers/.test(t)), hinweise.filter(Boolean).slice(-3));
ok('der Hinweis nennt die Alt-Taste als Ausweg',
   hinweise.some(t => /Alt-Taste/.test(t)), hinweise.filter(t => /Rand/.test(t)).slice(0, 1));

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Randstopp-Tests bestanden.');
process.exit(fails.length ? 1 : 0);
