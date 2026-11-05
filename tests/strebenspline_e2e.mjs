// Browser-Test Strebe → Spline: Testscan importieren, Panel bedienen, Kontrollbild je Schritt.
//   node tests/strebenspline_e2e.mjs        (startet eigenen Dev-Server auf Port 18831)
//   STL=pfad/zum/scan.stl node tests/strebenspline_e2e.mjs   (echter Scan statt Testscan)
// Kontrollbilder: tests/out/ssp_*.png
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { makeTestScan, toBinarySTL } from './strebenspline_testscan.mjs';

const PORT = 18831, OUT = 'tests/out';
fs.mkdirSync(OUT, { recursive: true });
let stlPfad = process.env.STL;
if (!stlPfad) { stlPfad = OUT + '/colani_testscan.stl'; if (!fs.existsSync(stlPfad)) fs.writeFileSync(stlPfad, toBinarySTL(makeTestScan().positions)); }

const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
let fehler = 0;
const ok = (b, t) => { console.log((b ? '  ✓ ' : '  ✗ ') + t); if (!b) fehler++; };
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (/strebespline/.test(m.text())) console.log('   [konsole]', m.text()); });
  await page.route('**/__testscan.stl', r => r.fulfill({ body: fs.readFileSync(stlPfad), contentType: 'application/octet-stream' }));
  await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  ok(await page.evaluate(() => typeof openStrebenSpline === 'function' && !!window.StrebenKern), 'Werkzeug geladen');
  await page.evaluate(async () => {
    document.querySelectorAll('.modal,.ovl,[id$="-modal"]').forEach(m => { if (getComputedStyle(m).display !== 'none' && m.style) m.style.display = 'none'; });
    const buf = await (await fetch('/__testscan.stl')).arrayBuffer();
    _addImportedStl(buf, 'Colani_testscan.stl', false);
  });
  await page.waitForTimeout(800);
  // Knopf in der Werkzeugleiste
  await page.evaluate(() => openStrebenSpline());
  await page.waitForSelector('#ssp-panel');
  const shot = async n => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/ssp_${n}.png` }); };
  const klick = async (a, warte) => {
    await page.click(`#ssp-panel [data-a="${a}"]`);
    if (warte) await page.waitForFunction(() => !window._strebenSpline.beschaeftigt, null, { timeout: 240000 });
  };
  const st = id => page.$eval('#ssp-' + id, e => e.innerText);

  await klick('s0', true); await shot('0_ausrichtung');
  const t0 = await st('s0'); console.log('   0:', t0.split('\n')[0]);
  ok(/Symmetrieebene gefunden/.test(t0), 'Schritt 0 ausgerichtet');
  const rms = await page.evaluate(() => window._strebenSpline.al.rms); ok(rms < 1, `Restfehler ${rms.toFixed(2)} mm`);

  await klick('s1', true); await shot('1_streben');
  const t1 = await st('s1'); console.log('   1:', t1.replace(/\n/g, ' | '));
  ok(/links: Z/.test(t1) && /rechts: Z/.test(t1), 'Schritt 1 beide Streben');

  await klick('s2', true); await shot('2_kamm');
  const t2 = await st('s2'); console.log('   2:', t2.replace(/\n/g, ' | '));
  ok(/Kamm/.test(t2), 'Schritt 2 Kammpunkte');
  ok(await page.evaluate(() => !!(window._strebenSpline.sp.links && window._strebenSpline.sp.rechts)), 'Schritt 3 Splines automatisch');
  await shot('3_spline');

  // Glättung verstellen → Spline ändert sich live
  const vorher = await page.evaluate(() => JSON.stringify(window._strebenSpline.sp.links.ctrl));
  await page.$eval('#ssp-gl', e => { e.value = 8; e.dispatchEvent(new Event('input')); });
  const nachher = await page.evaluate(() => JSON.stringify(window._strebenSpline.sp.links.ctrl));
  ok(vorher !== nachher, 'Glättungsregler wirkt live');
  await page.$eval('#ssp-gl', e => { e.value = 5; e.dispatchEvent(new Event('input')); });

  // Stützpunkte vorschlagen + einen Griff mit der Maus ziehen
  await klick('vorschlag');
  const nSt = await page.evaluate(() => window._strebenSpline.stuetz.links.length);
  ok(nSt === 6, `${nSt} Stützpunkte vorgeschlagen`);
  await page.evaluate(() => { setView('front'); fitToObjects(objects); });
  await page.waitForTimeout(300);
  const ziel = await page.evaluate(() => {
    const S = window._strebenSpline, h = S.obj['griffe-links'].children[2];
    camera.updateMatrixWorld(); const w = h.getWorldPosition(new THREE.Vector3()).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (w.x + 1) / 2 * r.width, y: r.top + (1 - w.y) / 2 * r.height, p: S.stuetz.links[2].slice() };
  });
  await page.mouse.move(ziel.x, ziel.y); await page.mouse.down();
  await page.mouse.move(ziel.x + 30, ziel.y - 20, { steps: 6 }); await page.mouse.up();
  const neu = await page.evaluate(() => window._strebenSpline.stuetz.links[2]);
  const weg = Math.hypot(neu[0] - ziel.p[0], neu[1] - ziel.p[1], neu[2] - ziel.p[2]);
  ok(weg > 5, `Stützpunkt per Maus gezogen (${weg.toFixed(0)} mm), Spline live neu`);
  await shot('3b_stuetzpunkt_gezogen');
  await klick('undo');
  const zur = await page.evaluate(() => window._strebenSpline.stuetz.links[2]);
  ok(Math.hypot(zur[0] - ziel.p[0], zur[1] - ziel.p[1], zur[2] - ziel.p[2]) < 1e-6, 'Bearbeitung zurückgenommen');
  await page.click('#ssp-panel [data-m="ausgleich"]');

  await klick('s4'); await shot('4_symmetrie');
  const t4 = await st('s4'); console.log('   4:', t4.replace(/\n/g, ' | '));
  ok(/Abweichung: max/.test(t4), 'Schritt 4 Symmetrie');
  await klick('s5'); await shot('5_abweichung');
  const t5 = await st('s5'); console.log('   5:', t5.replace(/\n/g, ' | '));
  ok(/Beule max/.test(t5), 'Schritt 5 Abweichung');

  // Querschnitt anklicken
  const kp = await page.evaluate(() => {
    const S = window._strebenSpline, pts = S.obj['kamm-links']; const i = 40;
    const v = new THREE.Vector3().fromBufferAttribute(pts.geometry.attributes.position, i).applyMatrix4(pts.matrixWorld).project(camera);
    const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  });
  await page.mouse.click(kp.x, kp.y); await page.waitForTimeout(500);
  ok(await page.$eval('#ssp-profil', e => e.style.display === 'block'), 'Querschnitt-Bild nach Klick auf Kammpunkt');
  await shot('2b_querschnitt');

  await klick('mitteln'); await shot('4b_gemittelt');
  ok(await page.evaluate(() => window._strebenSpline.modus === 'gemittelt'), 'gemittelter Spline auf beide Seiten');

  // Export
  for (const [a, endung] of [['json', '.json'], ['csv', '.csv'], ['step', '.step'], ['poly', '.csv']]) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#ssp-panel [data-a="${a}"]`)]);
    const pfad = `${OUT}/export_${a}${endung}`; await dl.saveAs(pfad);
    const txt = fs.readFileSync(pfad, 'utf8');
    ok(txt.length > 200 && (a !== 'step' || txt.includes('B_SPLINE_CURVE_WITH_KNOTS')), `Export ${a} (${dl.suggestedFilename()}, ${txt.length} B)`);
  }
  ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} finally { await browser.close(); srv.kill(); }
console.log(fehler ? `\n✗ ${fehler} Fehler` : '\n✓ alles grün');
process.exit(fehler ? 1 : 0);
