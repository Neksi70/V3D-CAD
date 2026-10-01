// Aufmaß mit importiertem Netz (Halter mit Löchern + Haken): Ergebnis muss wasserdicht bleiben.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8921;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd(), stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [], logs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => logs.push(m.text().slice(0, 200)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, null, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  hideStarter();
  window._tSetup = (n) => {
    _newCreate(false);
    addShape('box'); const plate = objects[objects.length-1];
    let b = getMeshBox(plate);
    plate.scale.x *= 20 / (b.max.x - b.min.x); plate.scale.z *= 20 / (b.max.z - b.min.z); plate.scale.y *= 2 / (b.max.y - b.min.y);
    plate.position.y += 0 - getMeshBox(plate).min.y; plate.updateMatrixWorld(true);
    // Halter: Platte 70×28 mit runder Nase, 2 Löcher Ø6, S-Haken
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(55, 0); s.absarc(55, 14, 14, -Math.PI/2, Math.PI/2, false); s.lineTo(30, 28);
    s.lineTo(22, 28); s.absarc(15, 28, 7, 0, Math.PI, true);
    s.lineTo(0, 28); s.lineTo(0, 0);
    for (const [x, y] of [[12, 14], [52, 14]]) { const h = new THREE.Path(); h.absarc(x, y, 3, 0, Math.PI * 2, true); s.holes.push(h); }
    let geo = new THREE.ExtrudeGeometry(s, { depth: 8, bevelEnabled: false, curveSegments: 48 }).toNonIndexed();
    if (window._tMulti) {
      // wie ein Baugruppen-Export: weitere geschlossene Hüllen, die IN die Platte hineinragen
      const b1 = new THREE.BoxGeometry(20, 12, 14).toNonIndexed(); b1.translate(35, 14, 7);      // Klotz, steckt 8 mm in der Platte
      const c1 = new THREE.CylinderGeometry(9, 9, 16, 48).toNonIndexed(); c1.rotateX(Math.PI / 2); c1.translate(55, 14, 8);
      const arrs = [geo, b1, c1].map(g => g.attributes.position.array);
      const P = new Float32Array(arrs.reduce((n, x) => n + x.length, 0)); let off = 0; for (const x of arrs) { P.set(x, off); off += x.length; }
      geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    }
    geo.computeVertexNormals();
    _addImportedGeo(geo, 'halter.stl', true, null, false);
    let part = objects[objects.length-1];
    if (window._tJitter) {   // wie nach Neuladen/Undo: Teil aus den gespeicherten Daten neu aufgebaut
      const d = objectToData(part); scene.remove(part); objects.splice(objects.indexOf(part), 1);
      part = buildObjectFromData(d); scene.add(part); objects.push(part);
    }
    part.userData.isHole = true;
    window._tPartTri = part.geometry.attributes.position.count / 3;
    selectObjs([plate, part]);
    _applyFillPlate(3, 5, true, n, true, 5);
    selectObjs(objects.slice());
  };
  // Netz-Gesundheit: offene / mehrfach belegte Kanten, Volumen
  window._tMesh = () => {
    const o = objects[0]; o.updateMatrixWorld(true);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, pos = g.attributes.position;
    const key = i => Math.round(pos.getX(i)*1e4) + ',' + Math.round(pos.getY(i)*1e4) + ',' + Math.round(pos.getZ(i)*1e4);
    const E = new Map(); let vol = 0; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      const k = [key(t), key(t+1), key(t+2)];
      for (let e = 0; e < 3; e++) { const p = k[e], q = k[(e+1)%3]; const kk = p < q ? p+'|'+q : q+'|'+p; E.set(kk, (E.get(kk)||0) + (p < q ? 1 : -1) * 1 + 1000); }
      a.fromBufferAttribute(pos, t).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, t+1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, t+2).applyMatrix4(o.matrixWorld);
      vol += a.dot(b.clone().cross(c)) / 6;
    }
    let offen = 0, mehr = 0, falsch = 0;
    for (const v of E.values()) { const n = Math.round(v / 1000), bal = v - n * 1000; if (n === 1) offen++; else if (n > 2) mehr++; else if (bal !== 0) falsch++; }
    
    // Diagnose: Splitter-Dreiecke und Kantenlinien
    let sliver = 0, nanN = 0; const nrm = g.attributes.normal;
    for (let t = 0; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t+1); c.fromBufferAttribute(pos, t+2);
      const ar = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      const L = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      if (ar < 1e-6 * L * L || ar < 1e-10) sliver++;
      if (nrm) for (let i = t; i < t + 3; i++) { const l = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)); if (!(l > 0.5)) nanN++; }
    }
    const el = o.children.find(ch => ch.userData.isEdgeLines);
    const lines = el ? el.geometry.attributes.position.count / 2 : -1;
    const ys = {}; for (let i = 0; i < pos.count; i++) { a.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); const k = (a.y * 10).toFixed(1); ys[k] = (ys[k] || 0) + 1; }
    return { ys, sliver, nanN, lines, indexed: !!o.geometry.index, name: o.userData.name, objs: objects.length, tri: pos.count / 3, offen, mehr, falschRum: falsch, volCm3: +(vol).toFixed(2) };
  };
});
const out = {};
await page.evaluate(m => { window._tMulti = m !== 'single'; window._tJitter = m.startsWith('rebuilt'); if (m === 'rebuilt-alt') window._fitGrowMf = async () => false; }, process.argv[2] || 'multi');
const run = async (tag, n, val, unit) => {
  await page.evaluate(n => _tSetup(n), n);
  page.evaluate(() => subtractHoles());
  await page.waitForSelector('#fit-dialog', { timeout: 5000 });
  await page.click(`#fit-dialog ._fit-unit[data-u="${unit}"]`);
  await page.fill('#fit-dialog ._fit-val', String(val));
  await page.click('#fit-dialog ._fit-ok');
  await page.waitForFunction(() => objects.length === 1, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  out[tag] = await page.evaluate(() => _tMesh());
  await page.evaluate(() => { selectObjs([]); setView && 0; });
  await page.mouse.click(700, 500); await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/fit_${process.argv[2] || 'multi'}_${tag}.png` });
};
try {
  await run('ohne', 2, 0, 'mm');
  await run('mm05', 2, 0.5, 'mm');
  await run('mm2', 2, 2, 'mm');
  await run('p2', 2, 2, '%');
} catch (e) { out.FEHLER = String(e).slice(0, 300); }
out.partTri = await page.evaluate(() => _tPartTri);
console.log(JSON.stringify({ ...out, errs, logs: logs.filter(l => !/transparent/.test(l)).slice(-25) }, null, 1));
await browser.close(); srv.kill();
