// ▦ Füllen: Anordnung „dicht" und „in Reihen" mit einem Halter-ähnlichen Blechteil
// (unsymmetrisch, Bogen-Ausschnitt, Lasche). Prüft je Lauf am ECHTEN Netz:
// kein Teil ragt über die Platte (Randabstand), keine Überlappung; im Reihen-Modus
// zusätzlich: alle Teile gleich gedreht, Spalten/Reihen auf gemeinsamen Linien,
// konstante Teilung.
//   MODE=dense|rows  PX/PZ=Teilung mm  COUNT=n  PW/PD=Plattenmaß  LOCH=1 (4 Eckbohrungen)  NOROT=1
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 8937;
const OUT = process.env.OUT || '/tmp/claude-1000/-home-v3da-orca-wasm/0793dff5-93f4-5c16-a3e4-e7f955311788/scratchpad';
const MODE = process.env.MODE || 'rows', COUNT = process.env.COUNT || '';
const PW = Number(process.env.PW || 600), PD = Number(process.env.PD || 400), MARGIN = Number(process.env.MARGIN || 5);
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = []; page.on('console', m => logs.push(m.text())); page.on('pageerror', e => logs.push('PAGEERR ' + e));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForTimeout(3500);

// Halter als STL (mm) im Browser erzeugen
const stl = await page.evaluate(() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(30, 0); s.absarc(45, 0, 15, Math.PI, 0, true); s.lineTo(85, 0); s.lineTo(95, 10);
  s.lineTo(95, 22); s.lineTo(70, 40); s.lineTo(45, 55); s.lineTo(30, 55); s.lineTo(10, 35);
  s.lineTo(-15, 30); s.lineTo(-20, 22); s.lineTo(-15, 14); s.lineTo(0, 14); s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 6, bevelEnabled: false, curveSegments: 24 }).toNonIndexed();
  const p = g.attributes.position, n = p.count / 3;
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf); dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const o = 84 + t * 50 + 12 + k * 12;
    dv.setFloat32(o, p.getX(t*3+k), true); dv.setFloat32(o + 4, p.getY(t*3+k), true); dv.setFloat32(o + 8, p.getZ(t*3+k), true);
  }
  return Array.from(new Uint8Array(buf));
});
const STL = OUT + '/halter.stl'; fs.writeFileSync(STL, Buffer.from(stl));

await page.evaluate(([PW, PD]) => { hideStarter?.(); addShape('box'); const pl = objects[objects.length-1];
  pl.scale.set(PW/20, 0.5, PD/20); deselect(); selectedObjs.push(pl); _dropSelectedToGround(); }, [PW, PD]);
if (process.env.LOCH) {                                      // 4 Eckbohrungen Ø 8, 20 mm vom Rand
  await page.evaluate(([PW, PD]) => { const pl = objects[0];
    for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) { addShape('cylinder'); const c = objects[objects.length-1];
      c.scale.set(0.4, 2, 0.4); c.position.set(sx * (PW/20 - 2), 0.5, sz * (PD/20 - 2)); c.updateMatrixWorld(true);
      deselect(); selectedObjs.push(c); setObjMode('hole'); }
    deselect(); selectObjs([...objects]); subtractHoles(); }, [PW, PD]);
  await page.waitForFunction(() => objects.length === 1, null, { timeout: 60000 });
  await page.waitForTimeout(500);
}
await page.setInputFiles('#fimport', STL);
await page.waitForTimeout(2500);
await page.evaluate(() => { if (document.getElementById('sz-modal').classList.contains('show')) _confirmSize(); });
await page.waitForTimeout(800);
await page.evaluate(() => { const pl = objects[0], part = objects[objects.length-1];
  const bb = getMeshBox(part); part.position.y += getMeshBox(pl).max.y - bb.min.y; part.updateMatrixWorld(true);
  deselect(); selectObjs([pl, part]); });
