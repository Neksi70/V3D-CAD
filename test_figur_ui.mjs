// UI-Test Figur-Baukasten: Katalog → Dialog → Vorlage klicken → Erstellen → KI-Übergabe
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = +process.env.PORT || 8842;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof _fgbOpen === 'function');
await page.waitForTimeout(1500);
const fail = m => { console.log('XX', m); process.exitCode = 1; };
// Startdialog: Karte vorhanden?
const card = await page.evaluate(() => [...document.querySelectorAll('#start-grid *')].some(e => /Figur-Baukasten/.test(e.textContent)));
console.log(card ? 'OK Startkarte' : 'XX Startkarte fehlt'); if (!card) process.exitCode = 1;
await page.evaluate(() => { hideStarter(); _fgbOpen(); });
await page.waitForTimeout(2500);
await page.click('#fgb-bg-preset [data-k="drache"]');
await page.waitForTimeout(1500);
const st = await page.evaluate(() => ({ kind: _fgbP.kind, arch: _fgbP.arch, poseOpts: document.getElementById('fgb-pose').options.length,
  wings: document.getElementById('fgb-wings').value, prev: !!(_gpv.fgb && _gpv.fgb.group), on: document.querySelector('#fgb-bg-preset .on')?.dataset.k }));
console.log(JSON.stringify(st));
if (st.kind !== 'drache' || st.poseOpts !== 4 || st.wings !== 'dragon' || !st.prev || st.on !== 'drache') fail('Vorlage/Vorschau');
await page.selectOption('#fgb-hat', 'witch'); await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/fgb_dialog.png' });
const n0 = await page.evaluate(() => objects.length);
await page.click('#fgb-modal .g3foot .btn.pri');
await page.waitForFunction(n => objects.length > n, n0, { timeout: 60000 });
const o = await page.evaluate(() => { const m = objects[objects.length - 1]; const bb = new THREE.Box3().setFromObject(m);
  return { name: m.userData.name, type: m.userData.type, tris: m.geometry.index.count / 3, h: +((bb.max.z - bb.min.z) * 10).toFixed(1), hy: +((bb.max.y - bb.min.y) * 10).toFixed(1), hasP: !!m.userData.fgb }; });
console.log(JSON.stringify(o));
if (!/Drache/.test(o.name) || !o.hasP) fail('Objekt');
// KI-Übergabe
await page.evaluate(() => { _fgbOpen(); document.getElementById('fgb-ki').value = 'baby dragon sleeping on a pile of gold coins'; _fgbToKi('text'); });
await page.waitForTimeout(500);
const ki = await page.evaluate(() => ({ prompt: document.getElementById('ki-prompt').value, target: window._kiTargetHmm, open: document.getElementById('ki-panel').classList.contains('show') }));
console.log(JSON.stringify(ki));
if (!/^baby dragon/.test(ki.prompt) || !/wizard hat/.test(ki.prompt) || ki.target !== 60) fail('KI-Prompt');
await page.screenshot({ path: '/tmp/fgb_ki.png' });
console.log('pageerrors:', errs.length ? errs : 'keine'); if (errs.length) process.exitCode = 1;
await browser.close(); srv.kill();
