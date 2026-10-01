// ▦ Füllen mit fester Anzahl + „gleichmäßig": n Bohrungen sitzen in einem
// gleichmäßigen Raster (gleiche Teilung, Rand = halbe Teilung), symmetrisch zur Platte.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
const PORT = 8937;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, null, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);
await page.evaluate(() => hideStarter());

const res = await page.evaluate(() => {
  const run = (W, D, n, shape, dia) => {
    _newCreate(false);
    addShape(shape || 'box'); const plate = objects[objects.length-1];
    let b = getMeshBox(plate);
    plate.scale.x *= W/10 / (b.max.x - b.min.x); plate.scale.z *= D/10 / (b.max.z - b.min.z); plate.scale.y *= 0.5 / (b.max.y - b.min.y);
    plate.position.set(3, 0.25, -2); plate.updateMatrixWorld(true);
    addShape('cylinder'); const part = objects[objects.length-1];
    b = getMeshBox(part);
    part.scale.x *= (dia||10)/10 / (b.max.x - b.min.x); part.scale.z *= (dia||10)/10 / (b.max.z - b.min.z);
    part.position.set(0, 0.5, 0); part.updateMatrixWorld(true);
    part.userData.isHole = true;
    selectObjs([plate, part]);
    const t = performance.now();
    _applyFillPlate(3, 5, true, n, true);
    const pb = getMeshBox(plate);
    const pts = objects.filter(o => o !== plate).map(o => { const q = getMeshBox(o);
      return [ +(((q.min.x+q.max.x)/2 - pb.min.x)*10).toFixed(1), +(((q.min.z+q.max.z)/2 - pb.min.z)*10).toFixed(1) ]; })
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    return { ms: Math.round(performance.now() - t), pts: pts.map(p => p.join('/')).join('  ') };
  };
  const out = {};
  out['120x40 n3']  = run(120, 40, 3);
  out['40x120 n3']  = run(40, 120, 3);
  out['200x100 n3'] = run(200, 100, 3);
  out['100x100 n3'] = run(100, 100, 3);
  out['100x100 n4'] = run(100, 100, 4);
  out['200x100 n5'] = run(200, 100, 5);
  out['200x100 n6'] = run(200, 100, 6);
  out['120x40 n2']  = run(120, 40, 2);
  out['120x40 n1']  = run(120, 40, 1);
  out['rund100 n3'] = run(100, 100, 3, 'cylinder');
  out['rund100 n4'] = run(100, 100, 4, 'cylinder');
  out['60x20 n9 eng'] = run(60, 20, 9, 'box', 8);
  return out;
});
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(14), String(v.ms).padStart(5) + ' ms  ', v.pts);
const soll = { '120x40 n3': '27.5/20  60/20  92.5/20', '40x120 n3': '20/27.5  20/60  20/92.5', '200x100 n3': '47.5/50  100/50  152.5/50',
  '100x100 n3': '22.5/50  50/50  77.5/50', '100x100 n4': '31.7/31.7  68.3/31.7  31.7/68.3  68.3/68.3', '120x40 n2': '38.3/20  81.7/20', '120x40 n1': '60/20' };
const bad = Object.entries(soll).filter(([k, v]) => res[k].pts !== v).map(([k]) => k);
console.log('errs', errs, bad.length || errs.length ? 'FEHLER: ' + bad.join(', ') : 'OK');
process.exitCode = bad.length || errs.length ? 1 : 0;
await browser.close(); srv.kill();
