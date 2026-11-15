// Blätterkranz (🌿 _wdk*): Kern in Node (dicht, ein Stück, Loch passt zum Glas, Boden optional) + Browser
// (Menü, Vorschau, ≤ 6 einfache Felder mit Tooltips, Erstellen, Rückgängig, Bilder).
import Module from '/home/v3da/node_modules/manifold-3d/manifold.js';
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process'; import fs from 'fs';
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const w = await Module(); w.setup();
const K = new Function('module', fs.readFileSync(new URL('../tools/wedelkranz/wdk_core.js', import.meta.url), 'utf8') + '; return { WDK_DEF, wdkBuild, wdkMasse };')(undefined);
for (const [n, q] of [['Standard', {}], ['mit Boden', { boden: 1 }], ['3 Lagen, großes Glas', { lagen: 3, glasD: 100, dia: 230 }], ['1 Lage, steil', { lagen: 1, winkel: 55, wedel: 14 }]]) {
  const p = { ...K.WDK_DEF, ...q }, t0 = Date.now(), r = K.wdkBuild(w, p, true), b = r.body.boundingBox(), d = K.wdkMasse(p);
  const loch = w.Manifold.cylinder(30, p.glasD / 2, p.glasD / 2, 96).rotate([-90, 0, 0]).translate([0, p.boden ? p.bodenT + 0.01 : 0.01, 0]);
  const v = w.Manifold.intersection(r.body, loch).volume();
  const schnitt = r.body.rotate([90, 0, 0]).slice(0.5), duenn = schnitt.decompose().filter(c => c.offset(-0.39, 'Round').area() <= 0).length;   // nichts schmaler als 0,8 mm
  const aussen = Math.max(b.max[0], -b.min[0], b.max[2], -b.min[2]);
  ok(duenn === 0 && schnitt.decompose().length === 1 && r.weg < 20, `${n}: Grundriss ein Stück, keine Stelle schmaler als 0,8 mm (${duenn} zu dünn), abgetrennt ${r.weg.toFixed(1)} mm³`);
  ok(r.body.status() === 'NoError' && r.body.decompose().length === 1 && aussen <= p.dia / 2 + 0.01 && aussen > p.dia / 2 - 10 && b.min[1] > -0.01 && v < 1e-3,
     `${n}: geschlossen, 1 Stück, Rand folgt den Wedeln (bis Ø ${(2 * aussen).toFixed(0)} von ${p.dia} mm), ${b.max[1].toFixed(1)} mm hoch, Glas Ø ${p.glasD} passt (${v.toFixed(3)} mm³), ${(r.body.volume() / 1000).toFixed(0)} cm³, ${Date.now() - t0} ms`);
  if (p.boden) ok(w.Manifold.intersection(r.body, w.Manifold.cylinder(p.bodenT, 10, 10, 24).rotate([-90, 0, 0]).translate([0, 0.01, 0])).volume() > 1, 'Boden in der Mitte vorhanden');
  r.body.delete();
}
const PORT = 18861, srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1800));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _wdkOpen === 'function' && typeof objects !== 'undefined', null, { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  ok(await p.evaluate(() => _STARTERS.some(s => s.t === 'Blätterkranz') && _GEN_WEIHNACHTEN.includes('Blätterkranz')), 'Menüeintrag (Weihnachten)');
  await p.evaluate(() => _wdkOpen()); await p.waitForFunction(() => _gpv['wdk'] && _gpv['wdk'].group, null, { timeout: 60000 }).catch(() => {});
  ok(await p.evaluate(() => !!(_gpv['wdk'] && _gpv['wdk'].group)), 'Vorschau steht');
  const ui = await p.evaluate(() => { const c = document.querySelector('#wdk-modal .g3ctrl'), sicht = [...c.querySelectorAll('input,select')].filter(e => e.offsetParent && !e.closest('details'));
    return { n: sicht.length, ohne: [...c.querySelectorAll('input')].filter(e => !e.title && !(e.closest('label') && e.closest('label').title)).length, info: document.getElementById('wdk-info').textContent }; });
  ok(ui.n <= 6 && ui.ohne === 0 && /ohne Stützen/.test(ui.info), `Einfache Ansicht ${ui.n} Felder, alle mit Tooltip; Info: ${ui.info.slice(0, 80)}…`);
  await p.screenshot({ path: '/tmp/wdk_modal.png' });
  const r = await p.evaluate(async () => { const t0 = performance.now(); await _wdkCreate(); const o = objects[objects.length - 1]; o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
    return { n: objects.length, name: o.userData.name, ms: performance.now() - t0, d: (bb.max.x - bb.min.x) * 10, y0: bb.min.y }; });
  ok(r.n === 1 && /Blätterkranz/.test(r.name) && r.d <= 190.1 && r.d > 175 && Math.abs(r.y0) < 0.01, `Erstellt: ${r.name}, Ø ${r.d.toFixed(0)} mm, liegt auf der Platte (${(r.ms / 1000).toFixed(1)} s)`);
  await p.evaluate(() => { const o = objects[0]; try { deselectAll(); } catch (e) {} const box = new THREE.Box3().setFromObject(o), c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() * 0.62;
    camera.position.set(c.x + R * 0.35, c.y + R * 0.62, c.z + R * 0.72); camera.lookAt(c); renderer.render(scene, camera); });
  await p.waitForTimeout(500); await p.screenshot({ path: '/tmp/wdk_3d.png', clip: { x: 48, y: 250, width: 1035, height: 650 } });
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 2).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
