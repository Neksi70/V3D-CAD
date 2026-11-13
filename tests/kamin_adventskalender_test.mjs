// Kamin-Adventskalender (🧱 _kak*) im Browser gegen den Testserver (--dev):
// Menü → Vorschau → Prüfungen (Tage > Schlitze sperrt) → In Szene (Teile je Farbe) → STL-Export (Dateiliste, dicht)
// → 3MF mit Druckplatten (SV08 Max/Orca-Profil, H2C/Bambu-Profil) → H2C teilt den Turm → gen.run über _GEN_EXT → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import * as fflate from '/home/v3da/node_modules/fflate/esm/index.mjs';
const PORT = 18821;
const srv = spawn('python3', ['kamin-test-server.py', String(PORT), '--dev'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1800));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d-test-kamin.html`);
  await p.waitForFunction(() => typeof _kakOpen === 'function' && typeof objects !== 'undefined', null, { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Kamin-Adventskalender').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click(); await p.waitForSelector('#kak-modal.show');
  await p.waitForFunction(() => window._threeFont_helvetiker_bold, null, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => _gpv['kak'] && _gpv['kak'].group, null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!(_gpv['kak'] && _gpv['kak'].group)), 'Vorschau steht');
  const ui = await p.evaluate(() => { const c = document.querySelector('#kak-modal .g3ctrl'), sichtbar = [...c.querySelectorAll('input,select,textarea')].filter(e => e.offsetParent && !e.closest('details')).length;
    const ohneTip = [...c.querySelectorAll('input,select')].filter(e => !e.title && !(e.closest('label') && e.closest('label').title)).map(e => e.id); return { sichtbar, ohneTip, info: document.getElementById('kak-info').textContent }; });
  ok(ui.sichtbar <= 6 && ui.ohneTip.length === 0, `Einsteigeransicht ${ui.sichtbar} Felder, Tooltips an allen Feldern ${ui.ohneTip.join(',')}`);
  ok(/6 Blindsteine/.test(ui.info) && /Gesamt: 192 × 147/.test(ui.info), 'Zusammenfassung: ' + ui.info.slice(0, 160));
  const gesperrt = await p.evaluate(() => { _kakSet('tage', 31); const r = { sp: document.getElementById('kak-stl').disabled, t: document.getElementById('kak-info').textContent }; _kakSet('tage', 24); return { ...r, frei: !document.getElementById('kak-stl').disabled }; });
  ok(gesperrt.sp && gesperrt.frei && /Mehr Tage/.test(gesperrt.t), 'Tage > Schlitze: Hinweis + Export gesperrt, danach wieder frei');
  await p.evaluate(() => _kakStr('name_txt', 'FAMILIE ISKEN'));
  const sz = await p.evaluate(async () => { const t0 = performance.now(); await _kakSzene(); return { ms: performance.now() - t0, n: objects.map(o => o.userData.name), y0: Math.min(...objects.map(o => getMeshBox(o).min.y)) }; });
  ok(sz.n.length === 7 && Math.abs(sz.y0) < 0.01, `In Szene: ${sz.n.join(', ')} (${(sz.ms / 1000).toFixed(1)} s)`);
  // STL-Export abfangen
  const ex = await p.evaluate(async () => { let files = null; const alt = window._saveExportMany; window._saveExportMany = async f => { files = f; return { wrote: true, dir: 'Test' }; };
    try { _kakOpen(); await _kakExportStl(); } finally { window._saveExportMany = alt; }
    const w = await _mfInit(), out = { namen: files.map(f => f.name), dicht: 0, bb: {} };
    for (const f of files) { const buf = await f.blob.arrayBuffer(), dv = new DataView(buf), n = dv.getUint32(80, true), E = new Map(), key = (o) => [0, 4, 8].map(j => dv.getFloat32(o + j, true).toFixed(4)).join(',');
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (let t = 0; t < n; t++) { const o = 84 + t * 50 + 12, v = [key(o), key(o + 12), key(o + 24)];
        for (let j = 0; j < 3; j++) { const a = v[j], c = v[(j + 1) % 3], kk = a < c ? a + '|' + c : c + '|' + a; E.set(kk, (E.get(kk) || 0) + 1);
          const xx = dv.getFloat32(o + j * 12, true), yy = dv.getFloat32(o + j * 12 + 4, true), zz = dv.getFloat32(o + j * 12 + 8, true);
          x0 = Math.min(x0, xx); y0 = Math.min(y0, yy); z0 = Math.min(z0, zz); x1 = Math.max(x1, xx); y1 = Math.max(y1, yy); z1 = Math.max(z1, zz); } }
      if ([...E.values()].every(c => c === 2)) out.dicht++;
      out.bb[f.name] = [x1 - x0, y1 - y0, z1 - z0].map(v => +v.toFixed(2)).concat([+z0.toFixed(3)]); }
    return out; });
  const erwartet = ['feuerstelle.stl', 'name.stl', 'turm.stl', 'kaminkrone.stl', 'kaminkrone_aufsatz.stl', 'blindstein.stl', 'tag_01_stein.stl', 'tag_01_zahl.stl', 'tag_24_stein.stl', 'tag_24_zahl.stl'];
  ok(ex.namen.length === 54 && erwartet.every(n => ex.namen.includes(n)), `STL-Export: ${ex.namen.length} Dateien (${ex.namen.slice(0, 7).join(', ')} …)`);
  ok(ex.dicht === ex.namen.length, `alle ${ex.dicht}/${ex.namen.length} STL geschlossen (jede Kante 2×)`);
  ok(Object.entries(ex.bb).every(([n, b]) => /name|zahl/.test(n) || Math.abs(b[3]) < 0.01) && Math.abs(ex.bb['turm.stl'][2] - 430) < 0.05 && Math.abs(ex.bb['tag_01_stein.stl'][2] - 12.8) < 0.05,
     `Druckorientierung: alles auf z = 0 (Name/Zahlen in derselben Lage wie Feuerstelle/Stein), Turm ${ex.bb['turm.stl'].slice(0, 3).join('×')}, Stein ${ex.bb['tag_01_stein.stl'].slice(0, 3).join('×')}, Krone ${ex.bb['kaminkrone.stl'].slice(0, 3).join('×')}`);
  // 3MF mit Druckplatten: Blob abfangen, in Node entpacken
  const hol3mf = dr => p.evaluate(async (dr) => { _kakStr('drucker', dr); let blob = null; const alt = window._saveExport; window._saveExport = async bl => { blob = bl; return { wrote: true, dir: 'Test' }; };
    try { await _kakExport3mf(); } finally { window._saveExport = alt; _kakStr('drucker', 'sv08max'); }
    return blob && await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); }); }, dr);
  for (const [dr, soll, masch] of [['sv08max', 'Feuerstelle|Turm|Krone|Blindsteine|Tagessteine 1|Tagessteine 2', /SV08 MAX/], ['h2c', 'Feuerstelle|Turm|Krone|Blindsteine|Tagessteine 1|Tagessteine 2|Tagessteine 3|Tagessteine 4|Tagessteine 5|Tagessteine 6', /H2C/]]) {
    const b64 = await hol3mf(dr); if (!b64) { ok(false, `3MF ${dr}: keine Datei`); continue; }
    const z = fflate.unzipSync(Buffer.from(b64, 'base64')), cfg = fflate.strFromU8(z['Metadata/model_settings.config']), ps = JSON.parse(fflate.strFromU8(z['Metadata/project_settings.config']));
    const namen = [...cfg.matchAll(/key="plater_name" value="([^"]*)"/g)].map(m => m[1]).join('|');
    const tag1 = cfg.match(/value="tag1"\/>([\s\S]*?)<\/object>/), ext = tag1 ? [...tag1[1].matchAll(/key="extruder" value="(\d+)"/g)].map(m => m[1]).join(',') : '';
    const farb = (ps.filament_colour || []).join(','), model = fflate.strFromU8(z['3D/3dmodel.model']);
    ok(namen === soll && masch.test(ps.printer_settings_id || '') && ext === '4,4,2' && farb === '#B5563A,#2D4A3E,#D9CFC0,#E8E1D4,#9A8F80' && /<metadata name="Application">BambuStudio-/.test(model) && (ps.wipe_tower_x || []).length === soll.split('|').length,
       `3MF ${dr}: Platten ${namen.split('|').length} (${namen}), Profil ${ps.printer_settings_id}, Tag 1 Stein/Zahl Extruder ${ext}`);
  }
  const h2c = await p.evaluate(async () => { _kakStr('drucker', 'h2c'); let files = null; const alt = window._saveExportMany; window._saveExportMany = async f => { files = f; return { wrote: true, dir: 'Test' }; };
    try { await _kakExportStl(); } finally { window._saveExportMany = alt; _kakStr('drucker', 'sv08max'); } return files.map(f => f.name).filter(n => /^turm/.test(n)); });
  ok(h2c.length === 2 && h2c[0] === 'turm_1von2.stl', 'H2C: Turm geteilt → ' + h2c.join(', '));
  const gr = await p.evaluate(async () => { _newCreate(false); const ids = await window._GEN_EXT['kamin-adventskalender'].run({ tage: 12, slots: 16, schacht: 80 }); return { ids: ids.length, n: objects.length }; });
  ok(gr.ids === 6 && gr.n === 6, `gen.run (12 Tage, 16 Schlitze, Schacht 80): ${gr.ids} Teile`);
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
