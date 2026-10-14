// Headless-Durchlauf: Login, Lieferant, Rubrik, Artikel, Bestellung, Kunden-Import (CSV + XLSX)
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const [,, URL = 'http://127.0.0.1:8811/', PIN, CSV1, XLSX, OUT = '.'] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const fehler = []; p.on('pageerror', e => fehler.push(e.message));
p.on('dialog', d => d.accept());
await p.goto(URL);
await p.fill('#pin', PIN); await p.press('#pin', 'Enter');
await p.waitForSelector('#app:not([hidden])');

// Lieferant
await p.click('nav button[data-s=lieferanten]');
await p.click('text=+ Lieferant');
await p.fill('[data-k=name]', 'Stahlhandel Ruhr GmbH');
await p.fill('[data-k=ansprechpartner]', 'Herr Becker');
await p.check('#lrub input[value="1"]');
await p.click('#fdSpeichern');
await p.waitForSelector('text=Stahlhandel Ruhr GmbH');

// eigene Rubrik
await p.click('nav button[data-s=rubriken]');
await p.click('text=+ Rubrik');
await p.fill('[data-k=name]', 'Kupfer & Messing');
await p.click('#fdSpeichern');
await p.waitForSelector('.baum >> text=Kupfer & Messing');

// Artikel in Stahl › Bleche
await p.click('.baum >> text=Stahl');
await p.click('text=+ Artikel');
await p.fill('[data-k=name]', 'Stahlblech DC01');
await p.fill('[data-k=abmessung]', '2000×1000×2 mm');
await p.selectOption('[data-k=einheit]', 'Tafel');
await p.fill('[data-k=preis]', '48,50');
await p.selectOption('[data-k=lieferant_id]', { label: 'Stahlhandel Ruhr GmbH' });
await p.click('#fdSpeichern');
await p.waitForSelector('td >> text=Stahlblech DC01');

// Kunden-Import CSV (cp1252, Semikolon)
await p.click('nav button[data-s=kunden]');
await p.setInputFiles('#importDatei', CSV1);
await p.waitForSelector('text=Datensätze gefunden');
const zuord = await p.$$eval('select[data-i]', s => s.map(x => x.value));
console.log('CSV-Zuordnung:', zuord.join(','));
await p.click('.dfuss .btn.p');
console.log(await p.textContent('.ok'));
await p.click('text=Fertig');
// XLSX: aktualisiert 10002, legt 20001 an
await p.setInputFiles('#importDatei', XLSX);
await p.waitForSelector('text=Datensätze gefunden');
console.log('XLSX-Zuordnung:', (await p.$$eval('select[data-i]', s => s.map(x => x.value))).join(','));
await p.click('.dfuss .btn.p');
console.log(await p.textContent('.ok'));
await p.click('text=Fertig');
await p.screenshot({ path: OUT + '/kunden.png' });

// Bestellung mit Kunde + Artikel
await p.click('nav button[data-s=bestellungen]');
await p.click('text=+ Neuer Vorgang');
await p.fill('#b_kunde', '10001 · Müller Fahrzeugbau GmbH (Dortmund)');
await p.fill('#b_projekt', 'Foodtruck Ausbau');
await p.fill('#b_besteller', 'V. Isken');
await p.fill('#posBody tr:nth-child(1) input[list]', 'Stahlblech DC01 – 2000×1000×2 mm');
await p.press('#posBody tr:nth-child(1) input[list]', 'Tab');
await p.fill('#posBody tr:nth-child(1) td:nth-child(3) input', '4');
await p.press('#posBody tr:nth-child(1) td:nth-child(3) input', 'Tab');
await p.selectOption('#b_status', 'Bestellt');
console.log('Summe:', await p.textContent('#bSumme'), '| Lieferant:', await p.$eval('#b_lieferant_id', s => s.selectedOptions[0].text));
await p.screenshot({ path: OUT + '/bestellung.png' });
await p.click('.dfuss >> text=Speichern');
await p.waitForSelector('td >> text=E-2026-0001');
await p.click('nav button[data-s=uebersicht]');
await p.screenshot({ path: OUT + '/uebersicht.png' });
await p.click('nav button[data-s=rubriken]');
await p.screenshot({ path: OUT + '/rubriken.png' });
console.log('JS-Fehler:', fehler.length ? fehler : 'keine');
await b.close();
