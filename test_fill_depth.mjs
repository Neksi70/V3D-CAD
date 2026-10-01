// ▦ Füllen mit Eintauchtiefe: Unterkante aller Teile = Plattenoberseite − Tiefe; leer = Höhe bleibt.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8918;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd(), stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  hideStarter();
  window._tSetup = () => {
    _newCreate(false);
    addShape('box'); const plate = objects[objects.length-1];
    let b = getMeshBox(plate);
    plate.scale.x *= 20 / (b.max.x - b.min.x); plate.scale.z *= 12 / (b.max.z - b.min.z); plate.scale.y *= 1 / (b.max.y - b.min.y);
    plate.position.y += 0 - getMeshBox(plate).min.y; plate.updateMatrixWorld(true);       // Platte 10 mm dick, Oberseite y=1
    addShape('box'); const part = objects[objects.length-1];
    b = getMeshBox(part);
    part.scale.x *= 3 / (b.max.x - b.min.x); part.scale.z *= 2 / (b.max.z - b.min.z);
    part.position.y += 3; part.updateMatrixWorld(true);
    selectObjs([plate, part]); window._tPlate = plate;
  };
  window._tInfo = () => { const top = getMeshBox(_tPlate).max.y;
    const d = objects.filter(o => o !== _tPlate).map(o => +((top - getMeshBox(o).min.y) * 10).toFixed(3));
    return { n: d.length, min: Math.min(...d), max: Math.max(...d) }; };
});
const out = {};
out.direkt4 = await page.evaluate(() => { _tSetup(); _applyFillPlate(3, 5, true, 4, true, 4); return _tInfo(); });
out.direkt0 = await page.evaluate(() => { _tSetup(); _applyFillPlate(3, 5, true, 0, true, 0); return _tInfo(); });
out.ohne    = await page.evaluate(() => { _tSetup(); const v = _tInfo(); _applyFillPlate(3, 5, true, 3, true); return { vorher: v.min, ...(_tInfo()) }; });
// Dialog-Weg
await page.evaluate(() => { _tSetup(); fillPlateTool(); });
out.info = await page.evaluate(() => document.getElementById('pat-fill-depth-info').textContent);
out.rowShown = await page.evaluate(() => document.getElementById('pat-fill-depth-row').style.display);
await page.fill('#pat-fill-count', '4'); await page.fill('#pat-fill-depth', '2.5');
await page.click('#pat-modal .btn.pri'); await page.waitForTimeout(300);
out.dialog = await page.evaluate(() => _tInfo());
// Druckplatte: Feld ausgeblendet, Höhe bleibt
await page.evaluate(() => { _newCreate(false); addShape('box'); selectObjs([objects[0]]); fillPlateTool(); });
out.bedRow = await page.evaluate(() => document.getElementById('pat-fill-depth-row').style.display);
await page.evaluate(() => _closePat());
console.log(JSON.stringify({ ...out, errs }));
await browser.close(); srv.kill();
