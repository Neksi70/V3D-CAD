// Bibliothek: Reiter „Ordner" (Kacheln, hineinklicken, zurück) + flache Liste in „Alle"
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
const PORT = 8917;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _stlRenderGrid === 'function' && typeof hideStarter === 'function');
  await page.evaluate(() => {
    try { hideStarter(); } catch (e) {}
    document.getElementById('stllib-modal').classList.add('show');
    const t = Date.now(), mk = (path, d) => ({ name: _stlBase(path), path, size: 1000 * (d + 1), mtime: t - d * 864e5, _thumbDone: true });
    _stlFiles.splice(0, _stlFiles.length,
      mk('Dackel.stl', 1), mk('Box.3mf', 2),
      mk('Lampe/Fuss.stl', 5), mk('Lampe/Schirm.stl', 6), mk('Lampe/Teile/Schraube.stl', 7),
      mk('Auto/Rad.stl', 3), mk('Auto/Karosse.3mf', 4));
    _stlSetFmt('');
  });
  const state = () => page.evaluate(() => ({
    hdr: document.querySelectorAll('#stllib-grid .stl-folder-hdr').length,
    dirs: [...document.querySelectorAll('#stllib-grid .stl-dir-card .ds-name')].map(e => e.textContent),
    files: [...document.querySelectorAll('#stllib-grid .ds-card:not(.stl-dir-card) .ds-name')].map(e => e.textContent),
    crumbs: [...document.querySelectorAll('#stllib-grid .stl-crumb')].map(e => e.textContent),
  }));
  let s = await state();
  ok(s.hdr === 0 && s.files.length === 7 && s.dirs.length === 0, '„Alle": 7 Karten flach, keine Ordner-Überschriften');
  ok(s.files.join() === 'Dackel.stl,Box.3mf,Rad.stl,Karosse.3mf,Fuss.stl,Schirm.stl,Schraube.stl', '„Alle": nach Datum über Ordnergrenzen sortiert → ' + s.files.join());
  await page.click('#stllib-tabs [data-fmt="__dir"]');
  s = await state();
  ok(s.dirs.join() === '📁 Auto,📁 Lampe' && s.files.length === 0, 'Ordner-Reiter: Kacheln Auto, Lampe (neueste zuerst), keine Einzeldateien → ' + s.dirs.join());
  ok(await page.evaluate(() => document.querySelector('#stllib-tabs [data-fmt="__dir"]').classList.contains('pri')), 'Ordner-Reiter ist hervorgehoben');
  await page.screenshot({ path: '/tmp/claude-1000/-home-v3da-orca-wasm/6d2473fd-670d-589d-8423-d4009bc1b35b/scratchpad/ordner1.png' });
  await page.click('.stl-dir-card:has-text("Lampe")');
  s = await state();
  ok(s.dirs.join() === '📁 Teile' && s.files.join() === 'Fuss.stl,Schirm.stl', 'In „Lampe": Unterordner Teile + 2 Dateien → ' + s.dirs.join() + ' | ' + s.files.join());
  ok(s.crumbs.join(' › ') === '📁 Ordner › Lampe', 'Pfadzeile: ' + s.crumbs.join(' › '));
  await page.click('.stl-dir-card:has-text("Teile")');
  s = await state();
  ok(s.files.join() === 'Schraube.stl' && s.crumbs.length === 3, 'In „Lampe/Teile": Schraube.stl');
  await page.screenshot({ path: '/tmp/claude-1000/-home-v3da-orca-wasm/6d2473fd-670d-589d-8423-d4009bc1b35b/scratchpad/ordner2.png' });
  await page.click('#stllib-grid .stl-folder-hdr button');
  s = await state();
  ok(s.dirs.join() === '📁 Teile', '← Zurück führt nach „Lampe"');
  await page.click('#stllib-grid .stl-crumb >> nth=0');
  s = await state();
  ok(s.dirs.length === 2 && s.crumbs.length === 0, 'Pfadzeile „Ordner" führt zur Übersicht');
  await page.fill('#stllib-search', 'schraube');
  s = await state();
  ok(s.dirs.join() === '📁 Lampe', 'Suche im Ordner-Reiter zeigt nur passende Ordner → ' + s.dirs.join());
  await page.fill('#stllib-search', '');
  await page.selectOption('#stllib-sort', 'name_desc');
  s = await state();
  ok(s.dirs.join() === '📁 Lampe,📁 Auto', 'Sortierung Name Z→A gilt auch für Ordner');
  await page.selectOption('#stllib-sort', 'date_desc');
  await page.click('#stllib-tabs [data-fmt="3mf"]');
  s = await state();
  ok(s.files.join() === 'Box.3mf,Karosse.3mf' && s.dirs.length === 0, '3MF-Reiter weiter korrekt');
  // Ordner verschwindet (gelöscht) während er offen ist → Übersicht
  await page.click('#stllib-tabs [data-fmt="__dir"]'); await page.click('.stl-dir-card:has-text("Auto")');
  await page.evaluate(() => { for (let i = _stlFiles.length - 1; i >= 0; i--) if (_stlFiles[i].path.startsWith('Auto/')) _stlFiles.splice(i, 1); _stlRenderGrid(); });
  s = await state();
  ok(s.dirs.join() === '📁 Lampe' && s.crumbs.length === 0, 'offener Ordner gelöscht → zurück in der Übersicht');
  ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK'); process.exit(fail ? 1 : 0);
