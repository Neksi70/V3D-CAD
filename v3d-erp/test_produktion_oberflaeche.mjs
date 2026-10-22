// Klicktest Produktion (Playwright): Tablet starten/Pause/Fertig melden, Büro-Übersicht, Charge-Detail, Kunden-PDF.
// Testserver wie bei test_oberflaeche.mjs (/tmp/erp-neustart.sh); Tablet-Login werkstatt/werkstatt, Büro demo/demo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch(); const out = {}; const errs = [];
// ---- Tablet
const tab = await (await b.newContext({viewport:{width:1180,height:820}})).newPage();
tab.on('pageerror', e=>errs.push('TAB '+e.message));
await tab.goto(B); await tab.fill('#lu','werkstatt'); await tab.fill('#lp','werkstatt'); await tab.click('button.pri');
await tab.waitForSelector('#pdNeu');
out.modus = await tab.locator('.ws-modus .btn.pri').innerText();
await tab.click('#pdNeu'); await tab.waitForSelector('#pdL [data-i]');
out.chargenAuswahl = await tab.locator('#pdL [data-i]').count();
const erste = (await tab.locator('#pdL [data-i]').first().innerText()).split(' · ')[0].trim();
await tab.fill('#pdS', erste); await tab.waitForTimeout(400); await tab.press('#pdS', 'Enter');
await tab.waitForSelector('#pdP');
out.arbeitsgaenge = await tab.locator('#dBody [data-f="arbeitsgang"]').allInnerTexts();
await tab.click('#dFuss .btn.ok'); out.ohneAG = await tab.locator('#toast').innerText();       // ohne Arbeitsgang → Hinweis, Dialog bleibt
await tab.locator('#dBody [data-f="arbeitsgang"]').first().click();
await tab.fill('#pdP', '1'); await tab.fill('#pdM', '500'); await tab.fill('#pdW', 'Mama');
await tab.click('#dFuss .btn.ok'); await tab.waitForSelector('.pd-karte');
out.karte = (await tab.locator('.pd-karte').first().innerText()).replace(/\s+/g,' ');
await tab.screenshot({path:'/tmp/pd_tablet_laeuft.png'});
await tab.click('.pd-pause'); await tab.waitForSelector('.pd-karte.pause'); out.pause = true;
await tab.click('.pd-weiter'); await tab.waitForSelector('.pd-karte.laeuft');
await tab.click('.pd-ende'); await tab.waitForSelector('#peG');
out.vorbelegtGut = await tab.inputValue('#peG');
await tab.fill('#peG', '495'); await tab.fill('#peA', '5'); await tab.locator('#dBody [data-g]').first().click();
await tab.screenshot({path:'/tmp/pd_tablet_ende.png'});
await tab.click('#dFuss .btn.ok'); await tab.waitForTimeout(800);
out.fertigToast = await tab.locator('#toast').innerText();
out.erledigtZeile = (await tab.locator('#wsBox table tbody tr').first().innerText()).replace(/\s+/g,' ');
// zweiter Gang läuft weiter für Büro-Ansicht
await tab.click('#pdNeu'); await tab.waitForSelector('#pdL [data-i]'); await tab.locator('#pdL [data-i]').first().click();
await tab.waitForSelector('#pdP'); await tab.locator('#dBody [data-f="arbeitsgang"]').nth(1).click(); await tab.click('#dFuss .btn.ok');
await tab.waitForSelector('.pd-karte');
await tab.click('.ws-modus [data-m="schritte"]'); await tab.waitForSelector('.ws-bereiche'); out.schritteModus = true;
await tab.screenshot({path:'/tmp/pd_tablet.png'});
// ---- Büro
const pg = await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
pg.on('pageerror', e=>errs.push('BUERO '+e.message)); pg.on('dialog', d=>d.accept());
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kopfzeile');
await pg.goto(B+'#/produktion'); await pg.waitForSelector('.seite.on #pdF tr');
out.bueroLaufend = await pg.locator('.seite.on .pd-karte').count();
out.fortschritt = (await pg.locator('.seite.on #pdF tr').first().innerText()).replace(/\s+/g,' ');
await pg.screenshot({path:'/tmp/pd_buero.png', fullPage:true});
await pg.locator('.seite.on #pdF tr').first().click(); await pg.waitForSelector('.seite.on #chD table');
await pg.waitForTimeout(500);
out.chargeDetail = (await pg.locator('.seite.on #chD').innerText()).replace(/\s+/g,' ').match(/Fertigung.{0,200}/)?.[0];
// Kunden-PDF des Projekts
const pid = await pg.evaluate(async () => (await (await fetch('api/projekte')).json())[0]?.id);
out.pdf = await pg.evaluate(async id => { const r = await fetch(`api/projekte/${id}/bericht.pdf`); return [r.status, r.headers.get('content-type'), (await r.arrayBuffer()).byteLength]; }, pid);
// Werkstatt darf keine Belege
out.werkstattGesperrt = await tab.evaluate(async () => (await fetch('api/belege?bereich=VK')).status);
console.log(JSON.stringify(out, null, 1)); console.log('Fehler:', errs);
await b.close();
