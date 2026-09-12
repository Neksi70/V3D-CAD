// Josy 13.9.26: gewickeltes Motiv auf einer bauchigen Vase laesst sich nicht
// abziehen ("kein gueltiges Werkzeug"), auch nach dem Reparieren nicht.
// Prueft die gewickelte Geometrie auf Wasserdichtheit — glatte Wand, konische
// Wand und bauchige Wand (dort wird zusaetzlich in der Hoehe gesliced).
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20,10 H80 V30 H20 Z"/><path d="M35,45 H65 V90 H35 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const test = (art) => pg.evaluate(async ([art, svgText]) => {
  // Wand bauen: gerade / konisch / bauchig (wie eine Vase)
  const H = 100, N = 96;
  let geo;
  if (art === 'gerade') geo = new THREE.CylinderGeometry(30, 30, H, N, 1, true);
  else if (art === 'konisch') geo = new THREE.CylinderGeometry(35, 20, H, N, 1, true);
  else {
    // bauchig: Radius folgt einer Sinuskurve über die Höhe
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, y = -H / 2 + t * H;
      pts.push(new THREE.Vector2(22 + 12 * Math.sin(Math.PI * t), y));
    }
    geo = new THREE.LatheGeometry(pts, N);
  }
  const wand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x66c }));
  wand.scale.set(0.1, 0.1, 0.1); wand.position.set(0, 5, 0);
  wand.userData = { id: idCtr++, name: 'Wand_' + art, type: 'import', shapeType: 'import' };
  scene.add(wand); objects.push(wand); wand.updateMatrixWorld(true);

  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: 40, name: 'Motiv_' + art });
  m.userData.isHole = true;
  wand.position.set(0, 5, 0); wand.updateMatrixWorld(true);
  const rWand = art === 'konisch' ? 2.75 : (art === 'gerade' ? 3.0 : 3.4);
  const hit = new THREE.Vector3(rWand, 5, 0);
  const p = _svgWrapProbe(wand, hit);
  if (!p) return { art, gewickelt: false };
  _svgWrapApply(m, p, hit);
  m.updateMatrixWorld(true);

  // offene / doppelte Kanten zaehlen
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
  const pos = g.attributes.position;
  const kanten = new Map();
  const key = (i, j) => {
    const A = [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => Math.round(v * 1e5)).join('_');
    const B = [pos.getX(j), pos.getY(j), pos.getZ(j)].map(v => Math.round(v * 1e5)).join('_');
    return A < B ? A + '|' + B : B + '|' + A;
  };
  for (let t = 0; t < pos.count; t += 3)
    for (let e = 0; e < 3; e++) {
      const k = key(t + e, t + (e + 1) % 3);
      kanten.set(k, (kanten.get(k) || 0) + 1);
    }
  let offen = 0, mehrfach = 0;
  for (const n of kanten.values()) { if (n === 1) offen++; else if (n > 2) mehrfach++; }

  const w = await _mfInit();
  let werkzeug = 'ok';
  try { _mfFromSoup(w, _moldCollectTris(m)); }
  catch (e) { werkzeug = String(e.message || e).slice(0, 80); }
  return { art, gewickelt: true, dreiecke: pos.count / 3, offeneKanten: offen, mehrfachKanten: mehrfach, werkzeug };
}, [art, SVG]);

for (const art of ['gerade', 'konisch', 'bauchig']) {
  const r = await test(art);
  console.log(art.padEnd(9), JSON.stringify(r));
  ok(`${art}: Motiv ist als Werkzeug brauchbar`, r.gewickelt && r.werkzeug === 'ok', r);
  ok(`${art}: keine offenen Kanten`, r.gewickelt && r.offeneKanten === 0, { offen: r.offeneKanten, mehrfach: r.mehrfachKanten });
}
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
