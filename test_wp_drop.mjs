import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8841;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.log('ERR', String(e)));
page.on('console', m => { if (m.type()==='error') console.log('CERR', m.text()); });
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.evaluate(() => {
  hideStarter?.();
  addShape('box'); const plate = objects[objects.length-1];
  plate.scale.set(25, 2, 22); selectedObjs.length=0; selectedObjs.push(plate); _dropSelectedToGround();
  addShape('box'); const part = objects[objects.length-1];
  part.scale.set(6,1,4); part.position.set(0, 12, 0); part.updateMatrixWorld(true);
  window._T = { plate, part };
  setView?.('iso'); fitToObjects?.(objects);
});
await page.waitForTimeout(500);
const proj = (which, dy) => page.evaluate(([w, dy]) => {
  const o = window._T[w]; const b = getMeshBox(o); const c = b.getCenter(new THREE.Vector3()); c.y = b.max.y;
  if (w==='plate') { c.x = b.min.x + 2; c.z = b.max.z - 2; }
  const v = c.clone().project(camera); const r = canvas.getBoundingClientRect();
  return [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height];
}, [which, dy]);
const state = () => page.evaluate(() => ({ n: workplaneNormal.toArray().map(x=>+x.toFixed(3)), p: workplanePoint.toArray().map(x=>+x.toFixed(2)), mode: workplaneMode, partMinY: +getMeshBox(_T.part).min.y.toFixed(3), sel: selectedObjs.map(o=>objects.indexOf(o)) }));
// 1) Arbeitsebene auf Platte
await page.keyboard.press('p');
let [x,y] = await proj('plate'); await page.mouse.move(x,y); await page.mouse.click(x,y);
console.log('nach WP Platte', await state());
// 2) Arbeitsebene auf Teil
await page.keyboard.press('p');
[x,y] = await proj('part'); await page.mouse.move(x,y);
console.log('am Punkt', await page.evaluate(([x,y]) => { const el=document.elementFromPoint(x,y); return [el.tagName, el.id, el.className, typeof _mg!=='undefined' && _mg.hover, _wpHL.visible]; }, [x,y]));
await page.mouse.click(x,y);
console.log('nach WP Teil', await state());
// 3) zurück auf Platte, Teil wählen, D
await page.keyboard.press('p');
[x,y] = await proj('plate'); await page.mouse.move(x,y); await page.mouse.click(x,y);
[x,y] = await proj('part'); await page.mouse.click(x,y);
await page.keyboard.press('d');
console.log('nach D', await state());
await page.screenshot({ path: '/tmp/claude-1000/-home-v3da/30fb767c-29bb-42d8-b218-07978e08748b/scratchpad/wp.png' });
await browser.close(); srv.kill();
