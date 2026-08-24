// Test für Zweitschrift + Trennlinie im Tortentopper (Wunsch von Ralf):
// Zeile 1 in Schreibschrift, darunter Zeilen in einer ZWEITEN Schrift, dazwischen
// eine wählbare Trennlinie ("keine" | "zwischen Schrift 1 und 2" | "zwischen allen Zeilen").
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8762;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);   // ein evtl. Service-Worker-Reload darf durchlaufen
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1000);

const res = await page.evaluate(async () => {
  const out = {};
  if (typeof _ttDividerParts !== 'function') return { err: '_ttDividerParts fehlt' };

  const set = (id, v) => { const e = document.getElementById(id); if ('checked' in e && typeof v === 'boolean') e.checked = v; else e.value = v; };
  set('tt-text', 'Lisa');
  set('tt-font', 'greatvibes_local');
  set('tt-text2', '1. KLASSE');
  set('tt-font2', 'baloo_local');   // lokale Blockschrift — helvetiker_bold käme vom CDN, das im Test-Container gesperrt ist
  set('tt-size2', 70);
  set('tt-dheart', false);
  set('tt-pins', 1);
  set('tt-explode', false);

  const run = (divider, explode) => new Promise(res2 => {
    set('tt-divider', divider);
    set('tt-explode', !!explode);
    const o = _ttOpts();
    _ttWithFonts(o, font => {
      let r = null, err = null;
      try { r = _ttGeo(font, o, true); } catch (e) { err = String(e); }
      if (!r) return res2({ err: err || 'kein Ergebnis' });
      res2({
        wMM: +r.wMM.toFixed(1), hMM: +r.hMM.toFixed(1), bridges: r.nBridges,
        pieces: r.pieces.map(p => p.name),
        font2Used: !!o.font2,
      });
    });
  });

  // 1) ohne Trennlinie — Grundfall zwei Schriften
  out.none = await run('none', false);
  // 2) Trennlinie zwischen den Schriften, zerlegt → "Trennlinie" muss als Teil auftauchen
  out.blocks = await run('blocks', true);
  // 3) drei Zeilen, Linie zwischen ALLEN → zwei Trennlinien
  set('tt-text', 'Lisa\nMarie');
  out.all = await run('all', true);
  // 4) nur Hauptschrift, eine Zeile, Trennlinie an → darf nichts erzeugen und nichts werfen
  set('tt-text', 'Lisa'); set('tt-text2', '');
  out.single = await run('all', true);
  // 5) Layout-Detail: Trennlinie liegt zwischen den Blöcken und ist breit genug
  set('tt-text', 'Lisa'); set('tt-text2', '1. KLASSE');
  out.geom = await new Promise(res2 => {
    set('tt-divider', 'blocks');
    const o = _ttOpts();
    _ttWithFonts(o, font => {
      const sizeU = o.sizeMM / 10;
      const parts = _ttLayoutParts(font, o.txt, sizeU, o.overlap / 100, sizeU * o.lineGap / 100, o);
      const div = _ttDividerParts(parts, o, sizeU);
      if (div.length !== 1) return res2({ err: 'erwartet 1 Trennlinie, bekam ' + div.length });
      const b = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 };
      for (const q of div[0].pts) { b.minX = Math.min(b.minX, q.x); b.maxX = Math.max(b.maxX, q.x); b.minY = Math.min(b.minY, q.y); b.maxY = Math.max(b.maxY, q.y); }
      let l0 = { min: 1e9, max: -1e9 }, l1 = { min: 1e9, max: -1e9 }, w1 = { min: 1e9, max: -1e9 };
      for (const p of parts) {
        const t = p.li === 0 ? l0 : l1;
        for (const q of p.pts) {
          t.min = Math.min(t.min, q.y); t.max = Math.max(t.max, q.y);
          if (p.li === 1) { w1.min = Math.min(w1.min, q.x); w1.max = Math.max(w1.max, q.x); }
        }
      }
      res2({
        nLines: parts.nLines, nMain: parts.nMain,
        widthMM: +((b.maxX - b.minX) * 10).toFixed(1),
        thickMM: +((b.maxY - b.minY) * 10).toFixed(2),
        spansLine2: b.minX <= w1.min && b.maxX >= w1.max,      // Linie überspannt die breitere Zeile
        betweenBlocks: b.maxY <= l0.max && b.minY >= l1.min,   // liegt im Band zwischen den Blöcken
      });
    });
  });
  return out;
});

await browser.close();
srv.kill();

console.log(JSON.stringify(res, null, 2));
const fail = [];
if (res.err) fail.push(res.err);
else {
  for (const k of ['none', 'blocks', 'all', 'single', 'geom']) if (res[k] && res[k].err) fail.push(k + ': ' + res[k].err);
  if (res.none && !res.none.err) {
    if (!res.none.font2Used) fail.push('Zweitschrift wurde nicht geladen');
    if (res.none.pieces.includes('Trennlinie')) fail.push('none: Trennlinie erzeugt obwohl "keine"');
  }
  if (res.blocks && !res.blocks.err) {
    const n = res.blocks.pieces.filter(p => /^Trennlinie/.test(p)).length;
    if (n !== 1) fail.push('blocks: erwartet 1 Trennlinien-Teil, bekam ' + n);
    if (!res.blocks.pieces.some(p => /^K/.test(p))) fail.push('blocks: Buchstaben der Zweitschrift fehlen');
  }
  if (res.all && !res.all.err) {
    const n = res.all.pieces.filter(p => /^Trennlinie/.test(p)).length;
    if (n !== 2) fail.push('all: erwartet 2 Trennlinien-Teile, bekam ' + n);
  }
  if (res.single && !res.single.err) {
    const n = res.single.pieces.filter(p => /^Trennlinie/.test(p)).length;
    if (n !== 0) fail.push('single: Trennlinie bei nur einer Zeile');
  }
  if (res.geom && !res.geom.err) {
    if (res.geom.nLines !== 2 || res.geom.nMain !== 1) fail.push('geom: Zeilenzählung falsch');
    if (!res.geom.spansLine2) fail.push('geom: Linie überspannt die breitere Zeile nicht');
    if (!res.geom.betweenBlocks) fail.push('geom: Linie liegt nicht zwischen den Blöcken');
    if (Math.abs(res.geom.thickMM - 1.5) > 0.05) fail.push('geom: Linien-Stärke ' + res.geom.thickMM + ' statt 1,5 mm');
  }
}
if (errs.length) fail.push('Seitenfehler: ' + errs.join(' | '));
if (fail.length) { console.error('FAIL:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('OK — Zweitschrift + Trennlinie funktionieren');
