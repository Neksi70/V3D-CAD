// Josy 29.9.26: Zebra-Muster um das Leo-Windlicht-Oberteil (1,2 mm Wand) gewickelt,
// dann „Vereinen“ — „dann hat er innen auch was“ und „sie liegen nicht ganz dran“.
// Ursachen: (1) das vertiefte Motiv (2 mm in die Wand) stach beim Vereinen innen
// durch; (2) über der letzten Radius-Abtastzeile blieb der Radius konstant, auf dem
// schmaler werdenden Kegel stand das Motiv zum Rand hin ab.
// Prüft: vor dem Vereinen ≤ 0,3 mm Luft im Körperbereich (egal wo aufgelegt),
// nach dem Vereinen nichts innen, außen erhaben ≈ Motivtiefe, oben am Rand abgeschnitten.
// Start: npm run dev (Port 8766)
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
// schräge Zebra-Streifen, 100×140 (höher als der Becher)
let paths = '';
for (let i = -6; i < 12; i++) { const y = i * 12; paths += `<path d="M0,${y} L100,${y+40} L100,${y+45} L0,${y+6} Z"/>`; }
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140">${paths}</svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type()==='warning'||m.type()==='error') console.log('[c]', m.text().slice(0,200)); });
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const lauf = (mode, HF, ROT, NOU) => pg.evaluate(async ([h, nu]) => { window._HF = h; window._NOU = nu; }, [HF, NOU]).then(() => pg.evaluate(async ([svgText, mode, ROT]) => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  Object.assign(_lwlP, { motif: 'glatt' });
  const d = _lwlDims(_lwlP);
  const geo = _lwlShadeGeo(_lwlP, 'normal');
  const becher = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  becher.userData = { id: idCtr++, name: 'Oberteil', type: 'custom', shapeType: 'custom' };
  scene.add(becher); objects.push(becher); becher.updateMatrixWorld(true);
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 2, targetMM: 150, name: 'Zebra' });
  m.userData.isHole = false;
  becher.position.set(0, 0, 0); becher.updateMatrixWorld(true);
  const yHit = d.Hs * (+(window._HF||0.55)), hit = new THREE.Vector3(d.rOutS(yHit), yHit, 0);
  const p = _svgWrapProbe(becher, hit);
  if (!p) return { gewickelt: false };
  _svgWrapApply(m, p, hit);
  if (ROT) { m.userData._svgWrap.rotRad = ROT; _svgWrapReshape(m, 2); m.updateMatrixWorld(true); }
  if (mode === 'erhaben') { m.userData.svgDepth = -1; _svgWrapReshape(m, -1); }
  m.updateMatrixWorld(true);
  // Motiv-Innenfläche: radialer Abstand zur Außenwand (in mm), je Höhe
  const pos = m.geometry.attributes.position, v = new THREE.Vector3();
  let minD = 1e9, maxD = -1e9, maxDy = null; const perY = {};
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    if (v.y < 0.3 || v.y > d.Hs - 0.1) continue;
    const dd = (Math.hypot(v.x, v.z) - d.rOutS(v.y)) * 10;
    const key = Math.round(v.y); perY[key] = perY[key] || [1e9, -1e9];
    perY[key][0] = Math.min(perY[key][0], dd); perY[key][1] = Math.max(perY[key][1], dd);
    if (dd < minD) minD = dd; if (dd > maxD) { maxD = dd; maxDy = v.y * 10; }
  }
  const oben = {};
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    if (v.y < d.Hs - 1.5) continue;
    const dd = (Math.hypot(v.x, v.z) - d.rOutS(Math.min(v.y, d.Hs))) * 10;
    const key = (Math.round(v.y * 2) / 2).toFixed(1); oben[key] = oben[key] || [1e9, -1e9];
    oben[key][0] = Math.min(oben[key][0], +dd.toFixed(2)); oben[key][1] = Math.max(oben[key][1], +dd.toFixed(2));
  }
  const info = { oben, R: p.R || p.radius, prof: m.userData._svgWrap.profile ? m.userData._svgWrap.profile.map(q => [+(q[0]*10).toFixed(1), +(q[1]*10).toFixed(2)]).slice(0, 40) : null, feld: !!m.userData._svgWrap.feld };
  if (window._NOU) return { maxDmm: +maxD.toFixed(2), maxDyMm: maxDy, minDmm: +minD.toFixed(2), wrapped: !!m.userData._svgWrap };
  // Vereinen
  selectObjs([becher, m]);
  await unionSelected();
  const res = objects.find(o => o.userData.name && o.userData.name.startsWith('Verschmolzen'));
  let innen = null;
  if (res) {
    res.updateMatrixWorld(true);
    const rp = res.geometry.attributes.position; let cnt = 0, maxIn = 0;
    for (let i = 0; i < rp.count; i++) {
      v.fromBufferAttribute(rp, i).applyMatrix4(res.matrixWorld);
      if (v.y < d.yC + 0.2 || v.y > d.Hs - 0.05) continue;
      const di = (d.rInS(v.y) - Math.hypot(v.x, v.z)) * 10;   // >0 = ragt nach innen
      if (di > 0.05) { cnt++; maxIn = Math.max(maxIn, di); }
      const da = (Math.hypot(v.x, v.z) - d.rOutS(Math.min(v.y, d.Hs))) * 10;
      if (v.y > d.Hs - 1.5) { window._aussenMax = Math.max(window._aussenMax || 0, da); }
    }
    innen = { cnt, maxInMm: +maxIn.toFixed(2), aussenObenMax: +(window._aussenMax||0).toFixed(2), resMaxY: new THREE.Box3().setFromObject(res).max.y };
  }
  return { gewickelt: true, minDmm: +minD.toFixed(2), maxDmm: +maxD.toFixed(2), maxDyMm: maxDy, perY, info, innen, wandMm: _lwlP.shadeWall };
}, [SVG, mode, ROT]));
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
for (const [hf, rot] of [[0.1, 0], [0.55, 0], [0.8, 0], [0.95, 0], [0.55, 0.6]]) {
  const r = await lauf('vertieft', String(hf), rot, true);
  ok(`aufgelegt bei ${hf * 100} % Höhe${rot ? ', gedreht' : ''}: liegt an (≤ 0,3 mm Luft)`, r.wrapped && r.maxDmm <= 0.3, r);
}
const r = await lauf('vertieft', '0.55', 0, false);
ok('Vereinen: innen steht nichts heraus', r.innen && r.innen.cnt === 0, r.innen);
ok('Vereinen: außen erhaben ≈ Motivtiefe (2 mm)', r.innen && r.innen.aussenObenMax > 1.8 && r.innen.aussenObenMax < 2.2, r.innen);
ok('Vereinen: oben am Rand abgeschnitten', r.innen && Math.abs(r.innen.resMaxY - 12) < 0.005, r.innen);
ok('keine JS-Fehler', errs.length === 0, errs);
await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER: ${fails.join(', ')}`); process.exit(1); }
console.log('\nAlles grün.');
