// Relief (Lithophane): war intern auf 360 Spalten gedeckelt und damit immer grob.
// Prüft: hohe Auflösung greift, wird an der Vorlage begrenzt, Vorschau bleibt
// flott, Erstellen nutzt die volle Auflösung.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8809;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  if (typeof hideStarter === 'function') hideStarter();
  const mk = (W, H) => new Promise((r, j) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
    cx.strokeStyle = '#000';
    for (let i = 0; i < 40; i++) { cx.lineWidth = 1 + (i % 4); cx.beginPath();
      cx.moveTo(20 + i * (W - 40) / 40, 40); cx.lineTo(20 + i * (W - 40) / 40, H - 40); cx.stroke(); }
    const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = cv.toDataURL();
  });
  const out = {};
  const tri = g => Math.round(g.attributes.position.count / 3);

  // Gute Vorlage: 900 px
  _litho.img = await mk(900, 990); _litho.aspect = 900 / 990;
  for (const r of [320, 900]) {
    _litho.p.res = r; _lithoSample();
    const t = performance.now(); const g = _buildLithoGeo(); const ms = Math.round(performance.now() - t);
    out['voll' + r] = { spalten: _litho.cols, dreiecke: tri(g), ms };
    g.dispose();
  }
  // Vorschau muss grob und schnell bleiben
  _litho.p.res = 900; _lithoSample();
  const tp = performance.now(); const gp = _buildLithoGeo(true); out.vorschau = {
    spalten: _litho.prev.cols, dreiecke: tri(gp), ms: Math.round(performance.now() - tp) }; gp.dispose();

  // Kleine Vorlage: darf nicht über ihre eigene Auflösung hinaus abgetastet werden
  _litho.img = await mk(260, 300); _litho.aspect = 260 / 300;
  _litho.p.res = 900; _lithoSample();
  out.kleineVorlage = { spalten: _litho.cols };

  // Erstellen nutzt die volle Auflösung
  _litho.img = await mk(900, 990); _litho.aspect = 900 / 990;
  _litho.p.res = 700; _lithoSample();
  const n0 = objects.length;
  _createLitho();
  await new Promise(r => setTimeout(r, 900));
  const o = objects[objects.length - 1];
  out.erstellt = { added: objects.length - n0, dreiecke: o && o.geometry ? tri(o.geometry) : -1 };
  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const ok =
  res.voll320.spalten === 320 &&
  res.voll900.spalten === 900 && res.voll900.dreiecke > 500000 &&   // früher bei 360 gedeckelt
  res.vorschau.spalten <= 240 && res.vorschau.ms < 200 &&           // Vorschau bleibt flott
  res.kleineVorlage.spalten === 260 &&                              // nicht über die Vorlage hinaus
  res.erstellt.added === 1 && res.erstellt.dreiecke > 300000;       // erstellt = volle Auflösung

console.log(ok ? '\n✅ Relief: fein statt grob, Vorschau bleibt flott' : '\n❌ Relief: Prüfung fehlgeschlagen');
await browser.close(); srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
