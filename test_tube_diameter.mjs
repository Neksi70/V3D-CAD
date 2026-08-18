// Prüft: Durchmesser-/Höhen-Regler eines Rotationskörpers wirken auf die FORM,
// auch wenn das Teil gedreht (liegend) ist. Bugmeldung Ralf: Ø-Schieber am
// liegenden Rohr veränderte die Länge.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8797;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);

const res = await page.evaluate(() => {
  const out = {};
  const localMM = o => { const v = _fpLocalSize(o); return { d: +(v.x*10).toFixed(2), h: +(v.y*10).toFixed(2) }; };

  // --- aufrechtes Rohr: Referenzverhalten darf sich nicht ändern ---
  addShape('tube'); const up = objects[objects.length-1];
  selectObjs([up]); updateFP();
  fpApplyDiameter(40); fpApplyDim('h', 60);
  out.upright = localMM(up);

  // --- liegendes Rohr (90° um Z gekippt) ---
  addShape('tube'); const t = objects[objects.length-1];
  t.rotation.set(0, 0, Math.PI/2); t.updateMatrixWorld(true);
  selectObjs([t]); _fpCurType = null; updateFP();
  out.panelBefore = {
    d: document.getElementById('fp-r').value,
    h: document.getElementById('fph').value,
    real: localMM(t)
  };
  fpApplyDiameter(30);
  out.afterDia = localMM(t);
  fpApplyDim('h', 80);
  out.afterHeight = localMM(t);
  out.panelAfter = { d: document.getElementById('fp-r').value, h: document.getElementById('fph').value };
  out.onPlate = +getMeshBox(t).min.y.toFixed(3);

  // --- liegender Zylinder: gleiche Prüfung ---
  addShape('cylinder'); const c = objects[objects.length-1];
  c.rotation.set(Math.PI/2, 0, 0); c.updateMatrixWorld(true);
  selectObjs([c]); _fpCurType = null; updateFP();
  fpApplyDiameter(25); fpApplyDim('h', 70);
  out.cylLying = localMM(c);
  return out;
});
await browser.close(); srv.kill();
console.log(JSON.stringify(res, null, 2));
