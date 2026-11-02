// Regressionstest 📐 Ohne Stützen (_ohf*) + 💾 3MF speichern mit Druck-Check und
// Bambu-Projekt (_3mfSpeichern/_bbsProjekt, v1.18.303).
//   1. T-Teil (Säule 20³ + Platte 40×40×4 oben): Schräge ≈ 5,33 cm³ (Pyramidenstumpf
//      40→20 auf 10 mm Höhe), Ergebnis wasserdicht, danach nichts mehr zu füllen
//   2. Würfel: nichts zu füllen
//   3. echter Weg: Druck-Check → „📐 Ohne Stützen" → Vorschau → Übernehmen
//   4. 3MF über den Speichern-Dialog: Druck-Check-Fenster, Bambu-Abschnitt, Download
//      = BambuStudio-Kennung + vollständige project_settings + Plattenmitte
//   5. Bambu Studio CLI (falls vorhanden) slict die 3MF OHNE --load-settings, also
//      nur mit den eingebetteten Einstellungen (= Projekt erkannt, nicht „nur Geometrie")
// Start: python3 volme3d_server.py 8874 --dev  →  node tests/ohne_stuetzen_3mf_test.mjs
import { chromium } from 'playwright';
import { writeFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { inflateRawSync } from 'zlib';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8874/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _ohfOpen === 'function' && typeof _mfInit === 'function' && window.V3D_DRUCKCHECK, { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
await pg.evaluate(async () => {
  await _mfInit();
  window.__mess = (o) => {
    const t = _ohfTris(o), n = t.length / 9;
    const key = (i) => Math.round(t[i] * 1e3) + ',' + Math.round(t[i + 1] * 1e3) + ',' + Math.round(t[i + 2] * 1e3);
    const kanten = new Map(); let vol = 0;
    for (let f = 0; f < n; f++) {
      const o9 = f * 9, k = [key(o9), key(o9 + 3), key(o9 + 6)];
      for (let j = 0; j < 3; j++) { const a = k[j], c = k[(j + 1) % 3]; if (a === c) continue; const e = a < c ? a + '|' + c : c + '|' + a; kanten.set(e, (kanten.get(e) || 0) + 1); }
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.subarray(o9, o9 + 9);
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    let offen = 0; for (const v of kanten.values()) if (v !== 2) offen++;
    return { vol, offen };
  };
  // T-Teil als Import: Säule 20×20×20 + Platte 40×40×4 darauf (mm, Z oben)
  window.__tTeil = async () => {
    const w = await _mfInit(), M = w.Manifold;
    const m = M.union(M.cube([20, 20, 20]).translate([-10, -10, 0]), M.cube([40, 40, 4]).translate([-20, -20, 20]));
    const mesh = _meshFromStlB64(_bufToBase64(_mfToStlBuf(m)), 'T-Teil', true);
    mesh.userData.color = '#e05050'; mesh.material.color.set('#e05050');
    updateTree(); return mesh;
  };
});

// 1. Kern auf dem T-Teil
const r1 = await pg.evaluate(async () => {
  _newCreate(false);
  const o = await __tTeil();
  const R = _ohfRechne(_ohfTris(o));
  const w = await _mfInit(), mf = _ohfKoerper(w, R);
  const vSchraege = mf ? mf.volume() : 0; mf && mf.delete();
  return { n: R.n, h: R.h, volZellen: R.volMm3, vSchraege, saeule: R.saeule, vor: __mess(o) };
});
ok('T-Teil: Zellen-Schräge ≈ 5333 mm³', Math.abs(r1.volZellen - 5333) < 700, Math.round(r1.volZellen));
ok('T-Teil: keine Säulen', r1.saeule === 0, r1.saeule);
ok('T-Teil vorher wasserdicht, 14400 mm³', r1.vor.offen === 0 && Math.abs(r1.vor.vol - 14400) < 1, r1.vor);

// 2. Würfel: nichts
const r2 = await pg.evaluate(async () => {
  _newCreate(false); addShape('box'); const o = objects[0]; o.updateMatrixWorld(true);
  const R = _ohfRechne(_ohfTris(o)); const w = await _mfInit(); const mf = _ohfKoerper(w, R);
  const r = { n: R.n, koerper: !!mf }; mf && mf.delete(); return r;
});
ok('Würfel: nichts zu füllen', !r2.koerper, r2);

// 3. echter Weg über den Druck-Check
await pg.evaluate(async () => { _newCreate(false); await __tTeil(); selectObjs([]); _printCheckOpen(); });
await pg.waitForSelector('#printcheck-modal.show');
const knopf = pg.locator('#printcheck-body button', { hasText: 'Ohne Stützen' });
ok('Druck-Check zeigt „📐 Ohne Stützen"', await knopf.count() === 1, await knopf.count());
await knopf.click();
await pg.waitForSelector('#ohf-panel', { timeout: 60000 });
const r3a = await pg.evaluate(() => ({ ghost: !!(_ohf && _ohf.ghost), text: document.getElementById('ohf-panel').innerText, rot: _pcOhVis.length }));
ok('Vorschau blau + rote Stellen + Volumen', r3a.ghost && r3a.rot > 0 && /\+\s*5[,.]\d cm³/.test(r3a.text), r3a.text.replace(/\s+/g, ' ').slice(0, 160));
await pg.click('#ohf-ok');
await pg.waitForFunction(() => !_ohf && objects.length === 1 && objects[0].userData.ohneStuetzen === 45, { timeout: 60000 });
await pg.waitForSelector('#printcheck-modal.show', { timeout: 10000 });
const r3 = await pg.evaluate(async () => {
  const o = objects[0]; o.updateMatrixWorld(true);
  const m = __mess(o), R = _ohfRechne(_ohfTris(o)); const w = await _mfInit(); const mf = _ohfKoerper(w, R);
  const rest = mf ? mf.volume() : 0; mf && mf.delete();
  return { m, rest, ghostWeg: !scene.children.some(c => c.isGroup && c.children.some(x => x.material && x.material.color && x.material.color.getHex() === 0x2f7cf6)), modal: document.getElementById('printcheck-modal').classList.contains('show') };
});
ok('nach Übernehmen wasserdicht', r3.m.offen === 0, r3.m.offen);
ok('Volumen ≈ 14400 + 5333', Math.abs(r3.m.vol - 19733) < 800, Math.round(r3.m.vol));
ok('danach nichts mehr zu füllen (< 0,1 cm³)', r3.rest < 100, Math.round(r3.rest));
ok('Vorschau weg, Druck-Check wieder offen', r3.ghostWeg && r3.modal, r3);
await pg.evaluate(() => _printCheckClose());

// 4. 3MF über den Speichern-Dialog (zwei Farben → zwei Filamente)
await pg.evaluate(async () => {
  localStorage.setItem('v3d_3mf_pruefen', '1'); localStorage.setItem('v3d_3mf_projekt', '1');
  localStorage.setItem('v3d_3mf_bambu', JSON.stringify({ machine: 'Bambu Lab X1 Carbon 0.4 nozzle', ftype: 'PLA', lh: '0.2' }));
  _newCreate(false);
  addShape('box'); const a = objects[0]; a.userData.color = '#ff0000'; a.material.color.set('#ff0000');
  addShape('box'); const c = objects[1]; c.position.x += 3; c.userData.color = '#0000ff'; c.material.color.set('#0000ff'); c.updateMatrixWorld(true);
  selectObjs([]);
  _3mfSpeichern();
});
await pg.waitForSelector('#printcheck-modal.show');
await pg.waitForFunction(() => document.getElementById('b3-check') && /V3D Druckcheck/.test(document.getElementById('b3-check').innerText), { timeout: 60000 });
const r4a = await pg.evaluate(() => ({ titel: document.getElementById('printcheck-hd').innerText, wahl: document.getElementById('b3-wahl').innerText, check: document.getElementById('b3-check').innerText.slice(0, 400), save: !!document.getElementById('b3-save') }));
ok('Speichern-Dialog: Titel, Bambu-Wahl, V3D Druckcheck, Knopf', /3MF speichern/.test(r4a.titel) && /X1 Carbon/.test(r4a.wahl) && r4a.save, r4a);
const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('#b3-save')]);
mkdirSync('/tmp/v3d-3mf-test', { recursive: true });
const datei = '/tmp/v3d-3mf-test/projekt.3mf';
await dl.saveAs(datei);
// Zip lesen (zentrales Verzeichnis)
function unzip(buf) {
  const out = {}; let e = buf.length - 22; while (buf.readUInt32LE(e) !== 0x06054b50) e--;
  let p = buf.readUInt32LE(e + 16); const n = buf.readUInt16LE(e + 10);
  for (let i = 0; i < n; i++) {
    const meth = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), d = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + cs);
    out[name] = (meth === 8 ? inflateRawSync(d) : d).toString('utf8');
    p += 46 + nl + xl + cl;
  }
  return out;
}
const z = unzip(readFileSync(datei));
const ps = z['Metadata/project_settings.config'] ? JSON.parse(z['Metadata/project_settings.config']) : null;
ok('3MF: BambuStudio-Kennung', /<metadata name="Application">BambuStudio-/.test(z['3D/3dmodel.model'] || ''));
ok('3MF: project_settings vollständig (> 400 Schlüssel)', ps && Object.keys(ps).length > 400, ps && Object.keys(ps).length);
ok('3MF: Profilnamen X1C/PLA', ps && ps.printer_settings_id === 'Bambu Lab X1 Carbon 0.4 nozzle' && /^0\.20mm Standard @BBL X1C$/.test(ps.print_settings_id) && ps.filament_settings_id.length === 2 && /Bambu PLA Basic @BBL X1C/.test(ps.filament_settings_id[0]), ps && [ps.printer_settings_id, ps.print_settings_id, ps.filament_settings_id]);
ok('3MF: 2 Filamentfarben, Spalten passend', ps && ps.filament_colour.length === 2 && ps.nozzle_temperature.length === 2 && ps.inherits_group.length === 4 && ps.different_settings_to_system.length === 4, ps && [ps.filament_colour, ps.different_settings_to_system]);
const tr = /<item objectid="\d+" transform="([^"]+)"/.exec(z['3D/3dmodel.model'] || '');
const t = tr ? tr[1].split(' ').map(Number) : [];
ok('3MF: Modell auf Plattenmitte (X1C 128/128)', t.length === 12 && Math.abs(t[9] - 128) < 30 && Math.abs(t[10] - 128) < 30, t.slice(9));
ok('3MF: Teile mit Extruder 1 und 2 + Platte', /key="extruder" value="2"/.test(z['Metadata/model_settings.config'] || '') && /<plate>/.test(z['Metadata/model_settings.config'] || ''));

