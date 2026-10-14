// Symbol-Tooltips am Touchgerät: Tippen = ausführen + kurz zeigen, lange drücken = nur erklären
import { chromium, devices } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8953;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, hasTouch: true, isMobile: true });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fails = 0; const ok = (n, c, x) => { console.log((c ? '  OK  ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails++; };
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function', { timeout: 60000 });
  await pg.evaluate(() => { hideStarter(); _advSet('beginner'); _symToggle(true); _newCreate(false); addShape('box'); });
  await pg.waitForTimeout(300); await pg.evaluate(() => document.querySelectorAll('.ni').forEach(n => n.remove()));
  const sel = '#tb-r1 button[onclick="mirrorTool()"]';
  const bb = await pg.locator(sel).boundingBox();
  const cdp = await ctx.newCDPSession(pg);
  const touch = async (ms) => {
    const p = [{ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p });
    await pg.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pg.waitForTimeout(150);
  };
  await pg.evaluate(() => { window._mirrorCalls = 0; const o = window.mirrorTool; window.mirrorTool = function () { window._mirrorCalls++; }; });
  console.log('  Knopf', JSON.stringify(bb), await pg.evaluate(([x,y]) => { const e = document.elementFromPoint(x,y); return e && (e.closest('button')?.getAttribute('onclick') || e.id || e.className); }, [bb.x+bb.width/2, bb.y+bb.height/2]));
  await touch(80);
  let r = await pg.evaluate(() => ({ n: window._mirrorCalls, tip: document.getElementById('sym-tip')?.style.display === 'block' ? document.getElementById('sym-tip').innerText : null }));
  ok('kurz tippen: Befehl läuft + Tooltip zeigt Namen', r.n === 1 && /^Spiegeln/.test(r.tip || ''), r);
  await pg.waitForTimeout(1800);
  ok('Tooltip geht von selbst wieder weg', await pg.evaluate(() => document.getElementById('sym-tip').style.display === 'none'));
  await touch(700);
  r = await pg.evaluate(() => ({ n: window._mirrorCalls, tip: document.getElementById('sym-tip')?.style.display === 'block' ? document.getElementById('sym-tip').innerText : null }));
  ok('lange drücken: nur Erklärung, Befehl läuft NICHT', r.n === 1 && /^Spiegeln/.test(r.tip || ''), r);
  await pg.screenshot({ path: '/tmp/sym_touch.png', clip: { x: 0, y: 0, width: 900, height: 330 } });
  ok('keine Seitenfehler', errs.length === 0, errs);
} catch (e) { console.log('ABBRUCH', e); fails++; } finally { await b.close(); srv.kill(); }
console.log(fails ? `\n${fails} FEHLER` : '\nalles OK'); process.exit(fails ? 1 : 0);
