// Klicktest Lohnbearbeitung/Chargen (Playwright), Testserver wie bei test_oberflaeche.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch(); const pg = await b.newPage({viewport:{width:1440,height:1000}});
const errs=[]; pg.on('pageerror', e=>errs.push('PAGE '+e.message)); pg.on('dialog', d=>d.accept());
const S = s => pg.locator('.seite.on ' + s); const out = {};
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kpis');
// AB der Lohnbearbeitung öffnen
const abId = await pg.evaluate(async()=>{ const l=await (await fetch('api/belege?bereich=VK&suche=4500012345',{headers:{'X-ERP':'1'}})).json(); return l.find(x=>x.belegart==='AB').id; });
await pg.goto(B+'#/beleg/'+abId); await pg.waitForSelector('.seite.on .bk-kasten');
await S('#wM .btn').click(); await S('#wM .ddl button').filter({hasText:'Wareneingang Kundenmaterial'}).click();
await pg.waitForSelector('.seite.on #chAlle'); await pg.waitForTimeout(300);
out.wkMenge = await S('#pt tr[data-i="0"] .pM').inputValue();
out.kopfLabel = await S('.bk-kasten').innerText().then(t=>t.includes('Ihr Lieferschein'));
await S('#chAlle').fill('SW-2610-B'); await S('#chAlleB').click();
await S('#kRef').fill('LS 88990');
out.chargeZeile = await S('#pt tr[data-i="0"] .pC').inputValue();
await S('#bVa').click(); await pg.waitForTimeout(1500);
out.toastWK = await pg.locator('#toast').innerText();
// Lieferschein aus AB: Chargen automatisch
await pg.goto(B+'#/beleg/'+abId); await pg.waitForTimeout(800);
await S('#wM .btn').click(); await S('#wM .ddl button').filter({hasText:'Lieferschein'}).click(); await pg.waitForTimeout(1500);
out.lsZeilen = await S('#pt tr').evaluateAll(trs => trs.filter(t=>t.querySelector('.pCs')).map(t => [t.querySelector('.pM').value, t.querySelector('.pCs').selectedOptions[0]?.textContent]));
await S('#bVa').click(); await pg.waitForTimeout(1500);
out.toastLS = await pg.locator('#toast').innerText();
out.lsDok = await S('#bDok').innerText();
await S('#bDok').click(); out.dokListe = (await pg.locator('#dBody').innerText()).split('\n').slice(0,3).join(' | '); await pg.locator('#dFuss .btn').click();
await pg.keyboard.press('Alt+a'); await pg.waitForSelector('#dlg[open] iframe.pdf-vorschau'); out.druckCharge = await pg.locator('#dlg iframe.pdf-vorschau').getAttribute('src'); await pg.locator('#dFuss .btn', {hasText:'Schließen'}).click();
await pg.screenshot({path:'/tmp/ch_ls.png', fullPage:true});
// Chargen-Seite
await pg.goto(B+'#/chargen'); await pg.waitForSelector('.seite.on #chL tr');
await S('#chO').uncheck(); await pg.waitForTimeout(500);
out.chargen = await S('#chL tr').allInnerTexts();
await S('#chL tr', ).filter({hasText:'SW-2610-A'}).click(); await pg.waitForSelector('.seite.on #chD .kpis');
out.chargeA = (await S('#chD').innerText()).replace(/\n/g,' | ').slice(0,420);
await pg.screenshot({path:'/tmp/ch_seite.png', fullPage:true});
// Kalkulation
await pg.goto(B+'#/artikel'); await pg.waitForSelector('.seite.on #arl tr[data-id]');
await S('#rS').fill('LD-40'); await pg.waitForTimeout(500); await S('#arl tr[data-id]').first().click(); await pg.waitForSelector('.seite.on #rR');
await S('#ard .reiter button').filter({hasText:'Kalkulation'}).click(); await pg.waitForTimeout(300);
out.kalk = await S('#kErg').innerText();
console.log(JSON.stringify({errs, ...out}, null, 1)); await b.close();
