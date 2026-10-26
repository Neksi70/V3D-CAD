// Klicktest Mengenabgleich (WK verarbeiten → Dialog → AB angepasst) und Sammel-Lieferschein.
// Frischer Testserver: bash /tmp/erp-neustart.sh (Login demo/demo)
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch(); const pg = await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
const errs=[]; pg.on('pageerror', e=>errs.push(e.message)); pg.on('dialog', d=>d.accept());
const S = s => pg.locator('.seite.on ' + s); const out = {};
const api = (p, body) => pg.evaluate(async ([p, bd]) => { const r = await fetch('api/'+p, {method: bd ? 'POST':'GET', headers:{'Content-Type':'application/json','X-ERP':'1'}, body: bd ? JSON.stringify(bd) : undefined}); return r.json(); }, [p, body]);
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kopfzeile');
// Vorbereitung per API: zwei Aufträge desselben Kunden
const kunde = (await api('adressen?rolle=kunde'))[0];
const art = (await api('artikel?suche=300400'))[0] || (await api('artikel'))[0];
const ab1 = (await api('belege/' + (await api('belege', {belegart:'AB', adresse_id:kunde.id, ihre_referenz:'400003572', positionen:[{artikel_id:art.id, text:'Ventilgehäuse Nut fräsen', menge:3830, einzelpreis:0.6325}]})).id + '/verarbeiten', {})).beleg;
const ab2 = (await api('belege/' + (await api('belege', {belegart:'AB', adresse_id:kunde.id, positionen:[{artikel_id:art.id, text:'Ritzel honen', menge:5000, einzelpreis:0.0742}]})).id + '/verarbeiten', {})).beleg;
for (const [ab, m, ch] of [[ab1, 3750, '400003572/50/160022690/10/74548'], [ab2, 5000, 'CH-RITZEL']]) {
  const wk = await api(`belege/${ab.id}/weiter`, {ziel:'WK'});
  wk.positionen.forEach(p => { p.menge = m; p.charge_nr = ch; });
  const w = await api('belege', wk);
  if (ab === ab1) out.wkId = w.id; else await api(`belege/${w.id}/verarbeiten`, {});
}
// 1) WK in der Oberfläche verarbeiten → Abgleich-Dialog
await pg.goto(B + '#/beleg/' + out.wkId); await pg.waitForSelector('.seite.on #bVa');
await S('#bVa').click(); await pg.waitForSelector('#dlg[open] #dTitel:has-text("weicht")');
out.dialog = (await pg.locator('#dBody').innerText()).replace(/\s+/g,' ').slice(0, 160);
await pg.screenshot({path:'/tmp/sl_abgleich.png'});
await pg.locator('#dFuss .btn.pri').click(); await pg.waitForTimeout(600);
out.toast = await pg.locator('#toast').innerText();
out.abMenge = (await api('belege/' + ab1.id)).positionen[0].menge;
// 2) Sammel-Lieferschein
await pg.goto(B + '#/belege/VK'); await pg.waitForSelector('.seite.on #slNeu');
await S('#slNeu').click(); await pg.waitForSelector('#dBody [data-k]');
await pg.locator(`#dBody [data-k="${kunde.id}"]`).click(); await pg.waitForSelector('.slH');
out.zeilen = await pg.locator('#dBody tbody tr:not(.sl-ab)').count();
out.abKoepfe = await pg.locator('#dBody tr.sl-ab').allInnerTexts();
await pg.screenshot({path:'/tmp/sl_auswahl.png'});
// nur die beiden neuen Aufträge anhaken
for (const nr of [ab1.nummer, ab2.nummer]) {
  const kopf = pg.locator('#dBody tr.sl-ab', {hasText: nr});
  await kopf.locator('xpath=following-sibling::tr[1]').locator('.slH').check();
}
await pg.locator('#dFuss .btn.pri').click(); await pg.waitForSelector('.seite.on #bMn');
const lsId = +(await pg.evaluate(() => location.hash)).split('/').pop();
const ls = await api('belege/' + lsId);
out.ls = ls.positionen.map(p => `${p.text.slice(0,40)} | ${p.menge} | ${p.charge_nr||''}`);
await S('#bDa').click(); await pg.waitForSelector('#dlg[open] .druck-vorschau');
await pg.screenshot({path:'/tmp/sl_druck.png'});
await pg.locator('#dFuss .btn').first().click();
console.log(JSON.stringify(out, null, 1)); console.log('Fehler:', errs);
await b.close();
