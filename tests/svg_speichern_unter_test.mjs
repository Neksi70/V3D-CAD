// Volker 23.10.: Bild → SVG „⬇ SVG speichern“ öffnete kein Fenster, wohin gespeichert wird
// (stiller Download). Prüft _speichernUnter + die Knöpfe Bild→SVG und Muster. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof _speichernUnter === 'function', null, { timeout: 30000 });
const r = await pg.evaluate(async () => {
  const log = { picker: [], geschrieben: [], downloads: [] };
  window._downloadBlob = (blob, name) => log.downloads.push(name);
  window.showSaveFilePicker = async (opt) => { log.picker.push(opt.suggestedName + ' ' + JSON.stringify(opt.types[0].accept));
    if (window._abbrechen) { const e = new Error('abgebrochen'); e.name = 'AbortError'; throw e; }
    return { name: 'gewaehlt.svg', createWritable: async () => ({ write: async b => log.geschrieben.push(b.size), close: async () => {} }) }; };
  const out = {};
  out.direkt = await _speichernUnter(new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'test.svg', 'SVG-Grafik', 'image/svg+xml', ['.svg']);
  window._abbrechen = true;
  out.abbruch = await _speichernUnter(new Blob(['<svg/>']), 'test2.svg', 'SVG-Grafik', 'image/svg+xml', ['.svg']);
  window._abbrechen = false;
  // Knopf Bild → SVG
  window._vecSvgText = () => '<svg xmlns="http://www.w3.org/2000/svg"/>'; _vec.name = 'nachgezeichnet';
  _vecSave(); await new Promise(r => setTimeout(r, 200));
  // Knopf Muster
  window._pgSvgText = () => '<svg xmlns="http://www.w3.org/2000/svg"/>';
  _pgSaveSvg(); await new Promise(r => setTimeout(r, 200));
  // ohne Dialog-Unterstützung (Firefox): Download
  delete window.showSaveFilePicker; window.showSaveFilePicker = undefined;
  out.ohneDialog = await _speichernUnter(new Blob(['<svg/>']), 'test3.svg', 'SVG-Grafik', 'image/svg+xml', ['.svg']);
  return { out, log };
});
console.log(JSON.stringify(r, null, 1));
let fehler = 0; const ok = (n, c) => { console.log((c ? '  OK     ' : '  FEHLER ') + n); if (!c) fehler++; };
ok('Dialog geht auf und schreibt', r.out.direkt === 'gewaehlt.svg' && r.log.geschrieben.length >= 1);
ok('Abbrechen: nichts heruntergeladen', r.out.abbruch === null && !r.log.downloads.includes('test2.svg'));
ok('Bild → SVG öffnet den Dialog mit Vorschlag „nachgezeichnet.svg“', r.log.picker.some(x => x.startsWith('nachgezeichnet.svg')));
ok('Muster öffnet den Dialog', r.log.picker.some(x => x.startsWith('muster-')));
ok('ohne Dialog (Firefox/Safari): Download', r.out.ohneDialog === 'download' && r.log.downloads.includes('test3.svg'));
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
