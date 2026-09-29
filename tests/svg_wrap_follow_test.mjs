// Josy 10.9.26 (2. Meldung): Motiv per Pfeiltasten/Panel in der Hoehe verschieben →
// "Luecke zwischen Objekt und SVG" bzw. "verschwindet da wieder drin".
// Auf einer KONISCHEN Wand aendert sich der Radius mit der Hoehe; behaelt das
// Motiv seinen alten Radius, schwebt es oder versinkt.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10,10 H90 V90 H10 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// Becher als STL-Import: unten Ø40, oben Ø70, 80 mm hoch, Mitte bei y=4 (40mm)
const setup = await pg.evaluate((svg) => {
  const g = new THREE.CylinderGeometry(35, 20, 80, 64, 1, true);
  const cup = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8a8 }));
  cup.scale.set(0.1, 0.1, 0.1); cup.position.set(0, 4, 0);
  cup.userData = { id: idCtr++, name: 'Becher', type: 'import', shapeType: 'import', color: '#88aa88' };
  scene.add(cup); objects.push(cup); cup.updateMatrixWorld(true);
  const m = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 3, targetMM: 20, name: 'Motiv' });
  m.userData.isHole = true;
  cup.position.set(0, 4, 0);              // der Import schiebt vorhandene Objekte beiseite
  cup.updateMatrixWorld(true);
  // auf mittlerer Hoehe wickeln (y = 4 → Wandradius 27,5 mm)
  const hit = new THREE.Vector3(2.75, 4, 0);
  const p = _svgWrapProbe(cup, hit);
  if (!p) return { gewickelt: false };
  _svgWrapApply(m, p, hit);
  selectObjs([m]);
  return { gewickelt: true, R: +(p.R * 10).toFixed(2), y: +m.position.y.toFixed(2) };
}, SVG);
ok('auf mittlerer Höhe gewickelt', setup.gewickelt, setup);

// Messung: groesster Abstand zwischen Motiv-Aussenflaeche und Bechwand (in mm).
// >0 = Luecke (schwebt), <0 = steckt tiefer drin als vorgesehen.
const spalt = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const cup = objects.find(o => o.userData.name === 'Becher');
  m.updateMatrixWorld(true); cup.updateMatrixWorld(true);
  const achse = cup.position.clone();                      // Achse = y durch cup.position
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  // Wandradius (Welt-Einheiten) an Hoehe y: linear zwischen unten 20 und oben 35 mm
  const R = y => { const lokalY = (y - cup.position.y) / 0.1; // in mm-Geometrie
                   const t = (lokalY + 40) / 80; return (20 + (35 - 20) * Math.max(0, Math.min(1, t))) * 0.1; };
  let maxLuecke = -Infinity, minLuecke = Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    // nur wo Becher ist: über den Rand hinaus setzt das Wickeln seit v1.18.78 die
    // Wandneigung fort, der Überstand wird beim Vereinen/Abziehen abgeschnitten
    if (v.y > cup.position.y + 4 || v.y < cup.position.y - 4) continue;
    const r = Math.hypot(v.x - achse.x, v.z - achse.z);
    const d = r - R(v.y);                                   // >0: ausserhalb der Wand
    if (d > maxLuecke) maxLuecke = d;
    if (d < minLuecke) minLuecke = d;
  }
  return { obersteAussenkanteMM: +(maxLuecke * 10).toFixed(2), tiefsterPunktMM: +(minLuecke * 10).toFixed(2),
           y: +m.position.y.toFixed(2) };
});
const s0 = await spalt();
console.log('   direkt nach dem Wickeln:', JSON.stringify(s0));
ok('sitzt sauber auf der Wand (0,2 mm Überstand, 1,2–3 mm tief)',
   Math.abs(s0.obersteAussenkanteMM - 0.2) < 0.25 && s0.tiefsterPunktMM < -0.5, s0);

// jetzt wie Josy: mit der Pfeiltaste 20 mm nach oben (dort ist die Wand weiter)
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  selectObjs([m]);
});
// "exakt versetzen": 10 × 3,5 mm nach oben (▲ HÖHE im Panel)
for (let i = 0; i < 10; i++) { await pg.evaluate(() => _nudgeMove('y', 1)); await pg.waitForTimeout(40); }
await pg.waitForTimeout(500);
const s1 = await spalt();
console.log('   nach 10× ▲ (35 mm hoch):', JSON.stringify(s1));
ok('folgt der Wand beim Versetzen über das Panel',
   Math.abs(s1.obersteAussenkanteMM - 0.2) < 0.6, s1);

// und per Eingabefeld (applyTF)
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  selectObjs([m]);
  document.getElementById('py').value = (m.position.y - 3).toFixed(2);
  applyTF('py');
});
await pg.waitForTimeout(500);
const s2 = await spalt();
console.log('   nach Eingabe Y −30 mm:', JSON.stringify(s2));
ok('folgt der Wand auch bei Eingabe im Feld', Math.abs(s2.obersteAussenkanteMM - 0.2) < 0.6, s2);
// Josy: "ist er ja nur halb" — dicht an der Oberkante wickeln
const rand = await pg.evaluate(() => {
  const cup = objects.find(o => o.userData.name === 'Becher');
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const bb = new THREE.Box3().setFromObject(cup);
  cup.updateMatrixWorld(true);
  const hit = new THREE.Vector3(3.4, bb.max.y - 0.1, 0);      // 1 mm unter dem Rand
  const p = _svgWrapProbe(cup, hit);
  if (!p) return { ok: false };
  _svgWrapApply(m, p, hit);
  m.updateMatrixWorld(true);
  const mb = new THREE.Box3().setFromObject(m);
  return { ok: true, motivOben: +mb.max.y.toFixed(2), motivUnten: +mb.min.y.toFixed(2),
           koerperOben: +bb.max.y.toFixed(2), koerperUnten: +bb.min.y.toFixed(2) };
});
console.log('   dicht an der Oberkante gewickelt:', JSON.stringify(rand));
ok('Motiv sitzt ganz auf dem Körper (ragt nicht über die Kante)',
   rand.ok && rand.motivOben <= rand.koerperOben + 0.05 && rand.motivUnten >= rand.koerperUnten - 0.05, rand);

console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
