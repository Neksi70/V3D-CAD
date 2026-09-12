// Test: Biege-Werkzeug (_bnd*) — beliebige Körper auf einen Radius.
// Ralf 1.9./12.9.2026: „Druck auf Tassenradius biegen" bzw. „mit einer SVG
// funktioniert es, wie ist es mit anderen Körpern?".
// Geprüft wird das, woran so ein Werkzeug scheitert:
//   (1) Die Rundung stimmt wirklich (Radius nachgemessen, nicht nur „sieht
//       gebogen aus") und die Bogenlänge bleibt die Länge des Teils,
//   (2) das Netz bleibt DICHT — die Unterteilung darf keine T-Stöße reißen,
//   (3) „An Körper anlegen" misst den Radius am Ziel und legt das Teil so an,
//       dass die Innenseite überall aufliegt — an Rundung UND an Kugel,
//   (4) Abbrechen stellt den Ausgangszustand wieder her,
//   (5) Übernehmen macht daraus ein freies Netz (sonst baut die nächste
//       Maßänderung die Urform neu auf und die Biegung ist weg).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {   // Sitzungs-Cookie, damit der Test auch gegen die Auslieferung (8765) läuft
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('bend-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

// Hilfsmittel in der Seite
await pg.evaluate(() => {
  window._bt = {
    // Kantenbilanz: jede gerichtete Kante braucht genau einen Partner
    dicht(pos) {
      const n = pos.length / 9, q = 1e4, vid = new Map(), ids = new Int32Array(n * 3);
      for (let i = 0; i < n * 3; i++) {
        const k = Math.round(pos[i*3]*q)+'|'+Math.round(pos[i*3+1]*q)+'|'+Math.round(pos[i*3+2]*q);
        let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); } ids[i] = id; }
      const seen = new Set(); let dup = 0;
      for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
        const k = ids[t*3+e] + '>' + ids[t*3+(e+1)%3]; if (seen.has(k)) dup++; else seen.add(k); }
      let open = 0; for (const k of seen) { const s = k.split('>'); if (!seen.has(s[1]+'>'+s[0])) open++; }
      return { tris: n, dup, open };
    },
    // Klick auf einen Weltpunkt nachstellen (Bildschirmkoordinaten ausrechnen)
    klickAuf(p3) {
      // WICHTIG: project() rechnet mit camera.matrixWorldInverse, und die
      // aktualisiert nur der Renderer. Ohne dieses Bild zeigt der berechnete
      // Klick woanders hin als die Kamera steht (der Strahl ging über das Teil
      // hinweg) — ein reiner Test-Stolperstein, in der App rendert jeder Frame.
      renderer.render(scene, camera);
      camera.updateMatrixWorld(true);
      const v = p3.clone().project(camera);
      const r = vpEl.getBoundingClientRect();   // getNorm() rechnet gegen vpEl
      return { clientX: r.left + (v.x + 1) / 2 * r.width,
               clientY: r.top  + (-v.y + 1) / 2 * r.height,
               shiftKey: false, button: 0 };
    },
    platte(l, dicke, breite) {
      [...objects].forEach(o => scene.remove(o)); objects.length = 0; selectObjs([]);
      addShape('box'); const o = objects[0];
      o.scale.set(l/20, dicke/20, breite/20);
      o.position.set(0, dicke/20, 0); o.updateMatrixWorld(true);
      selectObjs([o]); return o;
    }
  };
});

// ── 1+2) Radius stimmt, Bogenlänge bleibt, Netz bleibt dicht ──────────────
const rund = await pg.evaluate(() => {
  const o = _bt.platte(100, 3, 30);
  _bndOpen(); _bndSetR(30);
  const p = o.geometry.attributes.position.array;
  // Gebogen wird um die lokale Z? — die Achsen stehen im Dbg; hier reicht die
  // Hülle: Breite = 2·(R+d/2) sobald der Bogen über 180° geht, Höhe = R+d/2
  // plus der Rückschwung. Statt Formeln: Radien der Punkte um den ERMITTELTEN
  // Mittelpunkt messen (Kleinste-Quadrate-Kreis in der Biegeebene).
  const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    if (p[i+k] < mn[k]) mn[k] = p[i+k]; if (p[i+k] > mx[k]) mx[k] = p[i+k]; }
  const d = _bndDbg();
  return { dbg: d, dicht: _bt.dicht(p),
           bbox: [0,1,2].map(k => Math.round((mx[k]-mn[k]) * 100) / 10) };
});
// 100 mm auf R=30 (Mittelfläche): Bogen 191°, also mehr als ein Halbkreis →
// Breite = 2·(30+1,5) = 63 mm, Höhe = 31,5 + 31,5·|cos(95,5°)| = 34,5 mm
ok('Rundung: Hülle passt zur Rechnung (63 × 34,5 mm)',
   Math.abs(rund.bbox[0] - 63) < 0.6 && Math.abs(rund.bbox[1] - 34.5) < 0.6, rund.bbox);
