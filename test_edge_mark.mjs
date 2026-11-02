// Kanten per Klick markieren (dazu/weg) und per Panel mit Maß anwenden (Volker 2.11.26)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8967;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fail = 0; const chk = (c, m) => { console.log((c ? 'OK   ' : 'FEHL ') + m); if (!c) fail++; };
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function' && window.v3dApi);
  await pg.evaluate(async () => { try { hideStarter(); } catch (e) {}
    await window.v3dApi.execute('shape.add', { type: 'box', size: [40, 40, 40] });
    const o = objects[objects.length - 1]; selectObjs([o]); fitToObjects([o]); });
  await pg.mouse.click(5, 450); await pg.waitForTimeout(300);
  await pg.evaluate(() => { selectObjs([objects[objects.length - 1]]); enterEdgeMode(); });
  await pg.waitForTimeout(400);
  // Bildschirmpunkte der drei oberen, sichtbaren Kanten
  const pts = await pg.evaluate(() => { const o = _edgeObj, dyn = o.userData._dynamicEdges, r = vpEl.getBoundingClientRect(); const out = [];
    dyn.forEach((e, i) => { const [a, b2] = _edgeWorldPts(o, e); const m = a.clone().lerp(b2, 0.5);
      const top = a.y > 3.9 && b2.y > 3.9; const p = m.clone().project(camera);
      if (top) out.push({ i, x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }); });
    return out; });
  const vis = [];
  for (const p of pts) { const ok = await pg.evaluate(({ x, y }) => { const r = vpEl.getBoundingClientRect(); return _edgePickIdx({ clientX: x, clientY: y, pointerType: 'mouse' }).idx; }, p); if (ok === p.i) vis.push(p); }
  chk(vis.length >= 2, 'mind. 2 obere Kanten anklickbar (' + vis.length + ')');
  const sel = () => pg.evaluate(() => [..._edgeSel]);
  await pg.mouse.click(vis[0].x, vis[0].y); await pg.waitForTimeout(200);
  await pg.mouse.click(vis[1].x, vis[1].y); await pg.waitForTimeout(200);
  let s = await sel(); chk(s.length === 2 && s.includes(vis[0].i) && s.includes(vis[1].i), 'zwei Klicks → zwei Kanten markiert ' + JSON.stringify(s));
  if (vis[2]) { await pg.mouse.click(vis[2].x, vis[2].y); await pg.waitForTimeout(200); s = await sel(); chk(s.length === 3, 'dritter Klick → drei ' + JSON.stringify(s)); }
  await pg.mouse.click(vis[0].x, vis[0].y); await pg.waitForTimeout(200);
  s = await sel(); chk(!s.includes(vis[0].i) && s.length === (vis[2] ? 2 : 1), 'markierte nochmal angeklickt → wieder weg ' + JSON.stringify(s));
  const panel = await pg.evaluate(() => !!document.getElementById('fp-edge-mm') && document.body.innerText.includes('Anwenden ('));
  chk(panel, 'Panel zeigt Maßfeld + Anwenden');
  await pg.screenshot({ path: '/tmp/edge_mark.png' });
  // Rundung 3 mm über das Panel
  await pg.evaluate(() => _edgeMarkKind(true));
  await pg.fill('#fp-edge-mm', '3'); await pg.press('#fp-edge-mm', 'Enter');
  await pg.waitForFunction(() => { const o = objects[objects.length - 1]; return o.userData._occtParams && o.userData._occtParams.ops.length; }, null, { timeout: 30000 });
  await pg.waitForTimeout(500);
  const ops = await pg.evaluate(() => objects[objects.length - 1].userData._occtParams.ops.map(x => x.type + ':' + (x.dist * 10).toFixed(1)));
  chk(ops.length === s.length && ops.every(x => x === 'fillet:3.0'), 'Rundung 3 mm an allen markierten Kanten ' + JSON.stringify(ops));
  chk(await pg.evaluate(() => _edgeMode), 'Kanten-Modus bleibt für die nächsten Kanten offen');
  // Fase an einer weiteren Kante
  const p2 = await pg.evaluate(() => { const o = _edgeObj, dyn = o.userData._dynamicEdges, r = vpEl.getBoundingClientRect();
    for (let i = 0; i < dyn.length; i++) { const [a, b2] = _edgeWorldPts(o, dyn[i]); if (Math.abs(a.x - b2.x) > 1e-3 || Math.abs(a.z - b2.z) > 1e-3) continue;
      const m = a.clone().lerp(b2, 0.5), p = m.clone().project(camera); const x = r.left + (p.x + 1) / 2 * r.width, y = r.top + (1 - p.y) / 2 * r.height;
      if (_edgePickIdx({ clientX: x, clientY: y, pointerType: 'mouse' }).idx === i) return { x, y }; } return null; });
  chk(!!p2, 'senkrechte Kante sichtbar');
  if (p2) { await pg.mouse.click(p2.x, p2.y); await pg.waitForTimeout(200);
    await pg.evaluate(() => _edgeMarkKind(false)); await pg.fill('#fp-edge-mm', '1,5'); await pg.click('#fp-edge-apply');
    await pg.waitForFunction(n => objects[objects.length - 1].userData._occtParams.ops.length > n, ops.length, { timeout: 30000 });
    const ops2 = await pg.evaluate(() => objects[objects.length - 1].userData._occtParams.ops.map(x => x.type + ':' + (x.dist * 10).toFixed(1)));
    chk(ops2.includes('chamfer:1.5') && ops2.filter(x => x === 'fillet:3.0').length === ops.length, 'Fase 1,5 mm dazu, Rundungen bleiben ' + JSON.stringify(ops2)); }
  chk(!errs.length, 'keine Seitenfehler ' + JSON.stringify(errs));
} finally { await b.close(); srv.kill(); }
console.log(fail ? 'FEHLER: ' + fail : 'ALLES OK'); process.exit(fail ? 1 : 0);
