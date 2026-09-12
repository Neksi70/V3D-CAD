// Josy 12.9.26 (Mac): "Safari kann die Seite blob:… nicht öffnen
// (WebKitBlobResource-Fehler 1)" beim STL-Download.
// Faehrt den Export in der WebKit-Engine (Safaris Unterbau) und prueft, ob ein
// echter Download herauskommt — statt einer Navigation zur blob:-Adresse.
import { webkit } from 'playwright';
const URL_APP = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const b = await webkit.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
const downloads = []; pg.on('download', d => downloads.push(d.suggestedFilename()));
const navs = []; pg.on('framenavigated', f => { if (f === pg.mainFrame()) navs.push(f.url()); });
await pg.goto(URL_APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

await pg.evaluate(() => { addShape('box'); objects[objects.length - 1].scale.set(2, 2, 2); selectObjs([]); });
await pg.waitForTimeout(300);

// A) Export über den normalen Weg — als echter Klick, damit die Nutzergeste zählt
await pg.evaluate(() => {
  const b = document.createElement('button');
  b.id = 'test-export'; b.textContent = 'Export';
  b.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99999';
  b.onclick = () => exportSTL();
  document.body.appendChild(b);
});
await pg.click('#test-export');
await pg.waitForTimeout(2500);
console.log('Downloads:', downloads, '| Navigationen:', navs.filter(u => u.startsWith('blob:')));
ok('STL kommt als Download an (nicht als blob:-Seite)', downloads.some(f => f.endsWith('.stl')), downloads);
ok('Browser ist nicht zur blob:-Adresse navigiert', !navs.some(u => u.startsWith('blob:')), navs.slice(-2));

// B) Der Weg über "an Slicer senden" (ohne Druck-Helfer auf dem Rechner)
downloads.length = 0;
await pg.evaluate(() => {
  const b = document.createElement('button');
  b.id = 'test-slicer'; b.style.cssText = 'position:fixed;left:120px;top:10px;z-index:99999';
  b.textContent = 'Slicer'; b.onclick = () => _sendCurrentToSlicer();
  document.body.appendChild(b);
});
await pg.click('#test-slicer');
await pg.waitForTimeout(3000);
console.log('Downloads (Slicer-Weg):', downloads);
ok('auch ohne Druck-Helfer kommt die Datei an', downloads.length > 0, downloads);
ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
