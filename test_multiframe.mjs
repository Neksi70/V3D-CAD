// Prüft, ob bei Mehrfach-Auswahl der kombinierte Rahmen (#rov) gezeichnet wird.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8793;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs=[]; page.on('pageerror', e=>errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);

const res = await page.evaluate(async () => {
  addShape('box'); await new Promise(r=>setTimeout(r,150));
  addShape('sphere'); await new Promise(r=>setTimeout(r,150));
  // zweite Box wegbewegen, damit die Box echte Ausdehnung hat
  objects[1].position.set(10,0,0);
  selectObjs([...objects]);
  // kombinierte BBox prüfen
  const b = new THREE.Box3(); selectedObjs.forEach(o=>b.union(getMeshBox(o)));
  const finite = ['x','y','z'].every(k=>Number.isFinite(b.min[k])&&Number.isFinite(b.max[k]));
  // Overlay zeichnen lassen + Frame zählen
  _doRepositionDimHandles();
  await new Promise(r=>setTimeout(r,50));
  const rov = document.getElementById('rov');
  const lines = rov ? rov.querySelectorAll('line').length : -1;
  // pro Objekt: ist die einzelne BBox endlich?
  const perObj = objects.map(o=>{ const x=getMeshBox(o); return { type:o.userData.type, finite: Number.isFinite(x.min.x)&&Number.isFinite(x.max.x) }; });
  return { count: selectedObjs.length, finite, bbmin:[b.min.x,b.min.y,b.min.z], bbmax:[b.max.x,b.max.y,b.max.z], lines, perObj };
});
await browser.close(); srv.kill();
console.log(JSON.stringify(res,null,2));
for (const e of errs.slice(0,5)) console.log('pageerror:', e.slice(0,140));
console.log(res.finite && res.lines>=12 ? '\n✓ Rahmen wird gezeichnet' : '\n✗ Rahmen fehlt (finite='+res.finite+', lines='+res.lines+')');
process.exit(0);
