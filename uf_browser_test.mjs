// Headless-Test des TTF/OTF-Uploads. Läuft gegen den --dev-Server (Port 8766),
// damit die Arbeitskopie geprüft wird und nicht die ausgelieferte dist.
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8765/volme3d.html';   // 8765 = ausgelieferte dist, V3D_URL=…:8766 fuer die Arbeitskopie
const TTF = '/home/v3da/volmedraw/lib/GreatVibes-Regular.ttf';
const ok = [], bad = [];
const check = (name, cond, info = '') => (cond ? ok : bad).push(name + (info ? '  ' + info : ''));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._ufPick === 'function' && window.THREE, null, { timeout: 30000 });

// --- Referenz: Topper mit dem eingebauten Great Vibes -----------------------
const topper = (fontKey) => page.evaluate(key => new Promise(res => {
  const o = _ttOpts();
  o.fontKey = key;
  _ttWithFonts(o, font => {
    try {
      const r = _ttGeo(font, o, false);
      if (!r) return res({ err: 'keine Geometrie' });
      r.geo.computeBoundingBox();
      const b = r.geo.boundingBox;
      res({
        verts: r.geo.attributes.position.count,
        nBridges: r.nBridges,
        wMM: +r.wMM.toFixed(2), hMM: +r.hMM.toFixed(2),
        bbox: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map(v => +v.toFixed(3))
      });
    } catch (e) { res({ err: e.message }); }
  });
}), fontKey);

await page.evaluate(() => _ttOpen());
const ref = await topper('greatvibes_local');
check('Referenz-Topper (eingebautes Great Vibes) baut', !ref.err, JSON.stringify(ref));

// --- TTF laden --------------------------------------------------------------
await page.evaluate(() => _ufPick('tt-font'));
await page.setInputFiles('#uf-file', TTF);
await page.waitForFunction(() => typeof _ufFonts !== "undefined" && _ufFonts.length === 1, null, { timeout: 20000 });

const st = await page.evaluate(() => ({
  n: _ufFonts.length,
  key: _ufFonts[0].key,
  label: _ufFonts[0].label,
  glyphs: Object.keys(_ufFonts[0].json.glyphs).length,
  cached: !!window['_threeFont_' + _ufFonts[0].key],
  ttSel: document.getElementById('tt-font').value,
  optsIn: ['tt-font', 'name-font', 'text3d-font'].map(id =>
    !!document.getElementById(id).querySelector('option[value="' + _ufFonts[0].key + '"]')),
  optFirst: document.getElementById('tt-font').options[0].textContent,
  ls: (localStorage.getItem('v3d_userFonts') || '').length,
  gz: (localStorage.getItem('v3d_userFonts') || '').slice(0,4) === 'GZ1:',
  raw: JSON.stringify(_ufFonts).length
}));
check('Schrift registriert', st.n === 1, `key=${st.key} label="${st.label}" ${st.glyphs} Zeichen`);
check('Name aus der Schriftdatei gelesen', /^Great Vibes/.test(st.label), `"${st.label}"`);
check('In three-Cache gelegt', st.cached);
check('Option in allen 3 Schrift-Auswahlen', st.optsIn.every(Boolean), JSON.stringify(st.optsIn));
check('Option steht oben und ist als eigene markiert', /★.*eigene/.test(st.optFirst), `"${st.optFirst}"`);
check('Tortentopper-Auswahl springt auf die neue Schrift', st.ttSel === st.key);
check('In localStorage gespeichert (gzip)', st.ls > 1000 && st.gz, `${Math.round(st.ls / 1024)} KB, komprimiert=${st.gz}, roh=${Math.round(st.raw/1024)} KB`);

// --- Topper mit der geladenen Schrift ---------------------------------------
const mine = await topper(st.key);
check('Topper mit eigener Schrift baut', !mine.err, JSON.stringify(mine));
if (!mine.err && !ref.err) {
  const dW = Math.abs(mine.wMM - ref.wMM), dH = Math.abs(mine.hMM - ref.hMM);
  const dB = Math.max(...mine.bbox.map((v, i) => Math.abs(v - ref.bbox[i])));
  check('Maße stimmen mit eingebautem Great Vibes überein',
    dW < 0.5 && dH < 0.5 && dB < 0.05 && mine.nBridges === ref.nBridges,
    `Δbreite=${dW.toFixed(2)}mm Δhöhe=${dH.toFixed(2)}mm ΔBBox=${dB.toFixed(3)} Stege ${mine.nBridges}/${ref.nBridges}`);
  check('Buchstaben-Umrisse vorhanden (Eckenzahl plausibel)',
    Math.abs(mine.verts - ref.verts) / ref.verts < 0.05, `${mine.verts} vs ${ref.verts} Ecken`);
}

// --- Vorschau + echtes Erzeugen in der Szene --------------------------------
const created = await page.evaluate(() => new Promise(res => {
  const before = objects.length;
  try { _ttCreate(); } catch (e) { return res({ err: e.message }); }
  setTimeout(() => res({ added: objects.length - before }), 3000);
}));
check('Topper landet als Objekt in der Szene', created.added > 0, JSON.stringify(created));

// --- Persistenz über Reload -------------------------------------------------
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window._ufRestore === 'function', null, { timeout: 30000 });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({
  n: typeof _ufFonts !== "undefined" ? _ufFonts.length : -1,
  cached: typeof _ufFonts !== "undefined" && _ufFonts[0] ? !!window['_threeFont_' + _ufFonts[0].key] : false,
  opt: !!document.getElementById('tt-font').querySelector('option[value^="user_"]')
}));
check('Schrift überlebt einen Reload', after.n === 1 && after.cached && after.opt, JSON.stringify(after));

// --- Aufräumen: Schrift wieder entfernen ------------------------------------
const removed = await page.evaluate(() => {
  const key = _ufFonts[0].key;
  window.prompt = () => '1';
  _ufManage();
  return { n: _ufFonts.length, cached: !!window['_threeFont_' + key],
           opt: !!document.getElementById('tt-font').querySelector('option[value="' + key + '"]'),
           ls: _dsDecompress(localStorage.getItem('v3d_userFonts') || '[]') };
});
check('Entfernen räumt Liste, Cache und Auswahl auf',
  removed.n === 0 && !removed.cached && !removed.opt && removed.ls === '[]', JSON.stringify(removed));

check('Keine JS-Fehler auf der Seite', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log('\nBESTANDEN (' + ok.length + '):');
ok.forEach(s => console.log('  ✓ ' + s));
if (bad.length) { console.log('\nFEHLGESCHLAGEN (' + bad.length + '):'); bad.forEach(s => console.log('  ✗ ' + s)); }
console.log('\n=> ' + (bad.length ? 'FEHLER' : 'ALLES GRÜN'));
await browser.close();
process.exit(bad.length ? 1 : 0);
