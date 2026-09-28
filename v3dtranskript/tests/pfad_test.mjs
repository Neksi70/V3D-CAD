import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import fs from 'fs';
const CODE = JSON.parse(fs.readFileSync('/home/v3da/v3dtranskript/config.json')).code;
const b = await chromium.launch();
let schlecht = 0;
for (const url of ['https://v3da.tailf05fe9.ts.net/transkript',
                   'https://v3da.tailf05fe9.ts.net/transkript/']) {
  const p = await b.newPage();
  const fehler = [];
  p.on('console', m => { if (m.type()==='error' && !/40[13]/.test(m.text())) fehler.push(m.text()); });
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  // offener Betrieb (leerer Code in config.json): kein Tor, nichts einzutippen
  if (await p.isVisible('#code')) {
    await p.fill('#code', CODE);
    await p.click('button:has-text("Weiter")');
  }
  let ok = true;
  try { await p.waitForSelector('#tor', { state: 'hidden', timeout: 15000 }); }
  catch (e) { ok = false; }
  const meldung = await p.textContent('#torFehler');
  console.log(`${ok ? 'OK  ' : 'FEHL'}  ${url}  ${ok ? 'angemeldet' : 'Meldung: ' + meldung}`);
  if (ok) {
    await p.setInputFiles('#datei', '/tmp/whatsapp_test.mp4');
    await p.waitForSelector('#ergKarte:not(.weg)', { timeout: 240000 });
    const t = await p.textContent('#ergText');
    console.log('      Transkript: ' + t.trim().slice(0, 55) + ' …');
  } else schlecht++;
  if (fehler.length) { console.log('      JS-Fehler: ' + fehler.join(' | ')); schlecht++; }
  await p.close();
}
await b.close();
console.log(schlecht ? 'FEHLGESCHLAGEN' : 'beide Wege gehen');
