// Echter Bedienweg am Original-Teil (33.600 Dreiecke, 3 Nadel-Dreiecke): Import → Strg+A → ⊖ Abziehen
// → Strg+Z → Teil am Y-Pfeil ziehen (DRAG=px je Schritt, negativ = tiefer) → Strg+A → ⊖ Abziehen
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8845;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('console', m => logs.push(m.type() + ': ' + m.text()));
page.on('request', r => { if (r.url().includes('/api/occt')) logs.push('REQ ' + r.url()); });
page.on('pageerror', e => logs.push('PAGEERR ' + String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.evaluate(() => {
  hideStarter?.();
  addShape('box'); const plate = objects[objects.length-1];
  plate.scale.set(25, 2, 22); selectedObjs.length=0; selectedObjs.push(plate); _dropSelectedToGround();
});
await page.setInputFiles('#fimport', process.env.STL || '/home/v3da/occt-debug/2026-09-25T14-48-41-805Z-sub-tool0.stl');
await page.waitForTimeout(2500);
await page.evaluate(() => { if (document.getElementById('sz-modal').classList.contains('show')) _confirmSize(); }); await page.waitForTimeout(800);
console.log('nach Import', await page.evaluate(() => objects.map(o => o.userData.name + ':' + o.userData.type)));
await page.evaluate(() => {
  const part = objects[objects.length-1];
  const bb = getMeshBox(part); part.position.y += 4 - bb.min.y - 0.3; part.updateMatrixWorld(true);
  deselect(); selectedObjs.push(part); setObjMode('hole'); deselect();
  fitToObjects(objects);
});
await page.mouse.click(700, 850);
const info = () => page.evaluate(() => objects.map(o => `${o.userData.name}${o.userData.isHole?'(Loch)':''} y=${o.position.y.toFixed(2)} tris=${_countTris([o])}`).join(' | '));
const notes = () => page.evaluate(() => [...document.querySelectorAll('#notif .n, .notif, [class*=notif] > div')].slice(-4).map(d => d.textContent.trim()).join(' / '));
async function abziehen(label) {
  await page.mouse.click(700, 850);          // Leerraum → Auswahl weg, Fokus aufs Canvas
  await page.keyboard.press('Control+a');
  const L0 = logs.length;
  await page.click('button.btn.sub');
  await page.waitForTimeout(4000);
  console.log(label, '→', await info());
  console.log('   Meldungen:', await notes());
  console.log('   ' + logs.slice(L0).filter(l => !/GET|favicon/.test(l)).slice(0, 8).join('\n   '));
}
await abziehen('1. Abziehen');
await page.keyboard.press('Control+z'); await page.waitForTimeout(500);
console.log('nach Strg+Z →', await info());
// Teil anklicken (Mitte, von oben)
const ptOf = (expr) => page.evaluate((expr) => { const v = eval(expr).clone().project(camera); const r = canvas.getBoundingClientRect(); return [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height]; }, expr);
const [x, y] = await page.evaluate(() => {
  const r = canvas.getBoundingClientRect(); const part = objects.find(o => o.userData.isHole);
  for (let yy = r.top + 50; yy < r.bottom; yy += 6) for (let xx = r.left + 50; xx < r.right; xx += 6) {
    const h = pickObjects({ clientX: xx, clientY: yy }); if (h.length && h[0].object === part) return [xx, yy];
  } return null; });
await page.mouse.click(x, y); await page.waitForTimeout(300);
console.log('Auswahl:', await page.evaluate(() => selectedObjs.map(o => o.userData.name)));
// Y-Pfeil suchen: entlang der Hochachse ab Gizmo-Mitte abtasten
await page.waitForTimeout(300);
const arrow = await page.evaluate(() => {
  const r = canvas.getBoundingClientRect();
  const c = _mg.group.position.clone().project(camera);
  const cx = r.left + (c.x+1)/2*r.width, cy = r.top + (1-c.y)/2*r.height;
  for (let d = 5; d < 300; d += 3) { const e = { clientX: cx, clientY: cy - d }; if (_mgPick(e) === 'y') return [cx, cy - d]; }
  return null;
});
console.log('Y-Pfeil bei', arrow);
if (arrow) {
  await page.mouse.move(arrow[0], arrow[1]); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(arrow[0], arrow[1] - i * Number(process.env.DRAG || 0.3));
  await page.mouse.up(); await page.waitForTimeout(300);
}
console.log('nach Ziehen →', await info());
await abziehen('2. Abziehen');
await browser.close(); srv.kill();
