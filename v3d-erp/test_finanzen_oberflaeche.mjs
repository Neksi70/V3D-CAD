// Klicktest Startseite/Mahnwesen/Zahlungsabgleich/Kundenpreise/Kennzeichen (Playwright), Testserver wie bei test_oberflaeche.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import fs from 'fs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1440,height:1000}, acceptDownloads:true}); const pg = await ctx.newPage();
const errs=[]; pg.on('pageerror', e=>errs.push('PAGE '+e.message)); pg.on('dialog', d=>d.accept());
const S = s => pg.locator('.seite.on ' + s); const out = {};
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .viz-svg');
out.diagramme = await S('.viz').count();
out.umsatzSaeulen = await S('.viz-svg path').count();
await S('.viz-hit').nth(11).hover(); out.tooltip = await pg.locator('#vizTip').innerText();
await S('.viz-tab').first().click(); out.tabelle = await S('.viz-tabelle:not([hidden]) tr').count();
await pg.screenshot({path:'/tmp/f_start.png', fullPage:true});
// Mahnwesen
await pg.goto(B+'#/mahnwesen'); await pg.waitForSelector('.seite.on #mwOk');
out.mahnVorschlag = (await S('#mwI tbody').innerText()).replace(/\s+/g,' ').slice(0,160);
await S('#mwOk').click(); await pg.waitForSelector('#dlg[open]');
const pdfLink = await pg.locator('#dBody a').first().getAttribute('href');
out.mahnPdf = await pg.evaluate(async h => { const r = await fetch(h); return [r.status, r.headers.get('content-type')]; }, pdfLink);
await pg.locator('#dFuss .btn').click();
await S('#mwR button').filter({hasText:'Mahnstufen'}).click(); await pg.waitForSelector('.seite.on .msN'); out.stufen = await S('.msN').count();
// Zahlungsabgleich
await pg.goto(B+'#/bank'); await pg.waitForSelector('.seite.on #bkF', {state:'attached'});
const csv = await pg.evaluate(async () => Array.from(new Uint8Array(await (await fetch('api/bank/beispiel.csv')).arrayBuffer())));
fs.writeFileSync('/tmp/beispiel.csv', Buffer.from(csv));
await S('#bkF').setInputFiles('/tmp/beispiel.csv'); await pg.waitForTimeout(1500);
out.importToast = await pg.locator('#toast').innerText();
out.offen = await S('#bkL tbody tr').count();
out.vorschlaege = await S('#bkL tbody tr td:nth-child(5)').allInnerTexts();
await pg.screenshot({path:'/tmp/f_bank.png', fullPage:true});
await S('#bkAlle').click(); await pg.waitForTimeout(1200); out.alle = await pg.locator('#toast').innerText();
await S('.bkIgn').first().click(); await pg.waitForTimeout(600); out.offenNach = await S('#bkL tbody tr').count();
// Kundenpreise im Kunden
await pg.goto(B+'#/adressen/kunde'); await pg.waitForSelector('.seite.on #al tr[data-id]');
await S('#al tr[data-id]').filter({hasText:'MUSTER ANTRIEB'}).click(); await pg.waitForSelector('.seite.on #aR');
await S('#ad .reiter button').filter({hasText:'Preise'}).click(); await pg.waitForTimeout(600);
out.kpZeilen = await S('#aR tbody tr[data-id]').count();
// Kennzeichen-Reiter + Filter
await S('#ad .reiter button').filter({hasText:'Kennzeichen'}).click(); await pg.waitForTimeout(500);
out.kzFelder = await S('#aR [data-kz]').count();
await S('#aKz').click(); await pg.selectOption('#kfF', {label:'Branche'}); await pg.waitForTimeout(100); await pg.selectOption('#kfW select', 'Maschinenbau');
await pg.locator('#dFuss .btn', {hasText:'Filtern'}).click(); await pg.waitForTimeout(600);
out.kzFilter = [await S('#aKz').innerText(), await S('#al tr[data-id]').count()];
// Preisfindung im Beleg
const kid = await pg.evaluate(async()=> (await (await fetch('api/adressen?rolle=kunde&suche=MUSTER')).json())[0].kundennr);
await pg.goto(B+'#/neu/AN'); await pg.waitForSelector('.seite.on #kKnr');
await S('#kKnr').fill(kid); await S('#kKnr').dispatchEvent('change'); await pg.waitForTimeout(300);
await S('#pt tr[data-i="0"] .pA').fill('300400'); await S('#pt tr[data-i="0"] .pA').dispatchEvent('change'); await pg.waitForTimeout(900);
out.preis1 = await S('#pt tr[data-i="0"] .pP').inputValue();
await S('#pt tr[data-i="0"] .pM').fill('3000'); await pg.waitForTimeout(1200);
out.preis3000 = [await S('#pt tr[data-i="0"] .pP').inputValue(), await pg.locator('#toast').innerText()];
await S('#pt tr[data-i="0"] .pM').fill('12000'); await pg.waitForTimeout(1200);
out.preis12000 = await S('#pt tr[data-i="0"] .pP').inputValue();
await S('#pt tr[data-i="0"] .pP').fill('0,55'); await S('#pt tr[data-i="0"] .pM').fill('500'); await pg.waitForTimeout(1200);
out.manuellBleibt = await S('#pt tr[data-i="0"] .pP').inputValue();
// Kennzeichen-Einrichtung
await pg.goto(B+'#/kennzeichen'); await pg.waitForSelector('.seite.on .kzN');
out.kzDefs = await S('.kzN').count();
await S('[data-o="artikel"] .kzNeu').click(); await S('[data-o="artikel"] .kzN').last().fill('Härte HV'); await S('[data-o="artikel"] .kzT').last().selectOption('zahl');
await S('[data-o="artikel"] .kzSp').click(); await pg.waitForTimeout(600); out.kzNeu = await S('[data-o="artikel"] .kzN').count();
// OP Mahnsperre
await pg.goto(B+'#/op/debitor'); await pg.waitForSelector('.seite.on table'); out.opKopf = await S('thead').innerText();
console.log(JSON.stringify({errs, ...out}, null, 1)); await b.close();
