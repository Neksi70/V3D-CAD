// Übung A – „Kursweg“: nur Bedienwege, die Teilnehmer wirklich nehmen (Maße in mm, Ausrichten-Knöpfe,
// Bohrungs-Modus, Arbeitsebene mit Versatz). Keine Positionsfelder (die rechnen in cm und meinen die Mitte).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'child_process';

const URL = process.env.V3D_URL || 'http://localhost:8765/volme3d.html';
const cookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('uebung-a','test@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/' }]);
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);
const warteAufEins = async () => { for (let i = 0; i < 60; i++) { await pg.waitForTimeout(3000); if (await pg.evaluate(() => objects.length === 1 && !objects[0].userData.isHole)) return true; } return false; };

try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => {
    hideStarter(); _newCreate(false);
    window._k = {
      box(w, d, h) { addShape('box'); const o = objects[objects.length - 1]; selectObjs([o]); numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); return o; },
      bb(o) { o.updateMatrixWorld(true); const g = o.geometry; g.computeBoundingBox(); const x = g.boundingBox.clone().applyMatrix4(o.matrixWorld); return [x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z].map(v => +(v * 10).toFixed(2)); },
    };
  });

  // Schritt 1: Box 80×60×35 · „○ Bohrung“ · Box 74×54×33 · beide wählen → Ausrichten: Breite mittig, Tiefe mittig, Oben → abziehen
  const s1 = await pg.evaluate(() => {
    setShapeMode('solid'); const A = _k.box(80, 60, 35);
    setShapeMode('hole'); const B = _k.box(74, 54, 33);
    const vorAusrichten = { A: _k.bb(A), B: _k.bb(B) };
    selectObjs([A, B]); alignObjects('xcenter'); alignObjects('zcenter'); alignObjects('ymax');
    return { vorAusrichten, A: _k.bb(A), B: _k.bb(B), hole: !!B.userData.isHole };
  });
  log('S1 vor Ausrichten:', JSON.stringify(s1.vorAusrichten), '\nS1 nach Ausrichten: A', JSON.stringify(s1.A), 'B', JSON.stringify(s1.B));
  await pg.evaluate(() => { selectObjs(objects.slice()); subtractHoles(); });
  log('S1 abgezogen:', await warteAufEins(), JSON.stringify(await pg.evaluate(() => _k.bb(objects[0]))));

  // Schritt 2: Arbeitsebene auf die Oberseite der Box, Versatz −5,4 mm (= 2 mm + 3,4 mm Nut) → Bohrung 78×56×3,4
  //            → mit der Box: Breite mittig + Vorne → abziehen
  const s2 = await pg.evaluate(() => {
    const A = objects[0], bb = _k.bb(A);
    // wie ein Klick auf die Oberseite (Mitte): Basis der Konstruktionsebene setzen
    _wpBaseN = new THREE.Vector3(0, 1, 0); _wpBaseP = new THREE.Vector3((bb[0] + bb[3]) / 20, bb[4] / 10, (bb[2] + bb[5]) / 20);
    document.getElementById('wp-off').value = -5.4; _wpAdjust();
    setShapeMode('hole'); const C = _k.box(78, 56, 3.4);
    const nachAnlegen = _k.bb(C);
    selectObjs([A, C]); alignObjects('xcenter'); alignObjects('zmin');
    resetWorkplane(); setShapeMode('solid');
    return { nachAnlegen, A: _k.bb(A), C: _k.bb(C) };
  });
  log('S2 Nut nach Anlegen:', JSON.stringify(s2.nachAnlegen), '| nach Ausrichten: A', JSON.stringify(s2.A), 'C', JSON.stringify(s2.C));
  await pg.evaluate(() => { selectObjs(objects.slice()); subtractHoles(); });
  log('S2 abgezogen:', await warteAufEins());

  // Schritt 3: Stirnwand oberhalb der Nut: Arbeitsebene Oberseite, Versatz −2 mm → Bohrung 78×5×4 → Breite mittig + Vorne
  const s3 = await pg.evaluate(() => {
    const A = objects[0], bb = _k.bb(A);
    _wpBaseN = new THREE.Vector3(0, 1, 0); _wpBaseP = new THREE.Vector3((bb[0] + bb[3]) / 20, bb[4] / 10, (bb[2] + bb[5]) / 20);
    document.getElementById('wp-off').value = -2; _wpAdjust();
    setShapeMode('hole'); const D = _k.box(78, 5, 4);
    selectObjs([A, D]); alignObjects('xcenter'); alignObjects('zmin');
    resetWorkplane(); setShapeMode('solid');
    return { D: _k.bb(D) };
  });
  log('S3 Ausschnitt:', JSON.stringify(s3.D));
  await pg.evaluate(() => { selectObjs(objects.slice()); subtractHoles(); });
  log('S3 abgezogen:', await warteAufEins());

  const ende = await pg.evaluate(() => { const o = objects[0]; o.updateMatrixWorld(true); const p = o.geometry.attributes.position, v = new THREE.Vector3(); const ys = new Set(), zs = new Set(), xs = new Set();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); ys.add(+(v.y * 10).toFixed(2)); zs.add(+(v.z * 10).toFixed(2)); xs.add(+(v.x * 10).toFixed(2)); }
    const so = s => [...s].sort((a, b) => a - b); return { bb: _k.bb(o), x: so(xs), y: so(ys), z: so(zs) }; });
  log('Fertige Box – Ebenen (mm):', JSON.stringify(ende));
  log('Seitenfehler:', errs);
} finally { await b.close(); }
