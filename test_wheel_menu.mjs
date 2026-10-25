import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8871;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
let fail = 0;
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof hideStarter === 'function' && typeof _camWheel === 'function', null, { timeout: 30000 });
  await p.evaluate(() => hideStarter());
  await p.waitForTimeout(500);
  const dist = () => p.evaluate(() => camera.position.distanceTo(orbitTarget));
  // 1) Rad über Canvas zoomt weiterhin
  await p.mouse.move(900, 450);
  let d0 = await dist(); await p.mouse.wheel(0, 300); await p.waitForTimeout(400);
  let d1 = await dist(); console.log('Canvas:', d0.toFixed(1), '->', d1.toFixed(1));
  if (Math.abs(d1 - d0) < 0.5) { console.log('FEHLER: Canvas zoomt nicht'); fail++; }
  for (let i = 0; i < 1; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(40); }
  await p.waitForTimeout(500); console.log('hineingezoomt:', (await dist()).toFixed(1));
  // 2) Grundkörper-Menü öffnen und bis zum Ende scrollen
  await p.click('#shape-dd-btn'); await p.waitForTimeout(400);
  const info = await p.evaluate(() => {
    const btn = document.getElementById('shape-dd-btn');
    const cand = [...document.querySelectorAll('*')].filter(n => { const r = n.getBoundingClientRect(); const st = getComputedStyle(n);
      return r.width > 50 && r.height > 50 && /auto|scroll/.test(st.overflowY) && n.scrollHeight - n.clientHeight > 2 && st.visibility !== 'hidden' && st.display !== 'none'; });
    const m = cand.find(n => n.closest('.sdd-menu, [class*=sdd]')) || cand[0];
    if (!m) return null; const r = m.getBoundingClientRect();
    return { cls: m.className, id: m.id, x: r.left + r.width / 2, y: r.top + r.height / 2, sh: m.scrollHeight, ch: m.clientHeight };
  });
  console.log('Menü:', info);
  if (!info) { console.log('FEHLER: kein scrollbares Menü gefunden'); fail++; }
  else {
    await p.mouse.move(info.x, info.y);
    const dStart = await dist();
    for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 200); await p.waitForTimeout(30); }
    await p.waitForTimeout(400);
    d0 = await dist();
    for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, 200); await p.waitForTimeout(30); }
    await p.waitForTimeout(400);
    d1 = await dist(); console.log('Menü am Anschlag:', d0.toFixed(2), '->', d1.toFixed(2));
    if (Math.abs(d1 - d0) > 0.01) { console.log('FEHLER: zoomt am Menü-Ende'); fail++; }
    // nach oben scrollen geht noch
    const st0 = await p.evaluate(i => (document.getElementById(i.id) || document.getElementsByClassName(i.cls.split(' ')[0])[0]).scrollTop, info);
    await p.mouse.wheel(0, -300); await p.waitForTimeout(400);
    const st1 = await p.evaluate(i => (document.getElementById(i.id) || document.getElementsByClassName(i.cls.split(' ')[0])[0]).scrollTop, info);
    for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, -200); await p.waitForTimeout(30); }
    await p.waitForTimeout(400); d0 = await dist();
    for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, -200); await p.waitForTimeout(30); }
    await p.waitForTimeout(400); d1 = await dist(); console.log('Menü oben am Anschlag:', d0.toFixed(2), '->', d1.toFixed(2));
    if (Math.abs(d1 - d0) > 0.01) { console.log('FEHLER: zoomt am Menü-Anfang'); fail++; }
    const dEnd = await dist(); console.log('Menü gesamt:', dStart.toFixed(2), '->', dEnd.toFixed(2));
    if (Math.abs(dEnd - dStart) > 0.01) { console.log('FEHLER: Kamera hat sich beim Menü-Scrollen bewegt'); fail++; }
    console.log('scrollTop', st0, '->', st1); if (!(st1 < st0)) { console.log('FEHLER: Menü scrollt nicht hoch'); fail++; }
  }
} finally { await b.close(); srv.kill(); }
console.log(fail ? `ROT (${fail})` : 'GRÜN'); process.exit(fail ? 1 : 0);
