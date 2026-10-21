// Burkhard 21.10.: Menü → Speichern als „Schriftplatte xy“ → STL-Export hieß weiter wie der
// Fantasiename. Prüft: Name aus dem Dateidialog wird Entwurfsname (Reiter + Exportdatei),
// für neuen Entwurf UND für einen schon automatisch gespeicherten. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
let fehler = 0;
const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
for (const vorher of ['neu', 'autosave']) {
  const r = await pg.evaluate(async (vorher) => {
    hideStarter(); _newCreate(false); setShapeMode('solid'); addShape('box');
    if (vorher === 'autosave') { _doAutoSave(); await new Promise(r => setTimeout(r, 800)); }
    const alt = _designName();
    // Dateidialog wie in Chrome/Edge, Nutzer tippt „Schriftplatte xy“
    window.showSaveFilePicker = async () => ({ name: 'Schriftplatte xy.v3d', kind: 'file',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }), queryPermission: async () => 'granted' });
    _localFileHandle = null;
    await _localSave();
    await new Promise(r => setTimeout(r, 500));
    return { alt, entwurf: _designName(), stl: _designFilename('stl'), mf: _designFilename('3mf'),
      anzeige: document.getElementById('cur-design-lbl')?.textContent, meta: dsGetMeta(currentDesignId)?.name };
  }, vorher);
  console.log(vorher + ':', JSON.stringify(r));
  ok(`${vorher}: Entwurf heißt wie die Datei`, r.entwurf === 'Schriftplatte xy', r.entwurf);
  ok(`${vorher}: STL-Export heißt Schriftplatte_xy.stl`, r.stl === 'Schriftplatte_xy.stl', r.stl);
  ok(`${vorher}: Name gespeichert`, r.meta === 'Schriftplatte xy', r.meta);
}
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
