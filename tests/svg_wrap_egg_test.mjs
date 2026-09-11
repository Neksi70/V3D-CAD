// Josy 11.9.26 (3. Meldung): eigenes STL, eiförmiger Körper (Bbox 46 × 47,5 × 56,6 mm).
// "Ich kann das nicht einfach so", "es liegt nie wirklich drauf", "es ist ja wieder schräg".
// Zwei Ursachen, beide hier festgenagelt:
//   (1) Die Rundungserkennung hatte einen Vorfilter auf die SKALIERUNG des
//       Körpers mit 2 % Toleranz. Ein Körper, der nur 3 % unrund skaliert war,
//       wurde gar nicht mehr als Rundung angeboten — kommentarlos, es blieb nur
//       flaches Aufheften. Jetzt wird der Radius am echten Körper gemessen.
//   (2) Das Nachführen beim Verschieben gab auf, sobald der Wandradius um mehr
//       als 25 % vom Wickelradius abwich. Auf einer Kugel/einem Ei passiert das
//       nach wenigen Millimetern → das Motiv behielt den alten Radius und
//       schwebte (gemessen: 18 mm höher auf Ø46 = 6,6 mm Spalt).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M2,5 H98 V35 H2 Z"/></svg>`;
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
// Mit V3D_URL=http://localhost:8765/volme3d.html läuft der Test auch gegen die
// minifizierte Auslieferung — die verlangt ein Sitzungs-Cookie, das wir uns mit
// dem Server-Schlüssel selbst ausstellen.
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('wrap-test','test@lokal'))"],
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

// Hilfsfunktionen im Browser: Szene bauen, Spalt Motiv↔Wand messen.
await pg.evaluate((svg) => {
  window._eggSvg = svg;
  // Körper aufbauen. WICHTIG: das Motiv zuerst importieren — der Import rückt
  // vorhandene Körper beiseite und verfälscht sonst jede Messung.
  window._eggBuild = (scale, rotZgrad) => {
    if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
    const m = _importSvgConfirm({ svgText: window._eggSvg, mode: 'extrude', depthMM: 3, targetMM: 22, name: 'Motiv' });
    addShape('sphere');
    const k = objects.find(o => o !== m && o.userData.shapeType !== 'svg');
    k.userData.name = 'Ei';
    k.scale.set(scale[0], scale[1], scale[2]);
    k.rotation.z = (rotZgrad || 0) * Math.PI / 180;
    k.position.set(0, 0, 0); k.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(k);
    const rc = new THREE.Raycaster();
    rc.set(new THREE.Vector3(80, (bb.min.y + bb.max.y) / 2, 0), new THREE.Vector3(-1, 0, 0));
    const h = rc.intersectObject(k, true).find(x => x.face);
    return { m, k, hit: h && h.point.clone(),
             bbox: bb.getSize(new THREE.Vector3()).multiplyScalar(10).toArray().map(v => +v.toFixed(1)) };
  };
  // Abstand Motiv ↔ Wand, EXAKT statt gestrahlt: der Körper ist eine skalierte
  // Einheitskugel, in seinem lokalen Frame ist die Wand also r = √(1−y²).
  // Für jeden Motiv-Eckpunkt den Abstand dazu rechnen. Messstrahlen hatten hier
  // Streifschüsse geliefert (einzelne Ausreißer bei sauberem Profil ringsum).
  // Rückgabe in mm: ab = wie weit der äußerste Punkt vor der Wand steht,
  // ein = wie tief der innerste eintaucht (soll ≈ −Gravurtiefe sein).
  window._eggSpalt = (m, k) => {
    m.updateMatrixWorld(true); k.updateMatrixWorld(true);
    if (!m.userData._svgWrap) return null;
    const inv = new THREE.Matrix4().copy(k.matrixWorld).invert();
    const radial = Math.abs(k.scale.x) * 10;            // lokal → mm (x und z gleich skaliert)
    const pos = m.geometry.attributes.position, v = new THREE.Vector3();
    let ab = -Infinity, ein = Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      if (Math.abs(v.y) >= 1) continue;                 // über dem Pol: keine Wand mehr
      const d = (Math.hypot(v.x, v.z) - Math.sqrt(1 - v.y * v.y)) * radial;
      if (d > ab) ab = d;
      if (d < ein) ein = d;
    }
    return ab === -Infinity ? null : { ab: +ab.toFixed(2), ein: +ein.toFixed(2) };
  };
  // Bildschirmpunkt suchen, an dem das MOTIV vorn liegt. Die Mitte eines
  // gebogenen Motivs liegt hinter der Wand — dort greift der Zug den Körper.
  window._eggMotivPunkt = (m) => {
    const r = renderer.domElement.getBoundingClientRect();
    const rc = new THREE.Raycaster();
    const c = _svgGlideScreenPt(_svgCenterWorld(m));
    for (let rad = 0; rad <= 90; rad += 6) {
      for (let a = 0; a < 16; a++) {
        const x = c.x + rad * Math.cos(a * Math.PI / 8), y = c.y + rad * Math.sin(a * Math.PI / 8);
        if (x < r.left + 4 || x > r.right - 4 || y < r.top + 4 || y > r.bottom - 4) continue;
        // Am ausgewählten Objekt liegen die weißen Größe-Anfasser als DOM-Elemente
        // ÜBER dem Canvas. Ein Zug dort ändert die Größe statt zu gleiten — der
        // Greifpunkt muss also wirklich auf der 3D-Leinwand liegen.
        if (document.elementFromPoint(x, y) !== renderer.domElement) continue;
        rc.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1,
                                           -((y - r.top) / r.height) * 2 + 1), camera);
        const h = rc.intersectObjects(objects, true).find(t => t.face && !t.object.userData.isEdgeLines);
        if (!h) continue;
        let o = h.object; while (o && !objects.includes(o)) o = o.parent;
        if (o === m) return { x: Math.round(x), y: Math.round(y) };
        if (rad === 0) break;
      }
    }
    return null;
  };
}, SVG);

