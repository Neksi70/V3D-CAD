// Selbsttest der Kamera + Herkunft der Messwerte
import { chromium } from 'playwright';
const PORT = process.argv[2] || 8793;
const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream',
                                         '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true,
                                 permissions:['camera'] });
const p = await ctx.newPage();
const fehler = [];
p.on('pageerror', e => fehler.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') fehler.push('CONSOLE: ' + m.text()); });
const pruef = (name, ok, info) => {
  console.log(`${ok ? 'OK  ' : 'FEHL'} ${name}${info !== undefined ? ': ' + info : ''}`);
  if (!ok) fehler.push(name);
};
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.evaluate(() => { const k = document.getElementById('start'); if (k) k.style.display='none';
  zeigeTab('messen'); });
await p.waitForTimeout(300);

// Vor dem Test: Hinweis "noch nicht geprueft"
pruef('Hinweis auf den ungelaufenen Selbsttest',
  /Noch nicht geprüft/.test(await p.textContent('#gueteBox')));

// Die Bewertung wird mit gesetzten Rohwerten geprueft — schneller und eindeutiger
// als der echte Ablauf mit der Fake-Kamera.
const bewerte = (hell, dunkel, ev) => p.evaluate(([h, d, e]) => {
  const mach = (lux, n) => Array.from({length:n}, () => ({lux, Y:lux/3000, ev:e, ueber:0}));
  const PR = window._licht.PR();
  PR.hell = mach(h, 6); PR.dunkel = mach(d, 6);
  window._licht.pruefErgebnis();
  return window._licht.geraetLesen().guete;
}, [hell, dunkel, ev]);

let g = await bewerte(500, 120, true);
pruef('Gute Kamera mit Belichtungsdaten', g.stufe === 'gut' && g.ev === true,
      `${g.stufe} / ${g.kopf} / ${g.v}:1`);

g = await bewerte(500, 120, false);
pruef('Ohne Belichtungsdaten nur "mittel"', g.stufe === 'mittel', `${g.stufe} / ${g.kopf}`);

g = await bewerte(500, 350, false);   // 1,43:1 — reagiert, aber schwach
pruef('Schwache Reaktion wird als "mittel" gewarnt', g.stufe === 'mittel', `${g.v}:1 / ${g.kopf}`);
g = await bewerte(500, 430, true);    // 1,16:1 — unter der Schwelle, trotz Belichtungsdaten
pruef('Zu schwache Reaktion schlaegt Belichtungsdaten', g.stufe === 'schlecht', `${g.v}:1 / ${g.kopf}`);

g = await bewerte(500, 470, true);
pruef('Nachregelnde Kamera wird abgelehnt', g.stufe === 'schlecht', `${g.v}:1 / ${g.kopf}`);
const txt = await p.textContent('#pr_text');
pruef('Ablehnung nennt den Ausweg', /von Hand|Luxmeter/.test(txt));

// Ergebnis bleibt im Geraet gespeichert und erscheint im Mess-Reiter
await p.evaluate(() => pruefEnde());
pruef('Ergebnis steht dauerhaft im Mess-Reiter',
  /nicht verwertbar/.test(await p.textContent('#gueteBox')),
  (await p.textContent('#gueteBox')).slice(0, 60).replace(/\s+/g, ' '));
await p.reload({ waitUntil: 'networkidle' });
await p.evaluate(() => { const k=document.getElementById('start'); if(k) k.style.display='none'; zeigeTab('messen'); });
await p.waitForTimeout(300);
pruef('Ergebnis ueberlebt das Neuladen', /Reaktion/.test(await p.textContent('#gueteBox')));

// Herkunft der Messwerte
await p.evaluate(() => sensorWaehlen('hand'));
await p.fill('#i_handWert', '450');
await p.evaluate(() => punktMerken());
await p.waitForTimeout(200);
let q = await p.evaluate(() => window._licht.S.punkte[0].q);
pruef('Handeingabe wird als solche vermerkt', q === 'hand', q);
const spalte = await p.textContent('#punkteBody');
pruef('Protokoll zeigt das Herkunftszeichen', /⌨️/.test(spalte));

// Kamerawert: Quelle haengt daran, ob Belichtungsdaten vorlagen
await p.evaluate(() => { sensorWaehlen('kamera'); window._licht.S.camRoh = {ev:false, lux:300, Y:.1, ueber:0}; });
await p.evaluate(() => { window._licht.S.feld = {ix:1, iy:0};
  camGlatt = 300; });
q = await p.evaluate(() => window._licht.messQuelle());
pruef('Kamera ohne Belichtungsdaten wird unterschieden', q === 'kamera-hell', q);
await p.evaluate(() => { window._licht.S.camRoh.ev = true; });
q = await p.evaluate(() => window._licht.messQuelle());
pruef('Kamera mit Belichtungsdaten wird unterschieden', q === 'kamera-ev', q);

// Bericht warnt bei kamerabasierten Werten
await p.evaluate(() => {
  window._licht.S.punkte.push({n:'B1', v:420, h:.75, x:2, y:1, q:'kamera-hell'});
  window._licht.rechne(); zeigeTab('bericht');
});
await p.waitForTimeout(400);
const bericht = await p.textContent('#berichtKurz');
pruef('Bericht nennt die Herkunft', /Herkunft der Messwerte/.test(bericht));
pruef('Bericht warnt vor ungeeichten Werten', /keine geeichte Messung/.test(bericht));
pruef('Bericht nennt die fehlende Kalibrierung', /nicht kalibriert/.test(bericht));
const liste = await p.textContent('#pruefliste');
pruef('Pruefliste fordert Nachmessen', /ersetzt keine Abnahmemessung/.test(liste));

await b.close();
if (fehler.length) { console.log('\nFEHLER:\n' + fehler.join('\n')); process.exit(1); }
console.log('\nSelbsttest und Herkunft ok.');
