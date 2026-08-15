const { chromium } = require('playwright');
// Handy-Layout-Check: Wie gross erscheint Knoll in gaengigen Querformaten und
// verdeckt ihn ein Bedienknopf?  Aufruf: node test_mobile.js (Server auf 8773)
const FORMATE = [
  ['iPhone quer', 851, 393], ['Android quer', 915, 412],
  ['kleines Handy quer', 740, 360], ['Tablet quer', 1180, 820],
];
(async () => {
  const b = await chromium.launch();
  for (const [name, w, h] of FORMATE) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8773/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    // Level starten und Introfahrt der Kamera abwarten
    await page.evaluate(() => { const d = window._blDbg; d.level(0); d.G.introT = 0; for (let i = 0; i < 240; i++) d.step(); });
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const d = window._blDbg, C = window._CAM, p = d.G.player;
      const cv = document.getElementById('cv').getBoundingClientRect();
      const sc = cv.width / 960;
      const bw = 12 + 2 * p.mass, bh = 14 + 2 * p.mass;
      const cx = cv.x + (480 + (p.x - C.x) * C.z) * sc;
      const cy = cv.y + (216 + (p.y - C.y) * C.z) * sc;
      const fig = { x: cx - bw * C.z * sc / 2, y: cy - bh * C.z * sc, w: bw * C.z * sc, h: bh * C.z * sc };
      const treffer = [...document.querySelectorAll('.tb')].filter(el => {
        const q = el.getBoundingClientRect();
        return q.x < fig.x + fig.w && q.x + q.width > fig.x && q.y < fig.y + fig.h && q.y + q.height > fig.y;
      }).map(el => el.id);
      return { hoehe: Math.round(fig.h), yAnteil: +((fig.y + fig.h) / innerHeight).toFixed(2), treffer, zoom: +C.z.toFixed(2) };
    });
    console.log(`${name.padEnd(20)} Knoll ${String(r.hoehe).padStart(3)}px hoch, Füße bei ${(r.yAnteil * 100).toFixed(0)}% der Höhe, Zoom ${r.zoom}, verdeckt von: ${r.treffer.length ? r.treffer.join(',') : 'nichts'}`);
    await page.screenshot({ path: `/tmp/b_${name.split(' ')[0]}.png` });
    await ctx.close();
  }
  // Hochformat: dort soll der Dreh-Hinweis erscheinen
  const hoch = await b.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  const hp = await hoch.newPage();
  await hp.goto('http://127.0.0.1:8773/', { waitUntil: 'networkidle' });
  const st = await hp.evaluate(() => ({
    dreh: getComputedStyle(document.getElementById('turn')).display,
    knoepfe: getComputedStyle(document.getElementById('touch')).display,
  }));
  console.log(`${'Hochformat'.padEnd(20)} Dreh-Hinweis: ${st.dreh === 'flex' ? 'sichtbar' : 'FEHLT'}, Knöpfe: ${st.knoepfe}`);
  await b.close();
})();
