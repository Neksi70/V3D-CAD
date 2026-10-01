// Aufmaß beim Abziehen: Füllen → ⊖ Abziehen → Dialog (mm / %) → Tasche nachmessen.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8919;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd(), stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [], logs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => logs.push(m.text().slice(0, 160)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  hideStarter();
  window._tSetup = (shape, n, mark) => {
    _newCreate(false);
    addShape('box'); const plate = objects[objects.length-1];
    let b = getMeshBox(plate);
    plate.scale.x *= 20 / (b.max.x - b.min.x); plate.scale.z *= 12 / (b.max.z - b.min.z); plate.scale.y *= 1 / (b.max.y - b.min.y);
    plate.position.y += 0 - getMeshBox(plate).min.y; plate.updateMatrixWorld(true);
    addShape(shape); const part = objects[objects.length-1];
    b = getMeshBox(part);
    part.scale.x *= 3 / (b.max.x - b.min.x); part.scale.z *= 2 / (b.max.z - b.min.z);
    part.updateMatrixWorld(true);
    if (mark) { part.userData.isHole = true; }
    selectObjs([plate, part]);
    _applyFillPlate(3, 5, false, n, true, 4);
    objects.forEach(o => { if (o !== plate) o.userData.isHole = true; });
    selectObjs(objects.slice());
  };
  // Tasche vermessen: Ecken auf Höhe des Taschenbodens (Oberseite − Tiefe)
  window._tPocket = () => {
    const o = objects[0]; o.updateMatrixWorld(true);
    const bb = getMeshBox(o), pos = o.geometry.attributes.position, v = new THREE.Vector3();
    let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9, yFloor = null, ys = new Set();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      ys.add(Math.round(v.y * 1000) / 100);
      if (v.y > bb.min.y + 0.01 && v.y < bb.max.y - 0.01) { yFloor = v.y; x0=Math.min(x0,v.x); x1=Math.max(x1,v.x); z0=Math.min(z0,v.z); z1=Math.max(z1,v.z); } }
    return { objs: objects.length, w: +((x1-x0)*10).toFixed(2), d: +((z1-z0)*10).toFixed(2),
             tiefe: yFloor == null ? null : +((bb.max.y - yFloor)*10).toFixed(2), ys: [...ys].sort((a,b)=>a-b).slice(0,6) };
  };
});
const run = async (shape, n, val, unit) => {
  await page.evaluate(([s, n]) => _tSetup(s, n), [shape, n]);
  page.evaluate(() => subtractHoles());
  await page.waitForSelector('#fit-dialog', { timeout: 5000 });
  const txt = await page.evaluate(() => document.querySelector('#fit-dialog').innerText.slice(0, 60));
  await page.click(`#fit-dialog ._fit-unit[data-u="${unit}"]`);
  await page.fill('#fit-dialog ._fit-val', String(val));
  await page.click('#fit-dialog ._fit-ok');
  await page.waitForFunction(() => objects.length === 1, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  return { txt, ...(await page.evaluate(() => _tPocket())) };
};
const out = {};
try {
out.box_0    = await run('box', 1, 0, 'mm');     // erwartet 30 × 20, Tiefe 4
out.box_1mm  = await run('box', 1, 1, 'mm');     // erwartet 32 × 22, Tiefe 4
out.box_10p  = await run('box', 1, 10, '%');     // erwartet 33 × 22, Tiefe 4
out.cyl_1mm  = await run('cylinder', 1, 1, 'mm');// erwartet 32 × 22, Tiefe 4
out.box4_1mm = await run('box', 4, 1, 'mm');     // 4 Taschen, eine Platte
// Abbrechen lässt alles stehen
await page.evaluate(() => _tSetup('box', 2));
page.evaluate(() => subtractHoles());
await page.waitForSelector('#fit-dialog'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
out.abbruch = await page.evaluate(() => ({ objs: objects.length, dlg: !!document.getElementById('fit-dialog') }));
// Ohne Füllen: kein Dialog
await page.evaluate(() => { _newCreate(false); addShape('box'); addShape('box'); objects[0].scale.multiplyScalar(3); objects[1].userData.isHole = true; selectObjs(objects.slice()); subtractHoles(); });
await page.waitForTimeout(300);
out.ohneFuellenDialog = await page.evaluate(() => !!document.getElementById('fit-dialog'));
await page.waitForFunction(() => objects.length === 1, null, { timeout: 60000 }); await page.waitForTimeout(500);
// Undo nach Abziehen mit Aufmaß: Teile wieder in Originalgröße + Markierung noch da
await page.evaluate(() => _tSetup('box', 1));
page.evaluate(() => subtractHoles());
await page.waitForSelector('#fit-dialog'); await page.fill('#fit-dialog ._fit-val', '1'); await page.keyboard.press('Enter');
await page.waitForFunction(() => objects.length === 1, null, { timeout: 60000 }); await page.waitForTimeout(500);
out.undo = await page.evaluate(() => { undo(); const p = objects.find(o => o.userData.isHole); const b = p && getMeshBox(p);
  return { objs: objects.length, w: b && +((b.max.x-b.min.x)*10).toFixed(2), fillFit: p && !!p.userData.fillFit }; });
} catch (e) { out.FEHLER = String(e).slice(0, 300); out.stand = await page.evaluate(() => ({ objs: objects.map(o => (o.userData.name||'?') + (o.userData.isHole?'(B)':'')), dlg: !!document.getElementById('fit-dialog') })).catch(() => null); }
console.log(JSON.stringify({ ...out, errs, logs: logs.slice(-12) }));
await browser.close(); srv.kill();
