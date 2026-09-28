// Maß nach dem Ziehen eintippen (_ebVal*): Lochrand grob ziehen → Feld → „2" Enter
// → exakt 2-mm-Fase; 1× Rückgängig = Ausgangsstand. Quaderkante: ziehen →
// auf Rundung umschalten, „1,5" → fillet-Op mit 0.15.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8864;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' && !/GL Driver|GPU stall/.test(m.text())) console.log('[c]', m.type(), m.text().slice(0, 300)); });
await pg.addInitScript(() => {
  window.__vol = g => { const p = g.attributes.position, ix = g.index; let v = 0; const n = ix ? ix.count : p.count;
    for (let t = 0; t < n; t += 3) { const a = ix?ix.getX(t):t, b = ix?ix.getX(t+1):t+1, c = ix?ix.getX(t+2):t+2;
      v += (p.getX(a)*(p.getY(b)*p.getZ(c)-p.getY(c)*p.getZ(b)) - p.getX(b)*(p.getY(a)*p.getZ(c)-p.getY(c)*p.getZ(a)) + p.getX(c)*(p.getY(a)*p.getZ(b)-p.getY(b)*p.getZ(a)))/6; } return v*1000; };
});
const scr = w => pg.evaluate(w => { const v = new THREE.Vector3(...w).project(camera); const r = vpEl.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }, w);
const drag = async (pt, dx) => {
  await pg.mouse.move(pt.x - 30, pt.y - 30); await pg.mouse.move(pt.x, pt.y); await pg.waitForTimeout(200);
  await pg.mouse.down(); await pg.mouse.move(pt.x + dx / 2, pt.y); await pg.mouse.move(pt.x + dx, pt.y);
  await pg.waitForTimeout(300); await pg.mouse.up();
};
const waitFeld = async () => { for (let i = 0; i < 60; i++) { if (await pg.evaluate(() => document.getElementById('ebv').style.display === 'flex')) return true; await pg.waitForTimeout(100); } return false; };
let ok = true; const check = (name, c, info) => { console.log((c ? 'OK   ' : 'FAIL ') + name, info !== undefined ? JSON.stringify(info) : ''); if (!c) ok = false; };
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  // ── 1) Lochrand ────────────────────────────────────────────────────────────
  const v0 = await pg.evaluate(async () => {
    hideStarter(); _newCreate(false);
    addShape('box'); const box = objects[objects.length - 1];
    addShape('cylinder'); const cyl = objects[objects.length - 1];
    box.scale.set(5, 0.5, 2); box.position.set(0, 0.5, 0);
    cyl.scale.set(0.4, 1, 0.4); cyl.position.set(-3.5, 0.5, 0); cyl.userData.isHole = true;
    selectObjs([box, cyl]); subtractHoles();
    for (let i = 0; i < 300 && objects.length !== 1; i++) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 300));
    selectObjs([objects[0]]); fitToObjects([objects[0]]);
    return __vol(objects[0].geometry);
  });
  await pg.waitForTimeout(500);
  const rimW = await pg.evaluate(() => { const rim = _dedRims(objects[0]).find(r => r.axisW[1] > 0.9);
    const c = new THREE.Vector3(...rim.cW), d = camera.position.clone().sub(c); d.y = 0; d.normalize();
    return c.addScaledVector(d, rim.rW).toArray(); });
  const undo0 = await pg.evaluate(() => undoStack.length);
  await drag(await scr(rimW), -40);
  check('Feld erscheint nach dem Ziehen', await waitFeld());
  const feld = await pg.evaluate(() => ({ wert: document.getElementById('ebv-in').value, fokus: document.activeElement.id,
    fase: document.getElementById('ebv-fase').style.background, dV: undefined }));
  check('Feld: gezogener Wert, fokussiert, Fase aktiv', feld.wert === '4,0' && feld.fokus === 'ebv-in' && /249|F97316/i.test(feld.fase), feld);
  await pg.keyboard.press('Delete'); await pg.keyboard.press('Backspace'); await pg.keyboard.press('Backspace');
  check('Entf/Rücktaste im Feld löschen keinen Körper', await pg.evaluate(() => objects.length === 1 && document.getElementById('ebv-in').value === ''));
  await pg.keyboard.type('2');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(1500);
  const r1 = await pg.evaluate(v0 => ({ dV: +(v0 - __vol(objects[0].geometry)).toFixed(1), n: objects.length, undo: undoStack.length,
    feld: document.getElementById('ebv').style.display, wert: document.getElementById('ebv-in').value }), v0);
  check('exakt 2-mm-Fase (≈59 mm³)', Math.abs(r1.dV - 59) < 1.5 && r1.n === 1, r1);
  check('nur EIN Undo-Schritt dazu', r1.undo === undo0 + 1, { undo0, undo: r1.undo });
  check('Feld bleibt mit neuem Wert', r1.feld === 'flex' && r1.wert === '2,0', r1);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
  check('Esc schließt Feld', await pg.evaluate(() => document.getElementById('ebv').style.display === 'none'));
  await pg.evaluate(() => undo()); await pg.waitForTimeout(300);
  const r2 = await pg.evaluate(v0 => +(v0 - __vol(objects[0].geometry)).toFixed(1), v0);
  check('1× Rückgängig = Ausgangsstand', Math.abs(r2) < 0.5, { dV: r2 });

  // ── 2) Quaderkante: Rundung umschalten + Komma-Eingabe ─────────────────────
  await pg.evaluate(() => { _newCreate(false); addShape('box'); const o = objects[0]; o.scale.set(2, 1, 2); o.position.set(0, 1, 0);
    o.updateMatrixWorld(true); selectObjs([o]); fitToObjects([o]); });
  await pg.waitForTimeout(500);
  // obere vordere Kante (Mitte) — zur Kamera hin
  const kW = await pg.evaluate(() => { const o = objects[0]; const bb = getMeshBox(o); const zf = camera.position.z > 0 ? bb.max.z : bb.min.z;
    return [1.4, bb.max.y, zf]; });
  await drag(await scr(kW), -30);
  const fq = await waitFeld();
  console.log(await pg.evaluate(() => JSON.stringify({ ops: ((objects[0].userData._occtParams||{}).ops||[]).map(o=>o.type+o.dist), st: objects[0].userData.shapeType, occt: objects[0].userData.occtShape, undo: undoStack.length, n: objects.length, edgeMode: _edgeMode })));
  check('Feld erscheint (Quader)', fq);
  await pg.click('#ebv-rund');
  await pg.fill('#ebv-in', '1,5'); await pg.press('#ebv-in', 'Enter');
  await pg.waitForTimeout(1500);
  const r3 = await pg.evaluate(() => { const o = objects[0]; const ops = (o.userData._occtParams || {}).ops || [];
    return { n: objects.length, ops: ops.map(op => op.type + ' ' + (+op.dist).toFixed(3)) }; });
  check('Quader: genau eine Rundung 1,5 mm', r3.n === 1 && r3.ops.length === 1 && r3.ops[0] === 'fillet 0.150', r3);
  console.log(ok ? 'ALLES OK ✓' : 'FEHLER ✗');
} finally { console.log('errs', errs.slice(0, 3)); await b.close(); srv.kill(); }
