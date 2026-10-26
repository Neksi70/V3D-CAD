// 🧩 True Nest: viele verschiedene Teile → nach echter Kontur auf die Platte(n),
// keine Überlappung (Manifold), alle innerhalb der Platte mit Randabstand,
// Höhe bleibt, Abbrechen stellt alles wieder her, Undo geht.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8871, N = Number(process.env.N || 20), ROT = process.env.ROT || '90', SECS = process.env.SECS || '4';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = []; page.on('console', m => logs.push(m.text())); page.on('pageerror', e => logs.push('PAGEERR ' + e));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.evaluate((N) => {
  hideStarter?.(); _newCreate(false);
  buildplateW = 300; buildplateH = 200; _plateRebuild();
  const types = ['star', 'heart', 'torus', 'box', 'cylinder', 'star', 'heart'];
  for (let i = 0; i < N; i++) {
    addShape(types[i % types.length]);
    const o = objects[objects.length - 1];
    const s = 1 + (i % 4) * 0.4;
    o.scale.set(s * (i % 3 ? 1 : 1.6), 0.5, s);
    o.rotation.y = i * 0.7;
    o.position.set((i % 6) * 6 - 15, 0, Math.floor(i / 6) * 6 - 9);
    o.updateMatrixWorld(true);
  }
  selectObjs([...objects]); _dropSelectedToGround(); deselect();
}, N);
const before = await page.evaluate(() => objects.map(o => [o.position.toArray(), o.quaternion.toArray()]));
// 1) Abbrechen stellt wieder her
await page.evaluate(() => selectObjs([...objects]));
await page.click('button:has-text("🧩 True Nest")');
await page.fill('#tn-time', '3');
await page.click('#tn-set .btn.pri');
await page.waitForTimeout(1500);
console.log('nach 1,5 s:', await page.evaluate(() => ({ tn: !!_tn, show: document.getElementById('tn-modal').className, run: document.getElementById('tn-run').style.display, st: document.getElementById('tn-state').textContent })), logs.filter(l => /truenest|PAGEERR|rror/.test(l)).join('\n'));
await page.click('#tn-run button:has-text("Abbrechen")');
const restored = await page.evaluate((b) => objects.every((o, i) => o.position.distanceTo(new THREE.Vector3(...b[i][0])) < 1e-9) && plateCount === 1 && !document.getElementById('tn-modal').classList.contains('show'), before);
console.log('Abbrechen stellt her:', restored);
// 2) richtig laufen lassen
await page.evaluate(() => selectObjs([...objects]));
await page.click('button:has-text("🧩 True Nest")');
await page.fill('#tn-time', SECS); await page.fill('#tn-gap', '2'); await page.fill('#tn-margin', '5');
await page.selectOption('#tn-rot', ROT);
const t0 = Date.now();
await page.click('#tn-set .btn.pri');
await page.waitForFunction(() => !document.getElementById('tn-modal').classList.contains('show'), null, { timeout: 120000 });
console.log('Dauer', Date.now() - t0, 'ms');
const r = await page.evaluate(() => {
  const W = buildplateW / 10, D = buildplateH / 10, mar = 0.5 - 0.06;
  let inside = true, maxX = -1e9;
  for (const o of objects) {
    const b = getMeshBox(o), k = _plateOf(o), cx = _plateCenterX(k);
    if (b.min.x < cx - W/2 + mar || b.max.x > cx + W/2 - mar || b.min.z < -D/2 + mar || b.max.z > D/2 - mar) inside = false;
    if (k === 0) maxX = Math.max(maxX, b.max.x);
  }
  const ys = new Set(objects.map(o => getMeshBox(o).min.y.toFixed(3)));
  return { n: objects.length, plates: plateCount, inside, ground: [...ys], usedMm: Math.round((maxX + W/2) * 10), info: [...document.querySelectorAll('.tn-line')].map(e => e.textContent) };
});
console.log(JSON.stringify(r));
const ov = await page.evaluate(async () => { const w = await _mfInit(); const ps = objects.map(o => _mfFromSoup(w, _moldCollectTris(o)));
  let worst = 0; for (let i = 0; i < ps.length; i++) for (let j = i+1; j < ps.length; j++) worst = Math.max(worst, w.Manifold.intersection(ps[i], ps[j]).volume()); return worst * 1000; });
console.log('größte Überlappung mm³:', ov.toFixed(3));
console.log(logs.filter(l => /truenest|PAGEERR|rror/.test(l)).join('\n'));
await page.evaluate(() => { deselect(); setView('top'); fitToObjects(objects); });
await page.mouse.move(5, 5); await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/tn/nest_' + ROT + '.png' });
// 3) Undo → alte Lage
const undone = await page.evaluate((b) => { undo(); return objects.every((o, i) => o.position.distanceTo(new THREE.Vector3(...b[i][0])) < 1e-6); }, before);
console.log('Undo stellt her:', undone);
await browser.close(); srv.kill();
process.exit(restored && undone && r.inside && r.ground.length === 1 && ov < 0.01 ? 0 : 1);
