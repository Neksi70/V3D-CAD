// Namens-Lesezeichen (🔖 _lzn*) gegen volme3d_server --dev: Menü, Vorschau, Namensliste → je Kind Platte + Schrift,
// vier Darstellungen, eigenes Logo aus Bild, STL-Export (dicht, Platte/Schrift gleiche Lage), Rückgängig, keine Seitenfehler.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 18861;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1800));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _lznOpen === 'function' && typeof objects !== 'undefined', null, { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  ok(await p.evaluate(() => _STARTERS.some(s => s.t === 'Namens-Lesezeichen') && _GEN_THEMEN.some(([, l]) => l.includes('Namens-Lesezeichen'))), 'Eintrag in Generatoren (Bild, Text & KI)');
  await p.evaluate(() => _lznOpen());
  await p.waitForFunction(() => window._threeFont_pacifico_local, null, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => _gpv['lzn'] && _gpv['lzn'].group, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => !!(_gpv['lzn'] && _gpv['lzn'].group)), 'Vorschau steht');
  await p.screenshot({ path: '/tmp/lzn_modal.png' });
  const info = await p.evaluate(() => document.getElementById('lzn-info').textContent);
  ok(/2 Lesezeichen/.test(info) && /Größe je Stück/.test(info), 'Info: ' + info.slice(0, 120));
  // vier Darstellungen
  for (const d of ['erhaben', 'einfarbig', 'eingelassen', 'eingelegt']) {
    const r = await p.evaluate(async d => { _newCreate(false); _lznStr('darstellung', d); _lznStr('namen', 'Martina\nSvenja\nJönas'); await _lznCreate(); return objects.map(o => o.userData.name); }, d);
    const zwei = d === 'erhaben' || d === 'eingelegt';
    ok(r.length === (zwei ? 6 : 3) && r.some(n => /Lesezeichen Jönas/.test(n)), `${d}: ${r.length} Objekte (${r.slice(0, 3).join(', ')} …)`);
  }
  await p.evaluate(() => _lznStr('darstellung', 'erhaben'));
  // eigenes Logo aus einem gezeichneten Bild (Ring mit Loch + Balken)
  const lg = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 200; c.height = 120; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 200, 120);
    x.fillStyle = '#000'; x.beginPath(); x.arc(60, 60, 45, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(60, 60, 22, 0, 7); x.fill(); x.fillStyle = '#000'; x.fillRect(120, 20, 60, 80);
    const img = new Image(); await new Promise(r => { img.onload = r; img.src = c.toDataURL(); }); const L = _lznLogoAusBild(img, 128); _lznP.eigenLogo = L; _lznP.logo = 'bild'; _lznImg = img; _lznSync();
    const w = await _mfInit(), r = lznBuild(w, _lznParams('Martina'), _lznText); const v = r.deko.volume(); r.platte.delete(); r.deko.delete(); return { loops: L.loops.length, v }; });
  ok(lg.loops === 3 && lg.v > 50, `Eigenes Logo: ${lg.loops} Konturen (Ring außen, Loch, Balken), Schrift+Logo ${lg.v.toFixed(0)} mm³`);
  await p.evaluate(() => { _lznStr('logo', 'regenbogen'); });
  // STL-Export: dicht, Lage
  const ex = await p.evaluate(async () => { let files = null; const alt = window._saveExportMany; window._saveExportMany = async f => { files = f; return { wrote: true, dir: 'Test' }; };
    try { _lznStr('namen', 'Martina\nSvenja'); await _lznExportStl(); } finally { window._saveExportMany = alt; }
    const out = { namen: files.map(f => f.name), offen: [], z: {} };
    for (const f of files) { const dv = new DataView(await f.blob.arrayBuffer()), n = dv.getUint32(80, true), E = new Map(), key = o => [0, 4, 8].map(j => dv.getFloat32(o + j, true).toFixed(4)).join(',');
      let z0 = 1e9, z1 = -1e9;
      for (let t = 0; t < n; t++) { const o = 84 + t * 50 + 12, v = [key(o), key(o + 12), key(o + 24)]; for (let j = 0; j < 3; j++) { const a = v[j], c = v[(j + 1) % 3], kk = a < c ? a + '|' + c : c + '|' + a; E.set(kk, (E.get(kk) || 0) + 1); const zz = dv.getFloat32(o + j * 12 + 8, true); z0 = Math.min(z0, zz); z1 = Math.max(z1, zz); } }
      if (![...E.values()].every(c => c === 2)) out.offen.push(f.name); out.z[f.name] = [+z0.toFixed(2), +z1.toFixed(2)]; }
    return out; });
  ok(ex.namen.join() === 'lesezeichen_Martina.stl,lesezeichen_Martina_schrift.stl,lesezeichen_Svenja.stl,lesezeichen_Svenja_schrift.stl' && ex.offen.length === 0, `STL: ${ex.namen.join(', ')} – alle dicht ${ex.offen.join(',')}`);
  ok(ex.z['lesezeichen_Martina.stl'][0] === 0 && Math.abs(ex.z['lesezeichen_Martina_schrift.stl'][0] - 2) < 0.01, 'Platte liegt auf z = 0, Schrift sitzt obenauf (z = 2 mm)');
  // Bild der erstellten Lesezeichen
  await p.evaluate(async () => { _newCreate(false); _lznStr('namen', 'Martina\nSvenja'); await _lznCreate(); try { deselectAll(); } catch (e) {}
    const box = new THREE.Box3(); objects.forEach(m => box.expandByObject(m)); const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() * 0.75;
    camera.position.set(c.x, c.y + r, c.z + 0.01); camera.lookAt(c); renderer.render(scene, camera); });
  await p.waitForTimeout(700); await p.screenshot({ path: '/tmp/lzn_szene.png', clip: { x: 48, y: 250, width: 1035, height: 650 } });
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
