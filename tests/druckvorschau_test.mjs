// Druck-Vorschau: Druckerliste, Passt-Prüfung, Materialschätzung, Übergabe an den V3D Slicer (neuer Tab)
// mit Einstellungen + echtem Slice bzw. Projekt-3MF
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
const PORT = 8976;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _dvOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} localStorage.removeItem('v3d_druckvorschau');
    _newCreate(false); addShape('box'); const o = objects[0]; o.scale.set(2, 1, 2); o.updateMatrixWorld(true); o.position.y -= getMeshBox(o).min.y; });   // 40×20×40 mm
  await p.click('#btn-druckvorschau'); await p.waitForSelector('#dv-panel');
  const r1 = await p.evaluate(() => ({ txt: document.getElementById('dv-info').innerText, n: _dvListe.reduce((s, v) => s + v.drucker.length, 0), machine: _dv.p.machine }));
  ok(r1.n > 400, `Druckerliste geladen: ${r1.n} Drucker, Vorauswahl ${r1.machine}`);
  ok(/40 × 40 × 20 mm/.test(r1.txt) && /passt/.test(r1.txt), 'Maße + „passt" (' + r1.txt.split('\n').slice(0, 3).join(' | ') + ')');
  // Materialschätzung: massiver Quader 32 cm³, 15 % Füllung, 2 Wände → deutlich unter Vollmaterial (39,7 g PLA)
  const g = parseFloat((r1.txt.match(/([\d,]+) g/) || [])[1].replace(',', '.'));
  ok(g > 6 && g < 30, 'Material ca. ' + g + ' g (Vollmaterial wären 39,7 g)');
  // Herstellerwechsel → Snapmaker U1 wählen, zu großes Teil erkennen
  await p.selectOption('#dv-vendor', 'Snapmaker');
  await p.selectOption('#dv-machine', 'Snapmaker U1 (0.4 nozzle)');
  await p.selectOption('#dv-ftype', 'PETG'); await p.selectOption('#dv-lh', '0.28');
  await p.fill('#dv-walls', '3'); await p.press('#dv-walls', 'Tab');
  await p.evaluate(() => _dvSet('infill', 25)); await p.click('#dv-panel .vbg button:has-text("Baum")');
  const big = await p.evaluate(() => { const o = objects[0]; o.scale.set(15, 1, 2); o.updateMatrixWorld(true); _dvPanel(true); const t = document.getElementById('dv-info').innerText; o.scale.set(2, 1, 2); o.updateMatrixWorld(true); _dvPanel(true); return t; });
  ok(/zu groß/.test(big), 'U1 (270 mm): 300 mm langes Teil → „zu groß"');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('v3d_druckvorschau')));
  ok(saved.vendor === 'Snapmaker' && saved.machine === 'Snapmaker U1 (0.4 nozzle)' && saved.ftype === 'PETG' && saved.walls === 3 && saved.infill === 25 && saved.support === 'baum', 'Auswahl gemerkt ' + JSON.stringify(saved));
  // Slicen → neuer Tab mit V3D Slicer
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), p.click('#dv-slice')]);
  await pop.waitForURL(/cad=1/, { timeout: 60000 });
  const url = pop.url();
  ok(/vendor=Snapmaker/.test(url) && /autoslice=1/.test(url) && /load=/.test(url), 'Slicer-Tab mit Einstellungen + Modell: ' + url.slice(0, 90) + '…');
  await pop.waitForFunction(() => window._cadApplied, null, { timeout: 120000 });
  const st = await pop.evaluate(() => window._cadDebug());
  ok(st.machine === 'Snapmaker U1 (0.4 nozzle)' && /PETG/.test(st.filament) && /^0\.28/.test(st.process), `Slicer übernimmt: ${st.machine} · ${st.filament} · ${st.process}`);
  ok(JSON.stringify(st.changed).includes('"wall_loops","3"') && JSON.stringify(st.changed).includes('25%') && JSON.stringify(st.changed).includes('tree(auto)'), 'Overrides Wände 3 / 25 % / Baumstützen');
  // echter Slice läuft automatisch → G-Code-Knopf wird frei
  const sliced = await pop.waitForFunction(() => !document.getElementById('btnDownload').disabled, null, { timeout: 240000 }).then(() => true).catch(() => false);
  const stat = await pop.evaluate(() => document.getElementById('status').innerText);
  ok(sliced, 'automatisch gesliced: ' + stat.slice(0, 160).replace(/\n/g, ' '));
  await pop.close();
  // Projekt-3MF direkt aus CAD
  const [pop2] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), p.click('#dv-proj')]);
  const dl = await pop2.waitForEvent('download', { timeout: 180000 }).catch(() => null);
  ok(!!dl, 'Projekt-3MF wird im Slicer-Tab heruntergeladen: ' + (dl && dl.suggestedFilename()));
  if (dl) {
    await dl.saveAs('/tmp/dv_proj.3mf');
    const cfg = JSON.parse(execSync('unzip -p /tmp/dv_proj.3mf Metadata/project_settings.config').toString());
    ok(cfg.printer_settings_id === 'Snapmaker U1 (0.4 nozzle)' && cfg.layer_height === '0.28' && cfg.wall_loops === '3' && cfg.sparse_infill_density === '25%' && cfg.enable_support === '1',
       `Projekt-3MF trägt die Einstellungen: ${cfg.printer_settings_id}, ${cfg.layer_height} mm, ${cfg.wall_loops} Wände, ${cfg.sparse_infill_density}, Stützen ${cfg.support_type}`);
    let prof = ''; try { prof = execSync('unzip -p /tmp/dv_proj.3mf Metadata/layer_heights_profile.txt').toString(); } catch (e) {}
    const pv = (prof.split('|')[1] || '').split(';').map(Number);
    ok(/^object_id=1\|/.test(prof) && Math.abs(pv[pv.length - 2] - 20) < 0.01, 'Projekt-3MF trägt die variable Schichthöhe (Profil bis 20 mm): ' + prof.slice(0, 60));
  }
  ok(errs.length === 0, 'keine Seitenfehler in CAD ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
