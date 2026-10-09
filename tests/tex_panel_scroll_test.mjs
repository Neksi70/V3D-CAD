// 9.10.: Auf kleinen Monitoren lief das Textur-Fenster (Eigenschaften → ⬡ Textur) unten
// aus dem Bild, und man konnte nicht scrollen. Das Fenster muss am Fensterrand enden,
// sich mit dem Mausrad scrollen lassen und der letzte Knopf muss erreichbar sein.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';

const PORT = 8872;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.env.V3D_DIR || '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1280, height: 600 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fehler = 0; const ok = (b, t, x) => { console.log((b ? '  OK   ' : '  FEHL ') + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!b) fehler++; };
const info = () => pg.evaluate(() => {
  const p = document.getElementById('tex-panel'), bd = document.getElementById('tex-body');
  const r = p.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), inner: innerHeight, sh: bd.scrollHeight, ch: bd.clientHeight, st: Math.round(bd.scrollTop) };
});

try {
  await pg.goto(`http://localhost:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => { hideStarter(); _newCreate(false); addShape('box'); selectObjs([objects[objects.length - 1]]); });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => toggleTexPanel());
  await pg.waitForTimeout(300);
  let i = await info();
  ok(i.bottom <= i.inner, 'Textur-Fenster endet im sichtbaren Bereich', i);
  const tbB = await pg.evaluate(() => Math.round(document.getElementById('tb').getBoundingClientRect().bottom));
  ok(i.top >= tbB, 'Kopfzeile bleibt sichtbar (nicht unter der Werkzeugleiste)', { ...i, tbB });
  ok(i.sh > i.ch, 'Inhalt ist länger als das Fenster → Scrollbalken', i);
  const bx = await pg.evaluate(() => { const r = document.getElementById('tex-body').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 40]; });
  await pg.mouse.move(bx[0], bx[1]);
  for (let k = 0; k < 30; k++) await pg.mouse.wheel(0, 200);
  await pg.waitForTimeout(300);
  i = await info();
  ok(i.st > 0 && i.st >= i.sh - i.ch - 2, 'Mausrad scrollt bis ganz nach unten', i);
  const last = await pg.evaluate(() => { const btns = [...document.querySelectorAll('#tex-body button')]; const r = btns[btns.length - 1].getBoundingClientRect(); return { bottom: Math.round(r.bottom), inner: innerHeight, txt: btns[btns.length - 1].textContent }; });
  ok(last.bottom <= last.inner, 'Letzter Knopf ist erreichbar', last);
  await pg.setViewportSize({ width: 1280, height: 450 });
  await pg.waitForTimeout(300);
  i = await info();
  ok(i.bottom <= i.inner && i.top >= 0, 'Nach Verkleinern des Fensters passt es weiter', i);
  ok(!errs.length, 'keine Seitenfehler', errs);
} finally { await b.close(); srv.kill(); }
console.log(fehler ? `${fehler} FEHLER` : 'ALLES OK'); process.exit(fehler ? 1 : 0);