ok('Rundung: Netz bleibt dicht (keine T-Stöße)',
   rund.dicht.dup === 0 && rund.dicht.open === 0, rund.dicht);
ok('Rundung: Netz wird nur so fein wie nötig unterteilt',
   rund.dicht.tris > 500 && rund.dicht.tris < 40000, { tris: rund.dicht.tris });

// ── 3a) An eine Rundung anlegen ───────────────────────────────────────────
const anRohr = await pg.evaluate(() => {
  [...objects].forEach(o => scene.remove(o)); objects.length = 0; selectObjs([]);
  // Erst BEIDE Körper anlegen, dann setzen: addShape rückt vorhandene Teile
  // zur Seite, damit nichts übereinander liegt — sonst steht der Zylinder
  // hinterher woanders als gedacht und der Testklick geht ins Leere.
  addShape('cylinder'); addShape('box');
  const zyl = objects[0], pl = objects[1];
  zyl.scale.set(2, 3, 2); zyl.position.set(0, 3, 0); zyl.updateMatrixWorld(true);   // Ø40, h60
  pl.scale.set(2.5, 0.1, 0.75); pl.position.set(0, 8, 0); pl.updateMatrixWorld(true);  // 50 × 2 × 15
  const zbb = new THREE.Box3().setFromObject(zyl);
  const Rzyl = (zbb.max.x - zbb.min.x) / 2;
  selectObjs([pl]);
  _bndOpen();
  // Klick auf die Seitenwand — den Punkt nehmen, der der KAMERA zugewandt ist.
  // Genau am Rand (+X) streift der Strahl die Wand nur und trifft nichts.
  const kd = camera.position.clone().sub(new THREE.Vector3(0, 3, 0));
  kd.y = 0; kd.normalize();
  const ziel = new THREE.Vector3(kd.x * Rzyl, 3, kd.z * Rzyl);
  _bndZielStart();
  _bndZielKlick(_bt.klickAuf(ziel));
  pl.updateMatrixWorld(true);
  const dbg = _bndDbg();
  // Abstand aller Punkte zur Zylinderachse (x=0,z=0) messen
  const p = pl.geometry.attributes.position.array;
  const v = new THREE.Vector3(); let rMin = 1e9, rMax = -1e9;
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i+1], p[i+2]).applyMatrix4(pl.matrixWorld);
    const r = Math.hypot(v.x, v.z); if (r < rMin) rMin = r; if (r > rMax) rMax = r;
  }
  return { dbg, Rzyl: Math.round(Rzyl*100)/10, innen: Math.round(rMin*100)/10,
           aussen: Math.round(rMax*100)/10, dicht: _bt.dicht(p) };
});
ok('Anlegen an Rundung: Radius am Körper gemessen',
   anRohr.dbg.ziel && Math.abs(anRohr.dbg.ziel.R * 10 - anRohr.Rzyl) < 1.0, anRohr);
ok('Anlegen an Rundung: Innenseite liegt auf der Wand (< 0,6 mm Spalt)',
   Math.abs(anRohr.innen - anRohr.Rzyl) < 0.6, { innen: anRohr.innen, wand: anRohr.Rzyl });
ok('Anlegen an Rundung: Dicke bleibt erhalten (2 mm)',
   Math.abs((anRohr.aussen - anRohr.innen) - 2) < 0.35, { dicke: Math.round((anRohr.aussen-anRohr.innen)*10)/10 });
ok('Anlegen an Rundung: Netz bleibt dicht',
   anRohr.dicht.dup === 0 && anRohr.dicht.open === 0, anRohr.dicht);

// ── 3b) An eine Kugel anlegen (Kuppel) ────────────────────────────────────
const anKugel = await pg.evaluate(() => {
  [...objects].forEach(o => scene.remove(o)); objects.length = 0; selectObjs([]);
  addShape('sphere'); addShape('box');
  const ku = objects[0], pl = objects[1];
  ku.scale.set(2.5, 2.5, 2.5); ku.position.set(0, 5, 0); ku.updateMatrixWorld(true);  // Ø50
  pl.scale.set(1.2, 0.1, 1.2); pl.position.set(0, 12, 0); pl.updateMatrixWorld(true);   // 24 × 2 × 24
  const kbb = new THREE.Box3().setFromObject(ku);
  const C = kbb.getCenter(new THREE.Vector3());
  const Rk = (kbb.max.x - kbb.min.x) / 2;
  selectObjs([pl]);
  _bndOpen();
  _bndZielStart();
  const kdk = camera.position.clone().sub(C).normalize();               // der Kamera zugewandt
  _bndZielKlick(_bt.klickAuf(C.clone().addScaledVector(kdk, Rk)));
  pl.updateMatrixWorld(true);
  const dbg = _bndDbg();
  const p = pl.geometry.attributes.position.array;
  const v = new THREE.Vector3(); let rMin = 1e9, rMax = -1e9;
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i+1], p[i+2]).applyMatrix4(pl.matrixWorld);
    const r = v.distanceTo(C); if (r < rMin) rMin = r; if (r > rMax) rMax = r;
  }
  return { dbg, Rk: Math.round(Rk*100)/10, innen: Math.round(rMin*100)/10,
           aussen: Math.round(rMax*100)/10, dicht: _bt.dicht(p) };
});
ok('Anlegen an Kugel: schaltet auf Kuppel um', anKugel.dbg.modus === 'kugel', anKugel.dbg);
ok('Anlegen an Kugel: Innenseite liegt auf der Kugel (< 0,6 mm)',
   Math.abs(anKugel.innen - anKugel.Rk) < 0.6, { innen: anKugel.innen, kugel: anKugel.Rk });
