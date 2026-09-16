// Josy 16.9.26: Motive auf Scheitel und Schulter ihrer Lampe "nicht ganz drauf". Dort
// ist die Wand um KEINE Achse rund; bisher gab es nur flaches Aufheften (liegt auf
// einer Woelbung nur in der Mitte auf). Seit v1.18.24: ANSCHMIEGEN — Hoehenfeld der
// Wand ueber der Tangentialebene, Bogenlaengen je Zeile/Spalte, Tiefe entlang der
// lokalen Normale. Prueft: Erkennung, Anliegen (Aussen +0,2 / Innen -3 mm), Speichern/
// Laden-Nachbau, Drehung ueber den Ring, Gravur-Abzug (Manifold) mit 1,2 mm Tiefe.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
// "T" mit breiten Balken: der Strahl fuer die Tiefenmessung trifft sicher Material
// zwei GETRENNTE Konturen (ueberlappende Rechtecke ergaeben Mehrfachkanten im Extrusionsnetz)
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="44" y="21" width="12" height="74"/><rect x="15" y="5" width="70" height="13"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

await pg.evaluate(() => {
  // Lichthuelle mit runder Schulter, oben offen (wie svg_wrap_hint_test)
  window._huelle = () => {
    const H = 110, R0 = 55, SEG = 96, pts = [];
    for (let z = 0; z <= H; z += 2.5) pts.push(new THREE.Vector2(R0 - 6 * Math.pow(z / H, 2), z));
    for (let a = 0; a <= 90; a += 6) { const r = 25, cx = R0 - 6 - r; pts.push(new THREE.Vector2(cx + r * Math.cos(a * Math.PI / 180), H + r * Math.sin(a * Math.PI / 180))); }
    for (let i = pts.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(Math.max(0.5, pts[i].x - 2), pts[i].y));
    pts.push(pts[0].clone());
    const geo = new THREE.LatheGeometry(pts, SEG).toNonIndexed(); geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x66cccc, side: THREE.DoubleSide }));
    m.scale.set(0.1, 0.1, 0.1); m.rotation.x = -Math.PI / 2;
    m.userData = { id: idCtr++, name: 'Lichthülle', type: 'import', shapeType: 'import', _origGeo: geo };
    scene.add(m); objects.push(m); m.updateMatrixWorld(true);
    return m;
  };
  window._setzeAn = (m, k, hRel) => {
    const bb = new THREE.Box3().setFromObject(k); const C = bb.getCenter(new THREE.Vector3());
    const y = bb.min.y + (bb.max.y - bb.min.y) * hRel;
    orbitTarget.copy(C); sph.theta = Math.PI / 2; sph.phi = 1.2; sph.r = 45; sph2cam(); camera.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(); rc.set(new THREE.Vector3(C.x + 200, y, C.z), new THREE.Vector3(-1, 0, 0));
    const h0 = rc.intersectObject(k, true).find(x => x.face); if (!h0) return null;
    const p = h0.point.clone().project(camera); const r = renderer.domElement.getBoundingClientRect();
    _svgSnapDetect(m, { clientX: r.left + (p.x * 0.5 + 0.5) * r.width, clientY: r.top + (-p.y * 0.5 + 0.5) * r.height });
    const hint = document.getElementById('text-snap-hint').textContent, art = _textSnapTarget && _textSnapTarget.type;
    _applySvgSnap(m, _textSnapTarget); m.updateMatrixWorld(true);
    return { hint, art, wand: h0.point.clone() };
  };
  // Aussen-/Innenflaeche ueber Vertexnormalen messen (Windung des Extrusionsnetzes ist egal)
  window._messe = (m, k) => {
    const w = m.userData._svgSchmieg; if (!w) return null;
    const ecW = new THREE.Vector3().fromArray(w.ec);
    const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld), v = new THREE.Vector3(), nn = new THREE.Vector3(), rc = new THREE.Raycaster();
    const plus = [], minus = []; let ohne = 0;
    const schritt = Math.max(1, Math.floor(pos.count / 2500));
    for (let i = 0; i < pos.count; i += schritt) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); nn.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      const s = nn.dot(ecW); if (Math.abs(s) < 0.7) continue;
      const dirOut = s > 0 ? nn.clone() : nn.clone().negate();
      rc.set(v.clone().addScaledVector(dirOut, 5), dirOut.clone().negate());
      const hh = rc.intersectObject(k, true).find(x => x.face);
      if (!hh) { ohne++; continue; }
      const d = (hh.distance - 5) * 10; if (d > 20) { ohne++; continue; }
      (s > 0 ? plus : minus).push(d);
    }
    const st = arr => { if (!arr.length) return null; const so = arr.slice().sort((a, b) => a - b); return { n: arr.length, median: +so[so.length >> 1].toFixed(2), min: +so[0].toFixed(2), max: +so[so.length - 1].toFixed(2), unter0: +(arr.filter(x => x < -0.05).length / arr.length).toFixed(3) }; };
    const sp = st(plus), sm = st(minus);
    const aussen = (sp && sm) ? (Math.abs(sp.median - 0.2) < Math.abs(sm.median - 0.2) ? sp : sm) : (sp || sm);
    return { aussen, innen: aussen === sp ? sm : sp, ueberOeffnung: ohne };
  };
});

