// Handy-Ansicht: Layout, Bericht mit Grafiken, Druckansicht
import { chromium } from 'playwright';
const PORT = process.argv[2] || 8793;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
  hasTouch: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('PAGEERROR: ' + e.message));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.evaluate(() => { const k = document.getElementById('start'); if (k) k.style.display = 'none'; });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.evaluate(() => { const k = document.getElementById('start'); if (k) k.style.display = 'none'; });

// Waagerechtes Scrollen waere auf dem Handy ein Fehler
const ueberbreit = await p.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('Horizontaler Ueberstand:', ueberbreit, 'px');
if (ueberbreit > 2) fehler.push('Seite ist auf dem Handy zu breit: ' + ueberbreit + ' px');

for (const t of ['raum', 'leuchten', 'messen', 'bericht']) {
  await p.evaluate(x => zeigeTab(x), t);
  await p.waitForTimeout(150);
  const ue = await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ue > 2) fehler.push('Reiter ' + t + ' zu breit: ' + ue + ' px');
  await p.screenshot({ path: `/tmp/licht_handy_${t}.png`, fullPage: false });
}

// Bericht: Grafiken eingebettet?
const bilder = await p.evaluate(() => ({
  plan: (document.getElementById('b_plan').src || '').slice(0, 22),
  map: (document.getElementById('b_map').src || '').slice(0, 22)
}));
console.log('Berichtsgrafiken:', bilder.plan, '/', bilder.map);
if (!bilder.plan.startsWith('data:image/png')) fehler.push('Grundriss fehlt im Bericht');
if (!bilder.map.startsWith('data:image/png')) fehler.push('Lux-Karte fehlt im Bericht');

// Druckansicht: nur der Bericht darf sichtbar sein
await p.emulateMedia({ media: 'print' });
const sichtbar = await p.evaluate(() => [...document.querySelectorAll('section')]
  .filter(s => getComputedStyle(s).display !== 'none').map(s => s.id));
console.log('Im Druck sichtbar:', sichtbar.join(', '));
if (sichtbar.length !== 1 || sichtbar[0] !== 's-bericht') fehler.push('Druckansicht falsch: ' + sichtbar);
const navWeg = await p.evaluate(() => getComputedStyle(document.querySelector('nav')).display);
if (navWeg !== 'none') fehler.push('Reiterleiste wird mitgedruckt');
await p.pdf && await p.pdf({ path: '/tmp/licht_bericht.pdf', format: 'A4' }).catch(() => {});
await p.emulateMedia({ media: 'screen' });

// Speichern + Neuladen
await p.evaluate(() => zeigeTab('raum'));
await p.fill('#i_kunde', 'Elektro Testkunde');
await p.evaluate(() => { document.getElementById('i_L').value = '9';
  document.getElementById('i_L').dispatchEvent(new Event('input')); speichern(); });
await p.reload({ waitUntil: 'networkidle' });
await p.evaluate(() => { const k = document.getElementById('start'); if (k) k.style.display = 'none'; });
const kunde = await p.inputValue('#i_kunde');
const laenge = await p.inputValue('#i_L');
console.log('Nach Neuladen:', kunde, '/', laenge, 'm');
if (kunde !== 'Elektro Testkunde' || laenge !== '9') fehler.push('Projekt wurde nicht gespeichert');

await b.close();
if (fehler.length) { console.log('\nFEHLER:\n' + fehler.join('\n')); process.exit(1); }
console.log('\nHandy-Ansicht ok.');
