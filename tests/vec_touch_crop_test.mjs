// Regressionstest: Im Vektorisier-Dialog muss sich der Auswahlrahmen auch per
// Finger/Stift aufziehen lassen (vorher nur mousedown → am Touchscreen tot).
// Geprüft: Touch-Geste setzt den Ausschnitt, Maus weiterhin auch, ein
// abgebrochener Zeiger (pointercancel) verwirft den Rahmen ohne Ausschnitt,
// und touch-action wird nur während der Auswahl gesperrt.
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: true });
const pg = await ctx.newPage();
const fehler = [];
pg.on('pageerror', e => fehler.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window._vecOpen === 'function', { timeout: 60000 });

await pg.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 600; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 600);
  x.fillStyle = '#000'; x.fillRect(80, 80, 440, 440);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = c.toDataURL('image/png'); });
  window._vecOpen();
  window._vecUseImage(img, 'test');
});
await pg.waitForTimeout(400);

// Zeiger-Geste über der Leinwand; Anteile 0..1 der Leinwandfläche
const geste = (art, schritte, pointerType) => pg.evaluate(({ art, schritte, pointerType }) => {
  const cv = document.getElementById('vec-canvas'), r = cv.getBoundingClientRect();
  const mk = (typ, f) => new PointerEvent(typ, {
    bubbles: true, cancelable: true, pointerId: 7, pointerType, isPrimary: true, button: 0,
    clientX: r.left + r.width * f[0], clientY: r.top + r.height * f[1] });
  cv.dispatchEvent(mk('pointerdown', schritte[0]));
  for (const f of schritte.slice(1, -1)) window.dispatchEvent(mk('pointermove', f));
  window.dispatchEvent(mk(art, schritte[schritte.length - 1]));
}, { art, schritte, pointerType });

const zustand = () => pg.evaluate(() => ({
  crop: _vecP.crop ? { ..._vecP.crop } : null,
  sel: _vecSel, drag: !!_vecDrag,
  touchAction: document.getElementById('vec-canvas').style.touchAction }));

const probleme = [];
const rund = c => c && { x: +c.x.toFixed(2), y: +c.y.toFixed(2), w: +c.w.toFixed(2), h: +c.h.toFixed(2) };

// 1) Auswahl aktivieren → Scrollgeste muss gesperrt sein
await pg.evaluate(() => window._vecSelToggle());
const an = await zustand();
if (an.touchAction !== 'none') probleme.push(`touch-action während Auswahl: "${an.touchAction}" statt "none"`);

// 2) Finger-Geste zieht den Rahmen auf
await geste('pointerup', [[0.2, 0.2], [0.4, 0.4], [0.7, 0.6]], 'touch');
await pg.waitForTimeout(500);
const nachTouch = await zustand();
if (!nachTouch.crop) probleme.push('Finger-Geste hat keinen Ausschnitt gesetzt');
else {
  const c = rund(nachTouch.crop);
  if (Math.abs(c.x - 0.2) > 0.02 || Math.abs(c.y - 0.2) > 0.02 ||
      Math.abs(c.w - 0.5) > 0.02 || Math.abs(c.h - 0.4) > 0.02)
    probleme.push('Finger-Ausschnitt falsch: ' + JSON.stringify(c) + ' (soll x .2 y .2 w .5 h .4)');
}
if (nachTouch.sel) probleme.push('Auswahlmodus blieb nach der Geste an');
if (nachTouch.touchAction === 'none') probleme.push('touch-action blieb nach der Geste gesperrt');

// 3) Abgebrochener Zeiger verwirft den Rahmen, Auswahl bleibt an
await pg.evaluate(() => { window._vecCropClear(); window._vecSelToggle(); });
await pg.waitForTimeout(300);
await geste('pointercancel', [[0.1, 0.1], [0.3, 0.3], [0.8, 0.8]], 'touch');
const nachAbbruch = await zustand();
if (nachAbbruch.crop) probleme.push('pointercancel hat trotzdem einen Ausschnitt gesetzt');
if (nachAbbruch.drag) probleme.push('pointercancel hat den laufenden Rahmen nicht verworfen');
if (!nachAbbruch.sel) probleme.push('pointercancel hat den Auswahlmodus beendet');

// 4) Maus zieht weiterhin auf
await geste('pointerup', [[0.25, 0.3], [0.5, 0.5], [0.75, 0.8]], 'mouse');
await pg.waitForTimeout(500);
const nachMaus = await zustand();
if (!nachMaus.crop) probleme.push('Maus-Geste hat keinen Ausschnitt gesetzt');
else {
  const c = rund(nachMaus.crop);
  if (Math.abs(c.x - 0.25) > 0.02 || Math.abs(c.w - 0.5) > 0.02 || Math.abs(c.h - 0.5) > 0.02)
    probleme.push('Maus-Ausschnitt falsch: ' + JSON.stringify(c) + ' (soll x .25 w .5 h .5)');
}

console.log('nach Touch :', JSON.stringify(nachTouch));
console.log('nach Abbruch:', JSON.stringify(nachAbbruch));
console.log('nach Maus  :', JSON.stringify(nachMaus));
await b.close();

if (fehler.length) probleme.push('Seitenfehler: ' + fehler.join(' | '));
if (probleme.length) { console.error('FEHLGESCHLAGEN:\n- ' + probleme.join('\n- ')); process.exit(1); }
console.log('OK — Rahmen lässt sich per Finger, Stift und Maus aufziehen');
