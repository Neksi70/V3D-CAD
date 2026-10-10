import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8849;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit', cwd: process.cwd() });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
// sichtbare Kanten (gerade, lang) als Bildschirmpunkt + Weltmitte
const visEdges = () => pg.evaluate(() => {
  const o = _edgeMode ? _edgeObj : objects[objects.length-1];
  const el = o.children.find(c => c.userData.isEdgeLines); const pos = el.geometry.attributes.position;
  const r = vpEl.getBoundingClientRect(); const out = [];
  for (let i = 0; i < pos.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(el.matrixWorld);
    const c = new THREE.Vector3().fromBufferAttribute(pos,i+1).applyMatrix4(el.matrixWorld);
    if (a.distanceTo(c) < 1.2) continue;
    const m = a.clone().lerp(c, 0.5); const cam = m.clone().project(camera);
    const p = { x: r.left + (cam.x+1)/2*r.width, y: r.top + (1-cam.y)/2*r.height, w: m.toArray().map(v=>+v.toFixed(2)) };
    const pk = _dedPick({clientX:p.x, clientY:p.y, pointerType:'mouse'}, o);
    if (pk && pk.pw.distanceTo(m) < 0.2) out.push(p);
  }
  return out;
});
const opsWorld = () => pg.evaluate(() => { const o = objects[objects.length-1]; const q = o.userData._occtParams; if (!q) return null;
  return q.ops.map(op => ({ t: op.type, w: [(op.wa[0]+op.wb[0])/2+q.geoOff.x, (op.wa[1]+op.wb[1])/2+q.geoOff.y, (op.wa[2]+op.wb[2])/2+q.geoOff.z].map(v=>+v.toFixed(2)) })); });
const drag = async (p, dx) => { await pg.mouse.move(p.x, p.y); await pg.mouse.down();
  for (let i = 1; i <= 8; i++) { await pg.mouse.move(p.x + dx*i/8, p.y); await pg.waitForTimeout(30); }
  await pg.waitForTimeout(200); await pg.mouse.up(); await pg.waitForTimeout(900); };
const d3 = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
let fails = 0;
const check = (label, ops, want, type) => {
  const hit = ops && ops.find(o => d3(o.w, want) < 0.35 && o.t === type);
  console.log((hit ? 'OK  ' : 'FAIL') + ' ' + label, 'want', JSON.stringify(want), type, 'ops', JSON.stringify(ops));
  if (!hit) fails++;
};
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function');
  await pg.evaluate(() => hideStarter());
  await pg.mouse.click(700, 450);
  // Seit 11.10. (Ralf) greifen Kanten nur im Modus „⬡ Kanten bearbeiten" → erst öffnen
  await pg.evaluate(async () => { _newCreate(false); addShape('box'); await _loadOCCT(); selectObjs([objects[0]]); enterEdgeMode(true); });
  await pg.waitForTimeout(300);
  let E = await visEdges(); console.log('visible edges', E.length);
  // 1) Im Kanten-Modus direkt: erste Kante runden
  const e1 = E[0]; await drag(e1, 30); check('direkt #1 Rundung', await opsWorld(), e1.w, 'fillet');
  // 2) Direkt: die am weitesten entfernte sichtbare Kante fasen
  await pg.evaluate(() => { selectObjs([objects[objects.length-1]]); if (!_edgeMode) enterEdgeMode(true); });
  E = await visEdges(); const far = E.reduce((m, p) => d3(p.w, e1.w) > d3(m.w, e1.w) ? p : m, E[0]);
  await drag(far, -30); check('direkt #2 gegenüber Fase', await opsWorld(), far.w, 'chamfer');
  // 3) Klick (ohne Ziehen) auf Kante A → Kanten-Modus; dann Kante B drücken+ziehen
  await pg.evaluate(() => { selectObjs([objects[objects.length-1]]); if (!_edgeMode) enterEdgeMode(true); });
  E = await visEdges();
  const cand = E.filter(p => d3(p.w, e1.w) > 0.5 && d3(p.w, far.w) > 0.5);
  const A = cand[0], B = cand.reduce((m, p) => d3(p.w, A.w) > d3(m.w, A.w) ? p : m, cand[0]);
  await pg.mouse.move(A.x, A.y); await pg.mouse.down(); await pg.mouse.up(); await pg.waitForTimeout(200);
  console.log('  nach Klick A: edgeMode', await pg.evaluate(() => [_edgeMode, [..._edgeSel]]));
  const EB = await visEdges(); const B2 = EB.find(p => d3(p.w, B.w) < 0.2) || B;
  await drag(B2, 30); check('Kanten-Modus: A geklickt, B gezogen', await opsWorld(), B.w, 'fillet');
  const ops = await opsWorld();
  console.log('  A', JSON.stringify(A.w), 'B', JSON.stringify(B.w), 'A unberührt:', !ops.some(o => d3(o.w, A.w) < 0.35));
  await pg.screenshot({ path: '/tmp/claude-1000/-home-v3da/8ef21cf7-b51e-42e7-9863-7e8789f7c022/scratchpad/multi.png' });
} finally { console.log('fails', fails, 'errors', errs); await b.close(); srv.kill(); }
