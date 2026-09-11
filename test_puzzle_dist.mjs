// Puzzle-Generator gegen die AUSGELIEFERTE (minifizierte) App testen.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
const PORT = 8798;
const srv = spawn('python3', ['volme3d_server.py', String(PORT)], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 1200));
const sess = execFileSync('python3',
  ['-c', "import v3d_auth;print(v3d_auth.make_cookie('smoke','smoke@lokal'))"],
  { cwd: process.cwd(), encoding: 'utf8' }).trim();
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 40000 });
await page.waitForTimeout(4000);
const r = await page.evaluate(async () => {
  try { hideStarter(); } catch (e) {}
  const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300;
  const cx = cv.getContext('2d'); cx.fillStyle = '#1e88e5'; cx.fillRect(0, 0, 400, 300);
  cx.fillStyle = '#e53935'; cx.beginPath(); cx.arc(200, 150, 90, 0, 7); cx.fill();
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = cv.toDataURL('image/png'); });
  _pzlOpen(); _pzl.img = img; _pzl.dirty = true;
  Object.assign(_pzlP, { cols: 4, rows: 3, farben: 3, raster: 1.5 });
  _pzlSyncUI(); _pzlRefresh(true);
  await new Promise(r => setTimeout(r, 500));
  const before = objects.length;
  await _pzlCreate();
  for (let i = 0; i < 200 && objects.length === before; i++) await new Promise(r => setTimeout(r, 100));
  const g = objects[objects.length - 1], kids = g.children.filter(k => k.isMesh);
  let open = 0, tris = 0;
  for (const m of kids) {
    const pa = m.geometry.attributes.position.array, n = pa.length / 3; tris += n / 3;
    const K = 1e6, map = new Map();
    const vid = i => { const k = Math.round(pa[i*3]*K) + '_' + Math.round(pa[i*3+1]*K) + '_' + Math.round(pa[i*3+2]*K);
      let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } return id; };
    const em = new Map();
    for (let t = 0; t < n / 3; t++) { const v = [vid(t*3), vid(t*3+1), vid(t*3+2)];
      for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e+1)%3]; if (a === b) continue;
        const key = a < b ? a + '_' + b : b + '_' + a; em.set(key, (em.get(key) || 0) + 1); } }
    for (const c of em.values()) if (c !== 2) open++;
  }
  const ex = _build3mfBlob([g]);
  return { name: g.userData.name, pieces: kids.length, tris, open, mmu: kids[0].userData._mmuPaint,
           dbg: _pzl.dbg, mf3: { parts: ex.parts, colors: ex.colors } };
});
console.log('dist:', JSON.stringify(r));
console.log(errs.length ? 'FEHLER:\n' + errs.slice(0, 8).join('\n') : 'keine Konsolenfehler');
await browser.close();
srv.kill();
