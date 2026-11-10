// Geld-Engel: Menü → Vorschau mit Wortwolke → Schlitze (Körper 1 Teil, Spalten = Schlitzbreite) → Kopf passt auf den Zapfen
// → SVG-Vorlage (Pfade, mm) → Erstellen (Front unten) → Mitdrucken-Variante → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8993, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _gleOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Geld-Engel').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#gle-modal.show');
  await p.waitForFunction(() => window._threeFont_greatvibes_local && window._threeFont_helvetiker_bold && window._threeFont_baloo_local, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => !!(_gpv['gle'] && _gpv['gle'].group)), 'Vorschau steht');
  await p.screenshot({ path: SHOTS + '/gle-dialog.png', clip: await p.locator('#gle-modal .g3box').boundingBox() });
  const r1 = await p.evaluate(async () => { const w = await _mfInit(), M = w.Manifold, r = _gleBuild(w, _gleP), wo = _gleWolke(w, _gleP, r.umriss, _gleText);
    const res = { k: r.koerper.decompose().length, ov: M.intersection(r.koerper, r.kopfAuf).volume(), wolke: wo ? wo.area() : 0, imUmriss: wo ? wo.subtract(r.umriss).area() : 1,
      // Schlitz: dünne Platte (Schein) zwischen zwei Flügel-Lagen rechts einschieben
      gap: 0 };
    const CS = w.CrossSection, zu = r.umriss.offset(_gleP.schlitz * 0.7, 'Round').offset(-_gleP.schlitz * 0.7, 'Round'), spalt = zu.subtract(r.umriss);
    const frei = spalt.area(), teile = spalt.decompose().filter(q => q.area() > 10).length; res.teile = teile; zu.delete(); spalt.delete();
    res.frei = frei; [r.koerper, r.kopf, r.kopfAuf].forEach(m => m.delete()); r.umriss.delete(); if (wo) wo.delete(); return res; });
  ok(r1.k === 1 && r1.ov < 0.01, `Körper 1 Teil, Kopf auf Zapfen ohne Überschneidung (${r1.ov.toFixed(3)})`);
  ok(r1.frei > 100 && r1.teile >= 4, `Schlitze zwischen den Flügel-Lagen: ${r1.teile} Schlitze, ${Math.round(r1.frei)} mm² (je 1,6 mm breit)`);
  ok(r1.wolke > 1500 && r1.imUmriss < 0.5, `Wortwolke ${Math.round(r1.wolke)} mm² liegt ganz im Engel`);
  const svg = await p.evaluate(async () => { let blob = null; const o = window._speichernUnter; window._speichernUnter = (b) => { blob = b; return Promise.resolve(true); };
    await _gleSvg(); window._speichernUnter = o; return blob ? await blob.text() : ''; });
  ok(/width="[\d.]+mm"/.test(svg) && /id="Passkontur"/.test(svg) && /id="Wortwolke"/.test(svg) && svg.length > 20000, `UV-Vorlage: SVG in mm mit Passkontur + Wortwolke (${Math.round(svg.length / 1024)} KB)`);
  const r2 = await p.evaluate(async () => { await _gleCreate(); return objects.map(o => ({ name: o.userData.name, minY: getMeshBox(o).min.y, h: getMeshBox(o).getSize(new THREE.Vector3()).y * 10 })); });
  ok(r2.length === 2 && r2.every(t => Math.abs(t.minY) < 1e-3) && Math.abs(r2[0].h - 40) < 0.1, 'Erstellt (Front unten, 40 mm hoch liegend): ' + r2.map(t => t.name).join(', '));
  await p.evaluate(() => { _newCreate(false); _gleOpen(); _gleStr('wolke', 'inlay'); });
  const r3 = await p.evaluate(async () => { await _gleCreate(); return objects.map(o => o.userData.name); });
  ok(r3.length === 3 && r3.some(n => /Wortwolke/.test(n)), 'Mitdrucken: ' + r3.join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
