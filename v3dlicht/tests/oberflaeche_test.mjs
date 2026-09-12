// Prueft die Handy-Bedienung: Startkarte, Regler, Klebeleiste, Wischen, App-Dateien
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

// Begruessung erscheint beim ersten Besuch und verschwindet nach der Wahl
pruef('Startkarte beim ersten Besuch', await p.isVisible('#start'));
await p.click('text=Neuen Raum planen');
await p.waitForTimeout(450);
pruef('Startkarte weg nach Auswahl', !(await p.isVisible('#start')));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);
pruef('Begruessung kommt nicht jedes Mal', !(await p.isVisible('#start')));

// Schieberegler zieht die Rechnung mit
await p.evaluate(() => zeigeTab('raum'));
const vorher = await p.evaluate(() => window._licht.S.ergebnis.A);
await p.evaluate(() => { const r = document.getElementById('r_L');
  r.value = '12'; r.dispatchEvent(new Event('input')); });
await p.waitForTimeout(250);
const nachher = await p.evaluate(() => window._licht.S.ergebnis.A);
pruef('Regler aendert die Grundflaeche', nachher > vorher * 1.5, `${vorher} -> ${nachher} m²`);
pruef('Zahlenfeld folgt dem Regler', (await p.inputValue('#i_L')) === '12');
// und umgekehrt
await p.fill('#i_L', '7');
await p.waitForTimeout(250);
pruef('Regler folgt dem Zahlenfeld', (await p.inputValue('#r_L')) === '7');

// Mitlaufende Ergebniszeile im Leuchten-Blatt
await p.evaluate(() => zeigeTab('leuchten'));
await p.waitForTimeout(400);
const klebe1 = await p.textContent('#kl_anz');
await p.click('.lampitem:nth-of-type(3)');
await p.waitForTimeout(700);
const klebe2 = await p.textContent('#kl_anz');
const typ = await p.textContent('#kl_typ');
pruef('Ergebniszeile reagiert auf Leuchtenwahl', klebe1 !== klebe2 || typ.length > 3,
      `${klebe1} -> ${klebe2} (${typ})`);
pruef('Ergebniszeile klebt oben', await p.evaluate(() =>
  getComputedStyle(document.getElementById('klebe')).position === 'sticky'));
pruef('Lampenreihe zeigt jede Leuchte', await p.evaluate(() =>
  document.querySelectorAll('#lampenreihe span').length === Math.min(40, window._licht.S.ergebnis.n)));

// Wischen wechselt den Schritt
await p.evaluate(() => zeigeTab('raum'));
await p.waitForTimeout(300);
const mitte = { x: 195, y: 430 };
await p.touchscreen.tap(mitte.x, mitte.y).catch(() => {});
await p.evaluate(() => {
  const los = new Touch({ identifier: 1, target: document.body, clientX: 300, clientY: 420 });
  const ziel = new Touch({ identifier: 1, target: document.body, clientX: 80, clientY: 425 });
  document.dispatchEvent(new TouchEvent('touchstart', { touches: [los], changedTouches: [los], bubbles: true }));
  document.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [ziel], bubbles: true }));
});
await p.waitForTimeout(400);
pruef('Wischen nach links = naechster Schritt', await p.isVisible('#s-leuchten'),
      await p.evaluate(() => window._licht.S.tab));

// Fortschrittsbalken und Erledigt-Punkte
const breite = await p.evaluate(() => document.querySelector('#fortschritt i').style.width);
pruef('Fortschrittsbalken wandert mit', breite.startsWith('28'), breite);

// Dateien fuer "Zum Startbildschirm hinzufuegen"
for (const [datei, muster] of [['manifest.webmanifest', /"short_name": "V3D Licht"/],
                               ['icon.svg', /<svg/], ['sw.js', /caches/]]) {
  const r = await p.request.get(`http://127.0.0.1:${PORT}/${datei}`);
  pruef('App-Datei ' + datei, r.ok() && muster.test(await r.text()), r.status());
}

await b.close();
if (fehler.length) { console.log('\nFEHLER:\n' + fehler.join('\n')); process.exit(1); }
console.log('\nOberflaeche ok.');
