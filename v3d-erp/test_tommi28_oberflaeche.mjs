// Klicktest Rückmeldung 28.10.: LS ohne Preise (PDF eine Seite), Verpackung am LS, Neu→Rechnung aus Lieferscheinen, Formular-Einstellung.
// Frischer Testserver: bash /tmp/erp-neustart.sh
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import fs from 'fs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch(); const out = {}, errs = [];
const pg = await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
pg.on('pageerror', e=>errs.push(e.message)); pg.on('dialog', d=>d.accept());
const S = s => pg.locator('.seite.on ' + s);
const api = (p, body) => pg.evaluate(async ([p, bd]) => { const r = await fetch('api/'+p, {method: bd ? 'POST':'GET', headers:{'Content-Type':'application/json','X-ERP':'1'}, body: bd ? JSON.stringify(bd) : undefined}); return r.json(); }, [p, body]);
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kopfzeile');
const kunde = (await api('adressen?rolle=kunde'))[1];
const art = (await api('artikel?suche=300400'))[0];
const ab = (await api('belege/' + (await api('belege', {belegart:'AB', adresse_id:kunde.id, ihre_referenz:'4711', positionen:[{artikel_id:art.id, text:'Komfortventilkörper', menge:11800, einzelpreis:0.092}]})).id + '/verarbeiten', {})).beleg;
const wk = await api(`belege/${ab.id}/weiter`, {ziel:'WK'}); wk.positionen.forEach(p => p.charge_nr = '100075790 / 60 / 160022 / 10 / 74999');
await api(`belege/${(await api('belege', wk)).id}/verarbeiten`, {});
const lsE = await api(`belege/${ab.id}/weiter`, {ziel:'LS'});
const lsR = await api(`belege/${lsE.id}/verarbeiten`, {});
out.lsMeldungen = lsR.meldungen;
// Verpackung am verarbeiteten LS
await pg.goto(B + '#/beleg/' + lsE.id); await pg.waitForSelector('.seite.on #vpBox');
await S('#vpNeu').click(); await S('.vpA').first().fill('2'); await S('.vpT').first().selectOption('Europalette');
await S('#vpNeu').click(); await S('.vpA').nth(1).fill('40'); await S('.vpT').nth(1).selectOption('Lochkiste SMB');
await pg.waitForTimeout(1200);
out.verpackung = (await api('belege/' + lsE.id)).verpackung;
// Druckansicht = PDF
await S('#bDa').click(); await pg.waitForSelector('#dlg[open] iframe.pdf-vorschau');
out.vorschauSrc = await pg.locator('iframe.pdf-vorschau').getAttribute('src');
await pg.waitForTimeout(800); await pg.screenshot({path:'/tmp/t28_vorschau.png'});
await pg.locator('#dFuss .btn').first().click();
const pdf = await pg.evaluate(async id => Array.from(new Uint8Array(await (await fetch(`api/belege/${id}/pdf`)).arrayBuffer())), lsE.id);
fs.writeFileSync('/tmp/t28_ls.pdf', Buffer.from(pdf));
// Neu → Rechnung → Lieferscheine des Kunden
await pg.goto(B + '#/belege/VK'); await pg.waitForSelector('.seite.on #neuM');
await S('#neuM .btn').click(); await S('#neuM .ddl button[data-a="RE"]').click(); await pg.waitForSelector('#dBody [data-kr]');
await pg.locator(`#dBody [data-kr="${kunde.id}"]`).click(); await pg.waitForSelector('.srH');
out.lsListe = (await pg.locator('#dBody tbody').innerText()).replace(/\s+/g,' ').slice(0, 200);
out.summe = await pg.locator('#srSumme').innerText();
await pg.locator('#dFuss .btn.pri').click(); await pg.waitForSelector('.seite.on #bMn');
const reId = +(await pg.evaluate(() => location.hash)).split('/').pop();
const re = await api('belege/' + reId);
out.re = [re.belegart, re.netto, re.positionen.map(p => `${p.text.slice(0,30)}|${p.menge}`)];
// Formular-Einstellung: Preise auf LS wieder an
await pg.goto(B + '#/einstellungen'); await pg.waitForSelector('.seite.on .foC');
await S('.foC[data-a="LS"][data-o="preise"]').check(); await S('#eSp').click(); await pg.waitForTimeout(600);
out.formular = (await api('einstellungen')).formular;
console.log(JSON.stringify(out, null, 1)); console.log('Fehler:', errs);
await b.close();
