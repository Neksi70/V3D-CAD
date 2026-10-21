// Bauplan aus V3D Scan öffnen (v1.18.236): *.v3dcad.json → v3dApi.bauplan baut den Körper nach.
// Testdaten = echte Ausgabe von V3D Scan 1.4 („Scan → CAD mit einem Klick“) an künstlichen Scans:
//   testteil (Platte + Bohrungen + Zapfen/Kuppel/Kegel), drehteil (Stufenwelle), platte (Beispiel).
// Geprüft: Volumen ±1 % zu V3D Scan, ein Undo-Schritt, Verlauf, kaputter Plan lässt Szene unverändert,
// Weg über den Import-Dialog (#fimport). Start: npm run dev (8766) oder V3D_URL setzen.
import { readFileSync } from 'fs';
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const DIR = '/home/v3da/tests/fixtures/bauplan/';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function' && window.v3dApi, null, { timeout: 60000 });
await pg.evaluate(() => hideStarter());
let fehler = 0;
const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };

for (const name of ['testteil', 'drehteil', 'platte']) {
  const plan = JSON.parse(readFileSync(DIR + name + '.v3dcad.json', 'utf8'));
  await pg.evaluate(() => _newCreate(false));
  const r = await pg.evaluate(p => window.v3dApi.bauplan(p), plan);
  ok(`${name}: gebaut (${plan.befehle.length} Befehle)`, r.ok, r.ok ? undefined : r);
  if (!r.ok) continue;
  ok(`${name}: Volumen ±1 % zu V3D Scan`, Math.abs(r.abweichung) < 0.01,
     { volumen: r.volumen, soll: r.soll, prozent: +(100 * r.abweichung).toFixed(3) });
  const z = await pg.evaluate(() => ({ n: objects.length, undo: undoStack.length }));
  ok(`${name}: genau ein Körper`, z.n === 1, z);
  const tl = await pg.evaluate(() => window.v3dApi.execute('timeline.list', {}));
  ok(`${name}: Schritte stehen im Verlauf`, tl.ok && JSON.stringify(tl.result).length > 50, tl.ok ? undefined : tl);
  const u = await pg.evaluate(() => window.v3dApi.execute('edit.undo', {}));
  const nach = await pg.evaluate(() => objects.length);
  ok(`${name}: ein Undo-Schritt entfernt alles`, u.ok && nach === 0, { nach, u: u.ok ? 'ok' : u });
}

// kaputter Plan: zweiter Befehl unbekannt → Fehler, Szene unverändert
await pg.evaluate(() => { _newCreate(false); addShape('box'); });
const vorher = await pg.evaluate(() => objects.length);
const plan = JSON.parse(readFileSync(DIR + 'platte.v3dcad.json', 'utf8'));
plan.befehle.push({ befehl: 'gibt.esnicht', params: {} });
const r = await pg.evaluate(p => window.v3dApi.bauplan(p), plan);
ok('kaputter Plan meldet den Schritt', !r.ok && /Schritt 2 von 2/.test(r.error), r.error);
ok('kaputter Plan: Szene unverändert', (await pg.evaluate(() => objects.length)) === vorher);
const fremd = await pg.evaluate(() => window.v3dApi.bauplan({ format: 'irgendwas', befehle: [] }));
ok('fremde JSON-Datei abgelehnt', !fremd.ok && /keine Bauplan-Datei/.test(fremd.error), fremd.error);

// über den normalen Import (Datei-Dialog) und den Menüpunkt
await pg.evaluate(() => _newCreate(false));
await pg.setInputFiles('#fimport', DIR + 'drehteil.v3dcad.json');
await pg.waitForFunction(() => objects.length === 1, null, { timeout: 60000 });
await pg.waitForTimeout(300);
const toast = await pg.evaluate(() => [...document.querySelectorAll('.ni')].map(e => e.textContent).join(' | '));
ok('Import-Dialog nimmt .v3dcad.json + Meldung mit Volumen', /Bauplan gebaut/.test(toast) && /mm³/.test(toast), toast);
ok('Menüpunkt „Bauplan aus V3D Scan öffnen“ vorhanden',
   await pg.evaluate(() => [...document.querySelectorAll('.sli-item')].some(e => /Bauplan aus V3D Scan/.test(e.textContent))));
await pg.click('body', { position: { x: 700, y: 450 } });
await pg.screenshot({ path: '/home/v3da/tests/bauplan_v3dscan.png' });
ok('keine Seitenfehler', !errs.length, errs.slice(0, 3));
console.log(fehler ? `\n${fehler} FEHLER` : '\nALLES OK');
await b.close();
process.exit(fehler ? 1 : 0);
