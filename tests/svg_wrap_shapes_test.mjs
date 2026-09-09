// Josys zwei Fälle:
//   A) eigene STL — Drehachse geht NICHT durch den lokalen Ursprung
//      (Import behält die Koordinaten aus der Datei) → wurde nicht erkannt
//   B) konische Form (Becher) — Radius ändert sich über die Höhe, das Motiv
//      lag „nur halb drauf"
//
// Start: npm run dev  (Port 8766)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,5 H95 V95 H5 Z"/></svg>`;

// ── A) STL-artiger Import: Achse weit weg vom lokalen Ursprung ───────────
const stl = await pg.evaluate((svg) => {
  // So kommt eine STL an: Geometrie in mm mit den Koordinaten aus der Datei,
  // Mesh-Scale 0.1, Ursprung irgendwo — hier Achse bei x=120 mm, z=-80 mm.
  const g = new THREE.CylinderGeometry(30, 30, 100, 48, 1, true);
  g.translate(120, 0, -80);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x88a }));
  m.scale.set(0.1, 0.1, 0.1);
  m.userData = { id: idCtr++, name: 'Import', type: 'import', shapeType: 'import', color: '#8888aa' };
  scene.add(m); objects.push(m); m.updateMatrixWorld(true);

  const svgM = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 5, targetMM: 30, name: 'Motiv' });
  svgM.userData.isHole = true;
  m.updateMatrixWorld(true);
  const achseWelt = m.localToWorld(new THREE.Vector3(120, 0, -80));
  const hit = achseWelt.clone().add(new THREE.Vector3(3, 0, 0));   // 30 mm = 3 units radial
  const p = _svgWrapProbe(m, hit);
  if (!p) return { gefunden: false };
  _svgWrapApply(svgM, p, hit);
  _svgWrapReshape(svgM, 1.2);
  svgM.updateMatrixWorld(true);
  const pos = svgM.geometry.attributes.position, v = new THREE.Vector3();
  let rMin = Infinity, rMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(svgM.matrixWorld).sub(achseWelt);
    const r = Math.hypot(v.x, v.z);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
  }
  return { gefunden: true, R: p.R * 10, achsFehler: p.axisPt.distanceTo(achseWelt) * 10,
           rMinMM: rMin * 10, rMaxMM: rMax * 10 };
}, SVG);
ok('A) Rundung bei versetzter Achse erkannt', stl.gefunden, stl);
ok('A) Achse korrekt gefunden (nicht der lokale Ursprung)',
   stl.gefunden && stl.achsFehler < 0.05, { fehlerMM: stl.achsFehler?.toFixed(4) });
ok('A) Radius = 30 mm', stl.gefunden && Math.abs(stl.R - 30) < 0.1, { R: stl.R?.toFixed(3) });
ok('A) Gravurtiefe 1,2 mm sitzt an der Wand',
   stl.gefunden && Math.abs(stl.rMinMM - 28.8) < 0.1 && Math.abs(stl.rMaxMM - 30.2) < 0.1,
   { rMin: stl.rMinMM?.toFixed(3), rMax: stl.rMaxMM?.toFixed(3) });

