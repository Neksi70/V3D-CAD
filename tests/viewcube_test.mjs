// Ansichtswürfel: Pfeile schwenken um 90°, Flächenklick springt zur Ansicht
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8963;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
const Q = Math.PI / 2, near = (a, b, e = 0.06) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < e;
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _vcStep === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} });
  const cam = () => p.evaluate(() => ({ t: sph.theta, p: sph.phi }));
  const settle = () => p.waitForTimeout(450);
  for (const s of ['u','d','l','r']) ok(await p.isVisible('.vca-' + s), 'Pfeil ' + s + ' sichtbar');
  await p.evaluate(() => setView('front')); await p.mouse.move(5, 5);
  await p.click('.vca-r'); await settle();
  let c = await cam(); ok(near(c.t, Q) && near(c.p, Q), 'vorne → ▶ = rechts');
  await p.click('.vca-r'); await settle();
  c = await cam(); ok(near(c.t, Math.PI), '▶ nochmal = hinten');
  await p.click('.vca-l'); await p.click('.vca-l'); await settle();
  c = await cam(); ok(near(c.t, 0), '◀◀ zurück = vorne');
  await p.click('.vca-u'); await settle();
  c = await cam(); ok(c.p < 0.1, '▲ = oben');
  await p.click('.vca-d'); await settle();
  c = await cam(); ok(near(c.p, Q), '▼ = wieder Seite');
  await p.click('.vca-d'); await settle();
  c = await cam(); ok(c.p > Math.PI - 0.1, '▼ = unten');
  // ISO: Versatz bleibt beim Schwenken
  await p.evaluate(() => setView('iso')); await p.click('.vca-r'); await settle();
  c = await cam(); ok(near(c.t, 0.6 + Q) && near(c.p, 0.75), 'ISO ▶ behält 45°-Versatz und Neigung');
  // Flächenklick: Würfelmitte in Vorderansicht = VORNE; nach rechts-Ansicht Mitte = RECHTS
  await p.evaluate(() => setView('iso'));
  await p.waitForTimeout(100);
  const box = await p.locator('#vcube-wrap canvas').boundingBox();
  // In ISO: obere Mitte des Würfels ist die OBEN-Fläche
  await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.33); await settle();
  c = await cam(); ok(c.p < 0.1, 'Klick auf OBEN-Fläche → Draufsicht');
  await p.evaluate(() => { sph.theta = 1.3; sph.phi = 1.35; sph2cam(); });   // RECHTS zeigt fast frontal
  await p.mouse.move(5, 5); await p.waitForTimeout(300);   // Würfel erst nach Eingabe-Event neu gerendert
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await settle();
  c = await cam(); const sideOk = near(c.p, Q) && near(c.t, Q);
  ok(sideOk, 'Klick auf RECHTS-Fläche → rechte Ansicht (t=' + c.t.toFixed(2) + ' p=' + c.p.toFixed(2) + ')');
  // Ziehen dreht weiter frei (kein Sprung)
  await p.evaluate(() => setView('front'));
  await p.mouse.move(box.x + 50, box.y + 55); await p.mouse.down(); await p.mouse.move(box.x + 80, box.y + 55, { steps: 5 }); await p.mouse.up(); await settle();
  c = await cam(); ok(!near(c.t, 0, 0.05) && !near(c.t, Q, 0.05), 'Ziehen dreht frei');
  await p.evaluate(() => setView('iso')); await p.waitForTimeout(200);
  const wb = await p.locator('#vcube-wrap').boundingBox();
  await p.screenshot({ path: '/tmp/viewcube.png', clip: { x: wb.x - 40, y: wb.y - 30, width: wb.width + 80, height: wb.height + 60 } });
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
