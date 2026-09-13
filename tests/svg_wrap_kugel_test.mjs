// Josy 13.9.26 (Screenshot): kugelige Vase, "er setzt es leider immer noch nicht
// ganz drauf". Misst das Anliegen auf einer stark gekruemmten (kugeligen) Wand.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,5 H95 V95 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// art: 'kugel' (Ø70, oben offen) | 'walze' (schwach gewoelbt) — Motivgröße variabel
const test = (art, motivMM) => pg.evaluate(async ([art, motivMM, svgText]) => {
  objects.slice().forEach(o => { scene.remove(o); objects.splice(objects.indexOf(o), 1); });
  const R0 = 35, NR = 128;
  // Profil (Meridian) als Punktliste: Kugel bzw. flache Tonne
  const pts = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (art === 'kugel') {
      const phi = Math.PI * (0.08 + 0.84 * t);          // von unten bis kurz vor oben
      pts.push(new THREE.Vector2(R0 * Math.sin(phi), -R0 * Math.cos(phi)));
    } else {
      pts.push(new THREE.Vector2(30 + 4 * Math.sin(Math.PI * t), -50 + 100 * t));
    }
  }
  const g = new THREE.LatheGeometry(pts, NR);
  const vase = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2aa8c0, side: THREE.DoubleSide }));
  vase.scale.set(0.1, 0.1, 0.1); vase.position.set(0, 4, 0);
  vase.userData = { id: idCtr++, name: 'Vase', type: 'import', shapeType: 'import' };
  scene.add(vase); objects.push(vase); vase.updateMatrixWorld(true);

  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: motivMM, name: 'Motiv' });
  m.userData.isHole = true;
  vase.position.set(0, 4, 0); vase.updateMatrixWorld(true);
  // auf halber Höhe treffen (dickste Stelle)
  const bb = new THREE.Box3().setFromObject(vase);
  const yMitte = (bb.min.y + bb.max.y) / 2;
  const rMitte = (bb.max.x - bb.min.x) / 2;
  const hit = new THREE.Vector3(rMitte, yMitte, 0);
  const p = _svgWrapProbe(vase, hit);
  if (!p) return { art, motivMM, gewickelt: false };
  _svgWrapApply(m, p, hit);
  m.updateMatrixWorld(true);

  // Abstand jedes Motivpunkts zur Wand — Strahl radial von aussen
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  const rc = new THREE.Raycaster();
  const achse = vase.position.clone();
  let maxAb = -Infinity, minAb = Infinity, ueber05 = 0, n = 0;
  const schritt = Math.max(1, Math.floor(pos.count / 400));
  for (let i = 0; i < pos.count; i += schritt) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const dx = v.x - achse.x, dz = v.z - achse.z, r = Math.hypot(dx, dz);
    if (r < 1e-6) continue;
    const dir = new THREE.Vector3(dx / r, 0, dz / r);
    rc.set(new THREE.Vector3(achse.x, v.y, achse.z).addScaledVector(dir, r + 5), dir.clone().negate());
    const h = rc.intersectObject(vase, true).find(t2 => t2.face);
    if (!h) continue;
    const rw = Math.hypot(h.point.x - achse.x, h.point.z - achse.z);
    const d = (r - rw) * 10;
    if (d > maxAb) maxAb = d;
    if (d < minAb) minAb = d;
    if (d > 0.5) ueber05++;
    n++;
  }
  const mb = new THREE.Box3().setFromObject(m);
  return { art, motivMM, gewickelt: true, maxUeberstandMM: +maxAb.toFixed(2), tiefsteMM: +minAb.toFixed(2),
           punkte: n, ueber05mm: ueber05,
           motivHoeheMM: +((mb.max.y - mb.min.y) * 10).toFixed(1) };
}, [art, motivMM, SVG]);

for (const [art, mm] of [['walze', 40], ['kugel', 25], ['kugel', 40], ['kugel', 55]]) {
  const r = await test(art, mm);
  console.log(JSON.stringify(r));
  ok(`${art} mit ${mm} mm Motiv: liegt an`, r.gewickelt && r.maxUeberstandMM < 0.8 && r.ueber05mm === 0, r);
}
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
