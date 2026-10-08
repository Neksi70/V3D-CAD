// Muster auf Rundung (_rmp*): Wabe/Dreiecke/Organisch/Voronoi rundum auf einer
// hohlen Bauchvase (2 mm Wand, als Z-up-Import angelegt). Prüft: wasserdicht,
// Stege wirklich erhaben (0 … Höhe), Innenwand + Boden unberührt, nahtlos bei
// θ = ±180°, Speichern behält die Parameter. Screenshots nach /tmp/rmp_*.png.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8871;
const URL = process.env.V3D_URL || `http://localhost:${PORT}/volme3d.html`;
const srv = process.env.V3D_URL ? null : spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof _rmpApply === 'function' && typeof objects !== 'undefined', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { hideStarter?.(); _newCreate(false); });

const H = 120, WALL = 2;
const PATS = ['wabe', 'dreieck', 'organisch', 'voronoi'];
const out = {};
for (const pat of PATS) {
  const r = await page.evaluate(async ({ pat, H, WALL }) => {
    _newCreate(false);
    const ro = y => 24 + 14 * Math.sin(Math.PI * y / H);
    const pts = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= 60; i++) { const y = H * i / 60; pts.push(new THREE.Vector2(ro(y), y)); }
    for (let i = 60; i >= 0; i--) { const y = WALL + (H - WALL) * i / 60; pts.push(new THREE.Vector2(ro(y) - WALL, y)); }
    pts.push(new THREE.Vector2(0, WALL));
    const vol = g => { const p = g.attributes.position; let v = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2); v += a.dot(b.clone().cross(c)) / 6; } return v; };
    let g = new THREE.LatheGeometry(pts, 96).toNonIndexed();
    if (vol(g) < 0) g = new THREE.LatheGeometry(pts.reverse(), 96).toNonIndexed();
    g.rotateX(Math.PI / 2);                          // wie eine Z-up-STL
    _addImportedGeo(g, 'vase.stl', true, null, false);
    const o = objects[objects.length - 1];
    selectObjs([o]);
    o.updateMatrixWorld(true);
    const bb0 = new THREE.Box3().setFromObject(o);
    const t0 = performance.now();
    _rmpApply(pat);
    await new Promise(res => setTimeout(res, 120));
    for (let k = 0; k < 400 && o.userData.displacementPattern !== 'rmp'; k++) await new Promise(res => setTimeout(res, 50));
    const ms = Math.round(performance.now() - t0);
    o.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(o);
    const cx = (bb0.min.x + bb0.max.x) / 2, cz = (bb0.min.z + bb0.max.z) / 2, yB = bb0.min.y;
    // Ecken in mm relativ zur Achse
    const p = o.geometry.attributes.position, v = new THREE.Vector3();
    const q = x => Math.round(x * 1e4);
    const edges = new Map(); let degen = 0;
    const keyOf = i => { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); return q(v.x) + ',' + q(v.y) + ',' + q(v.z); };
    const idx = o.geometry.index ? o.geometry.index.array : null;
    const nTri = (idx ? idx.length : p.count) / 3;
    for (let t = 0; t < nTri; t++) {
      const k = [0, 1, 2].map(j => keyOf(idx ? idx[t * 3 + j] : t * 3 + j));
      if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) { degen++; continue; }
      for (let j = 0; j < 3; j++) { const a = k[j], b = k[(j + 1) % 3]; const e = a < b ? a + '|' + b : b + '|' + a; edges.set(e, (edges.get(e) || 0) + 1); }
    }
    let bad = 0; for (const n of edges.values()) if (n !== 2) bad++;
    // Versatz je Ecke gegen die analytische Wand
    let outerN = 0, web = 0, cell = 0, dMin = Infinity, dMax = -Infinity, innerMax = 0;
    const seamA = [], seamB = [];
    const seen = new Set();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const y = (v.y - yB) * 10, r = Math.hypot(v.x - cx, v.z - cz) * 10;
      if (y < WALL + 4 || y > H - 4) continue;
      const k = q(v.x) + ',' + q(v.y) + ',' + q(v.z); if (seen.has(k)) continue; seen.add(k);
      const dO = r - ro(y), dI = r - (ro(y) - WALL);
      if (Math.abs(dI) < Math.abs(dO)) { innerMax = Math.max(innerMax, Math.abs(dI)); continue; }
      outerN++; dMin = Math.min(dMin, dO); dMax = Math.max(dMax, dO);
      if (dO > 0.9) web++; else if (dO < 0.1) cell++;
      const th = Math.atan2(v.z - cz, v.x - cx);
      if (Math.abs(y - 60) < 25) { if (th > Math.PI - 0.12) seamA.push([y, dO]); if (th < -Math.PI + 0.12) seamB.push([y, dO]); }
    }
    const d = JSON.parse(JSON.stringify(objectToData(o)));
    const info = o.userData._warpCache && o.userData._warpCache.rmpInfo;
    return { ms, tris: nTri, bad, degen, outerN, webFrac: +(web / outerN).toFixed(3), cellFrac: +(cell / outerN).toFixed(3),
      dMin: +dMin.toFixed(3), dMax: +dMax.toFixed(3), innerMax: +innerMax.toFixed(3),
      bottom: +((bb.min.y - bb0.min.y) * 10).toFixed(3), seam: [seamA.length, seamB.length],
      seamWebA: seamA.filter(s => s[1] > 0.5).length / Math.max(1, seamA.length), seamWebB: seamB.filter(s => s[1] > 0.5).length / Math.max(1, seamB.length),
      saved: d.rmp && d.rmp.pat, dir: o.userData.texDir, where: o.userData.texWhere, N: info && info.N };
  }, { pat, H, WALL });
  out[pat] = r;
  console.log(pat, JSON.stringify(r));
  await page.mouse.move(650, 400); await page.mouse.move(660, 410);
  for (const [nm, dth] of [['a', 0], ['naht', Math.PI]]) {
    await page.evaluate((dth) => { selectObjs([]); fitView(); sph.r *= 0.55; sph.theta = (sph.theta || 0) + dth; sph2cam(); }, dth);
    await page.mouse.move(640, 600); await page.mouse.move(645, 605);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `/tmp/rmp_${pat}_${nm}.png`, clip: { x: 300, y: 260, width: 560, height: 600 } });
  }
}