// 4b. Druckcheck-Vorschlag landet in der Datei: T-Teil ohne Stützen → „Stützen an"
const r4b = await pg.evaluate(async () => {
  _newCreate(false); await __tTeil();
  const p0 = Object.assign({}, _dv.p); _dv.p.support = 'aus';
  const src = _exportSrc(), farben = _b3Farben(src), w = { machine: 'Bambu Lab X1 Carbon 0.4 nozzle', ftype: 'PLA', lh: '0.2' };
  const pr = _bbsProjekt(w, farben, []);
  const bef = V3D_DRUCKCHECK.checkSettings(pr.settings, { models: _b3Modelle(src), usedFilaments: [0] }).filter(f => (f.fixes || []).length);
  const fixes = bef.flatMap(f => f.fixes);
  const pr2 = _bbsProjekt(w, farben, fixes);
  Object.assign(_dv.p, p0);
  return { titel: bef.map(f => f.title), fixes: fixes.map(x => x.key + '=' + x.value), diff: pr2.settings.different_settings_to_system, sup: pr2.settings.enable_support };
});
ok('Druckcheck: Vorschläge für das T-Teil', r4b.fixes.length > 0, r4b.titel);
ok('Druckcheck-Fixes stehen in project_settings + different_settings_to_system', r4b.diff[0].length > 0 && r4b.fixes.every(f => { const k = f.split('=')[0]; return k === 'curr_bed_type' || r4b.diff.join(';').split(';').includes(k); }), r4b);

