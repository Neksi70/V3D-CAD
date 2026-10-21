// Bibliothek prüft große Dateien bei der Aufnahme und ersetzt sie durch die vereinfachte
// Fassung (Helfer v12 /replace, Original → Ordner „Original"). Braucht einen laufenden
// Helfer v12 auf 127.0.0.1:7777 mit Testdateien Scan_Kopf.3mf (großer Scan), Relief.stl
// (> 300.000 Dreiecke, gut vereinfachbar), Rauschen.stl (groß, kaum vereinfachbar) und
// Klein.stl im Bibliotheksordner; Kopien der Originale unter http://127.0.0.1:8927/ — z. B. im Container
// mcr.microsoft.com/powershell mit APPDATA/USERPROFILE gesetzt (Helfer-PowerShell nach #__PS__).
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
const PORT = 8928;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const H = 'http://127.0.0.1:7777';
const list = async () => (await (await fetch(H + '/list', { headers: { Origin: 'http://127.0.0.1:' + PORT } })).json()).files;
const nm = f => f.name.replace(/^\//, '');
const browser = await chromium.launch();
try {
  const before = await list();
  console.log('vorher:', before.map(f => nm(f) + ' ' + (f.size / 1e6).toFixed(1) + ' MB').join(' | '));
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (/stllib-check/.test(m.text())) console.log('console ' + m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _stlAutoCheck === 'function' && typeof hideStarter === 'function');
  await page.evaluate(async () => { try { hideStarter(); } catch (e) {} await _stlIdbSet('kv', 'source', 'helper'); });
  const t0 = Date.now();
  await page.evaluate(() => _stlLibOpen());
  await page.waitForFunction(() => _stlFiles.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(2500);   // Prüfung startet 1,5 s nach dem Laden
  await page.waitForFunction(() => !_stlChkBusy, null, { timeout: 600000, polling: 1000 });
  const t = Math.round((Date.now() - t0) / 1000);
  const after = await list();
  console.log('nachher (' + t + ' s):', after.map(f => nm(f) + ' ' + (f.size / 1e6).toFixed(1) + ' MB').join(' | '));
  const by = n => after.find(f => nm(f) === n), was = n => before.find(f => nm(f) === n);
  ok(by('Original/Scan_Kopf.3mf') && by('Original/Scan_Kopf.3mf').size === was('Scan_Kopf.3mf').size, 'Scan_Kopf.3mf: Original unverändert im Ordner Original');
  ok(by('Scan_Kopf.3mf') && by('Scan_Kopf.3mf').size < 0.6 * was('Scan_Kopf.3mf').size, 'Scan_Kopf.3mf ersetzt und kleiner');
  ok(by('Original/Relief.stl') && by('Relief.stl').size < was('Relief.stl').size, 'Relief.stl ersetzt, Original verschoben');
  ok(by('Rauschen.stl') && !by('Original/Rauschen.stl') && by('Rauschen.stl').size === was('Rauschen.stl').size, 'Rauschen.stl (lässt sich kaum vereinfachen) bleibt wie es ist');
  ok(by('Klein.stl') && !by('Original/Klein.stl'), 'Klein.stl unangetastet');
  ok(by('Scan_Kopf.3mf') && by('Scan_Kopf.3mf').mtime === was('Scan_Kopf.3mf').mtime, 'Datum bleibt (Reihenfolge in der Bibliothek)');
  const chk = await page.evaluate(async () => {
    const out = {};
    for (const n of ['Scan_Kopf.3mf', 'Original/Scan_Kopf.3mf', 'Relief.stl', 'Original/Relief.stl']) {
      // Originale von der Vergleichskopie (der Linux-Testhelfer liest keine Unterordner)
      const b = n.startsWith('Original/') ? await (await fetch('http://127.0.0.1:8927/' + n.slice(9))).arrayBuffer() : await _stlReadBytes({ path: '/' + n });
      let p;
      if (/3mf$/.test(n)) p = (await _p3mfParseAsync(b))[0].pos;
      else p = parseSTL(b).attributes.position.array;
      const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(p, 3));
      out[n] = { tris: p.length / 9, size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)) };
    }
    return out;
  });
  console.log('INFO ' + JSON.stringify(chk));
  for (const n of ['Scan_Kopf.3mf', 'Relief.stl']) {
    const k = chk[n], o = chk['Original/' + n];
    ok(k.tris >= 1000 && k.tris < 0.8 * o.tris, `${n} lesbar: ${o.tris} → ${k.tris} Dreiecke`);
    ok(k.size.every((v, i) => Math.abs(v - o.size[i]) < 0.05), `${n}: Abmessungen gleich ` + k.size.join('×') + ' mm');
  }
  const n1 = (await list()).length;
  await page.evaluate(() => { _stlListSig = ''; return _stlLoadFromHelper(); });
  await page.waitForTimeout(3000); await page.waitForFunction(() => !_stlChkBusy, null, { timeout: 300000, polling: 500 });
  ok((await list()).length === n1, 'zweiter Durchlauf ersetzt nichts mehr');
  ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
