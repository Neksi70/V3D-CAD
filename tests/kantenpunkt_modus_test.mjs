// Kanten-Griff nur im Modus „⬡ Kanten bearbeiten" (Ralf 11.10.26: gelber/oranger
// Punkt erschien beim Anklicken einer Kante in der normalen Auswahl, der Modus
// öffnete still und schluckte danach jeden Klick — weg nur mit Esc/Neuladen).
// Echte Mausbewegungen/Klicks an einer Würfelkante.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8946;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof addShape === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} const o = document.getElementById('auth-overlay'); if (o) o.style.display = 'none'; });
  await p.mouse.click(700, 500);
  await p.evaluate(async () => { _newCreate(false); addShape('box'); await _loadOCCT(); deselect(); });
  await p.waitForTimeout(300);
  const st = () => p.evaluate(() => ({
    edge: _edgeMode, sel: [..._edgeSel].length,
    handle: document.getElementById('edge-bevel-handle').style.display !== 'none',
    hl: !!(_ded.hl && _ded.hl.visible), cur: canvas.style.cursor,
    selObj: selectedObjs.length === 1 && selectedObjs[0] === objects[0],
    pos: objects[0].position.toArray().map(v => +v.toFixed(3)).join(','),
    ops: ((objects[0].userData._occtParams && objects[0].userData._occtParams.ops) || []).map(o => o.type) }));
  const mid = () => p.evaluate(() => { const o = objects[0]; const m = getMeshBox(o).getCenter(new THREE.Vector3()).project(camera); const r = vpEl.getBoundingClientRect();
    return { x: r.left + (m.x + 1) / 2 * r.width, y: r.top + (1 - m.y) / 2 * r.height }; });
  // sichtbare Kante (Mitte einer Kantenlinie, nicht verdeckt), nicht unter dem Verschiebe-Gizmo
  const edgePt = () => p.evaluate(() => {
    const o = objects[0]; const el = o.children.find(c => c.userData.isEdgeLines); const pos = el.geometry.attributes.position;
    el.updateMatrixWorld(true); const r = vpEl.getBoundingClientRect();
    for (let i = 0; i < pos.count; i += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(el.matrixWorld);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(el.matrixWorld);
      const m = a.clone().lerp(c, 0.5).project(camera);
      const q = { x: r.left + (m.x + 1) / 2 * r.width, y: r.top + (1 - m.y) / 2 * r.height };
      if (_dedPick({ clientX: q.x, clientY: q.y, pointerType: 'mouse' }, o)) return q;
    } return null; });

  // ── Normalmodus ──
  let c = await mid();
  await p.mouse.click(c.x, c.y); await p.waitForTimeout(200);
  let s = await st();
  ok(s.selObj && !s.edge, 'Körper per Klick gewählt, kein Kanten-Modus');
  let e = await edgePt();
  ok(!!e, 'sichtbare Kante gefunden');
  await p.mouse.move(e.x + 30, e.y + 30); await p.mouse.move(e.x, e.y, { steps: 3 }); await p.waitForTimeout(200);
  s = await st();
  ok(!s.hl && s.cur !== 'pointer' && !s.handle && !s.edge, 'Überfahren der Kante: kein Leuchten, kein Punkt');
  await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(300);
  s = await st();
  ok(!s.edge && !s.handle && s.sel === 0, 'Klick auf Kante: kein Kanten-Modus, kein oranger Punkt');
  ok(s.selObj, 'Körper bleibt gewählt');
  const pos0 = s.pos;
  e = await edgePt();
  await p.mouse.move(e.x, e.y); await p.mouse.down();
  await p.mouse.move(e.x + 60, e.y + 10, { steps: 8 }); await p.waitForTimeout(200);
  s = await st();
  ok(!s.edge && !s.handle, 'Ziehen an der Kante: kein Kanten-Griff');
  await p.mouse.up(); await p.waitForTimeout(400);
  s = await st();
  ok(s.pos !== pos0 && s.ops.length === 0, 'Ziehen an der Kante verschiebt den Körper (keine Fase): ' + pos0 + ' → ' + s.pos);
  ok(!s.edge && !s.handle, 'nach dem Ziehen kein Rest-Punkt');

  // ── Kanten-bearbeiten-Modus ──
  await p.click('button.fp-btn:has-text("Kanten bearbeiten")'); await p.waitForTimeout(300);
  s = await st();
  ok(s.edge, 'Knopf „Kanten bearbeiten" öffnet den Modus');
  e = await p.evaluate(() => null) || await edgePt();
  await p.mouse.move(e.x + 30, e.y + 30); await p.mouse.move(e.x, e.y, { steps: 3 }); await p.waitForTimeout(200);
  ok(await p.evaluate(() => _edgeHover >= 0), 'Kante leuchtet im Modus beim Überfahren');
  await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(300);
  s = await st();
  ok(s.edge && s.handle && s.sel === 1, 'Klick auf Kante im Modus: Kante gewählt, Griff sichtbar');
  await p.mouse.move(e.x, e.y); await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(e.x - i * 2, e.y); await p.waitForTimeout(30); }
  await p.mouse.up();
  await p.waitForFunction(() => ((objects[0].userData._occtParams || {}).ops || []).length > 0, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(500);
  s = await st();
  ok(s.ops.includes('chamfer'), 'Ziehen nach links im Modus: Fase angelegt (' + s.ops.join(',') + ')');
  ok(s.edge, 'Modus bleibt nach dem Zug offen');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);   // Maßfeld schließen
  // Klick ins Leere beendet den Modus (vorher: Klick verschluckt, Punkt blieb)
  await p.mouse.click(1000, 780); await p.waitForTimeout(300);
  s = await st();
  ok(!s.edge && !s.handle, 'Klick ins Leere beendet den Modus, kein Rest-Punkt');
  c = await mid();
  await p.mouse.click(c.x, c.y); await p.waitForTimeout(200);
  s = await st();
  ok(s.selObj && !s.edge, 'danach normal weiter: Körper wieder wählbar');

  // Esc beendet ebenfalls; Auswahl lösen beendet ebenfalls
  await p.click('button.fp-btn:has-text("Kanten bearbeiten")'); await p.waitForTimeout(300);
  e = await edgePt();
  await p.mouse.click(e.x, e.y); await p.waitForTimeout(200);
  ok((await st()).handle, 'Griff wieder da');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  s = await st();
  ok(!s.edge && !s.handle, 'Esc: Modus + Punkt weg');
  await p.evaluate(() => selectObjs([objects[0]]));
  await p.click('button.fp-btn:has-text("Kanten bearbeiten")'); await p.waitForTimeout(300);
  await p.evaluate(() => deselect()); await p.waitForTimeout(100);
  s = await st();
  ok(!s.edge && !s.handle, 'Auswahl lösen beendet den Modus');
  // Anderen Körper wählen beendet den Modus
  await p.evaluate(() => { addShape('cylinder'); objects[1].position.x += 40; objects[1].updateMatrixWorld(true); selectObjs([objects[0]]); });
  await p.click('button.fp-btn:has-text("Kanten bearbeiten")'); await p.waitForTimeout(300);
  await p.evaluate(() => selectObjs([objects[1]])); await p.waitForTimeout(100);
  s = await st();
  ok(!s.edge && !s.handle, 'anderen Körper wählen beendet den Modus');
  ok(errs.length === 0, 'keine Seitenfehler ' + JSON.stringify(errs));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
process.exit(fail ? 1 : 0);
