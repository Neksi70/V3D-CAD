// Vollbild-Knopf in der Kopfleiste: sichtbar, schaltet ein/aus, Symbol + Titel folgen dem Zustand
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8961;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _fsToggle === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} });
  ok(await p.isVisible('#fs-tb'), 'Knopf sichtbar');
  const d0 = await p.getAttribute('#fs-tb path', 'd');
  await p.click('#fs-tb');
  await p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 }).catch(() => {});
  ok(await p.evaluate(() => document.fullscreenElement === document.documentElement), 'Vollbild an');
  ok((await p.getAttribute('#fs-tb path', 'd')) !== d0, 'Symbol gewechselt');
  ok((await p.getAttribute('#fs-tb', 'title')).includes('beenden'), 'Titel „beenden"');
  await p.click('#fs-tb');
  await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 }).catch(() => {});
  ok(await p.evaluate(() => !document.fullscreenElement), 'Vollbild aus');
  ok((await p.getAttribute('#fs-tb path', 'd')) === d0, 'Symbol zurück');
  ok(await p.evaluate(() => VOLME3D_VERSION === VOLME3D_CHANGELOG[0].version), 'Version = Changelog-Kopf');
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
