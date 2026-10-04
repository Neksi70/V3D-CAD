// Ralf 4.10.2026: „Nach dem Abrunden ist die Farbe weg" (Kreisel: blaues Logo auf
// weißer Scheibe). ⬤ Alles abrunden muss je Farbe ein eigenes Teil behalten,
// Bemalung (🖍️) aufs gerundete Netz übertragen, und der 3MF danach 2 Farben haben.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8851;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
const res = await page.evaluate(async () => {
  hideStarter?.();
  const out = {};
  const run = async () => { document.getElementById('round-r').value = 0.6; await _roundApply(); };
  // ── Fall 1: Gruppe aus weißer Scheibe + blauem Klotz ──
  addShape('cylinder'); const disk = objects[objects.length-1];
  disk.scale.set(3.6, 0.25, 3.6); disk.material.color.set('#ffffff'); disk.userData.color = '#ffffff';
  addShape('box'); const logo = objects[objects.length-1];
  logo.scale.set(2, 0.3, 0.8); logo.position.set(0, 0.6, 0); logo.material.color.set('#1e5bd8'); logo.userData.color = '#1e5bd8';
  [disk, logo].forEach(o => o.updateMatrixWorld(true));
  selectObjs([disk, logo]); groupSelected();
  const grp = objects[objects.length-1];
  selectObjs([grp]); await run();
  const r1 = objects[objects.length-1];
  const kids = []; r1.traverse(m => { if (m.isMesh && !m.userData.isEdgeLines) kids.push('#' + m.material.color.getHexString()); });
  out.gruppe = { isGroup: !!r1.userData.isGroup, kids: kids.sort(), rounded: r1.children.every(c => !c.isMesh || c.userData._roundedMM) };
  const b = _build3mfBlob([r1]); out.gruppe.colors3mf = b && b.colors;
  // Speichern/Rückgängig: Datenkreislauf muss beide Farben behalten
  const rb = buildObjectFromData(JSON.parse(JSON.stringify(objectToData(r1))));
  const rk = []; rb.traverse(m => { if (m.isMesh && !m.userData.isEdgeLines) rk.push('#' + m.material.color.getHexString()); });
  out.gruppe.roundtrip = rk.sort();
  // ── Fall 2: einfarbiger Würfel bleibt EIN Netz in seiner Farbe ──
  addShape('box'); const cube = objects[objects.length-1];
  cube.scale.set(1, 1, 1); cube.position.set(8, 1, 0); cube.material.color.set('#e0a020'); cube.userData.color = '#e0a020';
  cube.updateMatrixWorld(true); selectObjs([cube]); await run();
  const r2 = objects[objects.length-1];
  out.einfarbig = { isMesh: !!r2.isMesh, col: '#' + r2.material.color.getHexString() };
  // ── Fall 3: bemalter Würfel — obere Hälfte rot bemalt ──
  addShape('box'); const pc = objects[objects.length-1];
  pc.scale.set(1, 1, 1); pc.position.set(-8, 1, 0); pc.updateMatrixWorld(true);
  const col = _mmuEnsure(pc);
  const g = pc.geometry, p = g.attributes.position, red = new THREE.Color(pc.userData._mmuSlots[0]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    let cy = 0; for (let k = 0; k < 3; k++) cy += v.fromBufferAttribute(p, i+k).applyMatrix4(pc.matrixWorld).y / 3;
    if (cy > 1.5) for (let k = 0; k < 3; k++) col.setXYZ(i+k, red.r, red.g, red.b);
  }
  col.needsUpdate = true;
  selectObjs([pc]); await run();
  const r3 = objects[objects.length-1];
  const st = _mmuTriStatesGeo(r3.geometry, r3.userData);
  let top = 0, topRed = 0, bot = 0, botRed = 0;
  if (st) { const q = r3.geometry.attributes.position; r3.updateMatrixWorld(true);
    for (let t = 0; t < st.states.length; t++) {
      const A = new THREE.Vector3().fromBufferAttribute(q, t*3).applyMatrix4(r3.matrixWorld);
      const B = new THREE.Vector3().fromBufferAttribute(q, t*3+1).applyMatrix4(r3.matrixWorld);
      const C = new THREE.Vector3().fromBufferAttribute(q, t*3+2).applyMatrix4(r3.matrixWorld);
      const ny = B.clone().sub(A).cross(C.clone().sub(A)).normalize().y;
      // Deckfläche (bemalt) und Bodenfläche (unbemalt) — Normalen nach oben/unten
      if (ny > 0.99) { top++; if (st.states[t] === 1) topRed++; } else if (ny < -0.99) { bot++; if (st.states[t] === 1) botRed++; } } }
  out.bemalt = { paint: !!r3.userData._mmuPaint, top, topRed, bot, botRed, colors3mf: _build3mfBlob([r3])?.colors };
  return out;
});
console.log(JSON.stringify(res, null, 1));
const g = res.gruppe, e = res.einfarbig, m = res.bemalt;
const ok = g.isGroup && g.kids.length === 2 && g.kids.includes('#ffffff') && g.kids.includes('#1e5bd8') && g.rounded && g.colors3mf === 2 && JSON.stringify(g.roundtrip) === JSON.stringify(g.kids)
  && e.isMesh && e.col === '#e0a020'
  && m.paint && m.top > 0 && m.topRed / m.top > 0.9 && m.botRed === 0 && m.colors3mf === 2
  && !errs.length;
console.log(errs.length ? 'ERR ' + errs.join('\n') : '', ok ? '✅ OK' : '❌ FEHLER');
await browser.close(); srv.kill();
process.exit(ok ? 0 : 1);