// ── 1) Leicht unrunder Querschnitt wird überhaupt als Rundung angeboten ─────
// Genau Josys Bbox: 46 × 47,5 × 56,6 mm. Vorher: gar keine Erkennung.
const erkannt = await pg.evaluate(() => {
  const R = {};
  for (const [name, sc] of [['rund', [2.3, 2.83, 2.3]], ['3% unrund', [2.3, 2.83, 2.37]],
                            ['Josys Bbox', [2.3, 2.375, 2.83]], ['8% unrund', [2.3, 2.83, 2.48]],
                            ['30% unrund (darf NICHT)', [2.3, 2.83, 3.0]]]) {
    const s = _eggBuild(sc, 0);
    const p = s.hit && _svgWrapProbe(s.k, s.hit.clone());
    R[name] = p ? { R_mm: +(p.R * 10).toFixed(2), bbox: s.bbox } : null;
  }
  return R;
});
ok('runder Körper wird erkannt', !!erkannt['rund'], erkannt['rund']);
ok('3 % unrund wird erkannt (war der Blocker)', !!erkannt['3% unrund'], erkannt['3% unrund']);
ok('Josys Maße 46×47,5×56,6 werden erkannt', !!erkannt['Josys Bbox'], erkannt['Josys Bbox']);
ok('8 % unrund wird noch erkannt', !!erkannt['8% unrund'], erkannt['8% unrund']);
ok('30 % unrund wird zu Recht abgelehnt', erkannt['30% unrund (darf NICHT)'] === null, erkannt['30% unrund (darf NICHT)']);

// ── 1b) Zu ovaler Körper: sagt es, statt kommentarlos nur aufzuheften ──────
const hinweis = await pg.evaluate(() => {
  const R = {};
  for (const [name, sc] of [['rund', [2.3, 2.83, 2.3]], ['30% oval', [2.3, 2.83, 3.0]]]) {
    const s = _eggBuild(sc, 0);
    _svgWrapProbe(s.k, s.hit.clone());
    R[name] = _svgWrapReason;
  }
  return R;
});
ok('runder Körper: kein Fehlgrund gemerkt', hinweis['rund'] === null, hinweis);
ok('zu ovaler Körper wird als „oval" begründet', hinweis['30% oval'] === 'oval', hinweis);

