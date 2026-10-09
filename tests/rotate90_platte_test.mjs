// Otmar 9.10.: Gehäuse/Box aus der Galerie, im Eigenschaften-Reiter X−90° bzw. Y−90°
// → Box steckt halb unter der Druckplatte, erst +90° holt sie zurück. Die 90°-Knöpfe
// sollen ein aufliegendes Teil auf der Platte lassen (wie Drehen/Kippen in 22,5°).
// Zweiter Teil: der Eigenschaften-Reiter muss sich mit dem Mausrad nach unten scrollen
// lassen, bis die Rotation sichtbar ist (auch bei kleinem Fenster).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';

const PORT = 8871;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.env.V3D_DIR || '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fehler = 0; const ok = (b, t, x) => { console.log((b ? '  OK   ' : '  FEHL ') + t + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!b) fehler++; };
const minY = () => pg.evaluate(() => +getMeshBox(selectedObjs[0]).min.y.toFixed(4));

try {
  await pg.goto(`http://localhost:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => { hideStarter(); _newCreate(false); _openEncModal(); _createEnc(); selectObjs([objects[objects.length - 1]]); });
  await pg.mouse.click(5, 700); await pg.evaluate(() => selectObjs([objects[objects.length - 1]])); await pg.waitForTimeout(200);
  ok(Math.abs(await minY()) < 1e-3, 'Box liegt anfangs auf der Platte', await minY());

  for (const [axis, dir, name] of [['x', -1, 'X−'], ['z', -1, 'Y−'], ['x', 1, 'X+'], ['z', 1, 'Y+'], ['y', 1, 'Z+']]) {
    await pg.evaluate(([a, d]) => rotate90(a, d), [axis, dir]);
    const y = await minY();
    ok(Math.abs(y) < 1e-3, `${name} 90°: Box bleibt auf der Platte`, y);
  }

  // schwebendes Teil (bewusst angehoben) bleibt auf seiner Höhe – nur die Lage ändert sich
  await pg.evaluate(() => { const o = selectedObjs[0]; o.position.y += 5; o.updateMatrixWorld(true); });
  const vor = await pg.evaluate(() => getMeshBox(selectedObjs[0]).getCenter(new THREE.Vector3()).y);
  await pg.evaluate(() => rotate90('x', -1));
  const nach = await pg.evaluate(() => getMeshBox(selectedObjs[0]).getCenter(new THREE.Vector3()).y);
  ok(Math.abs(vor - nach) < 1e-3, 'angehobenes Teil dreht um seine Mitte, fällt nicht runter', [vor, nach]);

  // Eigenschaften-Reiter per Mausrad scrollen
  const pane = await pg.evaluate(() => { switchTab && switchTab('pr'); const p = document.getElementById('pane-pr'); const r = p.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, sh: p.scrollHeight, ch: p.clientHeight }; });
  ok(pane.sh > pane.ch, 'Reiter ist länger als das Fenster (Scrollen nötig)', pane);
  await pg.mouse.move(pane.x, pane.y);
  for (let i = 0; i < 30; i++) { await pg.mouse.wheel(0, 120); await pg.waitForTimeout(20); }
  await pg.waitForTimeout(200);
  const st = await pg.evaluate(() => { const p = document.getElementById('pane-pr'); const r = document.getElementById('rx').getBoundingClientRect(), pr = p.getBoundingClientRect();
    return { top: p.scrollTop, max: p.scrollHeight - p.clientHeight, rotSichtbar: r.top >= pr.top && r.bottom <= pr.bottom }; });
  ok(st.top > 0 && st.rotSichtbar, 'Mausrad scrollt den Reiter bis zur Rotation', st);
  // Schwebendes Eigenschaften-Feld links (#fp): darf nicht unten aus dem Fenster laufen
  await pg.setViewportSize({ width: 1280, height: 600 }); await pg.waitForTimeout(200);
  await pg.mouse.click(5, 590);
  const c = await pg.evaluate(() => { const p = objects[objects.length - 1].position.clone().project(camera); const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (p.x * .5 + .5) * r.width, y: r.top + (-p.y * .5 + .5) * r.height }; });
  await pg.mouse.click(c.x, c.y - 5); await pg.waitForTimeout(300);
  const fp = await pg.evaluate(() => { const f = document.getElementById('fp'), bd = document.getElementById('fp-body');
    return { show: f.classList.contains('show'), unten: Math.round(f.getBoundingClientRect().bottom), win: innerHeight, scrollbar: bd.scrollHeight > bd.clientHeight,
      mx: bd.getBoundingClientRect() }; });
  ok(fp.show && fp.unten <= fp.win, 'Eigenschaften-Feld endet im Fenster', fp);
  ok(fp.scrollbar, 'Eigenschaften-Feld scrollt seinen Inhalt', fp);
  await pg.mouse.move(fp.mx.x + fp.mx.width / 2, fp.mx.y + 60);
  for (let i = 0; i < 20; i++) { await pg.mouse.wheel(0, 120); await pg.waitForTimeout(20); }
  const st2 = await pg.evaluate(() => { const bd = document.getElementById('fp-body'); return { top: bd.scrollTop, max: bd.scrollHeight - bd.clientHeight }; });
  ok(st2.top > 0 && st2.top >= st2.max - 2, 'Mausrad scrollt das Feld bis ganz unten', st2);
  ok(!errs.length, 'keine Seitenfehler', errs);
} finally { await b.close(); srv.kill(); }
console.log(fehler ? `${fehler} FEHLER` : 'ALLES OK');
process.exit(fehler ? 1 : 0);
