// 🕳️ Loch: Kreis dockt in der Flächenmitte an, Versatz/Ø/Tiefe im Fenster; Kreis aufziehen (Volker 2.11.26)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8968;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fail = 0; const chk = (c, m) => { console.log((c ? 'OK   ' : 'FEHL ') + m); if (!c) fail++; };
const vol = () => pg.evaluate(() => { const o = objects[objects.length - 1], g = o.geometry, p = g.attributes.position, ix = g.index; o.updateMatrixWorld(true);
  let V = 0; const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c = new THREE.Vector3(); const at = (t, w) => w.fromBufferAttribute(p, ix ? ix.getX(t) : t).applyMatrix4(o.matrixWorld);
  for (let t = 0; t < (ix ? ix.count : p.count); t += 3) { at(t, a); at(t + 1, b2); at(t + 2, c); V += a.dot(b2.cross(c)) / 6; } return Math.abs(V) * 1000; });
// Würfel 40 mm, Klick auf die Oberseite NICHT in der Mitte
async function wuerfel() {
  await pg.evaluate(async () => { try { hideStarter(); } catch (e) {} _newCreate(false);
    await window.v3dApi.execute('shape.add', { type: 'box', size: [40, 40, 40] }); const o = objects[objects.length - 1]; deselect(); fitToObjects([o]); });
  await pg.mouse.click(5, 450); await pg.waitForTimeout(300);
}
const topPt = (fx, fz) => pg.evaluate(([fx, fz]) => { const r = vpEl.getBoundingClientRect(), p = new THREE.Vector3(fx, 4, fz).project(camera);
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }, [fx, fz]);
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function' && window.v3dApi);
  // ── 1) Durchgangsloch Ø5 mittig
  await wuerfel();
  const v0 = await vol();
  await pg.evaluate(() => _holeQuickStart()); await pg.waitForTimeout(300);
  let p = await topPt(1.3, -0.9);           // Klick 13 mm / 9 mm neben der Mitte
  await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(600);
  const st = await pg.evaluate(() => ({ dbg: { act: _sk.active, fp: _sk.facePick, hole: _sk.hole, tip: (document.getElementById('sk-hole-tip')||{}).textContent, fr: !!_sk.faceRef }, O: _sk.O ? _sk.O.toArray().map(v => +v.toFixed(4)) : null, open: _skLoch.open, vis: document.getElementById('sk-loch') ? getComputedStyle(document.getElementById('sk-loch')).display : 'fehlt', c: _skLoch.en && _skLoch.en.c, ents: _sk.ents.length }));
  chk(st.O && Math.abs(st.O[0]) < 1e-3 && Math.abs(st.O[1] - 4) < 1e-3 && Math.abs(st.O[2]) < 1e-3, 'Skizzen-Ursprung = Flächenmitte ' + JSON.stringify(st.O));
  chk(st.open && st.vis === 'flex' && st.ents === 1 && st.c.u === 0 && st.c.v === 0, 'Loch-Fenster offen, Kreis in der Mitte');
  await pg.screenshot({ path: '/tmp/loch1.png' });
  await pg.click('#skl-go');
  await pg.waitForFunction(n => { const o = objects[objects.length - 1]; return !_sk.active && o; }, null, { timeout: 30000 }); await pg.waitForTimeout(800);
  const v1 = await vol(), soll1 = v0 - Math.PI * 2.5 * 2.5 * 40;
  chk(Math.abs(v1 - soll1) < soll1 * 0.004, 'Durchgangsloch Ø5: Volumen ' + v1.toFixed(0) + ' ≈ ' + soll1.toFixed(0));
  // ── 2) Sackloch Ø8, 10 tief, 8 mm nach rechts per Feld
  await wuerfel();
  const w0 = await vol();
  await pg.evaluate(() => _holeQuickStart()); await pg.waitForTimeout(300);
  p = await topPt(-0.5, 0.7);
  await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(600);
  await pg.fill('#skl-d', '8'); await pg.fill('#skl-x', '8'); await pg.uncheck('#skl-thru'); await pg.fill('#skl-t', '10');
  const cw = await pg.evaluate(() => { const c = _skLoch.en.c, w = _skToWorld(new THREE.Vector3(c.u, 0, c.v)); const r = vpEl.getBoundingClientRect();
    const s0 = _sk.O.clone().project(camera), s1 = w.clone().project(camera); return { w: w.toArray().map(v => +v.toFixed(3)), dxScreen: s1.x - s0.x, r: _skLoch.en.r }; });
  chk(Math.abs(Math.hypot(cw.w[0], cw.w[2]) - 0.8) < 1e-3 && cw.dxScreen > 0 && Math.abs(cw.r - 0.4) < 1e-6, '→ 8 mm: Kreis 8 mm neben der Mitte, auf dem Bildschirm rechts ' + JSON.stringify(cw));
  await pg.press('#skl-t', 'Enter');
  await pg.waitForFunction(() => !_sk.active, null, { timeout: 30000 }); await pg.waitForTimeout(800);
  const w1 = await vol(), soll2 = w0 - Math.PI * 4 * 4 * 10;
  chk(Math.abs(w1 - soll2) < soll2 * 0.004, 'Sackloch Ø8×10: Volumen ' + w1.toFixed(0) + ' ≈ ' + soll2.toFixed(0));
  // ── 3) Klick auf die Fläche versetzt den Kreis, Fang an der Mitte
  await wuerfel();
  await pg.evaluate(() => _holeQuickStart()); await pg.waitForTimeout(300);
  let q = await topPt(1.2, 1.2);
  await pg.mouse.click(q.x, q.y); await pg.waitForTimeout(600);   // Fläche wählen (beliebig)
  q = await topPt(1.2, 1.2); p = await topPt(0, 0);              // Kamera schaut jetzt auf die Fläche
  await pg.mouse.click(q.x, q.y); await pg.waitForTimeout(300);   // Kreis dorthin
  const moved = await pg.evaluate(() => ({ c: _skLoch.en.c, x: document.getElementById('skl-x').value, y: document.getElementById('skl-y').value }));
  chk(Math.hypot(moved.c.u, moved.c.v) > 1, 'Klick versetzt den Kreis, Felder folgen ' + JSON.stringify(moved));
  await pg.mouse.click(p.x + 3, p.y + 2); await pg.waitForTimeout(300);   // knapp neben der Mitte → rastet ein
  const snapped = await pg.evaluate(() => _skLoch.en.c);
  chk(Math.abs(snapped.u) < 1e-9 && Math.abs(snapped.v) < 1e-9, 'Klick nahe der Mitte rastet auf die Mitte ein ' + JSON.stringify(snapped));
  await pg.click('#sk-loch >> text=Abbrechen'); await pg.waitForTimeout(200);
  chk(await pg.evaluate(() => !_sk.active && getComputedStyle(document.getElementById('sk-loch')).display === 'none'), 'Abbrechen schließt Fenster und Skizze');
  // ── 4) Skizze auf Fläche + Kreis AUFZIEHEN
  await wuerfel();
  await pg.evaluate(() => { enterSketchMode(); _skFacePickStart(); }); await pg.waitForTimeout(300); p = await topPt(0.4, 0.4);
  await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(500);
  await pg.evaluate(() => _skSetTool('circle'));
  const c0 = await topPt(0, 0), c1 = await topPt(1, 0);
  await pg.mouse.move(c0.x + 2, c0.y + 1); await pg.mouse.down(); await pg.mouse.move((c0.x + c1.x) / 2, (c0.y + c1.y) / 2, { steps: 4 }); await pg.mouse.move(c1.x, c1.y, { steps: 4 }); await pg.mouse.up();
  await pg.waitForTimeout(300);
  const dr = await pg.evaluate(() => ({ n: _sk.ents.length, pend: _sk.pending.length, e: _sk.ents[0] }));
  chk(dr.n === 1 && dr.pend === 0 && Math.abs(dr.e.c.u) < 1e-6 && Math.abs(dr.e.c.v) < 1e-6 && Math.abs(dr.e.r - 1) < 0.05, 'Kreis aufgezogen, Mitte auf Flächenmitte gefangen ' + JSON.stringify(dr));
  // zwei Klicks gehen weiter
  const k0 = await topPt(-1.5, -1.2), k1 = await topPt(-1.0, -1.2);
  await pg.mouse.click(k0.x, k0.y); await pg.waitForTimeout(400); await pg.mouse.move(k1.x, k1.y, { steps: 5 }); await pg.mouse.click(k1.x, k1.y); await pg.waitForTimeout(300);
  const zk = await pg.evaluate(() => ({ n: _sk.ents.length, pend: _sk.pending.length, tool: _sk.tool, e: _sk.ents.map(x => [x.c, x.r]) }));
  chk(zk.n === 2 && zk.pend === 0, 'Kreis mit zwei Klicks geht weiter ' + JSON.stringify(zk));
  chk(!errs.length, 'keine Seitenfehler ' + JSON.stringify(errs));
} finally { await b.close(); srv.kill(); }
console.log(fail ? 'FEHLER: ' + fail : 'ALLES OK'); process.exit(fail ? 1 : 0);
