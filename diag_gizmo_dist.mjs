// Prueft den AUSGELIEFERTEN (minifizierten) Build: ueberlebt der Gizmo terser?
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
const PORT = 8797;
const srv = spawn('python3', ['volme3d_server.py', String(PORT)], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 1200));
const cookie = execFileSync('python3',
  ['-c', "import v3d_auth;print(v3d_auth.make_cookie('smoke','smoke@lokal'))"],
  { cwd: process.cwd(), encoding: 'utf8' }).trim();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/',
                        httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3500);
const rect = await page.evaluate(() => { const r = vpEl.getBoundingClientRect(); return { x: r.left, y: r.top }; });
const pt = await page.evaluate(async () => {
  const f = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const m = document.getElementById('start-modal'); if (m) m.classList.remove('show');
  const ov = document.getElementById('auth-overlay'); if (ov) ov.style.display = 'none';
  while (objects.length) { const o = objects.pop(); scene.remove(o); }
  addShape('box'); const B = objects[0]; B.position.set(0, B.position.y, 0);
  selectObjs([B]); setMode('select'); setSnapGrid(0);
  fitToObjects([B]); sph.r *= 1.9; sph.theta = 0.9; sph.phi = 1.05; sph2cam();
  await f();
  const g = _mg.group, d = _mgAxisVec('y').multiplyScalar(g.scale.x * 0.6);
  const w = g.position.clone().add(d);
  return { vis: g.visible, s: _worldToScreen(w.x, w.y, w.z), p: { x: B.position.x, y: B.position.y, z: B.position.z } };
});
const x = pt.s.x + rect.x, y = pt.s.y + rect.y;
await page.mouse.move(x, y);
const hover = await page.evaluate(() => _mg.hover);
await page.mouse.down();
const griff = await page.evaluate(() => _mg.drag ? _mg.drag.axis : null);
for (let i = 1; i <= 10; i++) await page.mouse.move(x, y - 130 * i / 10);
await page.mouse.up();
const after = await page.evaluate(() => { const o = objects[0]; return { x: o.position.x, y: o.position.y, z: o.position.z }; });
const dy = (after.y - pt.p.y) * 10, dx = Math.abs(after.x - pt.p.x) * 10, dz = Math.abs(after.z - pt.p.z) * 10;
console.log(`dist: sichtbar=${pt.vis} hover=${hover} griff=${griff} | ΔY=${dy.toFixed(1)}mm ΔX=${dx.toFixed(3)} ΔZ=${dz.toFixed(3)} | pageErrors=${errs.length}`);
if (errs.length) console.log(errs.slice(0, 3).join('\n'));
const ok = pt.vis && hover === 'y' && griff === 'y' && dy > 3 && dx < 0.001 && dz < 0.001 && errs.length === 0;
console.log('=>', ok ? 'OK ✓' : 'FEHLGESCHLAGEN ✗');
await browser.close(); srv.kill();
process.exit(ok ? 0 : 1);