// Regler: Zellgröße ändern → mehr Zellen
const regler = await page.evaluate(async () => {
  const o = objects[objects.length - 1]; selectObjs([o]);
  const n0 = o.userData._warpCache.rmpInfo.N;
  _rmpSet('cell', 6); await new Promise(r => setTimeout(r, 400));
  for (let k = 0; k < 100 && o.userData._warpCache.rmpInfo.N === n0; k++) await new Promise(r => setTimeout(r, 50));
  return { n0, n1: o.userData._warpCache.rmpInfo.N };
});
console.log('regler', JSON.stringify(regler));

// Echter Klickweg: Textur-Panel öffnen, Knopf „Voronoi" anklicken, Regler da?
await page.evaluate(() => { const o = objects[objects.length - 1]; selectObjs([o]); applyDisplacement('pattern', 'keine');
  const pnl = document.getElementById('tex-panel'); if (pnl.style.display !== 'block') toggleTexPanel(); pnl.style.left = '120px'; pnl.style.top = '270px'; });
await page.waitForTimeout(300);
await page.click('[data-rmp="voronoi"]');
await page.waitForFunction(() => objects[objects.length - 1].userData.displacementPattern === 'rmp', { timeout: 30000 });
await page.waitForTimeout(300);
const ui = await page.evaluate(() => ({ cell: !!document.getElementById('rmp-cell'), jit: !!document.getElementById('rmp-jitter'),
  on: document.querySelector('[data-rmp="voronoi"]').classList.contains('on'), pat: objects[objects.length - 1].userData.rmp.pat }));
await page.screenshot({ path: '/tmp/rmp_panel.png' });
 await page.evaluate(() => _rmpMode('durch')); await page.waitForTimeout(2500); await page.evaluate(() => _buildTexPanelContent(getFirst())); await page.screenshot({ path: '/tmp/rmp_panel_durch.png' }); await page.evaluate(() => _rmpMode('erhaben'));
