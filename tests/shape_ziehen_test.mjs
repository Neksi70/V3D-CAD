// V3D-Shape: Fläche direkt am Pfeil ziehen (wie Shapr3D). Gewählter Körper → auf
// ebene Fläche drücken und ziehen; Klick ohne Zug → Zahl tippen + Enter; nach innen =
// Tasche; Esc bricht ab; Kamera bleibt; runde Fläche zieht nicht; Knopf „Fläche ziehen“.
// Aufruf (im Worktree): node tests/shape_ziehen_test.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
const HIER = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 18858;
const srv = spawn('python3', [path.join(HIER, 'umgebungen-test-server.py'), String(PORT), '--dev'], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d-umgebungen.html`);
  await p.waitForFunction(() => typeof _advSet === 'function' && typeof objects !== 'undefined', null, { timeout: 60000 });
  await p.evaluate(async () => { await _loadOCCT(); try { hideStarter(); } catch (e) {} _advSet('shape'); return true; });

  // Würfel 20 mm (App-Einheit cm), Ansicht schräg von oben, gewählt.
  // Klickpunkte NEBEN die Flächendiagonale: genau auf der Naht der zwei Dreiecke
  // trifft der three.js-Strahl keins (Mitte der Deckfläche liegt darauf).
  const neu = (typ = 'box') => p.evaluate((typ) => { _newCreate(false); addShape(typ); const o = objects[0]; o.position.set(0, 1, 0); o.updateMatrixWorld(true); setView('iso'); sph.r = 12; sph2cam(); selectObjs([o]); return true; }, typ);
  const bild = (x, y, z) => p.evaluate(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }, [x, y, z]);
  const zustand = () => p.evaluate(() => { const o = objects[0], bb = getMeshBox(o), w = o.userData.exakt ? _exaktWelt(_oc, o) : null; return { n: objects.length, maxY: +bb.max.y.toFixed(4), vol: w ? +_occtVolumen(_oc, w).toFixed(5) : null, exakt: !!o.userData.exakt, pull: _skPull.editing, sk: _sk.active, skx: !!_skx.open, cam: [sph.theta, sph.phi, sph.r].map(v => +v.toFixed(4)).join(',') }; });
  const fertig = () => p.waitForFunction(() => !_skPull.editing && !_sk.active && objects.length === 1, null, { timeout: 60000 }).then(() => p.waitForTimeout(900)).catch(() => {});

  // 1) Deckfläche ziehen (Maus)
  await neu();
  const cam0 = (await zustand()).cam;
  let a = await bild(0.3, 2, 0.2), oben = await bild(0, 2.6, 0);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  const w1 = await zustand();
  ok(w1.pull && w1.sk, 'Drücken auf die Deckfläche des gewählten Körpers startet das Ziehen');
  await p.mouse.move(a.x, (a.y + oben.y) / 2, { steps: 4 }); await p.mouse.move(oben.x, oben.y, { steps: 6 });
  const lbl = await p.evaluate(() => _skPull.label && _skPull.label.textContent);
  ok(/mm/.test(lbl || ''), 'Maß am Pfeil beim Ziehen: ' + lbl);
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('sketch-bar')).display === 'none' && getComputedStyle(document.getElementById('sk-cons')).display === 'none'), 'beim Ziehen keine Skizzen-Werkzeuge im Bild');
  await p.mouse.up(); await fertig();
  const z1 = await zustand();
  ok(z1.n === 1 && z1.maxY > 2.2 && z1.exakt, `gezogen: Oberkante ${z1.maxY} cm (> 2,2), ein Körper, exakt`);
  ok(z1.cam === cam0, 'Kamera bleibt stehen');

  // 2) Klick ohne Zug → Pfeil wartet → „5“ Enter = genau 5 mm
  await neu();
  a = await bild(0.3, 2, 0.2);
  await p.mouse.click(a.x, a.y); await p.waitForTimeout(200);
  const w2 = await zustand();
  ok(w2.pull && !w2.skx, 'Klick ohne Zug: Pfeil wartet (kein Dialog)');
  await p.keyboard.type('5'); await p.keyboard.press('Enter'); await fertig();
  const z2 = await zustand();
  ok(Math.abs(z2.maxY - 2.5) < 1e-3 && Math.abs(z2.vol - 10) < 1e-4, `„5“ + Enter: Oberkante ${z2.maxY} = 2,5 cm, Volumen ${z2.vol} = 10 cm³`);

  // 3) nach innen: „-8“ Enter = Tasche über die ganze Fläche → 12 mm hoch
  await neu();
  a = await bild(0.3, 2, 0.2);
  await p.mouse.click(a.x, a.y); await p.waitForTimeout(200);
  await p.keyboard.type('-8'); await p.keyboard.press('Enter'); await fertig();
  const z3 = await zustand();
  ok(Math.abs(z3.maxY - 1.2) < 1e-3 && Math.abs(z3.vol - 4.8) < 1e-4, `„-8“ + Enter: Oberkante ${z3.maxY} = 1,2 cm, Volumen ${z3.vol} = 4,8 cm³`);

  // 4) Esc bricht ab, nichts geändert, Skizze wieder zu
  await neu();
  a = await bild(0.3, 2, 0.2);
  await p.mouse.click(a.x, a.y); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const z4 = await zustand();
  ok(!z4.pull && !z4.sk && z4.n === 1 && Math.abs(z4.maxY - 2) < 1e-3, 'Esc: abgebrochen, Körper unverändert, Skizze zu');

  // 5) Mantel eines Zylinders (rund) → kein Ziehen, normale Auswahl bleibt
  await neu('cylinder');
  const m = await bild(1, 1, 0);
  await p.mouse.move(m.x - 3, m.y); await p.mouse.down(); await p.waitForTimeout(150);
  const z5 = await zustand(); await p.mouse.up();
  ok(!z5.pull && !z5.sk, 'runder Mantel: kein Ziehen (normale Auswahl)');

  // 6) Knopf „Fläche ziehen“ in der Leiste → Fläche anklicken → Pfeil wartet (kein Dialog)
  await neu(); await p.waitForTimeout(300);
  await p.click('#shp-kontext .shp-b[data-shp="enterPushPull()"]'); await p.waitForTimeout(200);
  a = await bild(0.3, 2, 0.2);
  await p.mouse.click(a.x, a.y); await p.waitForTimeout(300);
  const z6 = await zustand();
  ok(z6.pull && !z6.skx, 'Leiste „Fläche ziehen“ → Fläche anklicken → Pfeil statt Dialog');
  await p.keyboard.type('3'); await p.keyboard.press('Enter'); await fertig();
  const z6b = await zustand();
  ok(Math.abs(z6b.maxY - 2.3) < 1e-3, `… „3“ + Enter: Oberkante ${z6b.maxY} = 2,3 cm`);

  // 7) Seitenfläche ziehen (x+), Rückgängig stellt den Würfel wieder her
  await neu();
  a = await bild(1, 1, 0); const r7 = await bild(1.6, 1, 0);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(r7.x, r7.y, { steps: 8 }); await p.mouse.up(); await fertig();
  const z7 = await p.evaluate(() => +getMeshBox(objects[0]).max.x.toFixed(3));
  ok(z7 > 1.2, `Seitenfläche gezogen: rechte Kante ${z7} cm (> 1,2)`);
  await p.evaluate(() => undo()); await p.waitForTimeout(400);
  ok(await p.evaluate(() => objects.length === 1 && Math.abs(getMeshBox(objects[0]).max.x - 1) < 1e-3), 'Rückgängig: Würfel wie vorher');

  // 9) Zylinder-Deckel ziehen: bleibt rund und exakt
  await neu('cylinder');
  a = await bild(0.3, 2, 0.2);
  await p.mouse.click(a.x, a.y); await p.waitForTimeout(200);
  await p.keyboard.type('5'); await p.keyboard.press('Enter'); await fertig();
  const z9 = await zustand(), soll9 = Math.PI * 2.5;
  ok(Math.abs(z9.maxY - 2.5) < 1e-3 && z9.exakt && Math.abs(z9.vol - soll9) < 1e-3, `Zylinder-Deckel +5 mm: exakt ${z9.vol} = π·1²·2,5 = ${soll9.toFixed(5)} cm³`);

  // 10) Quader mit Durchgangsloch: Deckfläche (Ring) ziehen → Loch wächst mit
  await p.evaluate(async () => {
    _newCreate(false); addShape('box'); addShape('cylinder');
    const [bx, cy] = objects; bx.position.set(0, 1, 0); cy.scale.set(0.3, 1.5, 0.3); cy.position.set(0, 1, 0); bx.updateMatrixWorld(true); cy.updateMatrixWorld(true);
    selectObjs([bx, cy]); _shpAbziehen();
    for (let i = 0; i < 100 && !(objects.length === 1 && objects[0].userData.isSubtract); i++) await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 900)); setView('iso'); sph.r = 12; sph2cam(); selectObjs([objects[0]]); return true;
  });
  a = await bild(0.6, 2, 0.5);
  await p.mouse.click(a.x, a.y); await p.waitForTimeout(200);
  await p.keyboard.type('5'); await p.keyboard.press('Enter'); await fertig();
  const z10 = await zustand(), soll10 = (8 - Math.PI * 0.09 * 2) + (4 - Math.PI * 0.09) * 0.5;
  ok(z10.exakt && Math.abs(z10.vol - soll10) < 1e-3, `Ring-Deckel +5 mm, Loch wächst mit: ${z10.vol} = ${soll10.toFixed(5)} cm³`);

  // 8) Beginner: Drücken auf gewählten Körper zieht NICHT (bisheriges Verhalten)
  await p.evaluate(() => _advSet('beginner')); await neu();
  a = await bild(0.3, 2, 0.2);
  await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.waitForTimeout(150);
  const z8 = await zustand(); await p.mouse.up();
  ok(!z8.pull, 'Beginner: kein Flächen-Ziehen beim Drücken');

  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLE OK');
process.exit(fail ? 1 : 0);
