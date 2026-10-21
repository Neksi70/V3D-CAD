// Bibliothek: nach dem Scrollen dürfen keine Eieruhren hängen bleiben, auch wenn parallel
// große Dateien geprüft/vereinfacht werden (Volker 21.10.). Dazu: Zeitlimit-Neustart des
// Workers und relative Toleranz (Datei in Metern darf nicht zerfallen).
// Braucht Helfer v12 auf 127.0.0.1:7777 (z. B. pwsh-Container) mit vielen Testdateien,
// darunter Relief_in_Metern.stl (relieftest.stl × 0,001) und große Scans.
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
const PORT = 8932;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (/Zeitlimit|stllib-check|\[thumb\]/.test(m.text())) console.log('console ' + m.text().slice(0, 160)); });
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _stlAutoCheck === 'function' && typeof hideStarter === 'function');
  await page.evaluate(async () => { try { hideStarter(); } catch (e) {} await _stlIdbSet('kv', 'source', 'helper'); });

  // 1) Zeitlimit: hängender Auftrag scheitert sauber, danach geht es weiter
  const r1 = await page.evaluate(async () => {
    const big = new Float32Array(9 * 400000); for (let i = 0; i < big.length; i++) big[i] = Math.random() * 50;
    let err = '';
    try { await _vfSimplifyAsync(big, { target: 1000, lane: 'thumb', timeout: 5 }); } catch (e) { err = e.message; }
    const small = new Float32Array(new THREE.SphereGeometry(5, 64, 48).toNonIndexed().attributes.position.array);
    const r = await _vfSimplifyAsync(small, { target: 500, lane: 'thumb' });
    return { err, after: r.outTris };
  });
  ok(/Zeitüberschreitung/.test(r1.err) && r1.after > 0 && r1.after <= 500, `Zeitlimit: Auftrag scheitert („${r1.err}“), Worker startet neu, nächster Auftrag klappt (${r1.after} Dr.)`);

  // 2) Bibliothek öffnen, langsam bis ganz unten scrollen, auf alle Vorschauen warten
  const t0 = Date.now();
  await page.evaluate(() => _stlLibOpen());
  await page.waitForFunction(() => _stlFiles.length > 20, null, { timeout: 30000 });
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => { const g = document.getElementById('stllib-grid'); g.scrollTop += 250; });
    await page.waitForTimeout(700);
  }
  const state = () => page.evaluate(() => {
    const w = [...document.querySelectorAll('#stllib-grid .ds-thumb-wrap')];
    return { n: w.length, uhr: w.filter(x => x.textContent.includes('⏳')).length, img: w.filter(x => x.querySelector('img')).length, box: w.filter(x => x.textContent.includes('📦')).length, chk: _stlChkBusy, pend: _stlThumbPending.length };
  });
  let s;
  for (let i = 0; i < 240; i++) {   // bis zu 8 min (große Prüfungen laufen parallel)
    s = await state();
    if (!s.uhr && !s.pend && !s.chk) break;
    if (i % 10 === 0) console.log('… ' + JSON.stringify(s));
    await page.waitForTimeout(2000);
  }
  console.log('Endstand ' + JSON.stringify(s) + ' nach ' + Math.round((Date.now() - t0) / 1000) + ' s');
  ok(s.uhr === 0, `keine Eieruhren mehr (${s.img} Bilder, ${s.box} 📦 von ${s.n} Karten)`);
  ok(s.img >= s.n - 1, 'praktisch alle Karten haben ein Vorschaubild');

  // 3) Datei in Metern: nicht zerfallen
  const r3 = await page.evaluate(async () => {
    const f = _stlFiles.find(x => /Relief_in_Metern\.stl$/.test(x.path) && !/Original/.test(x.path));
    const b = await _stlReadBytes(f); const g = parseSTL(b); g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    return { tris: g.attributes.position.count / 3, size: s.toArray().map(v => +v.toFixed(4)) };
  });
  console.log('INFO Relief_in_Metern: ' + JSON.stringify(r3));
  ok(r3.tris > 15000, `Datei in Metern behält Details: ${r3.tris} Dreiecke (mm-Fassung ergibt ~34.000; ohne Schutz wären es nur Dutzende)`);
  // 4) zweites Öffnen: alles aus dem Speicher, keine Datei wird erneut vom Helfer geholt
  const r4 = await page.evaluate(async () => {
    _stlLibClose();
    let reads = 0; const orig = _stlReadBytes; _stlReadBytes = async f => { reads++; return orig(f); };
    const t0 = performance.now(); await _stlLibOpen();
    for (let i = 0; i < 600; i++) {
      const w = [...document.querySelectorAll('#stllib-grid .ds-thumb-wrap')];
      if (w.length && w.every(x => x.querySelector('img')) && !_stlThumbPending.length && !_stlThumbBusy) break;
      await new Promise(r => setTimeout(r, 50));
    }
    const ms = Math.round(performance.now() - t0);
    await new Promise(r => setTimeout(r, 3000));   // Prüfung darf nichts mehr lesen
    _stlReadBytes = orig;
    return { ms, reads, n: document.querySelectorAll('#stllib-grid img.ds-thumb').length };
  });
  console.log('INFO zweites Öffnen: ' + JSON.stringify(r4));
  ok(r4.reads === 0, `zweites Öffnen: keine Datei neu gelesen (${r4.reads})`);
  ok(r4.ms < 5000, `zweites Öffnen: alle ${r4.n} Vorschaubilder nach ${r4.ms} ms da`);
  ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