// Zellen vertieft: Außenmaß bleibt, Zellen sinken ein
const tief = await page.evaluate(async () => {
  const o = objects[objects.length - 1]; selectObjs([o]);
  const r0 = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  applyDisplacement('dir', 'eingepraegt');
  const r1 = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  return { vorher: +(r0.x * 10).toFixed(2), nachher: +(r1.x * 10).toFixed(2) };
});
console.log('ui', JSON.stringify(ui), 'tief', JSON.stringify(tief));

// ── Durchbrochen: Öffnungen gehen durch die Wand ────────────────────────
const durch = {};
for (const pat of PATS) {
  const r = await page.evaluate(async ({ pat, H, WALL }) => {
    _newCreate(false);
    const ro = y => 24 + 14 * Math.sin(Math.PI * y / H);
    const pts = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= 60; i++) { const y = H * i / 60; pts.push(new THREE.Vector2(ro(y), y)); }
    for (let i = 60; i >= 0; i--) { const y = WALL + (H - WALL) * i / 60; pts.push(new THREE.Vector2(ro(y) - WALL, y)); }
    pts.push(new THREE.Vector2(0, WALL));
    const vol = g => { const p = g.attributes.position; let v = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2); v += a.dot(b.clone().cross(c)) / 6; } return v; };
    let g = new THREE.LatheGeometry(pts, 96).toNonIndexed();
    if (vol(g) < 0) g = new THREE.LatheGeometry(pts.reverse(), 96).toNonIndexed();
    g.rotateX(Math.PI / 2);
    _addImportedGeo(g, 'vase.stl', true, null, false);
    const o = objects[objects.length - 1]; selectObjs([o]); o.updateMatrixWorld(true);
    const bb0 = new THREE.Box3().setFromObject(o);
    const cx = (bb0.min.x + bb0.max.x) / 2, cz = (bb0.min.z + bb0.max.z) / 2, yB = bb0.min.y;
    const volObj = () => { o.updateMatrixWorld(true); const gg = o.geometry.clone().applyMatrix4(o.matrixWorld); const nn = gg.index ? gg.toNonIndexed() : gg; return vol(nn) * 1000; };
    const v0 = volObj();
    _rmpApply(pat); await new Promise(res => setTimeout(res, 100));
    for (let k = 0; k < 200 && o.userData.displacementPattern !== 'rmp'; k++) await new Promise(res => setTimeout(res, 50));
    const t0 = performance.now(); const g0 = o.geometry;
    _rmpMode('durch');
    for (let k = 0; k < 1200 && o.geometry === g0; k++) await new Promise(res => setTimeout(res, 50));
    const ms = Math.round(performance.now() - t0);
    o.updateMatrixWorld(true);
    const v1 = volObj();
    // Radiale Strahlen von außen: trifft der erste Treffer die Außenwand (~5 mm) oder geht er durch?
    const rc = new THREE.Raycaster();
    let loch = 0, wand = 0, randZu = 0, randN = 0;
    for (let yi = 0; yi < 40; yi++) for (let ti = 0; ti < 72; ti++) {
      const y = 1 + (H - 2) * yi / 39, th = ti / 72 * 2 * Math.PI, R = ro(y) + 5;
      const org = new THREE.Vector3(cx + R / 10 * Math.cos(th), yB + y / 10, cz + R / 10 * Math.sin(th));
      rc.set(org, new THREE.Vector3(-Math.cos(th), 0, -Math.sin(th)));
      const h = rc.intersectObject(o, false)[0];
      const d = h ? h.distance * 10 : Infinity;
      const durch = d > 5 + WALL + 1;
      if (y < 2.5 || y > H - 2.5) { randN++; if (!durch) randZu++; }
      else if (y > 8 && y < H - 8) { if (durch) loch++; else wand++; }
    }
    const bb = new THREE.Box3().setFromObject(o);
    const d = JSON.parse(JSON.stringify(objectToData(o)));
    return { ms, lochFrac: +(loch / (loch + wand)).toFixed(3), randZu: randZu / randN, volRel: +(v1 / v0).toFixed(3),
      tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3,
      boden: +((bb.min.y - bb0.min.y) * 10).toFixed(3), hoehe: +((bb.max.y - bb.min.y) * 10).toFixed(2),
      savedDurch: !!(d.rmp && d.rmp.durch), hatGeo: !!d.geometry };
  }, { pat, H, WALL });
  durch[pat] = r;
  console.log('durch', pat, JSON.stringify(r));
  await page.evaluate(() => { selectObjs([]); fitView(); sph.r *= 0.55; sph2cam(); });
  await page.mouse.move(640, 600); await page.mouse.move(645, 605); await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/rmp_durch_${pat}.png`, clip: { x: 300, y: 260, width: 560, height: 600 } });
}
// Größen-Mix: Zellen verschieden groß, trotzdem dicht und durchbrochen
const mix = await page.evaluate(async () => {
  const o = objects[objects.length - 1]; selectObjs([o]);
  const out = {};
  for (const pat of ['wabe', 'dreieck']) {
    o.userData.rmp = Object.assign(_rmpParams(o), { pat, mix: 80, durch: false });
    _applyDisplacementNow('rmp', null);
    const P = (() => { let i = null; o.traverse(m => { if (!i && m.userData._warpCache) i = m.userData._warpCache; }); return i; })();
    const g0 = o.geometry; _rmpMode('durch');
    for (let k = 0; k < 1200 && o.geometry === g0; k++) await new Promise(r => setTimeout(r, 50));
    // Zellflächen aus der Abwicklung: Spreizung groß/klein
    const base = _rmpBaseGeo(o); o.updateMatrixWorld(true);
    const bp = base.attributes.position, w = new Float32Array(bp.count * 3), v = new THREE.Vector3(), bb = new THREE.Box3();
    for (let i = 0; i < bp.count; i++) { v.fromBufferAttribute(bp, i).applyMatrix4(o.matrixWorld); w.set([v.x, v.y, v.z], i * 3); bb.expandByPoint(v); }
    const at = _rmpMapper(w, bb.getCenter(new THREE.Vector3()), _rmpParams(o), base.index ? base.index.array : null);
    const A = _rmpCells(at.prof, at.prof.V[0] + 20, at.prof.V[at.prof.NB] - 20).map(p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a / 2); }).filter(a => a > 1).sort((a, b) => a - b);
    out[pat] = { geaendert: o.geometry !== g0, spreiz: +(A[Math.floor(A.length * 0.9)] / A[Math.floor(A.length * 0.1)]).toFixed(2), n: A.length };
  }
  o.userData.rmp = Object.assign(_rmpParams(o), { pat: 'voronoi', mix: 0 });
  return out;
});
console.log('mix', JSON.stringify(mix));

// zurück auf erhaben + entfernen
const zurueck = await page.evaluate(async () => {
  const o = objects[objects.length - 1]; selectObjs([o]);
  _rmpMode('erhaben');
  const erh = !o.userData.rmp.durch && o.userData._warpCache && !!o.userData._warpCache.rmpInfo;
  applyDisplacement('pattern', 'keine');
  return { erh, keine: o.userData.displacementPattern };
});
console.log('zurueck', JSON.stringify(zurueck));

// ── Vasen-Generator: Netz ist umgestülpt (Volumen < 0) → Muster muss trotzdem AUSSEN sitzen
await page.evaluate(() => { _newCreate(false); _openVaseModal(); });
await page.waitForTimeout(800);
const gen = await page.evaluate(async () => {
  _createVase(); await new Promise(r => setTimeout(r, 500)); _closeVaseModal();
  const o = objects[objects.length - 1]; selectObjs([o]); o.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(o), cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const hs = [0.3, 0.55, 0.8].map(f => bb.min.y + (bb.max.y - bb.min.y) * f);
  // Strahlen gegen eine beidseitige Kopie: von außen → Außenhaut, von der Achse → Innenwand
  const mess = () => {
    o.updateMatrixWorld(true);
    const m = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.matrixWorld.copy(o.matrixWorld);
    const rc = new THREE.Raycaster();
    return hs.map(h => { let aussen = Infinity, innen = Infinity;
      for (let t = 0; t < 72; t++) { const th = t / 72 * 2 * Math.PI, d = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
        rc.set(new THREE.Vector3(cx, h, cz).addScaledVector(d, 8), d.clone().negate()); const a = rc.intersectObject(m)[0];
        if (a) aussen = Math.min(aussen, (8 - a.distance) * -10);   // −Radius der Außenhaut (min → größter Radius)
        rc.set(new THREE.Vector3(cx, h, cz), d); const b = rc.intersectObject(m)[0];
        if (b) innen = Math.min(innen, b.distance * 10); }
      return [innen, -aussen]; });
  };
  const vor = mess();
  _rmpApply('wabe'); await new Promise(r => setTimeout(r, 200));
  for (let k = 0; k < 200 && o.userData.displacementPattern !== 'rmp'; k++) await new Promise(r => setTimeout(r, 50));
  const nach = mess();
  return { vor, nach };
});
console.log('generator', JSON.stringify(gen));

const checks = [];
gen.vor.forEach((v, k) => {
  const n = gen.nach[k];
  checks.push([`Generator-Vase Höhe ${k}: Innenwand unberührt`, Math.abs(n[0] - v[0]) < 0.1]);
  checks.push([`Generator-Vase Höhe ${k}: Stege außen (~+1 mm)`, n[1] - v[1] > 0.8 && n[1] - v[1] < 1.6]);   // waagerecht gemessen: an Schrägen 1/cos(Neigung)
});
for (const pat of PATS) {
  const r = durch[pat];
  checks.push([pat + ' durch: Öffnungen gehen durch (> 25 % der Strahlen)', r.lochFrac > 0.25 && r.lochFrac < 0.9]);
  checks.push([pat + ' durch: Rand oben/unten bleibt zu', r.randZu > 0.97]);
  checks.push([pat + ' durch: Material weg, Vase steht noch', r.volRel < 0.95 && r.volRel > 0.2 && Math.abs(r.boden) < 0.02 && Math.abs(r.hoehe - 120) < 0.05]);
  checks.push([pat + ' durch: gespeichert mit Geometrie', r.savedDurch && r.hatGeo]);
}
for (const pat of ['wabe', 'dreieck']) {
  checks.push([`Größen-Mix ${pat}: durchgestanzt`, mix[pat].geaendert]);
  checks.push([`Größen-Mix ${pat}: Zellen klar verschieden groß (P90/P10 > 2)`, mix[pat].spreiz > 2]);
}
checks.push(['zurück auf Erhaben + Entfernen', zurueck.erh && zurueck.keine === 'keine']);
for (const pat of PATS) {
  const r = out[pat];
  checks.push([pat + ': wasserdicht', r.bad === 0]);
  checks.push([pat + ': Stege erhaben bis ~1 mm', r.dMax > 0.9 && r.dMax < 1.1 && r.dMin > -0.06]);
  checks.push([pat + ': Stege und Zellen beide da', r.webFrac > 0.1 && r.cellFrac > 0.1]);
  checks.push([pat + ': Innenwand unberührt', r.innerMax < 0.05]);
  checks.push([pat + ': Boden bleibt auf der Platte', Math.abs(r.bottom) < 0.02]);
  checks.push([pat + ': gespeichert', r.saved === pat]);
}
checks.push(['Zellgröße 6 mm → mehr Zellen', regler.n1 > regler.n0]);
checks.push(['Klick auf Knopf legt Voronoi an + Regler', ui.cell && ui.jit && ui.on && ui.pat === 'voronoi']);
checks.push(['Zellen vertieft: Außenmaß −2 mm (Stege weg von außen)', Math.abs(tief.vorher - tief.nachher - 2) < 0.15]);
checks.push(['keine Seitenfehler', errs.length === 0]);
let fail = 0;
for (const [n, ok] of checks) { console.log((ok ? '✓ ' : '✗ ') + n); if (!ok) fail++; }
if (errs.length) console.log(errs.slice(0, 5));
await browser.close(); srv && srv.kill();
process.exit(fail ? 1 : 0);
