// Quader mit zwei Löchern (abgezogen) → Lochränder DIREKT anfassen:
// Hover leuchtet ganzen Rand, beim Ziehen Live-Vorschau (Manifold), rechts =
// Rundung, links = Fase. Zweites Loch muss NACH dem ersten Bevel noch greifbar
// sein (Ergebnis hat dann Kantenlinien — bis 1.18.70 war dann Schluss).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8862;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.addInitScript(() => {
  window.__vol = g => { const p = g.attributes.position, ix = g.index; let v = 0; const n = ix ? ix.count : p.count;
    for (let t = 0; t < n; t += 3) { const a = ix?ix.getX(t):t, b = ix?ix.getX(t+1):t+1, c = ix?ix.getX(t+2):t+2;
      v += (p.getX(a)*(p.getY(b)*p.getZ(c)-p.getY(c)*p.getZ(b)) - p.getX(b)*(p.getY(a)*p.getZ(c)-p.getY(c)*p.getZ(a)) + p.getX(c)*(p.getY(a)*p.getZ(b)-p.getY(b)*p.getZ(a)))/6; } return v*1000; };
});
// sichtbarer Punkt auf dem oberen Rand des Lochs bei x≈hx (zur Kamera hin)
const rimPt = hx => pg.evaluate(hx => {
  const o = objects[0];
  const rim = _dedRims(o).filter(r => r.axisW[1] > 0.9).sort((a, b) => Math.abs(a.cW[0]-hx) - Math.abs(b.cW[0]-hx))[0];
  if (!rim) return null;
  const c = new THREE.Vector3(...rim.cW), d = camera.position.clone().sub(c); d.y = 0; d.normalize();
  const w = c.clone().addScaledVector(d, rim.rW).project(camera);
  const r = vpEl.getBoundingClientRect();
  return { x: r.left + (w.x + 1) / 2 * r.width, y: r.top + (1 - w.y) / 2 * r.height };
}, hx);
async function zug(hx, dx) {
  const pt = await rimPt(hx);
  if (!pt) return { hx, dx, fehler: 'kein Rand erkannt' };
  await pg.mouse.move(pt.x - 30, pt.y - 30); await pg.mouse.move(pt.x, pt.y);
  await pg.waitForTimeout(200);
  console.log('an', hx, await pg.evaluate(pt => { const e = document.elementFromPoint(pt.x, pt.y); return e.tagName + ' mgHover=' + JSON.stringify(_mg.hover) + ' blocked=' + _dedBlocked(); }, pt), JSON.stringify(await pg.evaluate(() => { try { return !!_dedPick({ clientX: _ded.lastEv.clientX, clientY: _ded.lastEv.clientY, pointerType: 'mouse' }); } catch (e) { return e.message; } })));
  const hover = await pg.evaluate(() => !!(_ded.hl && _ded.hl.visible) ? _ded.hl.geometry.attributes.position.count : 0);
  const v0 = await pg.evaluate(() => __vol(objects[0].geometry));
  const o0 = await pg.evaluate(() => objects[0].uuid);
  await pg.mouse.down();
  await pg.mouse.move(pt.x + dx / 2, pt.y); await pg.waitForTimeout(300);
  const pv1 = await pg.evaluate(() => _ebPrev && _ebPrev.mesh && _ebPrev.mesh.visible ? { k: _ebPrev.kind, v: __vol(_ebPrev.mesh.geometry) } : { k: _ebPrev && _ebPrev.kind, v: null });
  await pg.mouse.move(pt.x + dx, pt.y); await pg.waitForTimeout(300);
  const t0 = Date.now();
  const pv2 = await pg.evaluate(() => _ebPrev && _ebPrev.mesh && _ebPrev.mesh.visible ? __vol(_ebPrev.mesh.geometry) : null);
  const origHidden = await pg.evaluate(() => { const m = objects[0].material; return m.visible === false; });
  await pg.mouse.up();
  for (let i = 0; i < 60; i++) { if (await pg.evaluate(u => objects[0].uuid !== u, o0)) break; await pg.waitForTimeout(100); }
  const applyMs = Date.now() - t0;
  const r = await pg.evaluate(() => ({ n: objects.length, v1: __vol(objects[0].geometry), prevInScene: scene.children.some(c => c.userData && c.userData._ebPreview) }));
  const neu = await pg.evaluate(u => objects[0].uuid !== u, o0);
  const f = x => x == null ? x : +x.toFixed(1);
  return { hx, dx, hover, kind: pv1.k, v0: f(v0), prevHalb: f(pv1.v), prevVoll: f(pv2), origHidden, neu, v1: f(r.v1), n: r.n, prevInScene: r.prevInScene, applyMs };
}
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  await pg.evaluate(async () => {
    hideStarter(); _newCreate(false);
    addShape('box'); const box = objects[objects.length - 1];
    addShape('cylinder'); const c1 = objects[objects.length - 1];
    addShape('cylinder'); const c2 = objects[objects.length - 1];
    box.scale.set(5, 0.5, 2); box.position.set(0, 0.5, 0);
    for (const [c, x] of [[c1, -3.5], [c2, -1.5]]) { c.scale.set(0.4, 1, 0.4); c.position.set(x, 0.5, 0); c.userData.isHole = true; }
    selectObjs([box, c1, c2]); subtractHoles();
    for (let i = 0; i < 300 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 300));
    selectObjs([objects[0]]); fitToObjects([objects[0]]);
  });
  await pg.waitForTimeout(600);
  const a = await zug(-3.5, +40);          // Loch links: Rundung
  await pg.keyboard.press('Escape');       // Maßfeld (_ebVal) schließen — es liegt sonst über dem Nachbarloch
  await pg.waitForTimeout(300);
  console.log(await pg.evaluate(() => JSON.stringify({ edgeMode: _edgeMode, sel: selectedObjs.length, selIsObj: selectedObjs[0] === objects[0], blocked: _dedBlocked(), rims: _dedRims(objects[0]).map(r => r.cW.map(v => +v.toFixed(2)).concat([+r.axisW[1].toFixed(2)])), analytic: _dedAnalytic(objects[0]) })));
  const c = await zug(-1.5, -40);          // Loch rechts, NACH dem ersten Bevel: Fase
  console.log(JSON.stringify(a)); console.log(JSON.stringify(c));
  const gut = x => x.hover > 2 && x.kind === 'rim' && x.prevHalb < x.v0 && x.prevVoll < x.prevHalb && x.origHidden &&
                   x.neu && x.n === 1 && !x.prevInScene && Math.abs(x.v1 - x.prevVoll) < 0.5;
  console.log(gut(a) && gut(c) ? 'OK ✓' : 'FEHLER ✗');
} finally { console.log('errs', errs.slice(0, 3)); await b.close(); srv.kill(); }
