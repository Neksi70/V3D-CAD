// Zurueck-Weg und Projektverwaltung
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
const tab = () => p.evaluate(() => window._licht.S.tab);
const menu = () => p.evaluate(() => window._licht.menuOffen());

await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
// zweimal leeren: beim Entladen sichert die App noch einmal, das waere sonst ein Geist
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(300);

// Erster Start: Uebersicht
pruef('Erster Start zeigt die Projektuebersicht', await menu());
await p.click('#start button:has-text("Neues Projekt")');
await p.waitForTimeout(400);
pruef('Neues Projekt oeffnet Schritt 1', !(await menu()) && (await tab()) === 'raum');

// Projekt 1 benennen und ein paar Schritte gehen
await p.fill('#i_kunde', 'Kunde Eins');
await p.fill('#i_raum', 'Buero 1');
await p.waitForTimeout(1500);          // laufendes Sichern abwarten
await p.evaluate(() => { zeigeTab('leuchten'); });
await p.waitForTimeout(300);
await p.evaluate(() => { zeigeTab('messen'); });
await p.waitForTimeout(300);
pruef('Kopfzeile zeigt den Zurueck-Pfeil', (await p.textContent('#b_zurueck')) === '‹');

// Zurueck-Knopf geht Schritt fuer Schritt zurueck
await p.click('#b_zurueck');
await p.waitForTimeout(350);
pruef('Zurueck: Messen -> Leuchten', (await tab()) === 'leuchten', await tab());
await p.click('#b_zurueck');
await p.waitForTimeout(350);
pruef('Zurueck: Leuchten -> Raum', (await tab()) === 'raum', await tab());
pruef('In Schritt 1 wird daraus das Projektsymbol', (await p.textContent('#b_zurueck')) === '🗂️');

// Zurueck-Taste des Handys (Browser-Verlauf)
await p.evaluate(() => zeigeTab('energie'));
await p.waitForTimeout(300);
await p.goBack();
await p.waitForTimeout(400);
pruef('Zurueck-Taste des Handys wirkt', (await tab()) === 'raum', await tab());

// Aus Schritt 1 in die Uebersicht, zweites Projekt anlegen
await p.click('#b_zurueck');
await p.waitForTimeout(350);
pruef('Zurueck in Schritt 1 oeffnet die Uebersicht', await menu());
pruef('Menue-Knopf wird zum Schliesskreuz', (await p.textContent('#b_zurueck')) === '✕');
let liste = await p.evaluate(() => window._licht.alleProjekte());
pruef('Erstes Projekt ist gespeichert', liste.length === 1 && /Buero 1/.test(liste[0].titel),
      liste.map(x => x.titel).join(' | '));

await p.click('#start button:has-text("Neues Projekt")');
await p.waitForTimeout(400);
pruef('Neues Projekt startet leer', (await p.inputValue('#i_kunde')) === '' &&
      (await p.inputValue('#i_raum')) === '');
await p.fill('#i_raum', 'Halle 2');
await p.evaluate(() => { document.getElementById('i_L').value = '20';
  document.getElementById('i_L').dispatchEvent(new Event('input')); speichern(); });
await p.waitForTimeout(300);
liste = await p.evaluate(() => window._licht.alleProjekte());
pruef('Jetzt zwei Projekte', liste.length === 2, liste.map(x => x.titel).join(' | '));

// Zurueck ins erste Projekt wechseln
await p.evaluate(() => menuOeffnen());
await p.waitForTimeout(300);
const zeilen = await p.$$('.projzeile');
pruef('Uebersicht listet beide', zeilen.length === 2, zeilen.length);
await p.evaluate(() => {
  const alt = window._licht.alleProjekte().find(x => /Buero 1/.test(x.titel));
  window._licht.projektOeffnen(alt.id);
});
await p.waitForTimeout(500);
pruef('Altes Projekt wieder da', (await p.inputValue('#i_raum')) === 'Buero 1' &&
      (await p.inputValue('#i_kunde')) === 'Kunde Eins');
pruef('Halle 2 blieb erhalten', (await p.evaluate(() =>
  window._licht.alleProjekte().some(x => /Halle 2/.test(x.titel)))));

// Neu laden: App kommt im zuletzt geoeffneten Projekt hoch, ohne Uebersicht
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(500);
pruef('Nach Neuladen kein Startbildschirm', !(await menu()));
pruef('Zuletzt geoeffnetes Projekt ist aktiv', (await p.inputValue('#i_raum')) === 'Buero 1');

// Loeschen
await p.evaluate(() => menuOeffnen());
await p.waitForTimeout(250);

// Loeschknopf muss wirklich zu sehen sein (Klassennamen kollidieren leicht)
const knopf = await p.evaluate(() => {
  const w = document.querySelector('.projzeile .loeschen');
  if (!w) return null;
  const r = w.getBoundingClientRect(), st = getComputedStyle(w);
  return { breite: Math.round(r.width), deckkraft: st.opacity, sichtbar: st.visibility,
           obenAuf: (document.elementFromPoint(r.x + r.width/2, r.y + r.height/2) || {}).className };
});
pruef('Loeschknopf ist sichtbar und anklickbar',
  knopf && knopf.breite > 20 && parseFloat(knopf.deckkraft) > 0.9 &&
  knopf.sichtbar === 'visible' && /loeschen/.test(knopf.obenAuf || ''), JSON.stringify(knopf));

p.once('dialog', d => d.accept());
await p.evaluate(() => {
  const h = window._licht.alleProjekte().find(x => /Halle 2/.test(x.titel));
  window._licht.S.aktiv !== h.id && projektLoeschen(h.id);
});
await p.waitForTimeout(400);
liste = await p.evaluate(() => window._licht.alleProjekte());
pruef('Projekt geloescht', liste.length === 1, liste.map(x => x.titel).join(' | '));

await b.close();
if (fehler.length) { console.log('\nFEHLER:\n' + fehler.join('\n')); process.exit(1); }
console.log('\nProjekte und Zurueck ok.');
