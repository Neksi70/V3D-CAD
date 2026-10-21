// Bibliothek: eine schon vereinfachte Datei wird NIE ein zweites Mal vereinfacht – auch nicht
// in einem frischen Browser (Vermerk in der Datei). Doppelklick auf „Öffnen" öffnet nur einmal.
// (Volker 21.10.: Kopf-Scan in neuem Browser 858k → 378k; große Datei anklicken → hängt.)
// Braucht Helfer v12 auf 127.0.0.1:7777 mit Scan_Kopf.3mf (Original-Scan) + Relief.stl im
// Bibliotheksordner, Unterordner Original leer.
import { spawn } from 'child_process';
import fs from 'fs';
import { chromium } from '@playwright/test';
const PORT = 8939;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const list = async () => (await (await fetch('http://127.0.0.1:7777/list', { headers: { Origin: 'http://127.0.0.1:' + PORT } })).json()).files;
const sizeOf = async n => { const f = (await list()).find(x => x.name.replace(/^\//, '') === n); return f ? f.size : -1; };

async function browserRun(fn) {
  const dir = fs.mkdtempSync('/tmp/claude-1000/profil-');
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1400, height: 900 } });
  const page = ctx.pages()[0]; const errs = []; page.on('pageerror', e => errs.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
    await page.waitForFunction(() => typeof _stlLibOpen === 'function' && typeof hideStarter === 'function');
    await page.evaluate(async () => { try { hideStarter(); } catch (e) {} await _stlIdbSet('kv', 'source', 'helper'); });
    await page.evaluate(() => _stlLibOpen());
    await page.waitForFunction(() => _stlFiles.length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => !_stlChkBusy && !_stlThumbBusy && !_stlThumbPending.length, null, { timeout: 600000, polling: 1000 });
    return await fn(page);
  } finally { if (errs.length) { console.log('Seitenfehler: ' + errs.join(' | ')); fail++; } await ctx.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

try {
  const s0 = await sizeOf('Scan_Kopf.3mf');
  await browserRun(async () => {});
  const s1 = await sizeOf('Scan_Kopf.3mf');
  ok(s1 > 0 && s1 < s0, `Browser A: Scan_Kopf.3mf vereinfacht (${(s0 / 1e6).toFixed(1)} → ${(s1 / 1e6).toFixed(1)} MB)`);
  await browserRun(async () => {});
  const s2 = await sizeOf('Scan_Kopf.3mf');
  ok(s2 === s1, `frischer Browser B: NICHT noch einmal vereinfacht (${(s2 / 1e6).toFixed(1)} MB)`);
  ok(!(await list()).some(f => /Original\/Scan_Kopf_2\.3mf$/.test(f.name)), 'kein zweites Original (Scan_Kopf_2.3mf)');

  await browserRun(async (page) => {
    // Doppelklick auf „Öffnen" bei einer großen Datei → nur ein Körper; vereinfachte Datei ohne Nachfrage
    const r = await page.evaluate(async () => {
      const i = _stlFiles.findIndex(f => /Scan_Kopf\.3mf$/.test(f.path) && !/Original/.test(f.path));
      const btn = document.querySelector('[onclick="_stlOpenInScene(' + i + ')"]');
      const n0 = objects.length;
      btn.click(); await new Promise(r => setTimeout(r, 30));
      const txt = btn.textContent;
      _stlOpenInScene(i);   // zweiter Klick, während der erste noch läuft
      let fenster = false;
      for (let k = 0; k < 600 && objects.length === n0; k++) { if (document.getElementById('bigmesh-modal').classList.contains('show')) fenster = true; await new Promise(r => setTimeout(r, 100)); }
      await new Promise(r => setTimeout(r, 3000));
      return { neu: objects.length - n0, txt, fenster, tris: Math.round(_geoTriCount(objects[objects.length - 1].geometry)) };
    });
    ok(/Wird geöffnet/.test(r.txt), `Knopf zeigt sofort „${r.txt.trim()}“`);
    ok(r.neu === 1, `Doppelklick öffnet nur einmal (${r.neu} Körper)`);
    ok(!r.fenster, `schon vereinfachte Datei: kein Warnfenster, geladen mit ${r.tris} Dreiecken`);
  });
} finally { srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
