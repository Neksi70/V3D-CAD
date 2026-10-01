// ▦ Füllen mit fester Anzahl: genau n Teile, gleichmäßig = mittig + weiter Abstand,
// dicht = ab der Ecke; zu viele gewünscht → so viele wie passen. Auch über den Dialog.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8917;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd(), stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);
await page.evaluate(() => hideStarter());

const res = await page.evaluate(() => {
  const out = {};
  const setup = () => {
    _newCreate(false);
    addShape('box'); const plate = objects[objects.length-1];
    let b = getMeshBox(plate);
    plate.scale.x *= 20 / (b.max.x - b.min.x); plate.scale.z *= 12 / (b.max.z - b.min.z); plate.scale.y *= 0.3 / (b.max.y - b.min.y);
    plate.position.set(0, 0.15, 0); plate.updateMatrixWorld(true);
    addShape('box'); const part = objects[objects.length-1];
    b = getMeshBox(part);
    part.scale.x *= 3 / (b.max.x - b.min.x); part.scale.z *= 2 / (b.max.z - b.min.z);
    part.position.set(0, 2, 0); part.updateMatrixWorld(true);
    selectObjs([plate, part]);
    return plate;
  };
  const info = (plate) => {
    const pb = getMeshBox(plate), parts = objects.filter(o => o !== plate);
    let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9, inside = true, overlap = false;
    const bs = parts.map(o => getMeshBox(o));
    bs.forEach(b => { x0=Math.min(x0,b.min.x); x1=Math.max(x1,b.max.x); z0=Math.min(z0,b.min.z); z1=Math.max(z1,b.max.z);
      if (b.min.x < pb.min.x+0.49 || b.max.x > pb.max.x-0.49 || b.min.z < pb.min.z+0.49 || b.max.z > pb.max.z-0.49) inside = false; });
    for (let i=0;i<bs.length;i++) for (let j=i+1;j<bs.length;j++)
      if (bs[i].min.x < bs[j].max.x+0.29 && bs[j].min.x < bs[i].max.x+0.29 && bs[i].min.z < bs[j].max.z+0.29 && bs[j].min.z < bs[i].max.z+0.29) overlap = true;
    return { n: parts.length, inside, overlap,
      offX: +(((x0+x1)/2 - (pb.min.x+pb.max.x)/2)*10).toFixed(1), offZ: +(((z0+z1)/2 - (pb.min.z+pb.max.z)/2)*10).toFixed(1),
      spanX: +((x1-x0)*10).toFixed(1), spanZ: +((z1-z0)*10).toFixed(1) };
  };
  let p, t;
  p = setup(); _applyFillPlate(3, 5, true);            out.max   = info(p);
  for (const n of [1, 3, 4, 7]) { p = setup(); t = performance.now(); _applyFillPlate(3, 5, true, n, true); out['even'+n] = Object.assign(info(p), { ms: Math.round(performance.now()-t) }); }
  p = setup(); _applyFillPlate(3, 5, true, 4, false);  out.dense4 = info(p);
  p = setup(); _applyFillPlate(3, 5, true, 400, true); out.zuviel = info(p);
  // Undo stellt den Ausgangszustand wieder her
  p = setup(); _applyFillPlate(3, 5, true, 4, true); undo(); out.undoN = objects.length;
  return out;
});
// Dialog-Weg (Trigger-Pfad): Knopf → Feld → Anwenden
await page.evaluate(() => { _newCreate(false); addShape('box'); selectObjs([objects[0]]); fillPlateTool(); });
const evenHidden = await page.evaluate(() => document.getElementById('pat-fill-even-row').style.display);
await page.fill('#pat-fill-count', '3');
const evenShown = await page.evaluate(() => document.getElementById('pat-fill-even-row').style.display);
await page.click('#pat-modal .btn.pri');
await page.waitForTimeout(300);
const dlgN = await page.evaluate(() => objects.length);
console.log(JSON.stringify({ ...res, evenHidden, evenShown, dlgN, errs }, null, 1));
await browser.close(); srv.kill();
