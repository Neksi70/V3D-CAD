// Funktionstest 🎄 Weihnachts-Studio in V3D CAD (Dialog, Varianten, Löcher, Inschrift, Bearbeiten, Speichern, 3MF, Drucklage)
// Aufruf: node test_weihnachts_studio.mjs   (eigener Port; Screenshots nach V3D_SHOTS oder /tmp/v3d-test-screens)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 8881, SHOTS = process.env.V3D_SHOTS || '/tmp/v3d-test-screens';
fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore', env: { ...process.env, V3D_DB: '/tmp/v3d_wst_test.db' } });
await new Promise(r => setTimeout(r, 1200));
let fehler = 0;
const ok = (b, msg, x) => { console.log((b ? '  ✓ ' : '  ✗ ') + msg + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!b) fehler++; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|net::/.test(m.text())) errs.push(m.text()); });

// Hilfen im Browser: Kennzahlen der Weihnachts-Teile
const HELFER = () => {
  window._wt = () => objects.filter(o => o.userData.weihnachtsParams).map(o => {
    o.updateMatrixWorld(true);
    const g = o.geometry, pos = g.getAttribute('position'), idx = g.index;
    const q = 1e-4, key = i => Math.round(pos.getX(i) / q) + ',' + Math.round(pos.getY(i) / q) + ',' + Math.round(pos.getZ(i) / q);
    const kanten = new Map(); let vol = 0;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      for (const [x, y] of [[a, b], [b, c], [c, a]]) { const kx = idx ? String(x) : key(x), ky = idx ? String(y) : key(y); if (kx === ky) continue; const k = kx < ky ? kx + '|' + ky : ky + '|' + kx; kanten.set(k, (kanten.get(k) || 0) + 1); }
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a), bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b), cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
      vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    let offen = 0; for (const v of kanten.values()) if (v !== 2) offen++;
    const bb = getMeshBox(o);
    return { name: o.userData.name, rolle: o.userData.weihnachtsParams.rolle, gruppe: o.userData.weihnachtsParams.gruppe, farbe: o.userData.color,
      vol: Math.round(vol / 6 * 1000), offen, tris: n / 3, minY: +(bb.min.y * 10).toFixed(2), maxY: +(bb.max.y * 10).toFixed(2), x: [+(bb.min.x * 10).toFixed(1), +(bb.max.x * 10).toFixed(1)] };
  });
  window._wtNeu = async (p) => { _newCreate(false); _wstOpen(); Object.assign(_wstP, p); _wstRender(); return await _wstCreate(); };
};
try {
  await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.v3dApi && typeof _wstOpen === 'function' && window.V3DWeihnacht, null, { timeout: 30000 });
  await page.evaluate(() => { hideStarter(); _newCreate(false); });
  await page.evaluate(HELFER);

  console.log('1) Auslösepfade');
  const r1 = await page.evaluate(() => ({ rubrik: _GEN_WEIHNACHTEN[0], starter: _STARTERS.some(s => s.t === 'Weihnachts-Studio') }));
  ok(r1.rubrik === 'Weihnachts-Studio' && r1.starter, 'steht als Erstes in der Rubrik 🎄 Weihnachten', r1);
  await page.evaluate(() => _cmdkOpen());
  await page.fill('#cmdk-inp', 'Weihnachts-Studio');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#wst-modal.show', { timeout: 5000 });
  ok(true, 'Strg+K „Weihnachts-Studio“ + Enter öffnet den Dialog');
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + '/S10-weihnachts-studio.png' });

  console.log('2) Standard-Baum einfügen (Klick)');
  await page.click('#wst-ok');
  await page.waitForFunction(() => objects.filter(o => o.userData.weihnachtsParams).length >= 4, null, { timeout: 30000 });
  const r2 = await page.evaluate(() => _wt());
  ok(r2.length === 4 && r2.map(t => t.rolle).sort().join() === 'koerper,sockel,stern,stern', '4 Teile: Baum, Stern, Stern-Stiel, Sockel', r2.map(t => t.name));
  ok(r2.every(t => t.offen === 0 && t.vol > 0), 'alle Teile wasserdicht, Volumen > 0', r2.map(t => [t.rolle, t.offen, t.vol]));
  ok(new Set(r2.map(t => t.gruppe)).size === 1, 'eine gemeinsame Gruppe');
  ok(new Set(r2.map(t => t.farbe)).size >= 3, 'eigene Farben je Teil (Baum/Stern/Sockel)', [...new Set(r2.map(t => t.farbe))]);

  console.log('3) Bearbeiten: Doppelklick-Weg, Höhe ändern, Gruppe wird ersetzt');
  const r3 = await page.evaluate(async () => {
    const vorher = _wt(), o = objects.find(x => x.userData.weihnachtsParams && x.userData.weihnachtsParams.rolle === 'koerper');
    _wstOpen(o); _wstSet('hoehe', 180); await _wstCreate();
    return { vorher, nachher: _wt() };
  });
  ok(r3.nachher.length === 4 && r3.nachher[0].gruppe === r3.vorher[0].gruppe, 'gleiche Gruppe, 4 Teile (alte entfernt)', r3.nachher.length);
  const hV = r3.vorher.find(t => t.rolle === 'koerper'), hN = r3.nachher.find(t => t.rolle === 'koerper');
  ok(Math.abs((hN.maxY - hN.minY) - 180) < 1 && Math.abs(hN.minY - hV.minY) < 0.5, 'Baum jetzt 180 mm hoch, steht an derselben Stelle', [hV.maxY - hV.minY, hN.maxY - hN.minY]);

  console.log('4) Licht: Löcher werden ausgestanzt');
  const r4 = await page.evaluate(async () => {
    await _wtNeu({ ...V3DWeihnacht.VORLAGEN['Sternbaum-Licht'], lichtMuster: 'keine' }); const ohne = _wt().find(t => t.rolle === 'koerper');
    await _wtNeu(V3DWeihnacht.VORLAGEN['Sternbaum-Licht']); const mit = _wt();
    return { ohne, mit };
  });
  const lk = r4.mit.find(t => t.rolle === 'koerper');
  ok(lk.offen === 0 && lk.vol < r4.ohne.vol * 0.97 && lk.tris > r4.ohne.tris * 1.1, 'Schirm mit Sternlöchern: dicht, weniger Volumen, mehr Dreiecke', { ohne: [r4.ohne.vol, r4.ohne.tris], mit: [lk.vol, lk.tris, lk.offen] });
  ok(r4.mit.some(t => t.name.startsWith('Teelicht-Sockel')), 'Teelicht-Sockel dabei');

  console.log('5) Inschrift erhaben / vertieft');
  const r5 = await page.evaluate(async () => {
    await _wtNeu({ inschrift: '' }); const ohne = _wt().find(t => t.rolle === 'sockel');
    await _wtNeu({ inschrift: 'Emma 2026', inschriftArt: 'erhaben' }); const erh = _wt();
    await _wtNeu({ inschrift: 'Emma 2026', inschriftArt: 'vertieft' }); const ver = _wt();
    return { ohne, erh, ver };
  });
  const insE = r5.erh.find(t => t.rolle === 'inschrift'), sockV = r5.ver.find(t => t.rolle === 'sockel');
  ok(insE && insE.vol > 0 && insE.farbe !== r5.erh.find(t => t.rolle === 'sockel').farbe, 'erhaben: eigenes Teil „Inschrift“ in eigener Farbe', insE && insE.name);
  ok(!r5.ver.some(t => t.rolle === 'inschrift') && sockV.offen === 0 && sockV.tris > r5.ohne.tris * 2, 'vertieft: in den Sockel geschnitten, Sockel dicht', [r5.ohne.tris, sockV.tris, sockV.offen]);

  console.log('6) Mütze, Glocke, Dose, Anhänger');
  const r6 = await page.evaluate(async () => {
    const out = {};
    for (const [n, p] of [['muetze', V3DWeihnacht.VORLAGEN['Nikolausmütze']], ['glocke', V3DWeihnacht.VORLAGEN['Glocke mit Öse']], ['dose', V3DWeihnacht.VORLAGEN['Spiralbaum-Dose']], ['anh', V3DWeihnacht.VORLAGEN['Mini-Anhänger Baum']], ['muetzeLicht', V3DWeihnacht.VORLAGEN['Mützen-Licht']], ['gefaltet', { stil: 'gefaltet' }]]) {
      await _wtNeu(p); out[n] = _wt().map(t => [t.rolle, t.offen, t.vol > 0]);
    }
    return out;
  });
  const dicht = l => l.every(([, o, v]) => o === 0 && v);
  ok(r6.muetze.map(t => t[0]).sort().join() === 'bommel,koerper,krempe,sockel' && dicht(r6.muetze), 'Mütze: Körper, Krempe, Bommel, Sockel – dicht', r6.muetze);
  ok(r6.glocke.map(t => t[0]).sort().join() === 'kloeppel,koerper,oese' && dicht(r6.glocke), 'Glocke: Körper, Klöppel, Öse – dicht', r6.glocke);
  ok(r6.dose.map(t => t[0]).sort().join() === 'deckel,koerper' && dicht(r6.dose), 'Dose: Unterteil + Deckel – dicht', r6.dose);
  ok(r6.anh.some(t => t[0] === 'oese') && !r6.anh.some(t => t[0] === 'sockel') && dicht(r6.anh), 'Anhänger: mit Öse, ohne Sockel', r6.anh);
  ok(r6.muetzeLicht.some(t => t[0] === 'krempe') && dicht(r6.muetzeLicht), 'Mützen-Licht dicht', r6.muetzeLicht);
  ok(r6.gefaltet.some(t => t[0] === 'koerper') && r6.gefaltet.find(t => t[0] === 'koerper')[2], 'Stil „Gefaltet“ nutzt den Faltenbaum-Kern', r6.gefaltet);

  console.log('7) Zum Drucken verteilt: alles auf der Platte, Gruppen nebeneinander');
  const r7 = await page.evaluate(async () => { await _wtNeu({ ...V3DWeihnacht.VORLAGEN['Nikolausmütze'], anordnung: 'druck' }); return _wt(); });
  ok(r7.every(t => Math.abs(t.minY) < 0.05), 'jedes Teil liegt auf der Platte (min z = 0)', r7.map(t => [t.rolle, t.minY]));
  const gr = {}; r7.forEach(t => { const g = t.rolle === 'oese' ? 'bommel' : t.rolle; gr[g] = gr[g] ? [Math.min(gr[g][0], t.x[0]), Math.max(gr[g][1], t.x[1])] : t.x; });
  const iv = Object.values(gr).sort((a, b) => a[0] - b[0]);
  ok(iv.every((v, i) => i === 0 || v[0] >= iv[i - 1][1] - 0.01), 'Teile überlappen sich nicht', iv);

  console.log('8) Speichern/Laden + 3MF');
  const r8 = await page.evaluate(async () => {
    await _wtNeu({ inschrift: 'Oma', inschriftArt: 'erhaben' });
    const j = (await v3dApi.execute('scene.save', {})).result.json;
    await v3dApi.execute('scene.load', { json: j });
    const nach = objects.filter(o => o.userData.weihnachtsParams).map(o => o.userData.weihnachtsParams.rolle);
    const r = _build3mfBlob(objects.slice());
    return { nach, farben: r.colors, teile: r.parts };
  });
  ok(r8.nach.length === 5 && r8.nach.includes('inschrift'), 'nach scene.save/load: 5 Teile mit Studio-Parametern', r8.nach);
  ok(r8.farben >= 3 && r8.teile === 5, '3MF: 5 Teile, ≥ 3 Farben', r8);

  console.log('9) Dialog: Explodiert, 390 px, Klick-Bearbeiten');
  await page.evaluate(() => { _wstOpen(objects.find(o => o.userData.weihnachtsParams)); });
  await page.click('#wst-modal button:has-text("Explodiert")');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => _wstExplo === true), 'Explosionsansicht schaltet');
  await page.screenshot({ path: SHOTS + '/S16-weihnachts-explodiert.png' });
  await page.click('#wst-modal button:has-text("Mütze")');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => _wstP.objekt === 'muetze' && document.querySelector('#wst-ctrl').textContent.includes('Krempe')), 'Klick auf „Mütze“ zeigt Mützen-Stile und Krempen-Farbe');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/S10-weihnachts-390.png' });
  const r9 = await page.evaluate(() => { const b = document.querySelector('#wst-modal .g3box').getBoundingClientRect(); return [b.left, b.right]; });
  ok(r9[0] >= 0 && r9[1] <= 390.5, 'Dialog passt in 390 px', r9);
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.getElementById('wst-modal').classList.contains('show')), 'Escape schließt');
  ok(errs.length === 0, 'keine Fehler in der Konsole', errs.slice(0, 4));
} catch (e) { console.log('  ✗ Abbruch:', e.message); fehler++; }
finally { await browser.close(); srv.kill(); }
console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
process.exit(fehler ? 1 : 0);
