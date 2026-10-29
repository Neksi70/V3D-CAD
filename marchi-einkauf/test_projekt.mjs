// Projekt-Import + Statusmatrix (PC und Handy). NUR gegen eine Wegwerf-DB: legt Daten an, ruft die KI auf.
// node test_projekt.mjs URL PIN bestellliste.xlsx [ausgabeordner]
import { chromium, devices } from '/home/v3da/node_modules/playwright/index.mjs';
const [,, URL, PIN, DATEI, OUT = '.'] = process.argv;
const b = await chromium.launch();
const fehler = [];
const anmelden = async ctx => { const p = await ctx.newPage(); p.on('pageerror', e => fehler.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.fill('#pin', PIN); await p.press('#pin', 'Enter'); await p.waitForSelector('#app:not([hidden])'); return p; };
const p = await anmelden(await b.newContext({ viewport: { width: 1400, height: 950 } }));
await p.click('nav button[data-s=projekte]');
const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('text=Bestellliste einlesen >> nth=0')]);
await fc.setFiles(DATEI);
await p.waitForSelector('#pi_los');
console.log('Vorschau:', await p.inputValue('#pi_name'), '| Gruppen angehakt:', await p.$$eval('[data-g]:checked', x => x.length), 'von', await p.$$eval('[data-g]', x => x.length));
await p.screenshot({ path: OUT + '/p1-vorschau.png' });
await p.click('#pi_los');
await p.waitForSelector('text=Projekt öffnen', { timeout: 90000 });
console.log('Ergebnis:', (await p.textContent('#dlg .dinhalt')).replace(/\s+/g, ' ').trim());
await p.click('text=Projekt öffnen');
await p.waitForSelector('#pptab table');
await p.screenshot({ path: OUT + '/p2-projekt.png' });
// Fahrzeug 3 wählen, nur offene, Status ändern
await p.click('.fzg >> nth=2'); await p.selectOption('#ppstatus', 'offen');
const n1 = await p.$$eval('#pptab tbody tr', r => r.length);
await p.click('#pptab tbody tr >> nth=0 >> .pst');
await p.click('.stmenue [data-s=beauftragt]');
await p.waitForTimeout(400);
const n2 = await p.$$eval('#pptab tbody tr', r => r.length);
console.log('Fzg 3 offen:', n1, '→ nach Statuswechsel:', n2);
await p.selectOption('#ppansicht', 'lieferant');
await p.waitForTimeout(300);
await p.screenshot({ path: OUT + '/p3-lieferant.png' });
// Handy
const m = await anmelden(await b.newContext({ ...devices['Pixel 7'] }));
await m.click('nav button[data-s=projekte]'); await m.click('.karte.klick >> nth=0'); await m.waitForSelector('#pptab table');
await m.screenshot({ path: OUT + '/p4-handy.png' });
await m.click('#pptab tbody tr >> nth=1 >> .pst'); await m.waitForTimeout(200);
await m.screenshot({ path: OUT + '/p5-handy-menue.png' });
console.log('Handy-Überlauf px:', await m.evaluate(() => document.documentElement.scrollWidth - innerWidth));
console.log('JS-Fehler:', fehler.length ? fehler : 'keine');
await b.close();
