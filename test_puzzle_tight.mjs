import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load', timeout: 40000 });
await page.waitForTimeout(3500);
await page.evaluate(() => { try { hideStarter(); } catch (e) {} });

await page.evaluate(async () => {
  const cv = document.createElement('canvas'); cv.width = 700; cv.height = 500;
  const cx = cv.getContext('2d');
  const g = cx.createLinearGradient(0, 0, 700, 500);
  g.addColorStop(0, '#1e88e5'); g.addColorStop(.5, '#fdd835'); g.addColorStop(1, '#43a047');
  cx.fillStyle = g; cx.fillRect(0, 0, 700, 500);
  cx.fillStyle = '#e53935'; cx.beginPath(); cx.arc(350, 250, 150, 0, 7); cx.fill();
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = cv.toDataURL('image/png'); });
  window.__img = img;
});

const check = async (label, cfg) => {
  const r = await page.evaluate(async (c) => {
    _pzlOpen();
    Object.assign(_pzlP, c.P);
    _pzl.img = c.photo ? window.__img : null; _pzl.ras = null; _pzl.dirty = true;
    _pzlSetForm(c.P.form || 'rect');
    _pzlSyncUI(); _pzlRefresh(true);
    await new Promise(r => setTimeout(r, 400));
    const before = objects.length, t0 = performance.now();
    await _pzlCreate();
    for (let i = 0; i < 600 && objects.length === before; i++) await new Promise(r => setTimeout(r, 100));
    const ms = performance.now() - t0;
    const g = objects[objects.length - 1];
    const kids = g.children.filter(k => k.isMesh && k.userData.name !== 'Tablett');
    const tray = g.children.find(k => k.isMesh && k.userData.name === 'Tablett');
    // Dichtheit ueber alle Teile (Tablett getrennt)
    let tris = 0, open = 0, over = 0, deg = 0, worst = null;
    for (const m of kids) {
      const pa = m.geometry.attributes.position.array, n = pa.length / 3;
      tris += n / 3;
      const K = 1e6, map = new Map();
      const vid = i => { const k = Math.round(pa[i*3]*K) + '_' + Math.round(pa[i*3+1]*K) + '_' + Math.round(pa[i*3+2]*K);
        let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } return id; };
      const em = new Map();
      for (let t = 0; t < n / 3; t++) {
        const v = [vid(t*3), vid(t*3+1), vid(t*3+2)];
        for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e+1)%3];
          if (a === b) { deg++; continue; }
          const key = a < b ? a + '_' + b : b + '_' + a; em.set(key, (em.get(key) || 0) + 1); } }
      let o = 0;
      for (const cnt of em.values()) { if (cnt === 1) { o++; open++; } else if (cnt > 2) over++; }
      if (o && !worst) worst = m.userData.name;
    }
    return { pieces: kids.length, tris: Math.round(tris), open, over, deg, worst, tray: !!tray, ms: Math.round(ms) };
  }, cfg);
  console.log(label.padEnd(26), JSON.stringify(r));
  return r;
};

await check('Foto 5x4 / 1,5mm', { photo: 1, P: { form: 'rect', cols: 5, rows: 4, w: 180, h: 120, farben: 5, raster: 1.5, spiel: .25, rahmen: 0 } });
await check('Foto 8x6 / 1,0mm', { photo: 1, P: { form: 'rect', cols: 8, rows: 6, w: 220, h: 160, farben: 6, raster: 1.0, spiel: .25, rahmen: 0 } });
await check('Foto Herz 6x5', { photo: 1, P: { form: 'herz', cols: 6, rows: 5, w: 180, h: 170, farben: 4, raster: 1.5, spiel: .3, rahmen: 0 } });
await check('Foto Oval 5x4 + Tablett', { photo: 1, P: { form: 'oval', cols: 5, rows: 4, w: 180, h: 130, farben: 4, raster: 2, spiel: .2, rahmen: 1 } });
await check('Winzig 12x12, 0 Spiel', { photo: 1, P: { form: 'rect', cols: 12, rows: 12, w: 120, h: 120, farben: 3, raster: 2, spiel: 0, rahmen: 0 } });
await check('Kein Foto, max Spiel', { photo: 0, P: { form: 'rect', cols: 4, rows: 3, w: 100, h: 80, spiel: .6, rahmen: 0 } });

console.log(errs.length ? 'FEHLER:\n' + errs.slice(0, 10).join('\n') : 'keine Konsolenfehler');
await browser.close();
