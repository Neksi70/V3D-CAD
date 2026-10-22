// Klicktest E-Rechnung (Playwright): fehlende Angaben → Dialog, XRechnung/ZUGFeRD herunterladen, im Einkauf wieder einlesen.
// Testserver wie bei test_oberflaeche.mjs (/tmp/erp-neustart.sh, Login demo/demo)
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
const B='http://127.0.0.1:8820/';
const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1440,height:1000}, acceptDownloads:true}); const pg = await ctx.newPage();
const errs=[]; pg.on('pageerror', e=>errs.push('PAGE '+e.message)); pg.on('dialog', d=>d.accept());
const S = s => pg.locator('.seite.on ' + s); const out = {};
const api = (pfad, body) => pg.evaluate(async ([p, bd]) => { const r = await fetch('api/'+p, {method: bd ? 'POST':'GET', headers:{'Content-Type':'application/json','X-ERP':'1'}, body: bd ? JSON.stringify(bd) : undefined}); return r.json(); }, [pfad, body]);
await pg.goto(B); await pg.fill('#lu','demo'); await pg.fill('#lp','demo'); await pg.click('button.pri'); await pg.waitForSelector('.seite.on .kopfzeile');

const re = (await api('belege?bereich=VK&belegart=RE&status=verarbeitet'))[0];
out.rechnung = re.nummer;
await pg.goto(B+'#/beleg/'+re.id); await pg.waitForSelector('.seite.on #bMn');
await S('#bMn .btn').click(); out.menue = await S('#bMn .ddl').innerText();
await S('#bMn .ddl button[data-a="xrechnung"]').click(); await pg.waitForSelector('#dlg[open]');
out.fehlDialog = (await pg.locator('#dlg').innerText()).replace(/\s+/g,' ').slice(0,260);
await pg.locator('#dFuss .btn').click();

// Pflichtangaben ergänzen (wie es der Anwender in Einstellungen/Adresse täte)
await api('einstellungen', {iban:'DE02 1203 0000 0000 2020 51', bic:'BYLADEM1001', telefon:'02331 000000', email:'info@testbetrieb.example', ust_id:'DE123456789', strasse:'Werkstraße 1', plz:'58135', ort:'Hagen'});
const adr = await api('adressen/'+(await api('belege/'+re.id)).adresse_id);
await api('adressen', {...adr, email: adr.email || 'einkauf@kunde.example', strasse: adr.strasse || 'Testweg 1', plz: adr.plz || '44135', ort: adr.ort || 'Dortmund'});

for (const art of ['xrechnung','zugferd']) {
  await pg.reload(); await pg.waitForSelector('.seite.on #bMn');
  await S('#bMn .btn').click();
  const [dl] = await Promise.all([pg.waitForEvent('download'), S(`#bMn .ddl button[data-a="${art}"]`).click()]);
  out[art] = dl.suggestedFilename(); await dl.saveAs('/tmp/erech-ui-'+out[art]);
}
// Einlesen im Einkauf (eigene Rechnung als Lieferantenrechnung – reicht für den Ablauf)
await pg.goto(B+'#/belege/EK'); await pg.waitForSelector('.seite.on #erEin');
await S('#erDatei').setInputFiles('/tmp/erech-ui-'+out.xrechnung); await pg.waitForSelector('#dlg[open]');
out.einlesen = (await pg.locator('#dlg').innerText()).replace(/\s+/g,' ').slice(0,260);
await pg.screenshot({path:'/tmp/erech_einlesen.png'});
await pg.locator('#dFuss .btn.pri').click(); await pg.waitForSelector('.seite.on #bMn');
out.erBeleg = await pg.title();
await S('#erDatei').count();
// ZUGFeRD derselben Rechnung → Doppel-Erkennung
await pg.goto(B+'#/belege/EK'); await pg.waitForSelector('.seite.on #erEin');
await S('#erDatei').setInputFiles('/tmp/erech-ui-'+out.zugferd); await pg.waitForTimeout(1200);
out.doppelt = await pg.locator('#toast').innerText();
console.log(JSON.stringify(out, null, 1)); console.log('Fehler:', errs);
await b.close();
