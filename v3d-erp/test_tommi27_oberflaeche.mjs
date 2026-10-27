// Klicktest zu Tommis Sprachnachrichten 27.10.: Freigabe beim Fertigmelden, Status-Text, Neu→Lieferschein verknüpft (nur Freigegebenes), WK im Einkauf.
// Frischer Testserver: bash /tmp/erp-neustart.sh
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch(); const out = {}, errs = [];
const pg = await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
pg.on('pageerror', e=>errs.push('B '+e.message)); pg.on('dialog', d=>d.accept());
const S = s => pg.locator('.seite.on ' + s);
const api = (p, body) => pg.evaluate(async ([p, bd]) => { const r = await fetch('api/'+p, {method: bd ? 'POST':'GET', headers:{'Content-Type':'application/json','X-ERP':'1'}, body: bd ? JSON.stringify(bd) : undefined}); return r.json(); }, [p, body]);
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kopfzeile');
await api('einstellungen', {ls_nur_freigegeben: '1'});
const kunde = (await api('adressen?rolle=kunde'))[0];
const art = (await api('artikel?suche=300400'))[0];
const ab = (await api('belege/' + (await api('belege', {belegart:'AB', adresse_id:kunde.id, positionen:[{artikel_id:art.id, text:'Führungsbuchse bohren', menge:1000, einzelpreis:0.12}]})).id + '/verarbeiten', {})).beleg;
const wk = await api(`belege/${ab.id}/weiter`, {ziel:'WK'}); wk.positionen.forEach(p => p.charge_nr = 'T27-CHARGE');
await api(`belege/${(await api('belege', wk)).id}/verarbeiten`, {});
// WK steht im Einkauf
await pg.goto(B + '#/belege/EK'); await pg.waitForSelector('.seite.on #bl tr');
out.wkImEinkauf = await S('#bl tr', ).filter({hasText: 'Wareneingang Kundenmaterial'}).count();
await pg.goto(B + '#/belege/VK'); await pg.waitForSelector('.seite.on #bl tr');
out.wkImVerkauf = await S('#bl tr').filter({hasText: 'Wareneingang Kundenmaterial'}).count();
// Tablet
const t = await (await b.newContext({viewport:{width:1180,height:820}})).newPage(); t.on('pageerror', e=>errs.push('T '+e.message));
await t.goto(B); await t.fill('#lu','werkstatt'); await t.fill('#lp','werkstatt'); await t.click('button.pri'); await t.waitForSelector('#pdNeu');
const melde = async (gang, gut, frei) => {
  await t.click('#pdNeu'); await t.waitForSelector('#pdS'); await t.fill('#pdS', 'T27-CHARGE'); await t.waitForTimeout(400); await t.press('#pdS', 'Enter');
  await t.waitForSelector('#pdP'); await t.locator(`#dBody [data-f="arbeitsgang"][data-v="${gang}"]`).click(); await t.click('#dFuss .btn.ok');
  await t.waitForSelector('.pd-karte'); await t.locator('.pd-karte', {hasText: gang}).locator('.pd-ende').click(); await t.waitForSelector('#peF');
  const vorbelegt = await t.isChecked('#peF'); await t.fill('#peG', String(gut)); if (frei !== undefined) await t.setChecked('#peF', frei);
  await t.click('#dFuss .btn.ok'); await t.waitForTimeout(700); return vorbelegt;
};
out.freiVorbelegtBohren = await melde('Bohren', 1000);
out.statusNachBohren = (await api('produktion/fortschritt')).find(c => c.chargennr === 'T27-CHARGE').status_text;
// zu viel melden → Fehlermeldung
await t.click('#pdNeu'); await t.waitForSelector('#pdS'); await t.fill('#pdS', 'T27-CHARGE'); await t.waitForTimeout(400); await t.press('#pdS', 'Enter');
await t.waitForSelector('#pdP'); await t.locator('#dBody [data-f="arbeitsgang"][data-v="Bohren"]').click(); await t.click('#dFuss .btn.ok'); await t.waitForSelector('.pd-karte');
await t.locator('.pd-karte', {hasText: 'Bohren'}).locator('.pd-ende').click(); await t.waitForSelector('#peG'); await t.fill('#peG', '500'); await t.click('#dFuss .btn.ok'); await t.waitForTimeout(600);
out.zuVielToast = await t.locator('#toast').innerText();
await t.locator('#dFuss .btn').first().click(); await t.locator('.pd-karte', {hasText: 'Bohren'}).locator('.pd-weg').click(); await t.locator('#dFuss .btn').nth(1).click(); await t.waitForTimeout(500);
await melde('Gewinde schneiden', 1000);
out.freiVorbelegtPruefen = await melde('Prüfen', 600);
await t.screenshot({path:'/tmp/t27_tablet.png'});
// Büro: Neu → Lieferschein → verknüpfte Auswahl mit 600 freigegeben
await pg.goto(B + '#/belege/VK'); await pg.waitForSelector('.seite.on #neuM');
await S('#neuM .btn').click(); await S('#neuM .ddl button[data-a="LS"]').click(); await pg.waitForSelector('#dBody [data-k]');
out.leerKnopf = await pg.locator('#dFuss .btn', {hasText:'Leerer Lieferschein'}).count();
await pg.locator(`#dBody [data-k="${kunde.id}"]`).click(); await pg.waitForSelector('.slH');
const zeile = pg.locator('#dBody tr.sl-ab', {hasText: ab.nummer}).locator('xpath=following-sibling::tr[1]');
out.zeile = (await zeile.innerText()).replace(/\s+/g,' ');
out.spalte = await pg.locator('#dBody thead th').nth(5).innerText();
await zeile.locator('.slH').check(); await pg.locator('#dFuss .btn.pri').click(); await pg.waitForSelector('.seite.on #bVa');
await S('#bVa').click(); await pg.waitForTimeout(800);
out.lsToast = await pg.locator('#toast').innerText();
await pg.goto(B + '#/produktion'); await pg.waitForSelector('.seite.on #pdF tr');
out.fortschritt = (await S('#pdF tr', ).filter({hasText:'T27-CHARGE'}).innerText()).replace(/\s+/g,' ');
await pg.screenshot({path:'/tmp/t27_buero.png', fullPage:true});
console.log(JSON.stringify(out, null, 1)); console.log('Fehler:', errs);
await b.close();
