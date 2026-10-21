// Funktionstest „↝ Entlang Pfad" mit Operation (1.18.225): Nut abziehen, Leiste anfügen, Automatik, Lage, Neuberechnung
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8873;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => typeof _swpResolve === 'function' && window.v3dApi, null, { timeout: 30000 });
await page.evaluate(() => { try { hideStarter(); } catch (e) {} });
const res = await page.evaluate(async () => {
  const out = {};
  const L = (a, b, hl) => ({ type: 'line', a: { u: a[0], v: a[1] }, b: { u: b[0], v: b[1] }, ...(hl ? { hl: 1 } : {}) });
  const rect = (x0, y0, x1, y1) => [L([x0,y0],[x1,y0]), L([x1,y0],[x1,y1]), L([x1,y1],[x0,y1]), L([x0,y1],[x0,y0])];
  const vol = o => { const g = o.geometry, p = g.attributes.position, n = g.index ? g.index.count : p.count, ix = i => g.index ? g.index.getX(i) : i; let v = 0;
    const e = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); o.updateMatrixWorld(true);
    for (let t = 0; t < n; t += 3){ a.fromBufferAttribute(p, ix(t)).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, ix(t+1)).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, ix(t+2)).applyMatrix4(o.matrixWorld); v += a.dot(e.crossVectors(b, c)); }
    return +(v / 6 * 1000).toFixed(1); };   // mm³
  const wait = async f => { for (let i = 0; i < 200 && !f(); i++) await new Promise(r => setTimeout(r, 100)); };
  // Platte 100×100×10 mm (Units: 10×10×1, Oberseite y = 1)
  const b = await v3dApi.execute('shape.add', { type: 'box', size: [100, 100, 10], name: 'Platte' });
  const plate = () => objects.find(o => o.userData.name === 'Platte' || o.userData.name === 'Platte');
  out.v0 = vol(objects[0]);
  // Skizze auf die Oberseite (y = 1)
  const onTop = () => { enterSketchMode(); _skSetFrameM(new THREE.Matrix4().makeTranslation(0, 1, 0)); };
  // 1) Nut: Querschnitt 4×3 mm, eingesenkt, L-Pfad 60+40 mm, Automatik → Abziehen
  onTop(); _sk.ents = [...rect(-0.2, -4.7, 0.2, -4.4), L([-3,-3],[3,-3],1), L([3,-3],[3,1],1)]; _skRender();
  _swp.p = { op: 'auto', lage: 'ein' }; _skSweep();
  out.autoCut = { op: _swp.res.op, tgt: _swp.res.target && _swp.res.target.userData.name };
  const n0 = objects.length; await _swpApply();
  await wait(() => objects.length === n0 && !objects.some(o => o.userData.isHole));
  const p1 = objects[0]; out.cut = { n: objects.length, vol: vol(p1), exp: +(100*100*10 - 4*3*100).toFixed(1), feat: p1.userData.feat && p1.userData.feat.list.map(f => f.typ + ':' + f.op).join(','), label: p1.userData.feat && _featLabel(p1.userData.feat.list.at(-1), p1.userData.feat.list.length - 1) };
  // 2) Leiste: 2×5 mm auf der Oberseite, Automatik → Anfügen
  onTop(); _sk.ents = [...rect(-0.1, -4.5, 0.1, -4.0), L([-4,4],[4,4],1)]; _skRender();
  _swp.p = { op: 'auto', lage: 'auf' }; _skSweep();
  out.autoJoin = { op: _swp.res.op };
  await _swpApply(); await wait(() => objects.length === 1);
  const p2 = objects[0]; out.join = { n: objects.length, vol: vol(p2), exp: +(100*100*10 - 4*3*100 + 2*5*80).toFixed(1), feat: p2.userData.feat && p2.userData.feat.list.map(f => f.typ + ':' + f.op).join(',') };
  // 3) Neuberechnen: Nut tiefer (Querschnitt 4×5) über den Verlauf
  const H = _featClone(p2.userData.feat); const k = H.list.findIndex(f => f.op === 'cut');
  H.list[k].ents = [...rect(-0.2, -4.9, 0.2, -4.4), ...H.list[k].ents.filter(e => e.hl)];
  await _featApply(p2, H); out.rebuilt = { vol: vol(p2), exp: +(100*100*10 - 4*5*100 + 2*5*80).toFixed(1) };
  // 4) Bearbeiten öffnet mit gespeicherter Operation + Lage
  _featEditSweep(p2.userData.id, k); _skSweep(); out.edit = { op: _swp.res.op, edit: !!_swp.res.edit, lage: _swp.p.lage, opts: [...document.querySelectorAll('#swp-panel select option')].map(o => o.value).join(',') };
  _swpClose(true); exitSketchMode();
  // 5) neuer Körper danach wieder Automatik; ohne Körper → neu
  enterSketchMode(); _sk.ents = [...rect(-0.2, -4.4, 0.2, -4), L([20,20],[30,20],1)]; _skRender(); _skSweep(); out.after = { op: _swp.p.op, res: _swp.res.op }; _swpClose(true); exitSketchMode();
  // 6) Abziehen ohne Körper → Meldung, nichts passiert
  enterSketchMode(); _sk.ents = [...rect(-0.2, -4.4, 0.2, -4), L([20,20],[30,20],1)]; _skRender(); _swp.p = { op: 'cut', lage: 'ein' }; _skSweep(); const nn = objects.length; await _swpApply(); out.cutNone = { still: objects.length === nn, open: _swp.open }; _swpClose(true); exitSketchMode();
  return out;
});
console.log(JSON.stringify(res, null, 1)); console.log('pageerrors:', errs);
await browser.close(); srv.kill();