ok('Anlegen an Kugel: Dicke bleibt erhalten (2 mm)',
   Math.abs((anKugel.aussen - anKugel.innen) - 2) < 0.35, { dicke: Math.round((anKugel.aussen-anKugel.innen)*10)/10 });
ok('Anlegen an Kugel: Netz bleibt dicht',
   anKugel.dicht.dup === 0 && anKugel.dicht.open === 0, anKugel.dicht);

// ── 4) Abbrechen stellt alles zurück ─────────────────────────────────────
const zurueck = await pg.evaluate(() => {
  const o = _bt.platte(80, 4, 20);
  const vorTris = o.geometry.attributes.position.count / 3;
  const vorScale = o.scale.toArray().map(v => Math.round(v*1e4)/1e4);
  const vorTyp = o.userData.shapeType;
  _bndOpen(); _bndSetR(20);
  const mittenTris = o.geometry.attributes.position.count / 3;
  _bndClose(true);
  return { vorTris, mittenTris, nachTris: o.geometry.attributes.position.count / 3,
           vorScale, nachScale: o.scale.toArray().map(v => Math.round(v*1e4)/1e4),
           vorTyp, nachTyp: o.userData.shapeType, dialog: _bndDbg().offen };
});
ok('Abbrechen: Netz, Skalierung und Typ sind wieder wie vorher',
   zurueck.nachTris === zurueck.vorTris && zurueck.mittenTris > zurueck.vorTris &&
   JSON.stringify(zurueck.nachScale) === JSON.stringify(zurueck.vorScale) &&
   zurueck.nachTyp === zurueck.vorTyp && !zurueck.dialog, zurueck);

// ── 5) Übernehmen macht ein freies Netz daraus ───────────────────────────
const uebernommen = await pg.evaluate(() => {
  const o = _bt.platte(60, 3, 20);
  o.userData.occtShape = { dummy: true };
  o.userData._occtParams = { sx: 1 };
  _bndOpen(); _bndSetR(25); _bndApply();
  return { typ: o.userData.shapeType, occt: !!o.userData.occtShape, par: !!o.userData._occtParams,
           bend: o.userData._bend, hatOrig: !!o.userData._origGeo,
           skal: o.scale.toArray().map(v => Math.round(v*1e4)/1e4), dialog: _bndDbg().offen };
});
ok('Übernehmen: Körper ist jetzt ein freies Netz (Urform baut sich nicht neu auf)',
   uebernommen.typ === 'import' && !uebernommen.occt && !uebernommen.par, uebernommen);
ok('Übernehmen: Biege-Einstellung und Textur-Netz sind hinterlegt',
   !!uebernommen.bend && uebernommen.bend.R === 25 && uebernommen.hatOrig, uebernommen.bend);
ok('Übernehmen: Skalierung ist eingebacken', 
   JSON.stringify(uebernommen.skal) === JSON.stringify([1,1,1]), uebernommen.skal);

// ── 6) Taugt das Ergebnis noch fuer Vereinen/Abziehen? ───────────────────
// Das ist der eigentliche Zweck: Motiv auf die Rundung legen und gravieren.
// Manifold nimmt nur wasserdichte, mannigfaltige Netze an — was hier durchgeht,
// geht auch durch „Abziehen".
const boolTauglich = await pg.evaluate(async () => {
  const o = _bt.platte(60, 3, 20);
  _bndOpen(); _bndSetR(22); _bndApply();
  const W = await _mfInit();
  const p = o.geometry.attributes.position.array;
  try {
    const m = _mfFromSoup(W, p instanceof Float32Array ? p : new Float32Array(p));
    const v = m.volume(); const teile = m.decompose().length;   // Einheiten: 1 = 10 mm
    m.delete();
    return { ok: true, vol: Math.round(v * 100) / 100, teile };
  } catch (e) { return { ok: false, fehler: String(e.message || e) }; }
});
ok('Ergebnis ist boolean-tauglich (Vereinen/Abziehen)',
   boolTauglich.ok && boolTauglich.teile === 1 && boolTauglich.vol > 2, boolTauglich);

await b.close();
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
console.log(fails.length ? ('\nFEHLGESCHLAGEN: ' + fails.join(', ')) : '\nAlle Biege-Prüfungen bestanden.');
process.exit(fails.length ? 1 : 0);
