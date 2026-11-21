// Lithophane-Kugel: „Einpassen" bleibt beim Ziehen/Mausrad auf dem Foto und beim Öffnen
// des Ausschnitt-Fensters (vorher still auf „Ausschnitt" umgestellt, Volker 21.11.26).
// Im Modus „Ausschnitt" verschiebt der Zug weiter den Ausschnitt.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8991;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {} });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _openLithoModal === 'function' && typeof objects !== 'undefined');
  const png = await p.evaluate(async () => { hideStarter?.(); document.getElementById('umsteiger-hinweis')?.remove();
    const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 400, 0);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#222'); x.fillStyle = g; x.fillRect(0, 0, 400, 300);
    return Array.from(new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer())); });
  await p.evaluate(() => { _openLithoModal(); _lithoForm('kugel'); });
  await p.setInputFiles('#litho-file', { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await p.waitForFunction(() => _litho.bilder.length === 1 && _gpv['litho'] && _gpv['litho'].group, null, { timeout: 20000 });
  await p.evaluate(() => { _lithoStr('kFit', 'einpassen'); }); await p.waitForTimeout(800);
  // Punkt auf dem Foto in der Vorschau suchen
  const pt = await p.evaluate(() => { const cv = document.getElementById('litho-canvas'), r = cv.getBoundingClientRect();
    for (let dy = 0; dy < r.height / 2; dy += 6) for (const s of [1, -1]) { const x = r.left + r.width / 2, y = r.top + r.height / 2 + s * dy;
      const o = _lithoVorschauOrt({ clientX: x, clientY: y }); if (o && o.f && _litho.bilder[o.f.bi]) return { x, y }; } return null; });
  ok(!!pt, 'Punkt auf dem Foto in der Vorschau gefunden');
  const crop0 = await p.evaluate(() => JSON.stringify(_litho.bilder[0].crop || null));
  await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x, pt.y - 60, { steps: 6 }); await p.mouse.move(pt.x, pt.y + 40, { steps: 6 }); await p.mouse.up();
  await p.mouse.wheel(0, -300); await p.waitForTimeout(300);
  const s1 = await p.evaluate(() => ({ fit: _litho.p.kFit, crop: JSON.stringify(_litho.bilder[0].crop || null), btn: document.querySelector('#litho-fit-bg .vtb.on')?.dataset.v }));
  ok(s1.fit === 'einpassen' && s1.btn === 'einpassen' && s1.crop === crop0, `Ziehen hoch/runter + Mausrad auf dem Foto: bleibt „Einpassen“ (${JSON.stringify(s1)})`);
  // Ausschnitt-Fenster öffnen + schließen → bleibt Einpassen
  await p.evaluate(() => _lithoAusschnitt(0)); await p.waitForTimeout(200);
  ok(await p.evaluate(() => /Einpassen/.test(document.getElementById('litho-crop').textContent)), 'Ausschnitt-Fenster erklärt die Umstellung');
  await p.click('#lcr-ok'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => _litho.p.kFit === 'einpassen'), 'Ausschnitt-Fenster nur ansehen: bleibt „Einpassen“');
  // erst Zoomen im Fenster stellt um
  await p.evaluate(() => { _lithoAusschnitt(0); const z = document.getElementById('lcr-z'); z.value = 1.5; z.dispatchEvent(new Event('input')); document.getElementById('lcr-ok').click(); });
  ok(await p.evaluate(() => _litho.p.kFit === 'zuschneiden' && document.querySelector('#litho-fit-bg .vtb.on')?.dataset.v === 'zuschneiden'), 'Zoomen im Ausschnitt-Fenster → „Ausschnitt“ (Knopf zeigt es)');
  // Im Modus Ausschnitt verschiebt der Zug den Ausschnitt
  await p.waitForTimeout(600);
  const pt2 = await p.evaluate(() => { const cv = document.getElementById('litho-canvas'), r = cv.getBoundingClientRect();
    for (let dy = 0; dy < r.height / 2; dy += 6) for (const s of [1, -1]) { const x = r.left + r.width / 2, y = r.top + r.height / 2 + s * dy;
      const o = _lithoVorschauOrt({ clientX: x, clientY: y }); if (o && o.f && _litho.bilder[o.f.bi]) return { x, y }; } return null; });
  const c1 = await p.evaluate(() => ({ ..._litho.bilder[0].crop }));
  await p.mouse.move(pt2.x, pt2.y); await p.mouse.down(); await p.mouse.move(pt2.x + 50, pt2.y + 30, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
  const c2 = await p.evaluate(() => ({ ..._litho.bilder[0].crop }));
  ok(Math.abs(c2.x - c1.x) > 0.005 || Math.abs(c2.y - c1.y) > 0.005, `Ausschnitt-Modus: Zug verschiebt den Ausschnitt (${c1.x.toFixed(3)}→${c2.x.toFixed(3)})`);
  ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK'); process.exit(fail ? 1 : 0);
