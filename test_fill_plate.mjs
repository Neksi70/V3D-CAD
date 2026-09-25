// ▦ Platte füllen: Grundplatte + Teil → möglichst viele Kopien, gleiche Höhe, keine Überlappung,
// alle innerhalb der Platte (mit Randabstand). Danach Abziehen muss klappen.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8846;
const STL = process.env.STL || '/home/v3da/occt-debug/2026-09-25T14-48-41-805Z-sub-tool0.stl';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = []; page.on('console', m => logs.push(m.text())); page.on('pageerror', e => logs.push('PAGEERR ' + e));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.evaluate(([PW, PD]) => { hideStarter?.(); addShape('box'); const pl = objects[objects.length-1];
  pl.scale.set(PW/20, 1, PD/20); deselect(); selectedObjs.push(pl); _dropSelectedToGround(); }, [Number(process.env.PW||250), Number(process.env.PD||220)]);   // 250 × 220 × 20 mm
await page.setInputFiles('#fimport', STL);
await page.waitForTimeout(2500);
await page.evaluate(() => { if (document.getElementById('sz-modal').classList.contains('show')) _confirmSize(); });
await page.waitForTimeout(800);
await page.evaluate(() => { const pl = objects[0], part = objects[objects.length-1];
  const bb = getMeshBox(part); part.position.y += getMeshBox(pl).max.y - bb.min.y - 0.5; part.updateMatrixWorld(true);
  deselect(); selectedObjs.push(part); setObjMode('hole'); deselect(); selectObjs([pl, part]); });
// über den echten Knopf + Dialog
await page.click('button:has-text("▦ Füllen")');
await page.fill('#pat-fill-gap', process.env.GAP || '3'); await page.fill('#pat-fill-margin', '5');
if (process.env.NOROT) await page.uncheck('#pat-fill-rot');
await page.click('#pat-modal .btn.pri');
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const pl = objects[0], parts = objects.slice(1), pb = getMeshBox(pl);
  const ys = new Set(parts.map(o => getMeshBox(o).min.y.toFixed(4)));
  const inside = parts.every(o => { const b = getMeshBox(o); return b.min.x >= pb.min.x + 0.45 && b.max.x <= pb.max.x - 0.45 && b.min.z >= pb.min.z + 0.45 && b.max.z <= pb.max.z - 0.45; });
  // Überlappung exakt über Manifold: paarweise Schnittvolumen
  return { n: parts.length, holes: parts.every(o => o.userData.isHole), hoehen: [...ys], inside, bb: getMeshBox(parts[0]).getSize(new THREE.Vector3()).toArray().map(v => +(v*10).toFixed(1)) };
});
console.log(JSON.stringify(r)); console.log(logs.filter(l => /fill|PAGEERR/.test(l)).join('\n'));
const ov = await page.evaluate(async () => { const w = await _mfInit(); const ps = objects.slice(1).map(o => _mfFromSoup(w, _moldCollectTris(o)));
  let worst = 0; for (let i = 0; i < ps.length; i++) for (let j = i+1; j < ps.length; j++) worst = Math.max(worst, w.Manifold.intersection(ps[i], ps[j]).volume()); return worst; });
console.log('größte Überlappung mm³:', ov.toFixed(3));
await page.evaluate(() => { deselect(); setView('top'); fitToObjects(objects); });
await page.mouse.move(5,5); await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/claude-1000/-home-v3da/30fb767c-29bb-42d8-b218-07978e08748b/scratchpad/fill_' + (process.env.PW||250) + '.png' });
// danach abziehen
const t0 = Date.now(); await page.evaluate(() => { deselect(); selectObjs([...objects]); subtractHoles(); });
await page.waitForFunction(() => objects.length === 1, null, { timeout: 60000 }).catch(() => {});
console.log('Abziehen:', await page.evaluate(() => objects.length + ' Objekt(e), ' + _countTris(objects) + ' Dreiecke'), Date.now() - t0, 'ms');
await browser.close(); srv.kill();
process.exit(r.n > 1 && r.inside && r.hoehen.length === 1 && ov < 0.01 ? 0 : 1);
