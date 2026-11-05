// Funktionstest 📐 Überhänge live: bekannte Fläche, Nachführen bei Bewegung, Klickpfad, kein Export des Overlays
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 8876;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore', env: { ...process.env, V3D_DB: '/tmp/v3d_ohl_test.db' } });
await new Promise(r => setTimeout(r, 1200));
let fehler = 0;
const ok = (b, msg, x) => { console.log((b ? '  ✓ ' : '  ✗ ') + msg + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!b) fehler++; };
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
try {
  await page.goto(`http://localhost:${PORT}/volme3d.html`); await page.waitForFunction(() => window.v3dApi && typeof _ohlSchalten === 'function', null, { timeout: 30000 });
  await page.evaluate(() => { hideStarter(); _newCreate(false); localStorage.removeItem('v3d_overhang'); });
  const r1 = await page.evaluate(async () => {
    const s = (await v3dApi.execute('shape.add', { type: 'box', size: [10, 10, 20], center: [0, 0, 10] })).result;
    const d = (await v3dApi.execute('shape.add', { type: 'box', size: [40, 40, 4], center: [0, 0, 22] })).result;
    const a = (await v3dApi.execute('overhang.live', { an: true })).result;
    return { a, s: s.id, d: d.id, vis: _ohlVis.length };
  });
  ok(Math.abs(r1.a.stuetze_mm2 - 1600) <= 2, 'T-Körper: 40×40-Platte auf Säule → 1600 mm² brauchen Stütze', r1.a);
  ok(r1.a.knapp_mm2 === 0 && r1.vis === 1, 'nichts „knapp“, ein Overlay', { knapp: r1.a.knapp_mm2, vis: r1.vis });
  // Platte auf den Boden legen → Live-Nachführung ohne erneuten Befehl
  await page.evaluate(async id => { await v3dApi.execute('body.transform', { id, center: [60, 0, 2] }); }, r1.d);
  await page.waitForTimeout(1000);
  const r2 = await page.evaluate(() => ({ f: _ohlInfo.flaeche, txt: document.getElementById('ohl-btn').textContent }));
  ok(r2.f < 1 && /✓/.test(r2.txt), 'Platte auf dem Boden → keine Überhänge, Knopf zeigt ✓ (live nachgeführt)', r2);
  const rU = await page.evaluate(async () => { await v3dApi.execute('edit.undo', {}); await new Promise(r => setTimeout(r, 1000)); return _ohlInfo.flaeche; });
  ok(Math.abs(rU - 1600) <= 2, 'Rückgängig → Platte wieder oben, 1600 mm² live zurück', rU);
  // Keil-Unterseite 40° gegen die Waagrechte: Grenze 45 → rot, 35 → knapp (35–45), 25 → frei (über 25+10)
  const r3 = await page.evaluate(async () => {
    _newCreate(false);
    const k = (await v3dApi.execute('shape.add', { type: 'box', size: [20, 20, 2], center: [0, 0, 15] })).result;
    await v3dApi.execute('body.transform', { id: k.id, rotate: [0, 40, 0] });
    const a = (await v3dApi.execute('overhang.live', { an: true, grenze: 45 })).result;
    const b = (await v3dApi.execute('overhang.live', { an: true, grenze: 35 })).result;
    const c = (await v3dApi.execute('overhang.live', { an: true, grenze: 25 })).result;
    return { a, b, c };
  });
  ok(Math.abs(r3.a.stuetze_mm2 - 400) <= 2 && Math.abs(r3.a.knapp_mm2 - 40) <= 1, '40°-Unterseite bei Grenze 45° → rot 400 mm²; 2-mm-Seitenfläche (50°) knapp 40 mm²', r3.a);
  ok(r3.b.stuetze_mm2 === 0 && Math.abs(r3.b.knapp_mm2 - 400) <= 2, 'bei Grenze 35° → nur knapp (orange)', r3.b);
  ok(r3.c.stuetze_mm2 === 0 && r3.c.knapp_mm2 === 0, 'bei Grenze 25° → keine Färbung', r3.c);
  // Klickpfad + Abschalten + Export enthält kein Overlay
  await page.evaluate(() => _ohlSchalten(false));
  await page.click('#ohl-btn');
  const r4 = await page.evaluate(() => ({ an: _ohl.an, vis: _ohlVis.length, gespeichert: JSON.parse(localStorage.getItem('v3d_overhang')).an,
    pressed: document.getElementById('ohl-btn').getAttribute('aria-pressed'), inObjects: objects.some(o => o.userData.isOverlay) }));
  ok(r4.an && r4.gespeichert && r4.pressed === 'true', 'Klick auf 📐 schaltet an, merkt es sich, aria-pressed', r4);
  ok(!r4.inObjects, 'Overlay ist kein Objekt (kein Export/Speichern)');
  fs.mkdirSync(process.env.V3D_SHOTS || '/tmp/v3d-test-screens', { recursive: true });
  await page.screenshot({ path: (process.env.V3D_SHOTS || '/tmp/v3d-test-screens') + '/S15-ueberhaenge-live.png' });
  await page.click('#ohl-btn');
  ok(await page.evaluate(() => !_ohl.an && _ohlVis.length === 0 && _ohlTimer === null), 'zweiter Klick schaltet aus und räumt auf');
  await page.setViewportSize({ width: 390, height: 844 });
  const r5 = await page.evaluate(() => { const q = id => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.bottom), getComputedStyle(document.getElementById(id)).display]; };
    return { ohl: q('ohl-btn'), ttb: q('ttb'), set: q('scene-settings-btn') }; });
  ok(r5.ohl[0] >= 0 && r5.ohl[1] <= 390, 'Knopf bleibt bei 390 px im Bild', r5);
  ok(errs.length === 0, 'keine Fehler in der Konsole', errs.slice(0, 3));
} catch (e) { console.log('  ✗ Abbruch:', e.message); fehler++; }
finally { await browser.close(); srv.kill(); }
console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden'); process.exit(fehler ? 1 : 0);
