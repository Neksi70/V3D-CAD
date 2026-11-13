// Speichern mit Druck-Helfer + Netzordner (v1.18.403): kein Speichern-Dialog, Download + /collect, Rückgabe „Bibliothek“.
// Ohne Helfer (Ping scheitert) bleibt der Dialog-Weg. Helfer wird per page.route vorgetäuscht.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 18831;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1800));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  for (const [mitHelfer, ping] of [[true, { ok: true, version: 14, slicers: ['bambu'], netDir: '\\\\v3da\\stl', netOk: true, dir: '\\\\v3da\\stl', custom: false }], [true, { ok: true, version: 14, slicers: ['bambu'], libDir: 'C:\\Users\\V3D\\Documents\\Volme3D-STL', dir: 'C:\\Users\\V3D\\Documents\\Volme3D-STL', custom: false }], [false, null]]) {
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); let collect = 0;
    await p.route('http://127.0.0.1:7777/**', async r => {
      if (!mitHelfer) return r.abort();
      const u = r.request().url();
      if (u.endsWith('/ping')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(ping) });
      if (u.endsWith('/collect')) { collect++; return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }); }
      return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });
    await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
    await p.waitForFunction(() => typeof _saveExportMany === 'function', null, { timeout: 60000 });
    const r = await p.evaluate(async () => {
      let dl = 0, dialog = 0; window._downloadBlob = () => { dl++; };
      window.showSaveFilePicker = async () => { dialog++; throw Object.assign(new Error('x'), { name: 'AbortError' }); };
      window.showDirectoryPicker = async () => { dialog++; throw Object.assign(new Error('x'), { name: 'AbortError' }); };
      localStorage.removeItem('v3dFrageOrt');
      const res = await _saveExport(new Blob(['solid x'], { type: 'model/stl' }), 'probe.stl');
      await new Promise(z => setTimeout(z, 2200));
      return { dl, dialog, res };
    });
    if (mitHelfer) ok(r.dl === 1 && r.dialog === 0 && r.res.wrote && /Bibliothek \((stl|Volme3D-STL)\)/.test(r.res.dir) && collect === 1, `mit Helfer (${ping.netDir ? 'Netzordner' : 'lokal'}): Download ${r.dl}, Dialog ${r.dialog}, „${r.res.dir}“, /collect ${collect}×`);
    else ok(r.dialog === 1 && r.res.abgebrochen, `ohne Helfer: Speichern-Dialog wie bisher (Dialog ${r.dialog})`);
    ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 2).join(' | '));
    await p.close();
  }
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
