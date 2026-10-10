// Tab zwischen Maßfeldern: Seitenleiste B → T → H ohne Schieberegler; Maß-Fenster am Objekt kreist + Enter übernimmt
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8965;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof addShape === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} addShape('box'); });
  await p.evaluate(() => switchTab('pr')); await p.waitForTimeout(200);
  await p.click('#dn-w'); await p.fill('#dn-w', '33');
  await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement.id) === 'dn-d', 'Tab Breite → Tiefe (id=' + await p.evaluate(() => document.activeElement.id) + ')');
  const sz = await p.evaluate(() => { const s = getMeshBox(getFirst()).getSize(new THREE.Vector3()); return [s.x*10, s.z*10, s.y*10]; });
  ok(Math.abs(sz[0] - 33) < 0.05, 'Breite übernommen beim Tab (' + sz[0].toFixed(2) + ')');
  await p.keyboard.type('44'); await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement.id) === 'dn-h', 'Tab Tiefe → Höhe');
  await p.keyboard.press('Control+A'); await p.keyboard.type('15'); await p.keyboard.press('Tab');
  const s2 = await p.evaluate(() => { const s = getMeshBox(getFirst()).getSize(new THREE.Vector3()); return [s.x*10, s.z*10, s.y*10]; });
  ok(Math.abs(s2[1] - 44) < 0.05 && Math.abs(s2[2] - 15) < 0.05, 'Tiefe 44 / Höhe 15 übernommen (' + s2.map(v => v.toFixed(1)) + ')');
  // Maß-Fenster am Objekt
  await p.evaluate(() => { const bsz = getMeshBox(getFirst()).getSize(new THREE.Vector3()); openDimPanel(300, 300, bsz); });
  ok(await p.evaluate(() => document.activeElement.id) === 'dp-x', 'Maß-Fenster: Fokus auf B');
  await p.keyboard.type('20'); await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement.id) === 'dp-z', 'Fenster: Tab B → T');
  await p.keyboard.type('25'); await p.keyboard.press('Tab'); await p.keyboard.type('12'); await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement.id) === 'dp-x', 'Fenster: Tab nach H springt zurück zu B');
  await p.keyboard.press('Shift+Tab');
  ok(await p.evaluate(() => document.activeElement.id) === 'dp-y', 'Fenster: Shift+Tab rückwärts');
  await p.keyboard.press('Enter');
  const s3 = await p.evaluate(() => { const s = getMeshBox(getFirst()).getSize(new THREE.Vector3()); return [s.x*10, s.z*10, s.y*10]; });
  ok(Math.abs(s3[0] - 20) < 0.05 && Math.abs(s3[1] - 25) < 0.05 && Math.abs(s3[2] - 12) < 0.05, 'Enter übernimmt 20×25×12 (' + s3.map(v => v.toFixed(1)) + ')');
  ok(await p.evaluate(() => !document.getElementById('dim-panel').classList.contains('show')), 'Fenster nach Enter zu');
  ok(await p.evaluate(() => objects.length === 1), 'Enter/Tab löschen oder kopieren nichts');
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
