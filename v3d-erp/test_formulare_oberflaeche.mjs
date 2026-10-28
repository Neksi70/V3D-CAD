// Klicktest Formular-Baukasten: Spalte an + umbenennen + verschieben, Titel, Zusatztext, Briefpapier, Vorschau, Speichern, Positionsfeld wandert AB→LS.
// Frischer Testserver: bash /tmp/erp-neustart.sh
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch(); const out = {}, errs = [];
const pg = await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
pg.on('pageerror', e=>errs.push(e.message)); pg.on('dialog', d=>d.accept());
const S = s => pg.locator('.seite.on ' + s);
const api = (p, body) => pg.evaluate(async ([p, bd]) => { const r = await fetch('api/'+p, {method: bd ? 'POST':'GET', headers:{'Content-Type':'application/json','X-ERP':'1'}, body: bd ? JSON.stringify(bd) : undefined}); return r.json(); }, [p, body]);
let vorschauen = 0; pg.on('response', r => { if (r.url().includes('formular/vorschau')) vorschauen++; });
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kopfzeile');
// Positionsfeld definieren
await api('einstellungen', {positionsfelder: 'Kundenbestell-Nr.; Zeichnungs-Nr.'});
await pg.goto(B + '#/formulare/LS'); await pg.waitForSelector('.seite.on .foAn'); await pg.waitForTimeout(800);
const zeile = key => S('.fo-z').filter({has: pg.locator(`input.foT`)}).nth(['pos','artikelnr','text','menge','me','einzelpreis','rabatt','gesamt'].indexOf(key));
await S('.foAn[data-i="1"]').check(); await S('.foT[data-i="1"]').fill('Teile-Nr.');
await S('.foD[data-i="0"]').click();                          // Pos nach hinten → Teile-Nr. vorne
await S('#foTi').fill('Lieferschein / Delivery Note'); await S('#foZt').fill('Bitte Europaletten tauschen.');
await S('#foBp').check(); await S('#foRo').fill('50');
await pg.waitForTimeout(1500);
out.vorschauAufrufe = vorschauen;
out.spaltenOrdnung = await S('.foT').evaluateAll(x => x.map(i => i.value).slice(0,3));
await S('#foSp').click(); await pg.waitForTimeout(600);
const fo = JSON.parse((await api('einstellungen')).formular).LS;
out.gespeichert = [fo.titel, fo.briefpapier, fo.rand_oben, fo.spalten.slice(0,2).map(x => x.titel + (x.an ? '✓' : ''))];
await pg.screenshot({path:'/tmp/fo_baukasten.png'});
// Einstellungen speichern darf Formular nicht überschreiben
await pg.goto(B + '#/einstellungen'); await pg.waitForSelector('.seite.on #eSp'); await S('#eSp').click(); await pg.waitForTimeout(500);
out.nachEinstellungen = JSON.parse((await api('einstellungen')).formular).LS.titel;
// Positionsfeld an AB setzen → LS übernimmt
const kunde = (await api('adressen?rolle=kunde'))[0]; const art = (await api('artikel?suche=900100'))[0];
const abE = await api('belege', {belegart:'AB', adresse_id:kunde.id, positionen:[{artikel_id:art.id, text:'Konstruktion', menge:2, einzelpreis:95}]});
await pg.goto(B + '#/beleg/' + abE.id); await pg.waitForSelector('.seite.on .pD');
await S('.pD').first().click(); await pg.waitForSelector('#dBody .ldZ');
await pg.locator('#dBody .ldZ').first().fill('4500099999'); await pg.locator('#dFuss .btn.pri').click();
out.marker = await S('.pD').first().innerText();
await S('#bSp').click(); await pg.waitForTimeout(500);
await api(`belege/${abE.id}/verarbeiten`, {});
const ls = await api(`belege/${abE.id}/weiter`, {ziel:'LS'});
out.lsZusatz = ls.positionen[0].zusatz;
const pdfOk = await pg.evaluate(async id => { const r = await fetch(`api/belege/${id}/pdf`); return [r.status, r.headers.get('content-type')]; }, ls.id);
out.lsPdf = pdfOk;
console.log(JSON.stringify(out, null, 1)); console.log('Fehler:', errs);
await b.close();