// ── 2) Radius wird am echten Körper gemessen, nicht aus der Skalierung ──────
// Bei 6 % unrund lag der gemittelte Skalierungsfaktor ~0,7 mm daneben.
const radius = await pg.evaluate(() => {
  const s = _eggBuild([2.3, 2.83, 2.44], 0);            // 6 % unrund, Treffer auf der X-Seite
  const p = _svgWrapProbe(s.k, s.hit.clone());
  return { gemessen: +(p.R * 10).toFixed(2), echt: +(s.hit.x * 10).toFixed(2) };
});
ok('Radius stimmt mit dem echten Trefferpunkt überein',
   Math.abs(radius.gemessen - radius.echt) < 0.15, radius);

// ── 3) Motiv liegt an — und bleibt es beim Verschieben in der Höhe ──────────
for (const [name, sc, kipp] of [['Kugel Ø46', [2.3, 2.3, 2.3], 0],
                                ['Ei 46×57', [2.3, 2.83, 2.3], 0],
                                ['Ei 20° gekippt', [2.3, 2.83, 2.3], 20]]) {
  const r = await pg.evaluate(({ sc, kipp }) => {
    const s = _eggBuild(sc, kipp);
    const p = _svgWrapProbe(s.k, s.hit.clone());
    if (!p) return { fehler: 'keine Rundung' };
    _svgWrapApply(s.m, p, s.hit.clone());
    s.m.updateMatrixWorld(true); _svgWrapTarget(s.m); selectObjs([s.m]);
    const o = { direkt: _eggSpalt(s.m, s.k), R0: +(p.R * 10).toFixed(2) };
    // In 6-mm-Schritten die Wand hinauf — wie mit den Pfeiltasten / dem Pfeil-Gizmo
    const ax = p.axisDir.clone();
    for (let i = 1; i <= 3; i++) {
      s.m.position.addScaledVector(ax, 0.6);
      s.m.updateMatrixWorld(true);
      _svgWrapFollowWall(s.m);
      o['nach_' + (i * 6) + 'mm'] = _eggSpalt(s.m, s.k);
      o['R_' + (i * 6)] = +(s.m.userData._svgWrap.R * 10).toFixed(2);
    }
    return o;
  }, { sc, kipp });
  const stufen = ['direkt', 'nach_6mm', 'nach_12mm', 'nach_18mm'].map(k => r[k]).filter(Boolean);
  // „ab" = größter Überstand über die Wand. Liegt das Motiv an, ist das der
  // eingeplante Hauch von 0,2 mm; schwebt es, wird daraus der ganze Spalt.
  const schlimmster = stufen.length ? Math.max(...stufen.map(v => v.ab)) : 99;
  ok(name + ': liegt auf jeder Höhe an (Überstand ≤ 0,6 mm)', schlimmster <= 0.6,
     { ueberstand: stufen.map(v => v.ab), eintauchen: stufen.map(v => v.ein), R: [r.R0, r.R_6, r.R_12, r.R_18] });
  ok(name + ': Radius folgt der Wand', r.R_18 != null && Math.abs(r.R_18 - r.R0) > 0.3 || sc[0] === sc[1],
     { von: r.R0, bis: r.R_18 });
}

