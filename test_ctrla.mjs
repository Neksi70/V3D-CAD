// Repro + Fix-Test: Fokus in einem Eingabefeld, dann Klick in die 3D-Fläche,
// dann Strg+A → muss alle Objekte markieren (Klick muss Feld-Fokus lösen).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8792;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);

await page.evaluate(async () => { addShape('box'); addShape('sphere'); addShape('cylinder'); deselect();
  // sichtbares Eingabefeld erzeugen + fokussieren (simuliert „vorher in Panel-Feld geklickt")
  const inp = document.createElement('input'); inp.type='text'; inp.id='__t'; inp.value='abc';
  inp.style.cssText='position:fixed;top:5px;left:5px;z-index:99999'; document.body.appendChild(inp); inp.focus();
  await new Promise(r=>setTimeout(r,150));
});
const focusBefore = await page.evaluate(() => document.activeElement?.tagName);

// Klick in die leere 3D-Fläche
await page.mouse.click(400, 400);
const focusAfterClick = await page.evaluate(() => document.activeElement?.tagName);

// echter Strg+A
await page.keyboard.press('Control+a');
const r = await page.evaluate(() => ({ sel: selectedObjs.length, total: objects.length }));

await browser.close(); srv.kill();
console.log('Fokus vor Klick:      ', focusBefore, '(erwartet INPUT)');
console.log('Fokus nach 3D-Klick:  ', focusAfterClick, '(erwartet BODY → Feld-Fokus gelöst)');
console.log('Strg+A markiert:      ', r.sel, '/', r.total);
for (const e of errs.slice(0,5)) console.log('pageerror:', e.slice(0,140));
console.log(r.sel===r.total && r.total>0 && focusAfterClick==='BODY'
  ? '\n✓ Fix wirkt: Klick löst Feld-Fokus, Strg+A markiert alle'
  : '\n✗ noch nicht gefixt');
process.exit(0);
