// Messraster im Grundriss: Antippen, Eintragen, Ueberschreiben, Rasterwechsel, Bericht
import { chromium } from 'playwright';
const PORT = process.argv[2] || 8793;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') fehler.push('CONSOLE: ' + m.text()); });
const pruef = (name, ok, info) => {
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${info !== undefined ? ': ' + info : ''}`);
  if (!ok) fehler.push(name);
};
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.evaluate(() => { localStorage.clear(); });
await p.reload({ waitUntil: 'networkidle' });
await p.evaluate(() => { const k = document.getElementById('start'); if (k) k.style.display = 'none'; });

// Raum 6 x 4 m, Buero, Randzone 0,5 m -> Bewertungsflaeche 5 x 3 m
await p.evaluate(() => { window._licht.S.punkte = []; zeigeTab('messen'); });
await p.waitForTimeout(400);
const r = await p.evaluate(() => window._licht.S.raster);
console.log('Raster:', r.nx, 'x', r.ny, 'Felder a', r.zx.toFixed(2), 'x', r.zy.toFixed(2), 'm');
pruef('Raster nach Norm gebaut', r.nx >= 2 && r.ny >= 2 && r.rand === 0.5);
pruef('Raster liegt in der Bewertungsflaeche',
  Math.abs(r.nx * r.zx - 5) < 0.01 && Math.abs(r.ny * r.zy - 3) < 0.01,
  `${(r.nx*r.zx).toFixed(2)} x ${(r.ny*r.zy).toFixed(2)} m`);

// Feld antippen: Klick in die Mitte des Raums muss ein mittiges Feld waehlen
await p.evaluate(() => document.getElementById('messC').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(250);
const kasten = await p.evaluate(() => {
  const c = document.getElementById('messC'), k = c.getBoundingClientRect();
  return { x: k.left, y: k.top, w: k.width, h: k.height };
});
await p.mouse.click(kasten.x + kasten.w / 2, kasten.y + kasten.h / 2);
await p.waitForTimeout(200);
const feldMitte = await p.evaluate(() => window._licht.S.feld);
const mitteErwartet = { ix: Math.floor(r.nx / 2), iy: Math.floor(r.ny / 2) };
pruef('Antippen waehlt das Feld unter dem Finger',
  Math.abs(feldMitte.ix - mitteErwartet.ix) <= 1 && Math.abs(feldMitte.iy - mitteErwartet.iy) <= 1,
  `${JSON.stringify(feldMitte)} (erwartet ~${JSON.stringify(mitteErwartet)})`);

// Von Hand eintragen
await p.evaluate(() => sensorWaehlen('hand'));
const eintragen = async wert => {
  await p.fill('#i_handWert', String(wert));
  await p.evaluate(() => punktMerken());
  await p.waitForTimeout(120);
};
await p.evaluate(() => { window._licht.S.feld = { ix: 0, iy: 0 }; });
await eintragen(300);
let m = await p.evaluate(() => window._licht.messungIn(0, 0));
pruef('Wert steht im Feld A1', m && m.v === 300, m && m.v);
pruef('Feld sprang weiter', await p.evaluate(() =>
  window._licht.S.feld.ix === 1 || window._licht.S.feld.iy === 1),
  await p.evaluate(() => window._licht.feldName(window._licht.S.feld.ix, window._licht.S.feld.iy)));

// Ueberschreiben statt doppeln
await p.evaluate(() => { window._licht.S.feld = { ix: 0, iy: 0 }; });
await eintragen(450);
m = await p.evaluate(() => window._licht.messungIn(0, 0));
const anzahl = await p.evaluate(() => window._licht.S.punkte.length);
pruef('Erneut messen ueberschreibt das Feld', m.v === 450 && anzahl === 1, `${m.v} lx, ${anzahl} Punkte`);

// Auswertung und Soll/Ist-Vergleich
for (const [ix, iy, v] of [[1,0,500],[2,0,520],[3,0,480]]) {
  await p.evaluate(f => { window._licht.S.feld = f; }, { ix, iy });
  await eintragen(v);
}
await p.waitForTimeout(700);            // Kennzahlen zaehlen hoch, erst danach ablesen
const mittel = await p.textContent('#k_mMittel');
const uo = await p.textContent('#k_mUo');
console.log('Ausgewertet:', mittel, '/ Uo', uo);
pruef('Mittelwert ueber die gemessenen Felder', parseInt(mittel) === Math.round((450+500+520+480)/4), mittel);
const urteil = await p.textContent('#messUrteil');
pruef('Vergleich mit der Berechnung erscheint', /Gegenüber der Berechnung/.test(urteil));
pruef('Offene Felder werden gezaehlt', /Feld(er)? offen/.test(urteil),
  (urteil.match(/noch \d+ Felder? offen/) || ['–'])[0]);
const zaehler = await p.textContent('#rasterZahl');
pruef('Zaehler in der Ueberschrift', zaehler.startsWith('4 / '), zaehler);

// Rasterweite aendern: gemessene Werte duerfen nicht verloren gehen
await p.selectOption('#i_rasterWeite', '1');
await p.waitForTimeout(300);
const r2 = await p.evaluate(() => window._licht.S.raster);
const erhalten = await p.evaluate(() => window._licht.S.punkte.filter(window._licht.punktFeld).length);
console.log('Nach Rasterwechsel:', r2.nx, 'x', r2.ny, '-', erhalten, 'Werte noch verortet');
pruef('Rasterweite wirkt', Math.abs(r2.zx - 1) < 0.3, r2.zx.toFixed(2) + ' m');
pruef('Messwerte ueberleben den Rasterwechsel', erhalten >= 3, erhalten + ' von 4');

// Bericht zeigt das Messraster
await p.evaluate(() => zeigeTab('bericht'));
await p.waitForTimeout(400);
const bild = await p.evaluate(() => ({ an: getComputedStyle(document.getElementById('b_mess')).display,
  src: (document.getElementById('b_mess').src || '').slice(0, 15) }));
pruef('Messraster steht im Bericht', bild.an !== 'none' && bild.src.startsWith('data:image'), bild.an);

await b.close();
if (fehler.length) { console.log('\nFEHLER:\n' + fehler.join('\n')); process.exit(1); }
console.log('\nMessraster ok.');
