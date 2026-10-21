// Große Modelle: Warnung vor dem Import + Vereinfachen mit fester Höchstabweichung
// (meshoptimizer im Worker). Anlass: Absturz bei großen Scans (Volker 21.10.).
// Optional echte Datei: GROSS_STL=/pfad/scan.stl node tests/grosses_modell_test.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import { chromium } from '@playwright/test';
import { createRequire } from 'module';
const fflate = createRequire(import.meta.url)('fflate');
const PORT = 8923;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const TMP = fs.mkdtempSync('/tmp/claude-1000/gm-');

// scan-artige Fläche: W×W Punkte, Wellen + feine Rillen (die dürfen nicht verschwinden)
function stl(W, file) {
  const nT = 2 * (W - 1) * (W - 1), b = Buffer.alloc(84 + nT * 50); b.writeUInt32LE(nT, 80);
  const z = (x, y) => Math.sin(x * 0.05) * 4 + Math.cos(y * 0.07) * 3 + (x % 40 < 2 ? 0.3 : 0);
  let o = 84; const P = (x, y) => [x * 0.1, y * 0.1, z(x, y)];
  const tri = (a, c, d) => { o += 12; for (const p of [a, c, d]) for (const v of p) { b.writeFloatLE(v, o); o += 4; } o += 2; };
  for (let y = 0; y < W - 1; y++) for (let x = 0; x < W - 1; x++) { tri(P(x, y), P(x + 1, y), P(x, y + 1)); tri(P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)); }
  fs.writeFileSync(file, b); return nT;
}
const fBig = TMP + '/Scan_gross.stl', fSmall = TMP + '/Klein.stl';
const nBig = stl(560, fBig), nSmall = stl(60, fSmall);
const real = process.env.GROSS_STL;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _importMeshFile === 'function' && typeof hideStarter === 'function');
  await page.waitForTimeout(8000);
  await page.evaluate(() => { try { hideStarter(); } catch (e) {} });
  const tris = () => page.evaluate(() => { const o = objects[objects.length - 1]; return { n: objects.length, t: Math.round(_geoTriCount(o.geometry)), stl: !!o.userData._origStlBuf }; });
  const dlg = () => page.evaluate(() => document.getElementById('bigmesh-modal').classList.contains('show'));
  const closeSize = async () => { await page.waitForTimeout(400); await page.evaluate(() => { document.querySelectorAll('.g3dm.show, .modal.show').forEach(m => { if (m.id !== 'bigmesh-modal') m.classList.remove('show'); }); }); };

  // 1) kleine Datei: kein Fenster
  await page.setInputFiles('#fimport', fSmall);
  await page.waitForFunction(() => objects.length >= 1, null, { timeout: 20000 });
  ok(!(await dlg()), `kleine Datei (${nSmall} Dreiecke): kein Warnfenster`);
  await closeSize();

  // 2) großer Scan → Fenster, vereinfacht laden; Haupt-Thread-Lücken messen
  await page.evaluate(() => { window._gap = 0; let last = performance.now(); window._gapRun = true; const t = () => { const n = performance.now(); window._gap = Math.max(window._gap, n - last); last = n; if (window._gapRun) setTimeout(t, 10); }; t(); });
  await page.setInputFiles('#fimport', fBig);
  await page.waitForFunction(() => document.getElementById('bigmesh-modal').classList.contains('show'), null, { timeout: 30000 });
  const info = await page.textContent('#bigmesh-info');
  ok(/Dreiecke/.test(info) && info.replace(/\D/g, '').includes(String(nBig)), 'Warnfenster nennt Dreieckszahl → ' + info.trim());
  await page.waitForFunction(() => !document.getElementById('bigmesh-simp').disabled, null, { timeout: 60000 });
  const gapCalc = await page.evaluate(() => { window._gapRun = false; return Math.round(window._gap); });
  const res = await page.textContent('#bigmesh-res');
  console.log('INFO ' + res.trim());
  ok(gapCalc < 400, `Seite bleibt beim Berechnen bedienbar (längste Lücke ${gapCalc} ms, inkl. Datei lesen)`);
  await page.screenshot({ path: TMP + '/fenster.png' });
  const nBefore = (await tris()).n;
  await page.click('#bigmesh-simp');
  await page.waitForFunction(n => objects.length > n, nBefore, { timeout: 20000 });
  let t = await tris();
  ok(t.t < nBig * 0.5, `vereinfacht geladen: ${t.t} von ${nBig} Dreiecken`);
  ok(!t.stl, 'rohe STL-Bytes nicht an vereinfachtem Körper (würden nicht passen)');
  // Qualität: Abstand (3D) jedes Stichproben-Originalpunkts zur vereinfachten Fläche
  const dev = await page.evaluate(() => {
    const g = objects[objects.length - 1].geometry, p = g.attributes.position.array;
    const z = (x, y) => Math.sin(x * 0.05) * 4 + Math.cos(y * 0.07) * 3 + (x % 40 < 2 ? 0.3 : 0);
    const C = 1, grid = new Map();
    for (let t = 0; t < p.length; t += 9) {
      const xs = [p[t], p[t + 3], p[t + 6]], ys = [p[t + 1], p[t + 4], p[t + 7]];
      for (let gx = Math.floor(Math.min(...xs) / C); gx <= Math.floor(Math.max(...xs) / C); gx++)
        for (let gy = Math.floor(Math.min(...ys) / C); gy <= Math.floor(Math.max(...ys) / C); gy++) { const k = gx + ',' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(t); }
    }
    const tri = new THREE.Triangle(), q = new THREE.Vector3(), P = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
    let worst = 0, n = 0;
    for (let s = 0; s < 20000; s++) {
      const ix = Math.floor(Math.random() * 560), iy = Math.floor(Math.random() * 560);
      P.set(ix * 0.1, iy * 0.1, z(ix, iy)); let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        for (const t of grid.get((Math.floor(P.x / C) + dx) + ',' + (Math.floor(P.y / C) + dy)) || []) {
          tri.set(A.fromArray(p, t), B.fromArray(p, t + 3), Cc.fromArray(p, t + 6)); tri.closestPointToPoint(P, q);
          const d = q.distanceTo(P); if (d < best) best = d;
        }
      if (best < Infinity) { worst = Math.max(worst, best); n++; }
    }
    return { worst, n };
  });
  ok(dev.n > 19000 && dev.worst < 0.05, `Qualität: ${dev.n} Stichproben, größter Abstand zur Fläche ${dev.worst.toFixed(4)} mm (< 0,05)`);
  ok(await page.evaluate(() => { const o = objects[objects.length - 1]; o.updateMatrixWorld(true); const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); return Math.abs(Math.max(s.x, s.z) - 5.59) < 0.02; }), 'Größe unverändert (55,9 mm)');
  await closeSize();

  // 3) großer Scan → Original laden
  const n2 = (await tris()).n;
  await page.setInputFiles('#fimport', fBig);
  await page.waitForFunction(() => document.getElementById('bigmesh-modal').classList.contains('show'), null, { timeout: 30000 });
  await page.click('#bigmesh-orig');
  await page.waitForFunction(n => objects.length > n, n2, { timeout: 20000 });
  t = await tris();
  ok(t.t === nBig && t.stl, `„Original laden": alle ${nBig} Dreiecke, STL-Bytes bleiben`);
  ok(!(await dlg()), 'Fenster geschlossen');
  await closeSize();

  // 4) 3MF aus der Bibliothek (mehrere Teile) → Fenster, vereinfacht
  const zip = fflate.zipSync({ '3D/3dmodel.model': fflate.strToU8((() => {
    const W = 420, o = ['<model unit="millimeter"><resources>'];
    for (const id of [1, 2]) { o.push(`<object id="${id}" name="Teil${id}"><mesh><vertices>`);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) o.push(`<vertex x="${x * 0.1 + id * 50}" y="${y * 0.1}" z="${(Math.sin(x * 0.05) * 3).toFixed(4)}"/>`);
      o.push('</vertices><triangles>'); for (let y = 0; y < W - 1; y++) for (let x = 0; x < W - 1; x++) { const a = y * W + x; o.push(`<triangle v1="${a}" v2="${a + 1}" v3="${a + W}"/><triangle v1="${a + 1}" v2="${a + W + 1}" v3="${a + W}"/>`); }
      o.push('</triangles></mesh></object>'); }
    o.push('</resources><build><item objectid="1"/><item objectid="2"/></build></model>'); return o.join(''); })()) });
  fs.writeFileSync(TMP + '/Zwei.3mf', zip);
  const n3 = (await tris()).n;
  await page.route('**/__z.3mf', r => r.fulfill({ body: Buffer.from(zip) }));
  const p3 = page.evaluate(async () => { const b = await (await fetch('/__z.3mf')).arrayBuffer(); return _importMeshFile(b, 'Zwei.3mf', false); });
  await page.waitForFunction(() => !document.getElementById('bigmesh-simp').disabled && document.getElementById('bigmesh-modal').classList.contains('show'), null, { timeout: 60000 });
  ok(/2 Teilen/.test(await page.textContent('#bigmesh-info')), '3MF: Fenster nennt 2 Teile');
  await page.click('#bigmesh-simp', { timeout: 8000 }).catch(e => { console.log('KLICK ' + e.message.split('\n').filter(l => /intercept/.test(l)).slice(0, 2).join(' / ')); throw e; }); await p3;
  const after3 = await page.evaluate(n => objects.slice(n).map(o => Math.round(_geoTriCount(o.geometry))), n3);
  ok(after3.length === 2 && after3.every(x => x < 100000), '3MF: 2 Teile, beide vereinfacht → ' + after3.join(', '));

  // 5) Agent-API (kein Mensch da): kein Fenster
  const okApi = await page.evaluate(async () => { const b = await (await fetch('/__z.3mf')).arrayBuffer(); const r = _importThreeMF(b, 'api.3mf'); await new Promise(x => setTimeout(x, 300)); const shown = document.getElementById('bigmesh-modal').classList.contains('show'); return (await r) && !shown; });
  ok(okApi, 'Import ohne Nachfrage (Agent-API) zeigt kein Fenster');

  // 6) 🔻 Vereinfachen-Werkzeug auf großem Netz → meshopt im Worker
  const r6 = await page.evaluate(async () => {
    const o = objects.find(x => Math.round(_geoTriCount(x.geometry)) > 500000); selectObjs([o]);
    const before = _geoTriCount(o.geometry);
    openSimplifyModal(); document.getElementById('simplify-pct').value = 70; _simplifyEst(); _applySimplify();
    for (let i = 0; i < 200 && _geoTriCount(o.geometry) === before; i++) await new Promise(r => setTimeout(r, 100));
    return { before, after: _geoTriCount(o.geometry) };
  });
  ok(Math.abs(r6.after - r6.before * 0.3) < r6.before * 0.03, `🔻 Vereinfachen 70 %: ${r6.before} → ${r6.after} Dreiecke`);

  if (real) {
    const n7 = (await tris()).n;
    await page.setInputFiles('#fimport', real);
    await page.waitForFunction(() => document.getElementById('bigmesh-modal').classList.contains('show'), null, { timeout: 60000 });
    await page.waitForFunction(() => !document.getElementById('bigmesh-simp').disabled || /nicht geklappt/.test(document.getElementById('bigmesh-res').textContent), null, { timeout: 120000 });
    console.log('INFO echte Datei: ' + (await page.textContent('#bigmesh-info')).trim() + ' | ' + (await page.textContent('#bigmesh-res')).trim());
    await page.click('#bigmesh-simp'); await page.waitForFunction(n => objects.length > n, n7, { timeout: 60000 });
  }
  ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await browser.close(); srv.kill(); fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