// 5. Bambu Studio CLI: slicen NUR mit den eingebetteten Einstellungen
const BS = process.env.HOME + '/tools/bambustudio';
if (existsSync(BS + '/squashfs-root/bin/bambu-studio')) {
  const outd = '/tmp/v3d-3mf-test/out'; rmSync(outd, { recursive: true, force: true }); mkdirSync(outd, { recursive: true });
  let log = '';
  try {
    log = execFileSync(BS + '/squashfs-root/bin/bambu-studio', ['--slice', '0', '--outputdir', outd, '--export-3mf', 'o.gcode.3mf', datei],
      { env: { ...process.env, LD_LIBRARY_PATH: BS + '/squashfs-root/bin:' + BS + '/libs/usr/lib/x86_64-linux-gnu', LC_ALL: 'C' }, timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (e) { log = String(e.stdout || '') + String(e.stderr || '') + e.message; }
  let res = null; try { res = JSON.parse(readFileSync(outd + '/result.json', 'utf8')); } catch (e) {}
  ok('Bambu CLI slict mit den eingebetteten Einstellungen', res && res.return_code === 0 && (res.sliced_plates || []).length === 1, res ? [res.return_code, res.error_string] : log.slice(-400));
  if (res && res.return_code === 0) {
    const g = unzip(readFileSync(outd + '/o.gcode.3mf'));
    const gc = g['Metadata/plate_1.gcode'] || '';
    ok('G-Code: X1C, 0,2 mm, 2 Filamente', /; printer_model = Bambu Lab X1 Carbon/.test(gc) && /; layer_height = 0\.2\b/.test(gc) && (res.sliced_plates[0].filaments || []).length === 2,
      [(/; printer_model = .*/.exec(gc) || [''])[0], (/; layer_height = .*/.exec(gc) || [''])[0], (res.sliced_plates[0].filaments || []).length]);
  }
} else console.log('  (Bambu Studio CLI fehlt – Schritt 5 übersprungen)');

ok('keine Seitenfehler', !errs.length, errs.slice(0, 3));
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
