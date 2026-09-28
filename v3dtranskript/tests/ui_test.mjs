// Oberflaechen-Test: anmelden, Datei hochladen, Transkript abwarten, Zeitmarken.
// Aufruf: node tests/ui_test.mjs [port] [datei]
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import fs from 'fs';

const PORT = process.argv[2] || '8792';
const DATEI = process.argv[3] || '/tmp/whatsapp_test.mp4';
const CODE = JSON.parse(fs.readFileSync('/home/v3da/v3dtranskript/config.json')).code || '';
const URL = `http://127.0.0.1:${PORT}/`;

const pruefe = (bed, text) => {
  console.log((bed ? '  OK   ' : '  FEHL ') + text);
  if (!bed) process.exitCode = 1;
};

const browser = await chromium.launch();
const seite = await browser.newPage();
const fehlerLog = [];
seite.on('pageerror', e => fehlerLog.push(String(e)));
seite.on('console', m => { const t = m.text();
  if (m.type() === 'error' && !/status of 40[13]/.test(t)) fehlerLog.push(t); });

await seite.goto(URL, { waitUntil: 'networkidle' });

const OFFEN = (await (await fetch(URL + 'api/ping')).json()).offen;
if (OFFEN) {
  await seite.waitForTimeout(800);
  pruefe(!(await seite.isVisible('#tor')), 'offener Betrieb: kein Zugangscode noetig');
} else {
// 1. falscher Code
await seite.fill('#code', 'quatsch');
await seite.click('button:has-text("Weiter")');
await seite.waitForTimeout(1600);
pruefe((await seite.textContent('#torFehler')).includes('stimmt nicht'), 'falscher Code wird abgewiesen');
pruefe(await seite.isVisible('#tor'), 'Tor bleibt zu');

// 2. richtiger Code
await seite.fill('#code', CODE);
await seite.click('button:has-text("Weiter")');
await seite.waitForSelector('#tor', { state: 'hidden', timeout: 10000 });
pruefe(true, 'Anmeldung mit richtigem Code');
}

// 3. Datei hochladen
await seite.setInputFiles('#datei', DATEI);
await seite.waitForSelector('#laufKarte:not(.weg)', { timeout: 20000 });
pruefe(true, 'Fortschrittskarte erscheint');

// 4. Ergebnis abwarten
await seite.waitForSelector('#ergKarte:not(.weg)', { timeout: 300000 });
const text = (await seite.textContent('#ergText')).trim();
console.log('  Text: ' + text.slice(0, 90) + ' ...');
pruefe(text.length > 40, 'Transkript hat Inhalt');
pruefe(/Donnerstag/i.test(text), 'erwartetes Wort "Donnerstag" gefunden');
const info = await seite.textContent('#ergInfo');
console.log('  Info: ' + info);
pruefe(/Wörter/.test(info), 'Wortzahl wird angezeigt');

// 5. Zeitmarken umschalten
await seite.click('#umschalter');
await seite.waitForTimeout(300);
const mitZeit = await seite.textContent('#ergText');
pruefe(/\d+:\d\d/.test(mitZeit), 'Zeitmarken erscheinen');
await seite.click('#umschalter');
await seite.waitForTimeout(300);
pruefe(!/^\s*\d+:\d\d/.test(await seite.textContent('#ergText')), 'Zeitmarken wieder aus');

// 6. Liste
await seite.waitForTimeout(1000);
const eintraege = await seite.$$('#liste .job');
pruefe(eintraege.length >= 1, `Liste zeigt ${eintraege.length} Eintrag/Eintraege`);

// 6b. Kopieren-Knopf (Zwischenablage)
await seite.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await seite.click('button:has-text("Kopieren")');
await seite.waitForTimeout(400);
const abl = await seite.evaluate(() => navigator.clipboard.readText());
pruefe(abl.includes('Donnerstag'), `Kopieren legt Text in die Zwischenablage (${abl.length} Zeichen)`);
pruefe((await seite.textContent('button:has-text("kopiert")')).includes('kopiert'), 'Kopier-Rueckmeldung');

// 7. Download .txt
const [dl] = await Promise.all([
  seite.waitForEvent('download', { timeout: 15000 }),
  seite.click('button:has-text(".txt")'),
]);
const pfad = await dl.path();
const inhalt = fs.readFileSync(pfad, 'utf8');
pruefe(inhalt.includes('Donnerstag'), `.txt-Download (${dl.suggestedFilename()}, ${inhalt.length} Zeichen)`);

// 8. nach Neuladen weiterhin drin
await seite.reload({ waitUntil: 'networkidle' });
await seite.waitForTimeout(800);
pruefe(!(await seite.isVisible('#tor')), OFFEN ? 'nach Neuladen weiter offen'
                                               : 'bleibt nach Neuladen angemeldet');

pruefe(fehlerLog.length === 0, 'keine JS-Fehler' + (fehlerLog.length ? ': ' + fehlerLog.join(' | ') : ''));
await browser.close();
console.log(process.exitCode ? '\nFEHLGESCHLAGEN' : '\nalles gut');
