// Formattest: OTF (CFF/kubische Kurven) und Härtefälle. Gegen den --dev-Server.
import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8769/volme3d.html';
const ok = [], bad = [];
const check = (n, c, i = '') => (c ? ok : bad).push(n + (i ? '  ' + i : ''));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window._ufPick === 'function' && window.THREE, null, { timeout: 30000 });
await page.evaluate(() => { localStorage.removeItem('v3d_userFonts'); window.__n = []; const o = window.notify; window.notify = (m, t) => { window.__n.push(t + ': ' + m); return o && o(m, t); }; });
await page.evaluate(() => _ttOpen());
await page.evaluate(() => _ufPick('tt-font'));

async function load(path, label) {
  const before = await page.evaluate(() => (typeof _ufFonts !== 'undefined' ? _ufFonts.length : 0));
  await page.evaluate(() => { window.__n = []; });
  await page.setInputFiles('#uf-file', path);
  await page.waitForTimeout(9000);
  return page.evaluate(b => ({
    added: _ufFonts.length - b,
    last: _ufFonts.length ? { key: _ufFonts[_ufFonts.length - 1].key, label: _ufFonts[_ufFonts.length - 1].label,
                              glyphs: Object.keys(_ufFonts[_ufFonts.length - 1].json.glyphs).length,
                              cmds: (_ufFonts[_ufFonts.length - 1].json.glyphs['A'] || {}).o || '' } : null,
    notes: window.__n
  }), before);
}

// --- OTF mit CFF-Konturen ---------------------------------------------------
const otf = await load('/usr/share/fonts/opentype/malayalam/Gayathri-Regular.otf', 'OTF');
check('OTF (CFF) wird angenommen', otf.added === 1, JSON.stringify(otf.notes));
if (otf.added === 1) {
  check('OTF liefert Zeichen', otf.last.glyphs > 50, `${otf.last.glyphs} Zeichen, "${otf.last.label}"`);
  check('OTF nutzt kubische Kurven (b-Kommandos)', /\bb /.test(otf.last.cmds), otf.last.cmds.slice(0, 70));
  const geo = await page.evaluate(key => new Promise(res => {
    const o = _ttOpts(); o.fontKey = key; o.txt = 'Julia\nPatrick';
    _ttWithFonts(o, f => { try { const r = _ttGeo(f, o, false); res(r ? { v: r.geo.attributes.position.count, w: +r.wMM.toFixed(1), h: +r.hMM.toFixed(1) } : { err: 'leer' }); } catch (e) { res({ err: e.message }); } });
  }), otf.last.key);
  check('Topper aus OTF baut sauber', !geo.err && geo.v > 1000, JSON.stringify(geo));
}

// --- Härtefall: riesige CJK-Schrift ----------------------------------------
const cjk = await load('/usr/share/fonts/truetype/fonts-japanese-gothic.ttf', 'CJK');
check('Große CJK-Schrift stürzt nicht ab', true, `angenommen=${cjk.added}, Meldung: ${(cjk.notes[cjk.notes.length - 1] || '').slice(0, 90)}`);

// --- Härtefall: Datei, die keine Schrift ist --------------------------------
const junk = await load('/home/v3da/logo.svg', 'Müll');
check('Nicht-Schriftdatei wird sauber abgelehnt',
  junk.added === 0 && junk.notes.some(n => /keine lesbare|nicht/i.test(n)),
  JSON.stringify(junk.notes.slice(-1)));

check('Keine JS-Fehler', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log('\nBESTANDEN (' + ok.length + '):'); ok.forEach(s => console.log('  ✓ ' + s));
if (bad.length) { console.log('\nFEHLGESCHLAGEN (' + bad.length + '):'); bad.forEach(s => console.log('  ✗ ' + s)); }
console.log('\n=> ' + (bad.length ? 'FEHLER' : 'ALLES GRÜN'));
await page.evaluate(() => { try { localStorage.removeItem('v3d_userFonts'); } catch (e) { } });
await browser.close();
process.exit(bad.length ? 1 : 0);