// ── B) Konische Wand: Motiv muss der Verjüngung folgen ───────────────────
const kegel = await pg.evaluate((svg) => {
  // Becher: unten Ø40, oben Ø70, 80 mm hoch (offener Mantel reicht zum Prüfen)
  const rB = 20, rT = 35, H = 80;
  const g = new THREE.CylinderGeometry(rT, rB, H, 64, 1, true);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8a8 }));
  m.scale.set(0.1, 0.1, 0.1);
  m.userData = { id: idCtr++, name: 'Becher', type: 'import', shapeType: 'import', color: '#88aa88' };
  scene.add(m); objects.push(m); m.updateMatrixWorld(true);

  const svgM = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 5, targetMM: 40, name: 'Motiv2' });
  svgM.userData.isHole = true;
  m.updateMatrixWorld(true);
  const mitte = m.localToWorld(new THREE.Vector3(0, 0, 0));
  const rMitteU = (rB + rT) / 2 / 10;
  const hit = mitte.clone().add(new THREE.Vector3(rMitteU, 0, 0));
  const p = _svgWrapProbe(m, hit);
  if (!p) return { gefunden: false };
  _svgWrapApply(svgM, p, hit);
  _svgWrapReshape(svgM, 1.2);
  svgM.updateMatrixWorld(true);

  // Wandradius an einer Höhe (unabhängig gerechnet, nicht aus dem Wrap-Code)
  const wandR = y => (rB + (rT - rB) * (y * 10 + H / 2) / H) / 10;     // y in units
  const k = (rT - rB) / H;                                              // dR/dh
  // Motivpunkte in Höhenbändern: senkrechten Abstand zur Wand messen
  const pos = svgM.geometry.attributes.position, v = new THREE.Vector3();
  const baender = {};
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(svgM.matrixWorld).sub(mitte);
    const y = v.y, r = Math.hypot(v.x, v.z);
    const key = Math.round(y * 10) / 10;                                // 1-mm-Bänder
    const tiefeSenkrecht = (wandR(y) - r) * 10 / Math.sqrt(1 + k * k);  // mm
    if (!baender[key]) baender[key] = { min: Infinity, max: -Infinity };
    baender[key].min = Math.min(baender[key].min, tiefeSenkrecht);
    baender[key].max = Math.max(baender[key].max, tiefeSenkrecht);
  }
  const hs = Object.keys(baender).map(Number).sort((a, b) => a - b);
  const mess = hs.filter((_, i) => i % Math.max(1, Math.floor(hs.length / 6)) === 0)
                 .map(h => ({ h: +(h * 10).toFixed(1),
                              tiefe: +baender[h].max.toFixed(3),
                              ueberstand: +(-baender[h].min).toFixed(3) }));
  return { gefunden: true, hatProfil: !!(p && svgM.userData._svgWrap.profile),
           profilPunkte: svgM.userData._svgWrap.profile?.length || 0, mess };
}, SVG);

ok('B) Konische Wand erkannt', kegel.gefunden, kegel.gefunden ? undefined : kegel);
ok('B) Wandprofil wurde abgetastet', kegel.hatProfil && kegel.profilPunkte >= 3,
   { punkte: kegel.profilPunkte });
if (kegel.mess) {
  const tiefen = kegel.mess.map(m => m.tiefe);
  const ueber  = kegel.mess.map(m => m.ueberstand);
  console.log('  Tiefe je Höhe (mm):', JSON.stringify(kegel.mess));
  ok('B) Gravurtiefe 1,2 mm über die ganze Motivhöhe',
     tiefen.every(t => Math.abs(t - 1.2) < 0.15), { tiefen });
  ok('B) Motiv steht überall aus der Wand heraus (Boolean greift sicher)',
     ueber.every(u => u > 0.05), { ueberstand: ueber });
}

// ── C) Feines Netz (Kunst-STL): Abtasten statt aufgeben ──────────────────
const fein = await pg.evaluate((svg) => {
  const g = new THREE.CylinderGeometry(25, 25, 60, 1200, 120, true);   // ~288k Dreiecke
  const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xaa8 }));
  m.scale.set(0.1, 0.1, 0.1);
  m.userData = { id: idCtr++, name: 'FeinesNetz', type: 'import', shapeType: 'import', color: '#aaaa88' };
  scene.add(m); objects.push(m); m.updateMatrixWorld(true);
  const mitte = m.localToWorld(new THREE.Vector3(0, 0, 0));
  const hit = mitte.clone().add(new THREE.Vector3(2.5, 0, 0));
  const t0 = performance.now();
  const p = _svgWrapProbe(m, hit);
  return { tris, gefunden: !!p, R: p ? p.R * 10 : null, ms: Math.round(performance.now() - t0) };
}, SVG);
ok('C) Feines Netz (>250k Dreiecke) wird trotzdem erkannt',
   fein.gefunden && Math.abs(fein.R - 25) < 0.3, fein);
ok('C) Erkennung bleibt flott genug fürs Ziehen', fein.ms < 400, { ms: fein.ms, tris: fein.tris });

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER: ${fails.join(', ')}` : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
