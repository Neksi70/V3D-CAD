// Klicktest der Oberfläche (Playwright). Testserver: V3D_ERP_DATEN=/tmp/erp-test python3 server.py 8820, dann: node test_oberflaeche.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch();
const pg = await b.newPage({ viewport:{width:1440,height:1000} });
const errs=[]; pg.on('pageerror', e=>errs.push('PAGE '+e.message)); pg.on('console', m=>{ if(m.type()==='error') errs.push('CON '+m.text()); });
pg.on('dialog', d=>d.accept());
const S = s => pg.locator('.seite.on ' + s);
const out={};
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kpis');
out.tabs1 = await pg.locator('#tabs .rt').allInnerTexts();
// Business-Suche
await pg.fill('#bs','Schweiß'); await pg.waitForSelector('#bsErg.auf a');
out.suche = (await pg.locator('#bsErg').innerText()).split('\n').slice(0,4).join(' | ');
await pg.locator('#bsErg a', {hasText:'P-26-'}).first().click(); await pg.waitForSelector('.seite.on #gi .r');
out.tabs2 = await pg.locator('#tabs .rt').allInnerTexts();
// Kunden über Menü
await pg.getByRole('link', {name:'Kunden', exact:true}).click(); await pg.waitForSelector('.seite.on #al tr[data-id]');
out.blaettern = await S('#aAnz').innerText();
await S('#aS').fill('muster'); await pg.waitForTimeout(500);
out.gefiltert = await S('#al tr[data-id]').count();
await S('#al tr[data-id]').first().click(); await pg.waitForSelector('.seite.on #aR');
out.detailReiter = await S('#ad .reiter').innerText();
// Daten ▾ → Belege
await pg.keyboard.press('Alt+d'); await S('#aDat .ddl button', ).filter({hasText:'Belege'}).click(); await pg.waitForTimeout(500);
out.belegeReiter = (await S('#aR').innerText()).split('\n').length;
// Aktionen ▾ → Neues Angebot (Kunde vorbelegt)
await S('#aAkt .btn').click(); await S('#aAkt .ddl button').filter({hasText:'Neues Angebot'}).click();
await pg.waitForSelector('.seite.on #kKnr'); await pg.waitForTimeout(400);
out.anschrift = (await S('#anschrift').innerText()).split('\n')[0];
out.tabs3 = await pg.locator('#tabs .rt').allInnerTexts();
// Positionen ▾ → Artikel suchen
await S('#pMn .btn').click(); await S('#pMn .ddl button').filter({hasText:'Artikel suchen'}).click();
await pg.fill('#asI','Adapter'); await pg.waitForTimeout(200); await pg.locator('#asL tr').first().click(); await pg.waitForTimeout(400);
out.pos1 = await S('#pt tr[data-i="0"] .pT').inputValue(); out.posAnzahl = await S('#pt tr').count();
// Details …
await S('#pt tr[data-i="0"] .pD').click(); out.details = (await pg.locator('#dBody').innerText()).replace(/\n/g,' | ').slice(0,160); await pg.locator('#dFuss .btn', {hasText:'Abbrechen'}).click();
// Memotext
await pg.keyboard.press('Alt+m'); await pg.fill('#memoT','Kunde will Liefertermin KW 48'); await pg.locator('#dFuss .btn', {hasText:'Speichern'}).click(); await pg.waitForTimeout(300);
// Alt+S speichern
await pg.keyboard.press('Alt+s'); await pg.waitForTimeout(1200);
out.nachSpeichern = await pg.locator('#tabs .rt.on').innerText();
// Verarbeiten
await S('#bVa').click(); await pg.waitForTimeout(1500);
out.verarbeitet = await pg.locator('#tabs .rt.on').innerText();
out.memoMarker = await S('#bMemo').innerText();
// Druckansicht
await pg.keyboard.press('Alt+a'); await pg.waitForSelector('#dlg[open] iframe.pdf-vorschau'); out.druckansicht = await pg.locator('#dlg iframe.pdf-vorschau').getAttribute('src'); await pg.locator('#dFuss .btn', {hasText:'Schließen'}).click();
// Zurück zum Kunden-Reiter: Auswahl bleibt erhalten
await pg.locator('#tabs .rt', {hasText:'Kunden'}).click(); await pg.waitForTimeout(300);
out.kundeNochGewaehlt = await S('#al tr.sel').count();
// Reiter schließen
const vor = await pg.locator('#tabs .rt').count(); await pg.locator('#tabs .rt', {hasText:'Kunden'}).locator('i').click(); await pg.waitForTimeout(300);
out.reiterVorNach = [vor, await pg.locator('#tabs .rt').count()];
// Favorit
await pg.goto(B+'#/artikel'); await pg.waitForSelector('.seite.on #arl tr[data-id]');
await S('.kopficons [data-k="fav"]').click(); out.meinMenue = await pg.locator('#menu').innerText().then(t=>t.split('\n').slice(0,3).join(' | '));
// Artikel: Kopieren ohne Auswahl -> Hinweis, mit Auswahl
await S('#rKop').click(); out.ohneAuswahl = await pg.locator('#toast').innerText();
await S('#arl tr[data-id]').first().click(); await pg.waitForSelector('.seite.on #rR');
await S('#ard .reiter button', ).filter({hasText:'Bestände'}).click(); await pg.waitForTimeout(300);
out.bestaende = (await S('#rR').innerText()).slice(0,80).replace(/\n/g,' ');
// Löschen eines verwendeten Artikels -> Fehlermeldung
await S('#rLo').click(); await pg.waitForTimeout(600); out.loeschenFehler = await pg.locator('#toast').innerText();
// Einstellungen: Vorlage V3D-Orange live, nicht speichern
await pg.goto(B+'#/einstellungen'); await pg.waitForSelector('.seite.on [data-farbe]');
await S('[data-farbe^="#f97316"]').click(); out.farbeLive = await pg.evaluate(()=>document.documentElement.style.getPropertyValue('--blue'));
await pg.screenshot({path:'/tmp/l1_orange.png'});
await S('[data-farbe^="#004aad"]').click();
// Schnell-Neu
await pg.locator('.schnell [data-s="neu"]').click(); out.neuDialog = (await pg.locator('#dBody').innerText()).replace(/\n/g,' ').slice(0,90); await pg.locator('#dFuss .btn').click();
await pg.goto(B+'#/start'); await pg.waitForTimeout(400);
await pg.screenshot({path:'/tmp/l2_start.png'});
await pg.goto(B+'#/adressen/kunde'); await pg.waitForSelector('.seite.on #al tr[data-id]'); await S('#al tr[data-id]').first().click(); await pg.waitForTimeout(500);
await pg.screenshot({path:'/tmp/l3_kunden.png', fullPage:true});
console.log(JSON.stringify({errs, ...out}, null, 1));
await b.close();