// ── 4) Gerades Rohr: Radius bleibt, kein unnötiger Neuaufbau ────────────────
const rohr = await pg.evaluate(() => {
  if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
  const m = _importSvgConfirm({ svgText: _eggSvg, mode: 'extrude', depthMM: 3, targetMM: 22, name: 'Motiv' });
  addShape('tube');
  const k = objects.find(o => o !== m && o.userData.shapeType !== 'svg');
  k.scale.set(2.3, 2.83, 2.3); k.position.set(0, 0, 0); k.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(80, 0, 0), new THREE.Vector3(-1, 0, 0));
  const h = rc.intersectObject(k, true).find(x => x.face);
  const p = _svgWrapProbe(k, h.point.clone());
  _svgWrapApply(m, p, h.point.clone()); m.updateMatrixWorld(true); _svgWrapTarget(m);
  m.position.y += 1.0; m.updateMatrixWorld(true);
  const neuGebaut = _svgWrapFollowWall(m);
  // Rohr: Wand ist ein echter Zylinder mit festem Radius → direkt nachrechnen
  const inv = new THREE.Matrix4().copy(k.matrixWorld).invert();
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  let ab = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
    ab = Math.max(ab, (Math.hypot(v.x, v.z) - 1) * Math.abs(k.scale.x) * 10);
  }
  return { neuGebaut, R0: +(p.R * 10).toFixed(2), R1: +(m.userData._svgWrap.R * 10).toFixed(2),
           spalt: { ab: +ab.toFixed(2) } };
});
ok('gerades Rohr: kein unnötiger Neuaufbau', rohr.neuGebaut === false, rohr);
ok('gerades Rohr: liegt weiter an', rohr.spalt && rohr.spalt.ab <= 0.6, rohr.spalt);

// ── 5) Ganzer Weg mit der Maus: aufsetzen, wickeln, hochziehen ──────────────
const zug = await pg.evaluate(() => {
  const s = _eggBuild([2.3, 2.83, 2.3], 0);
  const p = _svgWrapProbe(s.k, s.hit.clone());
  _svgWrapApply(s.m, p, s.hit.clone()); s.m.updateMatrixWorld(true); _svgWrapTarget(s.m);
  // Auswahl aufheben: die weißen Größe-Anfasser sind DOM-Elemente und liegen
  // sonst über dem Motiv — der Zug änderte dann die Größe statt zu gleiten.
  // Der Klick wählt das Motiv ohnehin aus und startet das Gleiten im selben Zug.
  selectObjs([]);
  orbitTarget.set(0, 0, 0); sph.theta = 0.0; sph.phi = 1.35; sph.r = 30; sph2cam(); camera.updateMatrixWorld(true);
  const sc = _eggMotivPunkt(s.m);
  return sc ? { x: sc.x, y: sc.y, R0: +(p.R * 10).toFixed(2) } : { fehler: 'Motiv nicht sichtbar' };
});
ok('Motiv ist auf dem Schirm greifbar', !zug.fehler, zug);
await pg.mouse.move(zug.x, zug.y);
await pg.mouse.down();
const glide = await pg.evaluate(() => ({ an: typeof _svgGlide !== 'undefined' && !!_svgGlide,
                                        art: typeof _svgGlide !== 'undefined' && _svgGlide && _svgGlide.kind }));
ok('Mausziehen: Gleiten auf der Rundung springt an', glide.an && glide.art === 'wrap', glide);
for (let i = 1; i <= 6; i++) { await pg.mouse.move(zug.x, zug.y - i * 6); await pg.waitForTimeout(20); }
await pg.mouse.up();
await pg.waitForTimeout(400);
const nachZug = await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const k = objects.find(o => o.userData.name === 'Ei');
  return { bewegt: +(m.position.y * 10).toFixed(1),
           seitlich: [+(m.position.x * 10).toFixed(1), +(m.position.z * 10).toFixed(1)],
           R: +(m.userData._svgWrap.R * 10).toFixed(2),
           spalt: _eggSpalt(m, k), nochGewickelt: !!m.userData._svgWrap };
});
ok('Mausziehen: Motiv ist hochgewandert', Math.abs(nachZug.bewegt) > 2, nachZug.bewegt);
// Beim Gleiten läuft das Motiv AUF der Wand — sein Ursprung bleibt auf der Achse.
// Bei einem freien Zug flöge es seitlich weg.
ok('Mausziehen: Ursprung bleibt auf der Achse (kein freier Zug)',
   Math.abs(nachZug.seitlich[0]) < 1 && Math.abs(nachZug.seitlich[1]) < 1, nachZug.seitlich);
ok('Mausziehen: bleibt gewickelt', nachZug.nochGewickelt);
ok('Mausziehen: liegt danach an (Überstand ≤ 0,6 mm)',
   nachZug.spalt && nachZug.spalt.ab <= 0.6, nachZug);

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Ei-/Rundungs-Tests bestanden.');
process.exit(fails.length ? 1 : 0);