// ── 1) Schulter + Scheitel: Erkennung, Anliegen, Speichern/Laden ─────────────
for (const [hRel, name] of [[0.93, 'Schulter'], [0.97, 'Scheitel']]) {
  const r = await pg.evaluate(([svg, hRel]) => {
    objects.slice().forEach(o => { scene.remove(o); objects.splice(objects.indexOf(o), 1); });
    const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'T' }); m.userData.isHole = true;
    const k = _huelle();
    const a = _setzeAn(m, k, hRel); if (!a) return { fehler: 'kein Wandpunkt' };
    const mess = _messe(m, k);
    const w = m.userData._svgSchmieg;
    let roundtrip = null;
    if (w) { const g2 = _svgSchmiegBuildGeo(m.userData, JSON.parse(JSON.stringify(w))); const p1 = m.geometry.attributes.position.array, p2 = g2.attributes.position.array; let md = -1; if (p1.length === p2.length) { md = 0; for (let i = 0; i < p1.length; i++) md = Math.max(md, Math.abs(p1[i] - p2[i])); } roundtrip = { gleich: p1.length === p2.length, maxAbwMM: +(md * 10).toFixed(4) }; g2.dispose(); }
    // Drehung ueber Ring/Winkelfeld: Quaternion um die Wandnormale kippen, dann Nachfuehren
    let dreh = null;
    if (w) {
      const ec = new THREE.Vector3().fromArray(w.ec);
      m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(ec, Math.PI / 6)); m.updateMatrixWorld(true);
      const res = _svgSchmiegAbsorbTwist(m); m.updateMatrixWorld(true);
      dreh = { res, rotGrad: +((m.userData._svgSchmieg.rotRad || 0) * 180 / Math.PI).toFixed(1), mess: _messe(m, k) };
    }
    return { hint: a.hint, art: a.art, mess, roundtrip, dreh, scale: m.scale.toArray(), P0: w && w.P0.map(v => +v.toFixed(2)) };
  }, [SVG, hRel]);
  console.log(JSON.stringify(Object.assign({ P0: r.P0 }, r)));
  ok(`${name}: bietet Anschmiegen an`, r.art === 'schmieg' && /anschmiegen/.test(r.hint), { hint: r.hint, art: r.art });
  ok(`${name}: Aussenflaeche liegt mit 0,2 mm auf (Median), nichts steht ab`, r.mess && Math.abs(r.mess.aussen.median - 0.2) < 0.1 && r.mess.aussen.max < 0.6 && r.mess.aussen.unter0 < 0.03, r.mess && r.mess.aussen);
  ok(`${name}: Innenflaeche liegt 3 mm tief`, r.mess && Math.abs(r.mess.innen.median + 3) < 0.3, r.mess && r.mess.innen);
  ok(`${name}: Speichern/Laden baut dieselbe Geometrie`, r.roundtrip && r.roundtrip.gleich && r.roundtrip.maxAbwMM < 0.001, r.roundtrip);
  ok(`${name}: Drehung um 30° wandert ins Anschmiegen, Motiv bleibt dran`, r.dreh && r.dreh.res && Math.abs(r.dreh.rotGrad - 30) < 0.5 && r.dreh.mess.aussen.max < 0.6 && r.dreh.mess.aussen.unter0 < 0.03, r.dreh);
}

