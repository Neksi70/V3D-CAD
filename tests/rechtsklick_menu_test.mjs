// Rechtsklick-Menü: Ausschneiden/Kopieren/Einfügen/Duplizieren/Löschen (Ralf 11.10.26) – echte Mausklicks
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8975;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof cutSelected === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} const o = document.getElementById('auth-overlay'); if (o) o.style.display = 'none'; });
  await p.mouse.click(700, 500);
  await p.evaluate(() => { _newCreate(false); addShape('box'); addShape('cylinder'); const [a, c] = objects; a.position.x = -3; c.position.x = 3; a.updateMatrixWorld(true); c.updateMatrixWorld(true); deselect(); fitView && fitView(); });
  await p.waitForTimeout(2500);
  // Punkt auf dem Objekt suchen, der es wirklich trifft (nicht projizieren, siehe Howto-Falle)
  const spot = idx => p.evaluate(i => { const o = objects[i]; const r = canvas.getBoundingClientRect();
    for (let y = r.top + 20; y < r.bottom - 20; y += 12) for (let x = r.left + 20; x < r.right - 20; x += 12) {
      if (document.elementFromPoint(x, y) !== canvas) continue;
      const h = pickObjects({ clientX: x, clientY: y })[0]; if (h && h.object.isMesh && h.object === o) return { x, y }; } return null; }, idx);
  const vis = async () => p.evaluate(() => [...document.querySelectorAll('#vp-ctxmenu .sli-item')].filter(e => e.offsetParent).map(e => e.id));
  const ctxOn = async (pt) => { await p.mouse.click(pt.x, pt.y, { button: 'right' }); await p.waitForTimeout(250); return p.isVisible('#vp-ctxmenu'); };
  // 1) Rechtsklick auf Box → Box gewählt, Menü mit Bearbeiten-Einträgen
  const sb = await spot(0);
  ok(await ctxOn(sb), 'Rechtsklick auf Teil öffnet Menü');
  const s1 = await p.evaluate(() => ({ sel: selectedObjs.length, isBox: selectedObjs[0] === objects[0] }));
  ok(s1.sel === 1 && s1.isBox, 'Rechtsklick wählt das Teil unter dem Zeiger ');
  const v1 = await vis();
  ok(['ctx-cut', 'ctx-copy', 'ctx-dup', 'ctx-del'].every(id => v1.includes(id)) && !v1.includes('ctx-paste'), 'Einträge: ' + v1.join(','));
  // 2) Duplizieren
  await p.click('#ctx-dup'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => objects.length) === 3 && !(await p.isVisible('#vp-ctxmenu')), 'Duplizieren → 3 Teile, Menü zu');
  // 3) Kopieren + Einfügen (über Rechtsklick ins Leere)
  const sc = await spot(1); await ctxOn(sc); await p.click('#ctx-copy'); await p.waitForTimeout(200);
  const empty = await p.evaluate(() => { const r = canvas.getBoundingClientRect();
    for (let y = r.top + 40; y < r.bottom - 40; y += 15) for (let x = r.left + 300; x < r.right - 40; x += 15)
      if (document.elementFromPoint(x, y) === canvas && !pickObjects({ clientX: x, clientY: y }).length) return { x, y }; });
  await p.mouse.click(empty.x, empty.y, { button: 'right' }); await p.waitForTimeout(250);
  const v2 = await vis(); ok(v2.includes('ctx-paste'), 'nach Kopieren: Einfügen im Menü');
  await p.click('#ctx-paste'); await p.waitForTimeout(300);
  const s3 = await p.evaluate(() => ({ n: objects.length, t: objects[objects.length - 1].userData.shapeType || objects[objects.length - 1].userData.type }));
  ok(s3.n === 4 && /cyl/.test(s3.t), `Einfügen → 4 Teile, eingefügt: ${s3.t}`);
  // 4) Ausschneiden (Box) + Undo-fähig, dann Einfügen
  const sb2 = await spot(0); await ctxOn(sb2); await p.click('#ctx-cut'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => objects.length) === 3, 'Ausschneiden entfernt das Teil');
  await p.keyboard.press('Control+v'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => objects.length) === 4, 'Strg+V fügt das Ausgeschnittene ein');
  // 5) Strg+X
  await p.keyboard.press('Control+x'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => objects.length) === 3, 'Strg+X schneidet aus');
  // 6) Löschen per Menü + Undo
  const sd = await spot(0); await ctxOn(sd); await p.click('#ctx-del'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => objects.length) === 2, 'Löschen per Menü');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => objects.length) === 3, 'Strg+Z holt es zurück');
  // 7) Mehrfachauswahl bleibt bei Rechtsklick auf gewähltes Teil
  await p.evaluate(() => selectObjs([objects[0], objects[1]])); await p.waitForTimeout(200);
  const sm = await spot(1); await ctxOn(sm);
  ok(await p.evaluate(() => selectedObjs.length) === 2, 'Rechtsklick auf gewähltes Teil behält Mehrfachauswahl');
  await p.keyboard.press('Escape');
  // 8) Rechtsziehen = weiter Orbit, kein Menü
  await p.mouse.move(700, 450); await p.mouse.down({ button: 'right' }); await p.mouse.move(780, 470, { steps: 6 }); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(200);
  ok(!(await p.isVisible('#vp-ctxmenu')), 'Rechts ziehen dreht nur, kein Menü');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 2).join(' | '));
  await ctxOn(await spot(1)); await p.screenshot({ path: '/tmp/ctx_menu.png' });
} catch (e) { console.error(e); fail++; } finally { await b.close(); srv.kill(); }
console.log(fail ? `FEHLER: ${fail}` : 'alles grün'); process.exit(fail ? 1 : 0);
