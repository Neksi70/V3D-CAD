// HO HO HO – Schrift-Türecke (🎅 _hho*): Menü → Vorschau → Erstellen (3 Farbteile, Schwarz 1 Stück, keine Überschneidung)
// → rechte Ecke → eigener Text → Rückgängig. Bild: /tmp/hohoho.png
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 18861;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1800));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _hhoOpen === 'function' && typeof objects !== 'undefined', null, { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn'); const it = p.locator('#gen-dd >> text=HO HO HO Türecke').first();
  ok(await it.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)'); await it.click(); await p.waitForSelector('#hho-modal.show');
  await p.waitForFunction(() => window._threeFont_helvetiker_bold, null, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => _gpv['hho'] && _gpv['hho'].group && _hhoP._i, null, { timeout: 60000 }).catch(() => {});
  ok(await p.evaluate(() => !!(_gpv['hho'] && _gpv['hho'].group)), 'Vorschau steht');
  const r = await p.evaluate(async () => { const w = await _mfInit(), out = {};
    for (const ecke of ['links', 'rechts']) { const R = _hhoBuild(w, { ...HHO_DEF, ecke }, _hhoText), V = (a, b2) => w.Manifold.intersection(a, b2).volume();
      const bb = m => { const q = m.boundingBox(); return [q.min[0], q.max[0]]; };
      out[ecke] = { st: R.schwarz.decompose().length, rotSt: R.rot.decompose().length, ueb: Math.max(V(R.schwarz, R.rot), V(R.schwarz, R.weiss), V(R.rot, R.weiss)),
        aufliegen: V(R.schwarz.translate([0, 0, 0.1]), R.rot) > 1, sx: bb(R.schwarz), rx: bb(R.rot), info: R.info };
      for (const k of ['schwarz', 'rot', 'weiss']) R[k].delete(); }
    return out; });
  ok(r.links.st === 1 && r.links.ueb < 1e-3 && r.links.aufliegen && r.links.rotSt >= 1, `Linke Ecke: Schwarz 1 Stück, Rot ${r.links.rotSt} Stück(e) (Zeilen berühren sich wie im Vorbild), keine Überschneidung, Rot liegt auf (${Math.round(r.links.info.breite)} × ${Math.round(r.links.info.hoehe)} mm)`);
  ok(r.links.rx[1] < 0 && r.rechts.st === 1 && r.rechts.ueb < 1e-3 && r.rechts.rx[0] > 0, 'Schrift außen neben dem Schenkel (links: x < 0, rechts: x > 0), rechte Ecke 1 Stück, keine Überschneidung');
  const sz = await p.evaluate(async () => { await _hhoCreate(); return objects.map(o => o.userData.name); });
  ok(sz.length === 3 && sz.every(n => /^HO HO HO/.test(n)), 'Erstellen: ' + sz.join(', '));
  await p.evaluate(() => { const box = new THREE.Box3(); objects.forEach(m => box.expandByObject(m)); const c = box.getCenter(new THREE.Vector3()), rr = box.getSize(new THREE.Vector3()).length() * 0.9;
    camera.position.set(c.x + rr * 0.35, c.y + rr * 0.85, c.z + rr * 0.55); camera.lookAt(c); try { deselectAll(); } catch (e) {} renderer.render(scene, camera); });
  await p.waitForTimeout(600); await p.screenshot({ path: '/tmp/hohoho.png', clip: { x: 48, y: 250, width: 1035, height: 650 } });
  const eig = await p.evaluate(async () => { _newCreate(false); _hhoOpen(); _hhoStr('text', 'FROHE\nWEIH\nNACHTEN'); await _hhoCreate(); return objects.length; });
  ok(eig === 3, 'Eigener Text (3 Zeilen) erstellt');
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 2).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
