// Regressionstest 🩺 Druck prüfen aus der Bibliothek (_dcb*, Volker 9.11.): 3MF-Projekt aus der Bibliothek
// öffnet die eingebettete Druckcheck-Seite (/druckcheck.html), Befunde erscheinen, „Verbessern“ +
// „💾 In der Bibliothek speichern“ schickt das verbesserte 3MF über den Helfer (/replace) an dieselbe Stelle.
// Start: python3 volme3d_server.py 8887 --dev  →  node tests/druckcheck_bibliothek_test.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8887/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const DATEI = new globalThis.URL('./fixtures/projekt_pla_zu_heiss.3mf', import.meta.url).pathname;
const b64 = readFileSync(DATEI).toString('base64');
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _dcbOeffnen === 'function' && typeof _stlRenderGrid === 'function', { timeout: 60000 });
await pg.evaluate((b64) => {
  document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden');
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  // Helfer-Bibliothek nachbilden: /file liefert die Datei, /replace merkt sich die neue Fassung
  window.__ersetzt = null; const fe = window.fetch;
  window.fetch = async (url, o) => {
    const u = String(url);
    if (u.startsWith(STLLIB_HELPER + '/ping')) return new Response(JSON.stringify({ ok: true, version: 12, slicers: [] }));
    if (u.startsWith(STLLIB_HELPER + '/list')) return new Response(JSON.stringify({ ok: true, files: [{ name: 'Halter.3mf', path: 'Projekte/Halter.3mf', size: u8.length, mtime: Date.now() }] }));
    if (u.startsWith(STLLIB_HELPER + '/file')) return new Response(u8.slice(0));
    if (u.startsWith(STLLIB_HELPER + '/print')) { window.__print = { datei: decodeURIComponent(o.headers['X-LibFile'] || o.headers['X-Filename'] || ''), slicer: o.headers['X-Slicer'] }; return new Response(JSON.stringify({ ok: true, slicer: 'Bambu Studio' })); }
    if (u.startsWith(STLLIB_HELPER + '/replace')) { window.__ersetzt = { pfad: decodeURIComponent(o.headers['X-LibFile']), bytes: new Uint8Array(o.body) }; return new Response(JSON.stringify({ ok: true })); }
    return fe(url, o);
  };
  _stlHelperOk = true; _stlHelperVer = 12;
  _stlFiles.splice(0, _stlFiles.length, { name: 'Halter.3mf', path: 'Projekte/Halter.3mf', lib: true, size: u8.length, mtime: Date.now() });
  _stlLibOpen && _stlLibOpen();
}, b64);
await pg.waitForTimeout(1200);
await pg.evaluate(() => { _stlHelperOk = true; _stlHelperVer = 12; if (!_stlFiles.length) _stlFiles.push({ name: 'Halter.3mf', path: 'Projekte/Halter.3mf', lib: true, size: 1, mtime: Date.now() }); _stlFiles.forEach(f => f.lib = true); _stlRenderGrid(); });
const pfadVorher = await pg.evaluate(() => _stlFiles[0].path);
const knopf = await pg.$('#stllib-grid .dcb-gross');
ok('🩺-Knopf an der 3MF-Kachel', !!knopf);
if (knopf) await knopf.click(); else await pg.evaluate(() => _dcbOeffnen(0));
await pg.waitForSelector('#dcb-modal', { state: 'visible' });
const frame = await (await pg.waitForSelector('#dcb-frame')).contentFrame();
await frame.waitForFunction(() => document.getElementById('cards') && document.querySelectorAll('#cards > *').length > 0, null, { timeout: 30000 });
const befund = await frame.evaluate(() => ({ name: document.getElementById('fName').textContent, text: document.getElementById('cards').innerText.slice(0, 600), magic: !document.getElementById('magic').hidden }));
ok('Datei in der Prüfung geöffnet', befund.name === 'Halter.3mf', befund.name);
ok('Befund: Düse zu heiß für PLA erkannt', /250|Düsentemperatur|Temperatur/i.test(befund.text), befund.text.slice(0, 160));
ok('„Verbessern“-Knopf angeboten', befund.magic);
await frame.click('#magic');
await frame.waitForSelector('#oBib', { timeout: 10000 });
ok('zwei Knöpfe nebeneinander: Speichern + Im Slicer öffnen', await frame.evaluate(() => { const a = document.getElementById('oBib').getBoundingClientRect(), b = document.getElementById('oSlc').getBoundingClientRect(); return /Speichern/.test(document.getElementById('oBib').textContent) && /Im Slicer öffnen/.test(document.getElementById('oSlc').textContent) && Math.abs(a.top - b.top) < 2 && b.left > a.left; }));
// erst nur im Slicer öffnen: Kopie „…_verbessert.3mf“, Bibliothek unverändert
await frame.click('#oSlc');
await pg.waitForFunction(() => !!window.__print, null, { timeout: 15000 }).catch(() => {});
const s0 = await pg.evaluate(() => ({ ersetzt: !!window.__ersetzt, print: window.__print }));
ok('Im Slicer öffnen ohne Speichern: Kopie _verbessert.3mf, Bibliothek unverändert', !s0.ersetzt && s0.print && /_verbessert\.3mf$/.test(s0.print.datei), s0);
await pg.evaluate(() => { window.__print = null; });
await frame.click('#oBib');
await pg.waitForFunction(() => !!window.__ersetzt, null, { timeout: 15000 }).catch(async () => { console.log('Knopf:', await frame.evaluate(() => document.getElementById('oBib').textContent), 'Helfer:', await pg.evaluate(() => [_stlHelperOk, _stlHelperVer])); });
const neu = await pg.evaluate(() => {
  const z = fflate.unzipSync(window.__ersetzt.bytes); const cfg = JSON.parse(new TextDecoder().decode(z['Metadata/project_settings.config']));
  return { pfad: window.__ersetzt.pfad, temp: cfg.nozzle_temperature, top: cfg.top_shell_layers, modell: !!z['3D/3dmodel.model'] };
});
ok('über den Helfer an dieselbe Stelle ersetzt', neu.pfad === pfadVorher, [neu.pfad, pfadVorher]);
ok('verbessertes 3MF: Temperatur gesenkt, Modell drin', parseFloat([].concat(neu.temp)[0]) < 250 && neu.modell, neu);
await frame.waitForFunction(() => /Gespeichert/.test(document.getElementById('oBib').textContent), null, { timeout: 5000 }).catch(() => {});
const rueck = await frame.evaluate(() => document.getElementById('oBib').textContent);
ok('Rückmeldung in der Prüfseite', /✓ Gespeichert/.test(rueck), rueck);
// 🖨 Speichern & im Slicer öffnen: erst ersetzen, dann über den Helfer im Slicer öffnen
await pg.evaluate(() => { window.__ersetzt = null; window.__print = null; });
ok('Knopf „Im Slicer öffnen“ vorhanden', !!(await frame.$('#oSlc')));
await frame.click('#oSlc');
await pg.waitForFunction(() => !!window.__print, null, { timeout: 15000 }).catch(() => {});
const sl = await pg.evaluate(() => ({ ersetzt: !!window.__ersetzt, print: window.__print }));
ok('Slicer-Weg nach „Speichern“: kein zweites Speichern, /print mit derselben Datei', !sl.ersetzt && sl.print && sl.print.datei === pfadVorher, sl);
await frame.waitForFunction(() => /Bambu Studio geöffnet/.test(document.getElementById('oSlc').textContent), null, { timeout: 5000 }).catch(() => {});
ok('Rückmeldung „In Bambu Studio geöffnet“', /In Bambu Studio geöffnet/.test(await frame.evaluate(() => document.getElementById('oSlc').textContent)), await frame.evaluate(() => document.getElementById('oSlc').textContent));
await pg.screenshot({ path: '/tmp/dcb_bibliothek.png' });
await frame.click('body', { position: { x: 5, y: 5 } }).catch(() => {}); await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
ok('Esc schließt', await pg.evaluate(() => document.getElementById('dcb-modal').style.display === 'none'));
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
