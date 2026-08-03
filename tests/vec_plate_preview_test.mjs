// Regressionstest: Das Häkchen „Auf Grundplatte legen" darf die Vorschau im
// Vektorisier-Dialog nicht verzerren. Ralf hat gemeldet, dass sich beim Anhaken
// die Proportionen ändern — Ursache war der Flex-Stretch der Leinwand.
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const fehler = [];
pg.on('pageerror', e => fehler.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window._vecOpen === 'function', { timeout: 60000 });

// Startauswahl liegt über allem (z-index 3600) — im Test wegklicken
await pg.evaluate(() => document.getElementById('start-modal')?.classList.remove('show'));

// Testbild: breit (2:1), damit eine Verzerrung sofort auffällt
await pg.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 400;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 400);
  x.fillStyle = '#000'; x.fillRect(120, 60, 560, 280);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = c.toDataURL('image/png'); });
  window._vecOpen();
  window._vecUseImage(img, 'test');
  window._vecTrace();
});
await pg.waitForTimeout(600);

const miss = () => pg.evaluate(() => {
  const r = document.getElementById('vec-canvas').getBoundingClientRect();
  return { w: r.width, h: r.height, seite: r.width / r.height };
});

const ohne = await miss();
await pg.evaluate(() => { const cb = document.getElementById('vc-plate'); cb.checked = true; cb.onchange(); });
await pg.waitForTimeout(700);
const mit = await miss();

console.log('ohne Grundplatte:', ohne);
console.log('mit  Grundplatte:', mit);

const soll = 2.0;
const pruef = (name, ist) => {
  const ab = Math.abs(ist - soll) / soll;
  console.log(`${ab < 0.02 ? '✓' : '✗'} ${name}: Seitenverhältnis ${ist.toFixed(3)} (soll ${soll})`);
  if (ab >= 0.02) fehler.push(`${name}: Seitenverhältnis ${ist.toFixed(3)} statt ${soll}`);
};
pruef('ohne Grundplatte', ohne.seite);
pruef('mit Grundplatte', mit.seite);
if (Math.abs(mit.w - ohne.w) > 1 || Math.abs(mit.h - ohne.h) > 1)
  fehler.push(`Vorschau springt beim Anhaken: ${ohne.w}x${ohne.h} → ${mit.w}x${mit.h}`);

// Hochformat: muss ebenfalls maßhaltig bleiben und in den Kasten passen
await pg.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 900;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 900);
  x.fillStyle = '#000'; x.fillRect(60, 90, 280, 720);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = c.toDataURL('image/png'); });
  window._vecUseImage(img, 'hoch');
  window._vecTrace();
});
await pg.waitForTimeout(700);
const hoch = await miss();
const kasten = await pg.evaluate(() => {
  const r = document.getElementById('vec-cvwrap').getBoundingClientRect();
  return { w: r.width, h: r.height };
});
console.log('Hochformat:', hoch, 'Kasten:', kasten);
if (Math.abs(hoch.seite - 400 / 900) / (400 / 900) >= 0.02)
  fehler.push(`Hochformat verzerrt: ${hoch.seite.toFixed(3)} statt ${(400 / 900).toFixed(3)}`);
if (hoch.h > kasten.h + 1 || hoch.w > kasten.w + 1)
  fehler.push(`Hochformat läuft aus dem Kasten: ${hoch.w}x${hoch.h} in ${kasten.w}x${kasten.h}`);

// Ausschnitt aufziehen: die Maus rechnet über getBoundingClientRect — der Rahmen
// muss dort landen, wo gezogen wurde (mittlere Hälfte quer wie hoch).
await pg.evaluate(() => window._vecSelToggle());
const r = await pg.evaluate(() => {
  const q = document.getElementById('vec-canvas').getBoundingClientRect();
  return { x: q.x, y: q.y, w: q.width, h: q.height };
});
await pg.mouse.move(r.x + r.w * 0.25, r.y + r.h * 0.25);
await pg.mouse.down();
await pg.mouse.move(r.x + r.w * 0.75, r.y + r.h * 0.75, { steps: 5 });
await pg.mouse.up();
await pg.waitForTimeout(600);
const crop = await pg.evaluate(() => _vecP.crop);
console.log('Ausschnitt:', crop);
for (const [k, soll2] of [['x', 0.25], ['y', 0.25], ['w', 0.5], ['h', 0.5]])
  if (!crop || Math.abs(crop[k] - soll2) > 0.02) fehler.push(`Ausschnitt ${k}=${crop && crop[k]} statt ${soll2}`);

await b.close();
if (fehler.length) { console.error('FEHLER:\n' + fehler.join('\n')); process.exit(1); }
console.log('OK — Vorschau bleibt maßhaltig');
