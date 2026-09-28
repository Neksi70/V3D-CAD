// Oberflaechen-Test Bildmodus: stummes Video hochladen -> Galerie mit Bildern + Text.
// Aufruf: node tests/bild_ui_test.mjs [port|url] [video]
//   z. B. node tests/bild_ui_test.mjs https://v3da.tailf05fe9.ts.net/transkript  (Funnel)
//   Video erzeugen: python tests/testvideo.py /tmp/bmtest  (-> /tmp/bmtest/stumm.mp4)
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import fs from 'fs';

const PORT = process.argv[2] || '8792';
const DATEI = process.argv[3] || '/tmp/bmtest/stumm.mp4';
const CODE = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url))).code || '';
const URL_ = /^https?:/.test(PORT) ? PORT : `http://127.0.0.1:${PORT}/`;

const pruefe = (bed, text) => {
  console.log((bed ? '  OK   ' : '  FEHL ') + text);
  if (!bed) process.exitCode = 1;
};

const browser = await chromium.launch();
const seite = await browser.newPage({ viewport: { width: 420, height: 900 } });   // Handy
const fehlerLog = [];
seite.on('pageerror', e => fehlerLog.push(String(e)));
seite.on('console', m => { if (m.type() === 'error' && !/status of 40[13]/.test(m.text())) fehlerLog.push(m.text()); });

await seite.goto(URL_, { waitUntil: 'networkidle' });
if (await seite.isVisible('#tor')) {
  await seite.fill('#code', CODE);
  await seite.click('button:has-text("Weiter")');
  await seite.waitForSelector('#tor', { state: 'hidden', timeout: 10000 });
}

pruefe(await seite.isVisible('#modus'), 'Modus-Auswahl sichtbar');
pruefe(await seite.isChecked('#ocr'), 'OCR standardmaessig an');
pruefe(!(await seite.isChecked('#entzerren')), 'Entzerren standardmaessig aus');
await seite.click('details.fein summary');
await seite.fill('#bMax', '20');

await seite.setInputFiles('#datei', DATEI);
await seite.waitForSelector('#laufKarte:not(.weg)', { timeout: 20000 });
pruefe(true, 'Fortschrittskarte erscheint');
await seite.waitForSelector('#bildKarte:not(.weg)', { timeout: 300000 });
pruefe(await seite.isHidden('#ergKarte'), 'Text-Ergebniskarte bleibt zu');

const eintraege = await seite.$$('.bildeintrag');
pruefe(eintraege.length >= 6, `${eintraege.length} Bilder in der Galerie`);
await seite.waitForFunction(() => [...document.querySelectorAll('.bildeintrag img')]
  .every(i => { i.scrollIntoView(); return i.complete && i.naturalWidth > 0; }), null, { timeout: 30000 });
const breiten = await seite.$$eval('.bildeintrag img', l => l.map(i => i.naturalWidth));
pruefe(breiten.every(b => b > 0 && b <= 1280), 'alle Bilder geladen, max. 1280 px: ' + breiten.join(','));
const info = await seite.textContent('#bildInfo');
console.log('  Info: ' + info);
pruefe(/Bilder/.test(info) && /keine Tonspur/.test(info), 'Info nennt Anzahl und Grund');
const erster = await seite.textContent('.bildeintrag:first-child');
pruefe(/Bild 1/.test(erster) && /00:00:00/.test(erster), 'Kopf mit Nummer und Zeit');
if (/ohne Texterkennung/.test(info)) {             // Server ohne Tesseract
  const hinweis = await seite.textContent('#bildHinweise');
  pruefe(/Texterkennung übersprungen/.test(hinweis) && /tesseract/i.test(hinweis),
         'ohne Tesseract: Hinweis mit Installationsanleitung sichtbar');
} else {
  const texte = await seite.$$eval('.bildeintrag pre', l => l.map(p => p.textContent).join('\n'));
  pruefe(/Schritt 4/.test(texte), 'OCR-Text unter den Bildern');
}
pruefe(await seite.isVisible('button:has-text("ZIP für Claude")'), 'ZIP-Knopf da');

const [download] = await Promise.all([seite.waitForEvent('download'),
                                      seite.click('button:has-text("ZIP für Claude")')]);
pruefe(/_bildprotokoll\.zip$/.test(download.suggestedFilename()), 'ZIP-Download: ' + download.suggestedFilename());

await seite.screenshot({ path: '/tmp/bildmodus_ui.png', fullPage: false });
const liste = await seite.textContent('#liste');
pruefe(liste.includes('🖼'), 'Liste markiert Bildmodus-Job');

// aufraeumen: den eben angelegten Job loeschen
await seite.click('.job:first-child button');
await seite.waitForTimeout(800);
pruefe(await seite.isHidden('#bildKarte'), 'Loeschen blendet Galerie aus');

pruefe(fehlerLog.length === 0, 'keine JS-Fehler' + (fehlerLog.length ? ': ' + fehlerLog.join(' | ') : ''));
await browser.close();