// ── 2) Gravur-Abzug auf der Schulter: 1,2 mm tief (Manifold) ─────────────────
// Messung mit MEHREREN Treffern je Strahl: [Aussenwand, Innenwand, …]. Der
// synthetische Koerper ist an der Schulter stellenweise duenner als 1,2 mm — dort
// ist ein Durchbruch die richtige Antwort, sonst die Tiefe.
const prep = await pg.evaluate((svg) => {
  objects.slice().forEach(o => { scene.remove(o); objects.splice(objects.indexOf(o), 1); });
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'T' }); m.userData.isHole = true;
  const k = _huelle();
  const a = _setzeAn(m, k, 0.93);
  const w = m.userData._svgSchmieg; if (!w) return { fehler: 'nicht angeschmiegt' };
  const ea = new THREE.Vector3().fromArray(w.ea), eb = new THREE.Vector3().fromArray(w.eb), ec = new THREE.Vector3().fromArray(w.ec), P0 = new THREE.Vector3().fromArray(w.P0);
  const rc = new THREE.Raycaster();
  window._messe = (obj, aMM, bMM) => { const p2 = P0.clone().addScaledVector(ea, aMM / 10).addScaledVector(eb, bMM / 10); rc.set(p2.clone().addScaledVector(ec, 8), ec.clone().negate()); return rc.intersectObject(obj, true).filter(x => x.face).slice(0, 2).map(h => +((8 - h.distance) * 10).toFixed(2)); };
  window._punkte = { balken: [0, 11], stamm: [0, -5], daneben: [-9, -8], weit: [-16, -16] };
  const vorher = {}; for (const [n2, [x, y]] of Object.entries(window._punkte)) vorher[n2] = _messe(k, x, y);
  window._engraveDepthDialog = () => Promise.resolve({ depth: 1.2, wantInlay: false, through: false });
  selectObjs([k, m]);
  subtractHoles();
  return { art: a.art, vorher, n0: objects.length };
}, SVG);
console.log('prep', JSON.stringify(prep));
await pg.waitForFunction(() => objects.length === 1 && !objects[0].userData.isHole, { timeout: 180000 }).catch(() => {});
const cut = await pg.evaluate(() => {
  if (objects.length !== 1) return { n: objects.length };
  const o = objects[0]; o.updateMatrixWorld(true);
  const nachher = {}; for (const [n2, [x, y]] of Object.entries(window._punkte)) nachher[n2] = _messe(o, x, y);
  return { n: 1, nachher };
});
console.log('cut', JSON.stringify(cut));
ok('Abzug lieferte genau einen Koerper', cut.n === 1, cut);
const tiefe = (name) => { const v = prep.vorher[name], nn = cut.nachher[name]; if (!v || !nn || v.length < 1 || nn.length < 1) return null; return +(v[0] - nn[0]).toFixed(2); };
const wand = (name) => { const v = prep.vorher[name]; return v && v.length >= 2 ? +(v[0] - v[1]).toFixed(2) : null; };
for (const name of ['stamm', 'balken']) {
  const w = wand(name), t = tiefe(name);
  if (w != null && w > 1.6) ok(`Gravur im ${name} 1,2 mm tief (Wand ${w} mm)`, t != null && Math.abs(t - 1.2) < 0.3, { wand: w, tiefe: t, vorher: prep.vorher[name], nachher: cut.nachher[name] });
  else ok(`${name}: Wand nur ${w} mm → Durchbruch`, t != null && t > 5, { wand: w, tiefe: t, vorher: prep.vorher[name], nachher: cut.nachher[name] });
}
for (const name of ['daneben', 'weit'])
  ok(`${name}: Wand unberuehrt`, cut.n === 1 && prep.vorher[name] && cut.nachher[name] && Math.abs(prep.vorher[name][0] - cut.nachher[name][0]) < 0.05, { vorher: prep.vorher[name], nachher: cut.nachher[name] });
console.log('errs', errs);
ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
