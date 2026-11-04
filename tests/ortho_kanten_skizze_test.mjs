// Regressionstest nach v1.18.308 (gerade Ansichten orthogonal), Volker 5.11.:
//   1. „Fase und Rundung geht nicht mehr“: Größen-Griffe lagen in VORNE/OBEN genau auf den Kanten → im
//      Kantenmodus ausgeblendet. Prüfung mit echten Klicks in VORNE, OBEN, ISO.
//   2. „Skizze rastet nichts ein, Linie lässt sich nicht beenden“: nach H/V-Fang Raster für die freie Richtung,
//      Klick auf den Startpunkt schließt die Kontur und beendet den Linienzug.
// Start: python3 volme3d_server.py 8882 --dev  →  node tests/ortho_kanten_skizze_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8882/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof enterSketchMode === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); localStorage.setItem('v3d_umsteiger_hinweis', '1'); document.getElementById('umsteiger-hinweis')?.remove(); });

for (const ansicht of ['front', 'top', 'iso']) {
  await pg.evaluate(a => { _newCreate(false); addShape('box'); selectObjs([objects[0]]); setView(a); }, ansicht);
  await pg.click('#fp button:has-text("Kanten bearbeiten")'); await pg.waitForTimeout(250);
  const ziel = await pg.evaluate(() => {
    const E = _edgeObj.userData._dynamicEdges; let best = null;
    for (const e of E) { const m = new THREE.Vector3(...e.worldA).add(new THREE.Vector3(...e.worldB)).multiplyScalar(0.5); const d = m.distanceTo(camera.position); if (!best || d < best.d) best = { d, m }; }
    const s = _worldToScreen(best.m.x, best.m.y, best.m.z), r = vpEl.getBoundingClientRect();
    return { x: s.x + r.left, y: s.y + r.top, griffeAus: getComputedStyle(document.querySelector('#dim-handles > *') || document.body).display === 'none' };
  });
  await pg.mouse.move(ziel.x, ziel.y, { steps: 5 }); await pg.mouse.click(ziel.x, ziel.y); await pg.waitForTimeout(250);
  const sel = await pg.evaluate(() => _edgeSel.size);
  ok(ansicht + ': Kante per Klick markiert', sel >= 1, { sel, griffeAus: ziel.griffeAus });
  const vor = await pg.evaluate(() => objects[0].geometry.attributes.position.count);
  await pg.fill('#fp-edge-mm', '2'); await pg.click('#fp-edge-apply');
  await pg.waitForFunction(n => objects[0] && objects[0].geometry.attributes.position.count !== n, vor, { timeout: 20000 }).catch(() => {});
  const nach = await pg.evaluate(() => objects[0].geometry.attributes.position.count);
  ok(ansicht + ': Rundung 2 mm angebracht', nach !== vor, [vor, nach]);
  for (let i = 0; i < 3; i++) { if (!(await pg.evaluate(() => _edgeMode))) break; await pg.keyboard.press('Escape'); await pg.waitForTimeout(150); }
  const zust = await pg.evaluate(() => ({ modus: _edgeMode, aus: document.getElementById('dim-handles').classList.contains('edge-pick') }));
  ok(ansicht + ': Kantenmodus beendet → Griffe wieder da', !zust.modus && !zust.aus, zust);
}

// Skizze: Dreieck aus Linien, zweiter Punkt bewusst 2 px neben dem Raster
await pg.evaluate(() => { _newCreate(false); enterSketchMode(); _skSetTool('line'); });
await pg.waitForTimeout(800);
const P = await pg.evaluate(() => [[0, 0], [2, 0], [1, 1.5]].map(([u, v]) => _skScreen(u, v)));
const schritte = [[P[0], 0], [P[1], 2], [P[2], 0], [P[0], 4]];
const log = [];
for (const [p, dx] of schritte) {
  await pg.mouse.move(p.x + dx, p.y + dx * 0.5, { steps: 15 }); await pg.waitForTimeout(120);
  await pg.mouse.click(p.x + dx, p.y + dx * 0.5); await pg.waitForTimeout(250);
  log.push(await pg.evaluate(() => ({ n: _sk.ents.length, pending: _sk.pending.length, last: _sk.ents.length ? _sk.ents[_sk.ents.length - 1].b : null })));
}
const L1 = await pg.evaluate(() => _sk.ents[0] && [_sk.ents[0].b.u, _sk.ents[0].b.v]);
ok('Skizze: waagerechte Linie rastet auf 20 mm', L1 && Math.abs(L1[0] - 2) < 1e-6 && Math.abs(L1[1]) < 1e-6, L1);
ok('Skizze: 3 Linien', log[3].n === 3, log.map(x => x.n));
ok('Skizze: Klick auf Startpunkt beendet den Linienzug', log[3].pending === 0, log[3]);
const ex = await pg.evaluate(() => { try { return typeof _skLoopsForExtrude === 'function' ? _skLoopsForExtrude().length : null; } catch (e) { return String(e); } });
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