console.log('Teil (mm):', await page.evaluate(() => getMeshBox(objects[1]).getSize(new THREE.Vector3()).toArray().map(v => +(v*10).toFixed(1))));
await page.click('button:has-text("▦ Füllen")');
if (await page.locator('#pat-fill-mode').count()) await page.selectOption('#pat-fill-mode', MODE);
else if (MODE === 'rows') { console.log('kein Anordnungs-Feld im Dialog'); }
await page.fill('#pat-fill-count', COUNT);
if (process.env.PX) await page.fill('#pat-fill-px', process.env.PX);
if (process.env.PZ) await page.fill('#pat-fill-pz', process.env.PZ);
await page.fill('#pat-fill-gap', process.env.GAP || '3'); await page.fill('#pat-fill-margin', String(MARGIN));
if (process.env.NOROT) await page.uncheck('#pat-fill-rot');
if (process.env.NOEVEN && COUNT) await page.uncheck('#pat-fill-even');
await page.click('#pat-modal .btn.pri');
await page.waitForTimeout(2500);
const r = await page.evaluate(([MARGIN]) => {
  const pl = objects[0], parts = objects.slice(1), pb = getMeshBox(pl), m = MARGIN / 10 - 0.051;   // 1 Rasterzelle Toleranz
  const boxes = parts.map(o => getMeshBox(o));
  const raus = boxes.filter(b => b.min.x < pb.min.x + m || b.max.x > pb.max.x - m || b.min.z < pb.min.z + m || b.max.z > pb.max.z - m).length;
  const rots = new Set(parts.map(o => (Math.round(new THREE.Euler().setFromQuaternion(o.quaternion, 'YXZ').y / (Math.PI/2)) + 4) % 4));
  const q = v => +(v * 10).toFixed(2);
  const xs = [...new Set(boxes.map(b => q(b.min.x)))].sort((a, b) => a - b), zs = [...new Set(boxes.map(b => q(b.min.z)))].sort((a, b) => a - b);
  const d = a => [...new Set(a.slice(1).map((v, i) => +(v - a[i]).toFixed(1)))];
  return { n: parts.length, raus, rots: [...rots], spalten: xs.length, reihen: zs.length, teilungX: d(xs), teilungZ: d(zs),
    randL: q(Math.min(...boxes.map(b => b.min.x)) - pb.min.x), randR: q(pb.max.x - Math.max(...boxes.map(b => b.max.x))),
    randV: q(Math.min(...boxes.map(b => b.min.z)) - pb.min.z), randH: q(pb.max.z - Math.max(...boxes.map(b => b.max.z))),
    note: document.getElementById('notif')?.textContent || '' };
}, [MARGIN]);
console.log(JSON.stringify(r)); console.log(logs.filter(l => /fill|PAGEERR/.test(l)).join('\n'));
const ov = await page.evaluate(async () => { const w = await _mfInit(); const ps = objects.slice(1).map(o => _mfFromSoup(w, _moldCollectTris(o)));
  const pl = _mfFromSoup(w, _moldCollectTris(objects[0]));
  let worst = 0; for (let i = 0; i < ps.length; i++) for (let j = i+1; j < ps.length; j++) worst = Math.max(worst, w.Manifold.intersection(ps[i], ps[j]).volume()); return worst; });
console.log('größte Überlappung mm³:', ov.toFixed(3));
await page.evaluate(() => { deselect(); setView('top'); fitToObjects(objects); });
await page.mouse.move(5, 5); await page.mouse.click(700, 880).catch(() => {}); await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/fill_${MODE}_${COUNT || 'max'}${process.env.LOCH ? '_loch' : ''}.png` });
await browser.close(); srv.kill();
const ok = r.n >= 1 && r.raus === 0 && ov < 0.01 && (MODE !== 'rows' || (r.rots.length === 1 && r.teilungX.length <= 1 && r.teilungZ.length <= 1 && (COUNT || r.n === r.spalten * r.reihen) && Math.abs(r.randL - r.randR) < 1.1 && (COUNT || Math.abs(r.randV - r.randH) < 1.1)));
console.log(ok ? 'OK' : 'FEHLER');
process.exit(ok ? 0 : 1);
