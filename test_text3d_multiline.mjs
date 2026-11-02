import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8961;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch(); const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof addTextShape === 'function', null, { timeout: 30000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _text3dModeTouched = true; _text3dMode = 'free'; addTextShape(); });
  const ta = p.locator('#text3d-input');
  await ta.click(); await p.keyboard.type('Hallo'); await p.keyboard.press('Enter'); await p.keyboard.type('Welt');
  const v = await ta.inputValue(); console.log('Wert:', JSON.stringify(v), 'Modal offen:', await p.evaluate(() => document.getElementById('text3d-modal').classList.contains('show')));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: '/tmp/t3d_dialog.png' });
  await p.keyboard.press('Control+Enter');
  await p.waitForFunction(() => objects.length > 0, null, { timeout: 20000 });
  const r = await p.evaluate(() => { const o = objects[objects.length - 1]; const bb = new THREE.Box3().setFromObject(o); return { name: o.userData.name, str: o.userData.textEdit && o.userData.textEdit.str, sx: (bb.max.x - bb.min.x) * 10, sy: (bb.max.y - bb.min.y) * 10, sz: (bb.max.z - bb.min.z) * 10 }; });
  console.log('Objekt:', JSON.stringify(r));
  // Vergleich: einzeilig "Hallo" -> Höhe
  const one = await p.evaluate(() => { const f = window['_threeFont_' + document.getElementById('text3d-font').value]; const a = _textToSvg(f, 'Hallo', 1, 0), m = _textToSvg(f, 'Hallo\nWelt', 1, 0), g = _textToSvg(f, 'Hallo\nWelt', 1, 0.1), arc = _textArcSvg(f, 'Hallo\nWelt', 0.8, 4, 'up');
    return { a: [a.w, a.h, a.hLine], m: [m.w, m.h, m.hLine], g: [g.w, g.h], arc: [arc.w, arc.h], paths: (m.svg.match(/<path/g) || []).length }; });
  console.log('Maße:', JSON.stringify(one));
  // Arc erstellen
  await p.evaluate(() => { _text3dModeTouched = true; addTextShape(); _text3dSetMode('arc'); document.getElementById('text3d-input').value = 'Alles Gute\nzum Geburtstag'; _confirmText3d(); });
  await p.waitForTimeout(1500);
  console.log('Objekte:', await p.evaluate(() => objects.map(o => o.userData.name)));
  await p.evaluate(() => fitToObjects(objects));
  await p.mouse.click(5, 300); await p.waitForTimeout(500);
  await p.screenshot({ path: '/tmp/t3d_scene.png' });
  console.log('Fehler:', errs);
} finally { await b.close(); srv.kill(); }
