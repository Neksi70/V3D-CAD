// Test: Stützfinnen (_sfn*) — Rechenkern Support Fins (printfins.com, MIT) im Worker.
// Geprüft wird:
//   (1) der Worker wird ausgeliefert und lädt (lib/stuetzfinnen-worker.js),
//   (2) ein T-Teil mit zwei waagrechten Armen zeigt Überhänge (rot),
//   (3) die Vorschau baut Finnen, und zwar UNTER den Armen, auf der Platte —
//       die Umrechnung Szene (cm, Y oben) ↔ Kern (mm, Z oben) stimmt,
//   (4) „Finnen erzeugen“ legt einen eigenen Körper an, Rückgängig nimmt ihn weg,
//   (5) „Lage vorschlagen“ dreht das Teil und lässt es auf der Platte,
//   (6) Abbrechen räumt die Hilfsobjekte weg.
// Aufruf: V3D_URL=http://127.0.0.1:PORT/volme3d.html node tests/stuetzfinnen_test.mjs
//         (ohne V3D_URL startet der Test einen eigenen Dev-Server auf 8857)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

let srv = null;
let URL = process.env.V3D_URL;
if (!URL) {
  const { execSync } = await import('node:child_process');
  if (execSync('ss -tln').toString().includes(':8857 ')) { console.error('Port 8857 belegt (fremder Server mit altem Stand?) — abgebrochen'); process.exit(2); }
  srv = spawn('python3', ['volme3d_server.py', '8857', '--dev'], { stdio: 'inherit' });
  URL = 'http://127.0.0.1:8857/volme3d.html';
  await new Promise(r => setTimeout(r, 1500));
}
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
try {
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(URL, { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
  await pg.evaluate(() => { hideStarter?.(); document.getElementById('auth-overlay')?.classList.add('hidden'); _newCreate(false); });

  const wst = await pg.evaluate(async () => (await fetch('lib/stuetzfinnen-worker.js')).status);
  ok('Worker wird ausgeliefert', wst === 200, wst);

  // T-Teil in mm (Z oben): Steg 10 breit, 20 hoch; Arme je 15 mm überstehend, 6 mm dick; 10 mm tief
  const n0 = await pg.evaluate(() => {
    const s = new THREE.Shape([[0,0],[10,0],[10,20],[25,20],[25,26],[-15,26],[-15,20],[0,20]].map(p => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(s, { depth: 10, bevelEnabled: false }).toNonIndexed();
    g.rotateX(Math.PI / 2);                 // Profil-y → z (oben), Tiefe → −y
    g.translate(0, 5, 0);
    const m = _moldSceneMesh(g, 'T-Test');
    _updateObjEdgeLines(m); selectObjs([m]); updateTree();
    return objects.length;
  });

  await pg.evaluate(() => _sfnOpen());
  await pg.waitForFunction(() => { const d = _sfnDbg(); return d.info || /fehlgeschlagen/.test(document.getElementById('sfn-info').textContent); }, { timeout: 60000 });
  const d1 = await pg.evaluate(() => ({ ..._sfnDbg(), txt: document.getElementById('sfn-info').textContent,
                                        ueber: document.getElementById('sfn-ueber').textContent }));
  ok('Überhänge erkannt (rot)', d1.red > 0, { red: d1.red, ueber: d1.ueber });
  ok('Vorschau baut Finnen', d1.prev > 0 && d1.info && d1.info.fins >= 1, { prev: d1.prev, fins: d1.info && d1.info.fins, txt: d1.txt });
  ok('Panel offen, Szene sichtbar (Seitenleiste)', await pg.evaluate(() =>
    getComputedStyle(document.getElementById('sfn-modal')).pointerEvents === 'none'));

  await pg.evaluate(() => _sfnApply());
  const r = await pg.evaluate(() => {
    const m = objects[objects.length - 1]; m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    const part = objects.find(o => o.userData.name === 'T-Test');
    const pb = new THREE.Box3().setFromObject(part);
    // Finnen-Dreiecke unter den Armen? Weltpunkte in mm, Höhe = y*10
    const pos = m.geometry.attributes.position, v = new THREE.Vector3();
    let links = 0, rechts = 0, ueberArm = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const x = v.x * 10, h = v.y * 10;
      if (h > 20.5) ueberArm++;
      if (x < -1 && h < 20.5) links++;
      if (x > 11 && h < 20.5) rechts++;
    }
    return { n: objects.length, name: m.userData.name, minY: bb.min.y * 10, maxY: bb.max.y * 10,
             partMinY: pb.min.y * 10, links, rechts, ueberArm, offen: _sfnDbg().open };
  });
  ok('Finnen-Körper angelegt', r.n === n0 + 1 && /Stützfinnen/.test(r.name), r);
  ok('Finnen stehen auf der Platte', Math.abs(r.minY) < 0.6, r.minY);
  ok('Finnen reichen bis unter die Arme (≈20 mm)', r.maxY > 18 && r.maxY < 21.5, r.maxY);
  ok('Finnen unter BEIDEN Armen', r.links > 0 && r.rechts > 0, { links: r.links, rechts: r.rechts });
  ok('nichts über den Armen', r.ueberArm === 0, r.ueberArm);
  ok('Panel nach Übernehmen zu', !r.offen);

  await pg.evaluate(() => undo());
  ok('Rückgängig nimmt die Finnen weg', await pg.evaluate(() => objects.length) === n0);

  // Von Hand zeichnen: Ansicht von unten, zwei echte Klicks unter den LINKEN Arm
  await pg.evaluate(() => { selectObjs([objects.find(o => o.userData.name === 'T-Test')]); _sfnOpen(); });
  await pg.waitForFunction(() => _sfnDbg().info, { timeout: 60000 });
  await pg.evaluate(() => { _sfnSet('mode', 'draw'); orbitTarget.set(-0.5, 1.5, 0); sph.theta = 0; sph.phi = Math.PI - 0.25; sph.r = 9; sph2cam(); });
  await pg.waitForFunction(() => _sfnDbg().info, { timeout: 60000 });
  const scr = (x, y, z) => pg.evaluate(([x, y, z]) => {
    const v = new THREE.Vector3(x, y, z).project(camera), r = canvas.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }, [x, y, z]);
  await pg.evaluate(() => _sfnDrawStart());
  const p1 = await scr(-1.3, 2.0, 0), p2 = await scr(-0.3, 2.0, 0), pm = await scr(-0.6, 2.0, 0);
  await pg.mouse.move(p1[0], p1[1]); await pg.mouse.down(); await pg.mouse.up();
  ok('erster Punkt gesetzt', await pg.evaluate(() => _sfnDbg().start));
  await pg.mouse.move(pm[0], pm[1], { steps: 4 });
  await pg.waitForFunction(() => _sfnDbg().ghost > 0, { timeout: 20000 }).catch(() => {});
  ok('Live-Vorschau der Wand', await pg.evaluate(() => _sfnDbg().ghost > 0));
  await pg.mouse.move(p2[0], p2[1]); await pg.mouse.down(); await pg.mouse.up();
  await pg.waitForFunction(() => _sfnDbg().walls === 1 && _sfnDbg().info && (_sfnDbg().info.walls || []).length === 1, { timeout: 30000 }).catch(() => {});
  const dw = await pg.evaluate(() => _sfnDbg());
  ok('Wand von Hand gebaut', dw.walls === 1 && dw.info && dw.info.walls && dw.info.walls[0].ok, dw.info && dw.info.walls);
  // zu kurze Wand wird abgelehnt und nicht gezählt
  const q1 = await scr(-0.8, 2.0, 0), q2 = await scr(-0.79, 2.0, 0);
  await pg.mouse.move(q1[0], q1[1]); await pg.mouse.down(); await pg.mouse.up();
  await pg.mouse.move(q2[0], q2[1]); await pg.mouse.down(); await pg.mouse.up();
  await pg.waitForTimeout(800);
  ok('zu kurze Wand abgelehnt', await pg.evaluate(() => _sfnDbg().walls) === 1);
  await pg.keyboard.press('Escape');
  ok('Esc beendet das Zeichnen', !(await pg.evaluate(() => _sfnDbg().pick)));
  await pg.evaluate(() => _sfnApply());
  const h = await pg.evaluate(() => {
    const m = objects[objects.length - 1]; m.updateMatrixWorld(true);
    const pos = m.geometry.attributes.position, v = new THREE.Vector3();
    let links = 0, rechts = 0, maxH = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      const x = v.x * 10, hh = v.y * 10;
      if (hh > 1) { if (x < -1) links++; if (x > 11) rechts++; maxH = Math.max(maxH, hh); }
    }
    return { name: m.userData.name, links, rechts, maxH };
  });
  ok('Hand-Wand steht nur unter dem linken Arm', /Stützfinnen/.test(h.name) && h.links > 0 && h.rechts === 0, h);
  ok('Hand-Wand endet unter dem Arm', h.maxH > 18 && h.maxH < 20.01, h.maxH);
  await pg.evaluate(() => { undo(); _sfnP.mode = 'auto'; });

  // Runde Unterseite: Kuppeldecke aus den Testteilen von Support Fins (tests/fixtures,
  // MIT). Dort müssen Zinken greifen — an der flachen T-Decke gibt es keine (by design:
  // eine waagrechte Noppe findet unter einer ebenen Decke keinen Halt).
  const { readFileSync } = await import('node:fs');
  const dome = Array.from(readFileSync(new global.URL('./fixtures/dome_ceiling.stl', import.meta.url)));
  await pg.evaluate((bytes) => {
    _sfnClose();
    const u8 = new Uint8Array(bytes), dv = new DataView(u8.buffer), n = dv.getUint32(80, true), pos = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = _moldSceneMesh(g, 'Kuppel-Test'); m.position.x += 8; m.updateMatrixWorld(true);
    m.position.y -= getMeshBox(m).min.y; _updateObjEdgeLines(m); selectObjs([m]); _sfnOpen();
  }, dome);
  await pg.waitForFunction(() => _sfnDbg().info, { timeout: 60000 });
  const kg = await pg.evaluate(() => _sfnDbg().info);
  ok('Kuppeldecke: Finnen mit Zinken', kg.fins >= 1 && kg.tines > 0, { fins: kg.fins, tines: kg.tines, unserved: kg.unserved });
  await pg.evaluate(() => { _sfnClose(); const k = objects.find(o => o.userData.name === 'Kuppel-Test'); scene.remove(k); objects.splice(objects.indexOf(k), 1); });

  // Lage vorschlagen
  await pg.evaluate(() => { selectObjs([objects.find(o => o.userData.name === 'T-Test')]); _sfnOpen(); });
  await pg.waitForFunction(() => _sfnDbg().info, { timeout: 60000 });
  await pg.evaluate(() => _sfnSuggest());
  await pg.waitForFunction(() => /Vorschlag \d|Keine bessere|fehlgeschlagen/.test(document.getElementById('sfn-sug').textContent), { timeout: 60000 });
  const s = await pg.evaluate(() => {
    const o = objects.find(o => o.userData.name === 'T-Test'); o.updateMatrixWorld(true);
    return { txt: document.getElementById('sfn-sug').textContent, minY: getMeshBox(o).min.y * 10 };
  });
  ok('Lage vorschlagen antwortet', /Vorschlag \d/.test(s.txt), s.txt);
  ok('vorgeschlagene Lage liegt auf der Platte', Math.abs(s.minY) < 0.01, s.minY);
  await pg.waitForFunction(() => _sfnDbg().info, { timeout: 60000 });
  await pg.evaluate(() => _sfnClose());
  const z = await pg.evaluate(() => ({ ..._sfnDbg(), helfer: scene.children.filter(c => c.userData && c.userData.isSfnHelper).length }));
  ok('Abbrechen räumt Hilfsobjekte weg', !z.open && z.helfer === 0, z);

  ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
} finally {
  await b.close();
  if (srv) srv.kill();
}
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
