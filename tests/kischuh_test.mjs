// KI-Schuh: Fenster, Info, „Zum Anziehen“ mit GLB (ohne KI-Aufruf, Datei: KSU_GLB oder /tmp/ksu_sneaker.glb),
// Paar, Fußraum frei + Wand dicht, Deko-Länge, „Ausgewählten Schuh tragbar machen“. REAL=1 → echter KI-Lauf.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 8984, GLB = process.env.KSU_GLB || '/tmp/ksu_sneaker.glb';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route('**/__test/schuh.glb', r => r.fulfill({ body: fs.readFileSync(GLB), contentType: 'model/gltf-binary' }));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _ksuOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); _ksuOpen(); });
  const info = await p.evaluate(() => document.getElementById('ksu-info').innerText);
  ok(/Fußlänge 265 mm/.test(info), 'Info EU 42 → Fußlänge 265 mm');
  await p.evaluate(() => _ksuStr('art', 'clog'));
  ok(await p.evaluate(() => _ksuP.einstieg === 58), 'Clog setzt größeren Einstieg (58 %)');
  await p.evaluate(() => { _ksuStr('art', 'sneaker'); _ksuP._einstHand = 0; _ksuP.einstieg = 45; _ksuSet('paar', 1); });
  const t0 = Date.now();
  await p.evaluate(() => _ksuStart({ glb: '/__test/schuh.glb' }));
  await p.waitForFunction(() => !_ksuBusy, null, { timeout: 240000 });
  const r1 = await p.evaluate(async () => {
    const w = await _mfInit(), M = w.Manifold, res = [];
    for (const o of objects) { const m = _mfUnionObjs(w, [o]), bb = getMeshBox(o), s = bb.getSize(new THREE.Vector3());
      // Fuß (Leisten ohne Schacht) an seinen Platz: muss frei sein
      const info = o.userData.kiSchuh.info;
      res.push({ name: o.userData.name, shells: m.decompose().length, genus: m.genus(), vol: m.volume(), L: s.x * 10, B: s.z * 10, H: s.y * 10, minY: bb.min.y, info }); }
    return res;
  });
  console.log('     Dauer', ((Date.now() - t0) / 1000).toFixed(0), 's');
  ok(r1.length === 2 && /gespiegelt/.test(r1[1].name) && !/gespiegelt/.test(r1[0].name), 'Paar: ' + r1.map(x => x.name).join(' + '));
  ok(r1.every(x => x.shells === 1 && x.vol > 100000), `je eine geschlossene Schale (${r1.map(x => (x.vol / 1000).toFixed(0) + ' cm³').join(', ')})`);
  ok(Math.abs(r1[0].L - 287) < 15 && r1[0].B > 108 && r1[0].info.leck < 200, `Maße ${r1[0].L.toFixed(0)} × ${r1[0].B.toFixed(0)} × ${r1[0].H.toFixed(0)} mm, Sohle ${r1[0].info.sohle.toFixed(0)} mm, Wand-Leck ${r1[0].info.leck.toFixed(0)} mm³`);
  ok(r1.every(x => Math.abs(x.minY) < 1e-3), 'stehen auf der Platte');
  // Deko
  await p.evaluate(() => { _newCreate(false); _ksuOpen(); _ksuStr('ziel', 'deko'); _ksuSet('laenge', 80); });
  await p.evaluate(() => _ksuStart({ glb: '/__test/schuh.glb' }));
  await p.waitForFunction(() => !_ksuBusy, null, { timeout: 120000 });
  const r3 = await p.evaluate(() => { const o = objects[0], s = getMeshBox(o).getSize(new THREE.Vector3()); return { n: objects.length, L: s.x * 10, name: o.userData.name }; });
  ok(r3.n === 1 && Math.abs(r3.L - 80) < 1, `Deko-Schuh ${r3.L.toFixed(1)} mm lang`);
  // Auswahl tragbar machen (Kindergröße)
  await p.evaluate(() => { selectObjs([objects[0]]); _ksuStr('ziel', 'tragbar'); _ksuSet('eu', 30); _ksuSet('paar', 0); });
  await p.evaluate(() => _ksuAuswahl());
  await p.waitForFunction(() => !_ksuBusy, null, { timeout: 240000 });
  const r4 = await p.evaluate(async () => { const w = await _mfInit(), o = objects[0], m = _mfUnionObjs(w, [o]), s = getMeshBox(o).getSize(new THREE.Vector3());
    return { n: objects.length, L: s.x * 10, shells: m.decompose().length, name: o.userData.name, Lf: o.userData.kiSchuh.info.Lf }; });
  ok(r4.n === 1 && r4.shells === 1 && /EU 30/.test(r4.name) && r4.L > r4.Lf + 6 && r4.L < r4.Lf + 50, `Auswahl → ${r4.name}: ${r4.L.toFixed(0)} mm lang (Fuß ${r4.Lf.toFixed(0)} mm)`);
  await p.evaluate(() => { undo(); });
  ok(await p.evaluate(() => objects.length === 1 && /Deko/.test(objects[0].userData.name)), 'Rückgängig: Deko-Schuh wieder da');
  if (process.env.REAL) {
    await p.evaluate(() => { _newCreate(false); _ksuOpen(); _ksuStr('art', 'clog'); _ksuStr('ziel', 'tragbar'); _ksuSet('eu', 38); });
    await p.evaluate(() => _ksuStart());
    await p.waitForFunction(() => !_ksuBusy, null, { timeout: 480000 });
    const r5 = await p.evaluate(() => objects.map(o => o.userData.name));
    ok(r5.length === 1 && /EU 38/.test(r5[0]), 'echter KI-Lauf (Clog EU 38): ' + r5.join(', '));
    await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(600);
    await p.screenshot({ path: '/tmp/ksu-real.png' });
  }
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
