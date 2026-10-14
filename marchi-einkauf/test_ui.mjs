// Headless-Durchlauf (Handy-Größe): Telefonat per Text → KI → Speichern → Preisspiegel → Bestellen → Ersparnis,
// Anruf-Brücke, Altpreis-Import. NUR gegen eine Wegwerf-DB laufen lassen (legt Daten an, ruft die KI auf).
// node test_ui.mjs URL PIN altpreise.csv [ausgabeordner]
import { chromium, devices } from '/home/v3da/node_modules/playwright/index.mjs';
const [,, URL = 'http://127.0.0.1:8812/', PIN, ALT, OUT = '.'] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'] });
const p = await ctx.newPage();
const fehler = []; p.on('pageerror', e => fehler.push(e.message));
p.on('dialog', d => d.accept(d.type() === 'prompt' ? '600' : undefined));
const schritt = async (name) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/m-${name}.png` }); console.log('✓', name); };

await p.goto(URL);
await p.fill('#pin', PIN); await p.press('#pin', 'Enter');
await p.waitForSelector('#app:not([hidden])');
await p.click('nav button[data-s=start]');
await schritt('1-start');

// Telefonat eintragen (Text statt Sprache)
await p.click('.mikro-karte');
await p.fill('#memoText', 'Schweißtechnik Krämer, Ansprechpartner Herr Krämer, Telefon 0231 445566. Aluprofil 40 mal 40 mal 2 für 3,70 das Kilo ab 200 Kilo, Lieferzeit zwei Wochen, Fracht 45 Euro pauschal.');
await schritt('2-memo');
await p.click('#memoWeiter');
await p.waitForSelector('#mPos .posk', { timeout: 60000 });
await schritt('3-pruefen');
console.log('  Lieferant:', await p.inputValue('#m_lieferant'), '| Artikel:', await p.inputValue('#mPos [data-f=artikel]'), '| Preis:', await p.inputValue('#mPos [data-f=preis]'));
await p.click('#memoSpeichern');
await p.waitForSelector('text=Gespeichert', { timeout: 20000 });
await schritt('4-ergebnis');
console.log('  Urteil:', (await p.textContent('.urteil')).trim());
await p.click('.dfuss >> text=Fertig');

// Anruf-Brücke: so tun, als käme er nach 10 s Telefonat zurück
await p.evaluate(() => { const l = D.lieferanten.find(x => x.name.includes('Müller')); localStorage.setItem('me_anruf', JSON.stringify({lid: l.id, aid: D.artikel[0].id, t: Date.now() - 10000})); window.dispatchEvent(new Event('focus')); });
await p.waitForSelector('#dlg[open] .memo-mic');
console.log('  Nach Anruf:', (await p.textContent('#dlg h3')).trim());
await schritt('5-nach-anruf');
await p.click('#dlg .dkopf .x');

// Preisspiegel
await p.click('nav button[data-s=preise]');
await p.fill('#psuche', 'alu');
await p.click('#ptab tbody tr >> nth=0');
await p.waitForSelector('.rang');
await schritt('6-preisspiegel');
console.log('  Rangfolge:', (await p.$$eval('.rang', r => r.map(x => x.querySelector('b').textContent + ' ' + x.querySelector('.preis').childNodes[0].textContent))).join(' | '));
await p.click('.rang.best >> text=Bestellen');
await p.waitForSelector('#posBody tr');
console.log('  Bestellung:', (await p.textContent('#bSumme')).trim());
await schritt('7-bestellung');
await p.click('.dfuss >> text=Speichern');

// Ersparnis
await p.click('nav button[data-s=ersparnis]');
await p.waitForSelector('.groesse');
console.log('  Ersparnis:', (await p.$$eval('.groesse', g => g.map(x => x.textContent))).join(' / Bonus '));
await schritt('8-ersparnis');
await p.evaluate(() => window.scrollTo(0, 700));
await schritt('9-ersparnis-unten');

// Altpreise einlesen
await p.click('nav button[data-s=verwaltung]');
await p.click('.reiter >> text=Altpreise einlesen');
const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('text=Datei mit Altpreisen einlesen')]);
await fc.setFiles(ALT);
await p.waitForSelector('select[data-i]');
console.log('  Zuordnung:', (await p.$$eval('select[data-i]', s => s.map(x => x.value))).join(','));
await p.click('.dfuss >> text=Zeilen einlesen');
console.log(' ', (await (await p.waitForSelector('.ok')).textContent()).trim());
await p.click('.dfuss >> text=Fertig');
await schritt('10-altpreise');

// Desktop-Ansicht
const d = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
await d.goto(URL); await d.fill('#pin', PIN); await d.press('#pin', 'Enter'); await d.waitForSelector('#app:not([hidden])');
await d.click('nav button[data-s=ersparnis]'); await d.waitForSelector('.groesse'); await d.waitForTimeout(300);
await d.screenshot({ path: `${OUT}/d-ersparnis.png` });
await d.click('nav button[data-s=start]'); await d.waitForTimeout(400); await d.screenshot({ path: `${OUT}/d-start.png` });
console.log('JS-Fehler:', fehler.length ? fehler : 'keine');
await b.close();
