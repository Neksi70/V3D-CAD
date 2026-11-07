// Regressionstest ⧈ Spielraum (Volker 7.11.): Knopf −0,2 wählt nur, „Anwenden“ wendet genau einmal an
// (vorher: Knopf wandte sofort an, „Anwenden“ legte den Feld-Standard +0,2 drauf → Größe sprang zurück).
// Start: python3 volme3d_server.py 8886 --dev  →  node tests/spielraum_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8886/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof openOffsetTool === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); localStorage.setItem('v3d_umsteiger_hinweis', '1'); document.getElementById('umsteiger-hinweis')?.remove(); _newCreate(false); addShape('box'); selectObjs([objects[0]]); });
const breite = () => pg.evaluate(() => { const o = getFirst(); o.updateMatrixWorld(true); return +(getMeshBox(o).getSize(new THREE.Vector3()).x * 10).toFixed(2); });
const b0 = await breite();
await pg.click('button[onclick="openOffsetTool()"]');
await pg.waitForSelector('#offset-panel');
await pg.click('#offset-panel .off-wahl[data-v="-0.2"]');
const b1 = await breite(), feld = await pg.inputValue('#offset-val');
ok('Knopf −0,2 wählt nur (Größe unverändert, Feld −0,2)', b1 === b0 && feld === '-0,2', { b0, b1, feld });
await pg.click('#offset-go');
const b2 = await breite();
ok('Anwenden: −0,2 je Seite → Breite −0,4 mm', Math.abs(b2 - (b0 - 0.4)) < 0.01, { b0, b2 });
ok('„Bisher“ zeigt −0,2 mm', (await pg.textContent('#offset-sum')).trim() === '-0,2 mm', await pg.textContent('#offset-sum'));
// eigener Wert mit Komma + Enter
await pg.fill('#offset-val', '0,1'); await pg.press('#offset-val', 'Enter');
const b3 = await breite();
ok('Eingabe „0,1“ + Enter → +0,2 mm Breite', Math.abs(b3 - (b2 + 0.2)) < 0.01, { b2, b3 });
// Fenster neu öffnen zeigt bisherige Summe
await pg.click('#offset-panel span[onclick="_offsetClose()"]');
await pg.click('button[onclick="openOffsetTool()"]');
ok('neu geöffnet: Bisher −0,1 mm', (await pg.textContent('#offset-sum')).trim() === '-0,1 mm', await pg.textContent('#offset-sum'));
// leeres Feld: nichts passiert
await pg.click('#offset-go');
ok('leeres Feld: keine Änderung', (await breite()) === b3);
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
