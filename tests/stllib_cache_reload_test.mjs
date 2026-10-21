// Vorschaubilder müssen sich über ein Neuladen der Seite hinweg merken: beim zweiten Mal
// keine Datei vom Helfer lesen, alle Bilder sofort da (Volker 21.10.: „lädt jedes Mal neu").
// Braucht Helfer v12 auf 127.0.0.1:7777 mit Testdateien.
import { spawn } from 'child_process';
import fs from 'fs';
import { chromium } from '@playwright/test';
const PORT = 8933;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const dir = fs.mkdtempSync('/tmp/claude-1000/profil-');
const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1400, height: 900 } });
const runOnce = async (label) => {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _stlLibOpen === 'function' && typeof hideStarter === 'function');
  return page.evaluate(async () => {
    try { hideStarter(); } catch (e) {}
    await _stlIdbSet('kv', 'source', 'helper');
    let reads = 0; const orig = _stlReadBytes; _stlReadBytes = async f => { reads++; return orig(f); };
    const t0 = performance.now(); let tFirst = 0; await _stlLibOpen();
    for (let i = 0; i < 6000; i++) {
      const w = [...document.querySelectorAll('#stllib-grid .ds-thumb-wrap')];
      if (!tFirst && w.length) tFirst = performance.now() - t0;
      if (w.length && !w.some(x => x.textContent.includes('⏳')) && !_stlThumbPending.length && !_stlThumbBusy && !_stlChkBusy) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const ms = Math.round(performance.now() - t0);
    return { ms, reads, imgs: document.querySelectorAll('#stllib-grid img.ds-thumb').length, cards: document.querySelectorAll('#stllib-grid .ds-thumb-wrap').length };
  });
};
try {
  const a = await runOnce('erstes Mal'); console.log('INFO erstes Mal: ' + JSON.stringify(a));
  const b = await runOnce('nach Neuladen'); console.log('INFO nach Neuladen: ' + JSON.stringify(b));
  ok(a.reads > 0, `erstes Mal: Dateien gelesen (${a.reads})`);
  ok(b.reads === 0, `nach Neuladen der Seite: keine Datei neu gelesen (${b.reads})`);
  ok(b.imgs === b.cards, `nach Neuladen: alle ${b.cards} Vorschaubilder da`);
  ok(b.ms < 1500, `nach Neuladen: in ${b.ms} ms komplett`);
} finally { await ctx.close(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
