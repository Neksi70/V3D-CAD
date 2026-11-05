// Funktionstest 🎯 Passprobe: Karte bauen → Werte → 3MF-Objekt-Einstellung, Klickpfad über ⚙, Server-Sync
// Aufruf: node test_passprobe.mjs   (eigener Port + eigene Test-DB, berührt ~/.config/volme3d/v3d.db nicht)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 8873, DB = '/tmp/v3d_fit_test.db';
fs.rmSync(DB, { force: true });
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'],
  { cwd: '/home/v3da', stdio: 'inherit', env: { ...process.env, V3D_DB: DB } });
await new Promise(r => setTimeout(r, 1200));
const SHOTS = process.env.V3D_SHOTS || '/tmp/v3d-test-screens';
fs.mkdirSync(SHOTS, { recursive: true });

let fehler = 0;
const ok = (b, msg, extra) => { console.log((b ? '  ✓ ' : '  ✗ ') + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!b) fehler++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|fonts|net::/.test(m.text())) errs.push(m.text()); });
try {
  await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.v3dApi && typeof _pfOpen === 'function', null, { timeout: 30000 });
  await page.evaluate(() => { hideStarter(); localStorage.removeItem('v3d_fitprofile'); localStorage.removeItem('v3d_fitprofile_wahl'); localStorage.setItem('printerName', 'A1 / P1S / X1C'); _newCreate(false); });

  console.log('1) Passprobe bauen (fit.card)');
  const r1 = await page.evaluate(async () => {
    const r = await v3dApi.execute('fit.card', {});
    if (!r.ok) return { err: r.error };
    const ins = (await v3dApi.execute('scene.inspect', { measure: true })).result.bodies;
    // Lochdurchmesser direkt an der Platte messen: Eckpunkte um jede Lochmitte (Welt, mm)
    const pl = objects.find(o => /Lochplatte/.test(o.userData.name || ''));
    pl.updateMatrixWorld(true);
    const pos = pl.geometry.attributes.position, v = new THREE.Vector3(), ds = [];
    const xs = _PF_D.map((d, k) => -44 + k * _PF_PITCH);
    const wpts = [];
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(pl.matrixWorld); wpts.push([v.x * 10, -v.z * 10, v.y * 10]); }
    // Mitte der Platte in Welt-mm bestimmen (Platte kann verschoben liegen)
    const bx = wpts.reduce((a, p) => [Math.min(a[0], p[0]), Math.max(a[1], p[0]), Math.min(a[2], p[1]), Math.max(a[3], p[1])], [1e9, -1e9, 1e9, -1e9]);
    const cx = (bx[0] + bx[1]) / 2, cy = (bx[2] + bx[3]) / 2;
    xs.forEach((x, k) => {
      const rs = wpts.map(p => Math.hypot(p[0] - cx - x, p[1] - cy)).filter(r => r < 5.5);
      ds.push(rs.length ? +(2 * Math.max(...rs)).toFixed(3) : null);
    });
    return { bodies: ins.map(b => ({ name: b.name, size: b.size, vol: b.volume_mm3 })), loecher: ds,
      karte: objects.map(o => !!o.userData.fitKarte), achse: [cx, cy] };
  });
  ok(!r1.err, 'fit.card ohne Fehler', r1.err);
  ok(r1.bodies && r1.bodies.length === 2, '2 Körper (Lochplatte + Zapfen)', r1.bodies && r1.bodies.map(b => b.name));
  const pl = r1.bodies.find(b => /Lochplatte/.test(b.name)), zp = r1.bodies.find(b => /Zapfen/.test(b.name));
  ok(pl && Math.abs(pl.size[0] - 112) < 0.05 && Math.abs(pl.size[1] - 22) < 0.05 && Math.abs(pl.size[2] - 4.6) < 0.05, 'Platte 112 × 22 × 4,6 mm (mit 0,6 mm Markierung)', pl && pl.size);
  ok(zp && Math.abs(zp.size[0] - 8) < 0.02 && Math.abs(zp.size[2] - 10) < 0.02, 'Zapfen Ø 8 × 10 mm', zp && zp.size);
  // Soll-Volumen: Platte − Ecken − Löcher + Pfeil + Strich (Löcher als Kreis gerechnet)
  const soll = (112 * 22 - 4 * (9 - Math.PI * 9 / 4)) * 4 - [7.8, 7.9, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6].reduce((a, d) => a + Math.PI * d * d / 4 * 4, 0) + 12 * 0.6 + 6 * 1.4 * 0.6;
  ok(pl && pl.vol && Math.abs(pl.vol - soll) / soll < 0.01, 'Plattenvolumen ±1 % (Schnitte haben getroffen)', pl && { ist: pl.vol, soll: +soll.toFixed(1) });
  const sollD = [7.8, 7.9, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6];
  ok(r1.loecher.every((d, k) => d != null && Math.abs(d - sollD[k]) < 0.03), 'Lochdurchmesser (Eckpunkte) = 7,8 … 8,6 mm ±0,03', r1.loecher);
  ok(r1.karte.every(Boolean), 'beide als Passprobe markiert');

  console.log('2) Werte (fit.set)');
  const r2 = await page.evaluate(async () => {
    const a = (await v3dApi.execute('fit.set', { loch_nr: 6 })).result.gespeichert;
    const b = (await v3dApi.execute('fit.set', { zapfen_mm: 8.12, loch_mm: 7.78, duese_mm: 0.6 })).result.gespeichert;
    const c = await v3dApi.execute('fit.set', { loch_korr_mm: 3 });
    const d = await v3dApi.execute('fit.set', { loch_nr: 12 });
    return { a, b, c, d, aktiv: _pfAktiv() };
  });
  ok(r2.a.loch_korr_mm === 0.15 && r2.a.kontur_korr_mm === 0, 'Loch 6 (8,3) → Löcher +0,15 je Seite', r2.a);
  ok(r2.b.kontur_korr_mm === -0.06 && r2.b.loch_korr_mm === 0.11, 'Messschieber 8,12/7,78 → Kanten −0,06, Löcher +0,11', r2.b);
  ok(!r2.c.ok && /1 mm/.test(r2.c.error), 'Unsinn (3 mm) abgelehnt', r2.c.error);
  ok(!r2.d.ok, 'loch_nr 12 abgelehnt', r2.d.error);
  ok(r2.aktiv && r2.aktiv.duese_mm === 0.6, 'zuletzt gespeichertes Profil ist aktiv', r2.aktiv);

  console.log('3) 3MF-Export trägt die Korrektur ein, Passprobe selbst nicht');
  const r3 = await page.evaluate(async () => {
    const lies = r => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fflate.strFromU8(fflate.unzipSync(new Uint8Array(fr.result))['Metadata/model_settings.config'])); fr.readAsArrayBuffer(r.blob); });
    const karte = objects.slice();
    const box = (await v3dApi.execute('shape.add', { type: 'box', size: [20, 20, 10], center: [0, 60, 5] })).result;
    const bo = objects.find(o => o.userData.id === box.id);
    const rB = _build3mfBlob([bo]), rK = _build3mfBlob(karte);
    const out = { box: await lies(rB), karte: await lies(rK), hinweis: rB.passung, hinweisK: rK.passung };
    await v3dApi.execute('fit.set', { aktiv: false });
    const rA = _build3mfBlob([bo]);
    out.aus = await lies(rA); out.aktivNachAus = _pfAktiv();
    return out;
  });
  ok(/key="xy_hole_compensation" value="0\.110"/.test(r3.box) && /key="xy_contour_compensation" value="-0\.060"/.test(r3.box), 'Box-3MF: xy_hole 0.110 / xy_contour −0.060 als Objekt-Einstellung');
  ok(!/xy_hole_compensation/.test(r3.karte) && !r3.hinweisK, 'Passprobe-3MF ohne Korrektur');
  ok(/Passung/.test(r3.hinweis || ''), 'Export meldet die Korrektur', r3.hinweis);
  ok(!/xy_hole_compensation/.test(r3.aus) && r3.aktivNachAus === null, 'ausgeschaltet → kein Eintrag');

  console.log('4) Klickpfad: ⚙ Arbeitsbereich → Einmessen → Loch 6 → Speichern');
  await page.evaluate(() => { localStorage.removeItem('v3d_fitprofile'); localStorage.removeItem('v3d_fitprofile_wahl'); _openSceneSettings(); });
  await page.click('#scene-settings-modal button:has-text("Einmessen")');
  await page.waitForSelector('#pf-modal.show');
  await page.screenshot({ path: SHOTS + '/S17-passprobe-1.png' });
  await page.click('#pf-modal button:has-text("Probe auf die Platte legen")');
  await page.waitForFunction(() => objects.filter(o => /^Passprobe/.test(o.userData.name || '')).length >= 4, null, { timeout: 30000 });
  await page.click('#pf-modal button:has-text("Ich habe gedruckt")');
  await page.click('#pf-modal button:has-text("Weiter")');
  ok(await page.isVisible('#pf-modal .pf-err:has-text("Loch antippen")'), 'ohne Wahl: Hinweis „Bitte ein Loch antippen“');
  await page.click('#pf-modal .pf-cell >> nth=5');
  await page.screenshot({ path: SHOTS + '/S17-passprobe-2.png' });
  await page.click('#pf-modal button:has-text("Weiter")');
  await page.screenshot({ path: SHOTS + '/S17-passprobe-3.png' });
  await page.click('#pf-modal button:has-text("Speichern")');
  const r4 = await page.evaluate(() => ({ p: _pfAktiv(), offen: document.getElementById('pf-modal').classList.contains('show'),
    sub: document.getElementById('pf-ss-sub').textContent }));
  ok(r4.p && r4.p.loch_korr_mm === 0.15 && r4.p.quelle === 'karte' && r4.p.drucker === 'A1 / P1S / X1C', 'per Klick gespeichert: +0,15, Quelle Karte, Drucker A1/P1S/X1C', r4.p);
  ok(!r4.offen, 'Dialog nach Speichern zu');
  ok(/0,15/.test(r4.sub), 'Einstellungszeile zeigt aktive Passung', r4.sub);

  console.log('5) Tastatur: Escape schließt, Messschieber-Zweig');
  await page.evaluate(() => _pfOpen());
  await page.click('#pf-modal button:has-text("Ich habe gedruckt")');
  await page.click('#pf-modal button[role=radio]:has-text("Messschieber")');
  await page.fill('#pf-mz', '8,1'); await page.fill('#pf-ml', '7.9');
  await page.click('#pf-modal button:has-text("Weiter")');
  const r5 = await page.evaluate(() => _pf.werte);
  ok(r5 && r5.kontur_korr_mm === -0.05 && r5.loch_korr_mm === 0.05, 'Komma und Punkt werden gelesen (8,1 / 7.9)', r5);
  await page.keyboard.press('Escape');
  ok(!(await page.evaluate(() => document.getElementById('pf-modal').classList.contains('show'))), 'Escape schließt den Dialog');

  console.log('6) Server-Abgleich /api/fit-profil (Test-DB)');
  await page.waitForTimeout(800);
  const r6 = await page.evaluate(async () => {
    const g = await (await fetch('/api/fit-profil', { credentials: 'same-origin' })).json();
    const alt = await fetch('/api/fit-profil', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drucker: 'A1 / P1S / X1C', duese_mm: 0.4, material: 'PLA', loch_korr_mm: 0.4, geaendert_ts: 1 }) });
    const kaputt = await fetch('/api/fit-profil', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loch_korr_mm: 9 }) });
    return { profile: g.profile, alt: alt.status, kaputt: kaputt.status };
  });
  ok(r6.profile && r6.profile.some(p => p.loch_korr_mm === 0.15 && p.drucker === 'A1 / P1S / X1C'), 'Profil liegt auf dem Server', r6.profile && r6.profile.length);
  ok(r6.alt === 409, 'älterer Stand wird abgelehnt (409)', r6.alt);
  ok(r6.kaputt === 400, 'Unsinn wird abgelehnt (400)', r6.kaputt);

  console.log('7) Handy-Breite 390 px');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => _pfOpen());
  await page.click('#pf-modal button:has-text("Ich habe gedruckt")');
  await page.screenshot({ path: SHOTS + '/S17-passprobe-390.png' });
  const r7 = await page.evaluate(() => { const b = document.querySelector('#pf-modal .g3box').getBoundingClientRect();
    const g = document.querySelector('#pf-modal .pf-grid').getBoundingClientRect(); return { box: [b.left, b.right], grid: [g.left, g.right] }; });
  ok(r7.box[0] >= 0 && r7.box[1] <= 390 && r7.grid[1] <= r7.box[1], 'Dialog und Lochraster passen in 390 px', r7);

  console.log('8) Druckerwechsel: Passung gilt nur für ihren Drucker');
  await page.setViewportSize({ width: 1440, height: 900 });
  const r8 = await page.evaluate(async () => {
    await v3dApi.execute('fit.set', { loch_nr: 6 });                       // A1 / P1S / X1C
    localStorage.setItem('printerName', 'SV08 Max');
    const andere = _pfAktiv();
    const box = objects.find(o => !/^Passprobe/.test(o.userData.name || '')) || objects[0];
    const rB = _build3mfBlob([box]);
    localStorage.setItem('printerName', 'A1 / P1S / X1C');
    return { andere, passung: rB.passung, zurueck: _pfAktiv() && _pfAktiv().loch_korr_mm };
  });
  ok(r8.andere === null && !r8.passung, 'anderer Drucker → keine Korrektur im Export', r8);
  ok(r8.zurueck === 0.15, 'zurück auf A1 → Passung gilt wieder', r8.zurueck);

  console.log('9) Auslösepfad „An den Slicer“: einfarbig + Passung → 3MF mit Eintrag');
  const r9 = await page.evaluate(async () => {
    _newCreate(false);
    await v3dApi.execute('shape.add', { type: 'box', size: [20, 20, 10] });
    let fang = null; const orig = window._downloadBlob, meld = [];
    window._downloadBlob = (b, n) => { fang = { b, n }; };
    const origN = window.notify; window.notify = (m, t) => { meld.push(m); return origN(m, t); };
    _stlHelperOk = false;
    await _sendCurrentToSlicer();
    window._downloadBlob = orig; window.notify = origN;
    if (!fang) return { fehler: 'kein Download', meld };
    const u = new Uint8Array(await fang.b.arrayBuffer());
    const cfg = fflate.strFromU8(fflate.unzipSync(u)['Metadata/model_settings.config'] || new Uint8Array());
    return { name: fang.n, eintrag: /xy_hole_compensation" value="0\.150"/.test(cfg), meld };
  });
  ok(r9.name && /\.3mf$/.test(r9.name) && r9.eintrag, 'Download ist .3mf mit xy_hole_compensation 0.150', r9);
  ok(!(r9.meld || []).some(m => /1 Farben/.test(m)), 'keine Meldung „1 Farben“ (ohne Helfer)', r9.meld);
  const r9b = await page.evaluate(async () => {
    const meld = [], origN = window.notify, origF = window.fetch, origP = window._stlPingHelper;
    window.notify = (m, t) => { meld.push(m); return origN(m, t); };
    window._stlPingHelper = async () => {};
    window.fetch = async (u, o) => /\/print$/.test(String(u)) ? new Response(JSON.stringify({ ok: true, slicer: _stlHelperSlicers[0] }), { status: 200 }) : origF(u, o);
    _stlHelperOk = true; _stlHelperSlicers.splice(0, _stlHelperSlicers.length, 'bambu');
    try { await _sendCurrentToSlicer(); } finally { window.notify = origN; window.fetch = origF; window._stlPingHelper = origP; _stlHelperOk = false; }
    return meld;
  });
  ok(r9b.some(m => /3MF/.test(m) && /geöffnet/.test(m)) && !r9b.some(m => /1 Farben/.test(m)), 'mit Druck-Helfer: „als 3MF … geöffnet“, ohne „1 Farben“', r9b);

  ok(errs.length === 0, 'keine Fehler in der Konsole', errs.slice(0, 5));
} catch (e) { console.log('  ✗ Abbruch:', e.message); fehler++; }
finally { await browser.close(); srv.kill(); }
console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
