// Prueft den Rechenkern gegen von Hand nachgerechnete Faelle.
import { chromium } from 'playwright';
const PORT = process.argv[2] || 8793;
const b = await chromium.launch();
const p = await b.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') fehler.push('CONSOLE: ' + m.text()); });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.evaluate(() => { const k = document.getElementById('start'); if (k) k.style.display = 'none'; });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.evaluate(() => { const k = document.getElementById('start'); if (k) k.style.display = 'none'; });

const pruef = (name, ist, soll, tol) => {
  const ok = Math.abs(ist - soll) <= tol;
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}: ${ist} (erwartet ${soll} ±${tol})`);
  if (!ok) fehler.push(name);
};

// Fall 1: Buero 6x4x2,75 m, Nutzebene 0,75 -> h=2,0; k=(24)/(2*10)=1,2
const e = await p.evaluate(() => { window._licht.rechne(); return window._licht.S.ergebnis; });
pruef('Raumindex k', +e.k.toFixed(3), 1.2, 0.001);
pruef('Flaeche', e.A, 24, 0.001);
pruef('Lichtpunkthoehe', e.hm, 2.0, 0.001);
// eta ~ 0.585 (breit, k=1.2, rho 0.7/0.5/0.2), phi = 500*24/(eta*0.8)
pruef('Raumwirkungsgrad', +(e.eta * 100).toFixed(0), 58, 3);
const phiErwartet = 500 * 24 / (e.eta * 0.8);
pruef('Lichtstrombedarf', Math.round(e.phiGes), Math.round(phiErwartet), 1);
// Auto-Modus rundet auf ein volles Raster auf, darf aber nie unter den Bedarf fallen
pruef('Anzahl deckt Bedarf', e.n >= Math.ceil(phiErwartet / 4000) ? 1 : 0, 1, 0);
pruef('Raster voll bestueckt', e.n, e.reihen * e.spalten, 0);
pruef('Uo Buero >= 0,6', e.karte.uo >= 0.6 ? 1 : 0, 1, 0);
console.log('     (Uo = ' + e.karte.uo.toFixed(2) + ', n = ' + e.n + ' als ' + e.reihen + 'x' + e.spalten + ')');
pruef('erreichte Ebar', Math.round(e.eIst), Math.round(e.n * 4000 * e.eta * 0.8 / 24), 1);
// Karte: Mittelwert der Punktrechnung muss in derselben Groessenordnung liegen
pruef('Karte vs Lichtstromverfahren (%)', Math.round(e.karte.bMittel / e.eIst * 100), 100, 25);
pruef('Uo plausibel', e.karte.uo > 0.3 && e.karte.uo <= 1 ? 1 : 0, 1, 0);

// Fall 2: Halle 30x20x8, Hallenstrahler
await p.selectOption('#i_nutz', 'halle');
await p.fill('#i_L', '30'); await p.fill('#i_B', '20'); await p.fill('#i_H', '8');
await p.evaluate(() => { window._licht.S.leuchte = 'highbay'; window._licht.rechne(); });
const h = await p.evaluate(() => window._licht.S.ergebnis);
// h_m = 8 - 0.85 = 7.15; k = 600/(7.15*50) = 1.678
pruef('Halle k', +h.k.toFixed(2), 1.68, 0.02);
pruef('Halle Leuchtenzahl > 0', h.n > 0 ? 1 : 0, 1, 0);
pruef('Halle W/m2 plausibel', h.pGes / h.A < 15 ? 1 : 0, 1, 0);

// Fall 3: Messprotokoll
await p.evaluate(() => {
  window._licht.S.punkte = [{n:'a',v:400},{n:'b',v:500},{n:'c',v:600}];
  document.getElementById('i_nutz').value = 'buero';
  window._licht.S.nutz = 'buero';
  window._licht.rechne();
});
const mit = await p.textContent('#k_mMittel');
const uo = await p.textContent('#k_mUo');
pruef('Messmittel 500 lx', parseInt(mit), 500, 0);
pruef('Mess-Uo 0,80', parseFloat(uo.replace(',', '.')), 0.8, 0.005);

// Canvas gezeichnet?
const gemalt = await p.evaluate(() => {
  const c = document.getElementById('mapC');
  const d = c.getContext('2d').getImageData(c.width/2, c.height/2, 1, 1).data;
  return d[0] + d[1] + d[2];
});
pruef('Lux-Karte gezeichnet', gemalt > 30 ? 1 : 0, 1, 0);

// Alle Reiter oeffnen (findet tote Verdrahtung)
for (const t of ['raum','leuchten','verteilung','messen','energie','elektro','bericht']) {
  await p.evaluate(t => zeigeTab(t), t);
  const sichtbar = await p.isVisible(`#s-${t}`);
  if (!sichtbar) fehler.push('Reiter ' + t + ' nicht sichtbar');
}
const bericht = await p.textContent('#berichtKurz');
pruef('Bericht gefuellt', bericht.length > 300 ? 1 : 0, 1, 0);
const stk = await p.textContent('#stueckliste');
pruef('Stueckliste mit Summe', /Brutto/.test(stk) ? 1 : 0, 1, 0);

await b.close();
if (fehler.length) { console.log('\nFEHLER:\n' + fehler.join('\n')); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
