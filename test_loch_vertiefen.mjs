// 🕳️ Loch vertiefen (_lvt*): Platte mit Sackloch → Wand- und Boden-Klick messen
// Ø/Tiefe/Restmaterial richtig, Vertiefen nimmt genau das Zylindervolumen weg.
// Variante oben: echter Mausklick in das Loch (Trigger-Pfad).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8871;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.addInitScript(() => {
  window.__vol = g => { const p = g.attributes.position, ix = g.index; let v = 0; const n = ix ? ix.count : p.count;
    for (let t = 0; t < n; t += 3) { const a = ix?ix.getX(t):t, b = ix?ix.getX(t+1):t+1, c = ix?ix.getX(t+2):t+2;
      v += (p.getX(a)*(p.getY(b)*p.getZ(c)-p.getY(c)*p.getZ(b)) - p.getX(b)*(p.getY(a)*p.getZ(c)-p.getY(c)*p.getZ(a)) + p.getX(c)*(p.getY(a)*p.getZ(b)-p.getY(b)*p.getZ(a)))/6; } return v*1000; };
});
let ok = true;
const chk = (name, cond, info) => { console.log((cond ? '✓ ' : '✗ ') + name, info !== undefined ? JSON.stringify(info) : ''); if (!cond) ok = false; };
async function bau(oben) {
  await pg.evaluate(async oben => {
    _newCreate(false);
    addShape('box'); const box = objects[objects.length - 1];
    addShape('cylinder'); const c = objects[objects.length - 1];
    box.scale.set(2, 0.75, 2); box.position.set(0, 0.75, 0); box.updateMatrixWorld(true);
    c.scale.set(0.25, 0.5, 0.25); c.position.set(0, oben ? 1.5 : 0, 0); c.userData.isHole = true; c.updateMatrixWorld(true);
    window.__box = getMeshBox(box); window.__cyl = getMeshBox(c);
    selectObjs([box, c]); subtractHoles();
    for (let i = 0; i < 300 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 300));
    selectObjs([objects[0]]); fitToObjects([objects[0]]);
  }, oben);
  return pg.evaluate(() => ({ box: [__box.min.y, __box.max.y], cyl: [__cyl.min.y, __cyl.max.y], r: (__cyl.max.x - __cyl.min.x) / 2 }));
}
const mess = (from, dir) => pg.evaluate(([f, d]) => {
  const o = objects[0];
  const rc = new THREE.Raycaster(new THREE.Vector3(...f), new THREE.Vector3(...d).normalize());
  const h = rc.intersectObject(o, false)[0];
  if (!h) return { fehler: 'kein Treffer' };
  const m = _lvtMeasure(o, h);
  return m ? { d: +m.dMm.toFixed(2), t: +m.depthMm.toFixed(2), rest: +m.restMm.toFixed(2), s: m.s } : null;
}, [from, d = dir]);
let d;
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function' && typeof _lvtStart === 'function');
  await pg.evaluate(() => hideStarter());
  const g = await bau(false);
  console.log('Aufbau', JSON.stringify(g));
  const D = g.r * 20, T = (g.cyl[1] - g.box[0]) * 10, R = (g.box[1] - g.cyl[1]) * 10;
  // Wand-Klick: von der Lochachse waagerecht nach außen
  const w = await mess([0, (g.box[0] + g.cyl[1]) / 2, 0], [1, 0, 0.2]);
  chk('Wand: Ø/Tiefe/Rest', w && Math.abs(w.d - D) < 0.15 && Math.abs(w.t - T) < 0.1 && Math.abs(w.rest - R) < 0.1, { w, soll: { D, T, R } });
  // Boden-Klick: von unten durch die Öffnung nach oben
  const f = await mess([0.03, -1, 0.02], [0, 1, 0]);
  chk('Boden: Ø/Tiefe/Rest', f && Math.abs(f.d - D) < 0.15 && Math.abs(f.t - T) < 0.1 && Math.abs(f.rest - R) < 0.1, f);
  // Vertiefen auf T+6 mm
  const r = await pg.evaluate(async ([T]) => {
    const o = objects[0];
    const rc = new THREE.Raycaster(new THREE.Vector3(0.03, -1, 0.02), new THREE.Vector3(0, 1, 0));
    const h = rc.intersectObject(o, false)[0];
    _lvtStart(); _lvt.obj = o; _lvt.m = _lvtMeasure(o, h); _lvt.picking = false; _lvt.depth = T + 6;
    _lvtPanel(); _lvtPreview();
    const ghost = !!_lvt.ghost, panel = !!document.getElementById('lvt-panel');
    const v0 = __vol(o.geometry), n0 = undoStack.length;
    await _lvtApply();
    const o2 = objects[0];
    const rc2 = new THREE.Raycaster(new THREE.Vector3(0.03, -1, 0.02), new THREE.Vector3(0, 1, 0));
    const m2 = _lvtMeasure(o2, rc2.intersectObject(o2, false)[0]);
    return { ghost, panel, v0, v1: __vol(o2.geometry), n: objects.length, neu: o2 !== o, t2: m2 && m2.depthMm, rest2: m2 && m2.restMm,
             panelWeg: !document.getElementById('lvt-panel'), ghostWeg: !scene.children.some(c => c === _lvt.ghost && c) };
  }, [T]);
  const soll = Math.PI * (D / 2) ** 2 * 6;
  chk('Vertiefen: Volumen − π r² · 6 mm', r.neu && r.n === 1 && Math.abs((r.v0 - r.v1) - soll) / soll < 0.03, { weg: +(r.v0 - r.v1).toFixed(1), soll: +soll.toFixed(1) });
  chk('Nachmessen: Tiefe +6, Rest −6', Math.abs(r.t2 - (T + 6)) < 0.1 && Math.abs(r.rest2 - (R - 6)) < 0.1, { t2: r.t2, rest2: r.rest2 });
  chk('Vorschau + Fenster da, danach weg', r.ghost && r.panel && r.panelWeg, r);
  // Rückgängig
  const u = await pg.evaluate(() => { undo(); return __vol(objects[0].geometry); });
  chk('Strg+Z stellt alten Körper her', Math.abs(u - r.v0) < 1, { u: +u.toFixed(1), v0: +r.v0.toFixed(1) });

  // Loch oben + echter Mausklick auf die hintere Wand
  const g2 = await bau(true);
  await pg.evaluate(() => _lvtStart());
  await pg.waitForTimeout(300);
  const pt = await pg.evaluate(([r, yTop]) => {
    const c = new THREE.Vector3(0, yTop - 0.15, 0), d = c.clone().sub(camera.position); d.y = 0; d.normalize();
    const w = c.clone().addScaledVector(d, r * 0.97).project(camera), q = vpEl.getBoundingClientRect();
    return { x: q.left + (w.x + 1) / 2 * q.width, y: q.top + (1 - w.y) / 2 * q.height };
  }, [g2.r, g2.box[1]]);
  console.log('Klickpunkt', JSON.stringify(pt), await pg.evaluate(pt => { const e = document.elementFromPoint(pt.x, pt.y);
    const hs = pickObjects({ clientX: pt.x, clientY: pt.y }); return e.tagName + '#' + e.id + '.' + e.className + ' <' + (e.parentElement && (e.parentElement.id + '.' + e.parentElement.className)) + '> ' + (e.textContent||'').slice(0,60) + ' hits=' + hs.length + (hs[0] ? ' p=' + hs[0].point.toArray().map(v => v.toFixed(2)) : '') + ' cam=' + camera.position.toArray().map(v=>v.toFixed(1)); }, pt));
  await pg.mouse.click(pt.x, pt.y);
  await pg.waitForTimeout(1500);
  const k = await pg.evaluate(() => ({ note: [...document.querySelectorAll('.notify,.toast,#notify *')].map(e => e.textContent).slice(-3), panel: !!document.getElementById('lvt-panel'), m: _lvt.m && { d: +_lvt.m.dMm.toFixed(2), t: +_lvt.m.depthMm.toFixed(2), rest: +_lvt.m.restMm.toFixed(2), s: _lvt.m.s }, depth: _lvt.depth }));
  const T2 = (g2.box[1] - g2.cyl[0]) * 10, R2 = (g2.cyl[0] - g2.box[0]) * 10;
  chk('Klick von oben: Fenster + Maße', k.panel && k.m && Math.abs(k.m.t - T2) < 0.1 && Math.abs(k.m.rest - R2) < 0.1, { k, soll: { T2, R2 } });
  await pg.screenshot({ path: '/tmp/claude-1000/-home-v3da-orca-wasm/8ae6d2b7-eb2a-5e71-946c-5f44a69a76a3/scratchpad/lvt.png' });
  // Durchbruch-Warnung
  const warn = await pg.evaluate(R2 => { _lvtSet(_lvt.m.depthMm + R2 + 1); return document.getElementById('lvt-warn').textContent; }, R2);
  chk('Warnung bei Durchbruch', /bricht durch/.test(warn), warn);
  // Durchgangsloch wird abgelehnt
  const thru = await pg.evaluate(() => { _lvtClose(); const o = objects[0];
    const h = new THREE.Raycaster(new THREE.Vector3(0, 0.7, 0), new THREE.Vector3(1, 0, 0)).intersectObject(o, false)[0];
    return h ? 'ok' : 'kein'; });
  console.log('Durchgangs-Fall übersprungen (Aufbau hat keins):', thru);
} finally {
  console.log('errs', errs.slice(0, 3)); console.log(ok ? 'OK ✓' : 'FEHLER ✗');
  await b.close(); srv.kill();
}
