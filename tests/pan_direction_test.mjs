// Regressionstest: Bauplatte verschieben (Pan) folgt dem Zeiger — Maus-Mitteltaste,
// Touchpad-Wischen und Zwei-Finger-Touch müssen alle in dieselbe Richtung laufen.
// Start: npm run dev (Port 8766). Exit-Code 1 bei gegenläufigem Pfad.
import { chromium } from 'playwright';
let fails = 0;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
await pg.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter(); document.getElementById('auth-overlay')?.classList.add('hidden'); addShape('box'); selectObjs([]); setView('iso'); });
const cr = await pg.evaluate(() => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
// Bildschirmposition des Weltursprungs (Plattenmitte)
const originScr = () => pg.evaluate(() => { const p = new THREE.Vector3(0, 0, 0).project(camera); const r = canvas.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; });
const settle = () => pg.waitForTimeout(600);
const report = (name, ptr, a, b2) => {
  const dx = b2.x - a.x, dy = b2.y - a.y;
  const same = (Math.sign(dx) === Math.sign(ptr.x) || !ptr.x) && (Math.sign(dy) === Math.sign(ptr.y) || !ptr.y);
  console.log((same ? '  OK   ' : 'FEHLER ') + name.padEnd(28), 'Zeiger', JSON.stringify(ptr), '→ Platte wandert', `dx=${dx.toFixed(0)} dy=${dy.toFixed(0)}`, same ? 'folgt dem Zeiger' : 'GEGENLÄUFIG');
  if (!same) fails++;
};
// 1) Maus-Pan: mittlere Taste, nach rechts + nach unten
{
  const a = await originScr();
  await pg.mouse.move(cr.x, cr.y); await pg.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 10; i++) await pg.mouse.move(cr.x + 20 * i, cr.y + 10 * i);
  await pg.mouse.up({ button: 'middle' }); await settle();
  report('Maus Mitteltaste', { x: 200, y: 100 }, a, await originScr());
}
await pg.evaluate(() => setView('iso')); await settle();
// 2) Touchpad-Wischen: Finger nach rechts/unten. Ein wheel-Delta > 0 heißt
// „nach rechts/unten SCROLLEN“ (Inhalt wandert nach links/oben) — beim
// natürlichen Scrollen (Mac, Windows-Präzisions-Touchpad) schicken Finger nach
// rechts/unten also deltaX/deltaY < 0. Die Platte muss wie Seiteninhalt den
// Fingern folgen. (Bis 1.18.74 prüfte der Test Delta > 0 = Finger rechts —
// dieselbe falsche Annahme wie der Code, darum blieb der Fehler grün.)
{
  const a = await originScr();
  await pg.evaluate((cr) => { for (let i = 0; i < 10; i++) canvas.dispatchEvent(new WheelEvent('wheel', { clientX: cr.x, clientY: cr.y, deltaX: -20, deltaY: -10, deltaMode: 0, bubbles: true, cancelable: true })); }, cr);
  await settle();
  report('Touchpad Finger rechts/unten', { x: 200, y: 100 }, a, await originScr());
}
await pg.evaluate(() => setView('iso')); await settle();
// 3) Zwei-Finger-Touch nach rechts + unten
{
  const a = await originScr();
  await pg.evaluate((cr) => {
    const mk = (id, x, y) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
    const fire = (type, list) => canvas.dispatchEvent(new TouchEvent(type, { touches: list, changedTouches: list, targetTouches: list, bubbles: true, cancelable: true }));
    fire('touchstart', [mk(1, cr.x - 40, cr.y)]);
    fire('touchstart', [mk(2, cr.x + 40, cr.y)]);
    for (let i = 1; i <= 10; i++) fire('touchmove', [mk(1, cr.x - 40 + 20 * i, cr.y + 10 * i), mk(2, cr.x + 40 + 20 * i, cr.y + 10 * i)]);
    fire('touchend', []);
  }, cr);
  await settle();
  report('Zwei-Finger-Touch', { x: 200, y: 100 }, a, await originScr());
}
await b.close();
console.log(fails ? `\n${fails} FEHLER` : '\nAlles grün.');
process.exit(fails ? 1 : 0);
