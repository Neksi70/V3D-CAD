// 💾 3MF speichern als Slicer-Projekt für die Orca-Ableger (v1.18.366, Volker 11.11.):
// Slicer „Anycubic Slicer Next“ → Hersteller Anycubic, Drucker Kobra 3, PETG, 0,16 mm.
//   1. Dialog zeigt Slicer + Hersteller + Anycubic-Drucker, Hersteller-Wechsel lädt dessen Drucker
//   2. Download: Projekt-Kennung BambuStudio-02.03 (Orca lädt bis 2.3.2 ohne Bambu-Hinweis),
//      vollständige project_settings mit Anycubic-Profilnamen, Plattenmitte des Kobra 3
//   3. echter OrcaSlicer 2.4.2 (Docker, ~/tools/orcaslicer/orca.sh) slict NUR mit den eingebetteten
//      Einstellungen → G-Code für Kobra 3 mit 0,16 mm (= als Projekt erkannt)
// Start: python3 volme3d_server.py 8874 --dev  →  node tests/slicer_projekt_3mf_test.mjs
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { inflateRawSync } from 'zlib';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8874/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
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
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _3mfSpeichern === 'function' && window.V3D_DRUCKCHECK, { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden');
  localStorage.setItem('v3d_3mf_pruefen', '1'); localStorage.setItem('v3d_3mf_projekt', '1');
  localStorage.setItem('v3d_3mf_bambu', JSON.stringify({ slicer: 'anycubic', machine: 'Anycubic Kobra 3 0.4 nozzle', ftype: 'PETG', lh: '0.16' }));
  _newCreate(false); addShape('box'); selectObjs([]);
  _3mfSpeichern();
});
await pg.waitForSelector('#printcheck-modal.show');
await pg.waitForFunction(() => /V3D Druckcheck/.test(document.getElementById('b3-check')?.innerText || ''), { timeout: 60000 });
const r1 = await pg.evaluate(() => {
  const sels = [...document.querySelectorAll('#b3-wahl select')];
  return { felder: [...document.querySelectorAll('#b3-wahl .vrow label')].map(l => l.textContent), werte: sels.map(s => s.selectedOptions[0]?.textContent),
    hersteller: sels[1] ? [...sels[1].options].map(o => o.value) : [] };
});
ok('Dialog: Slicer, Hersteller, Drucker, Filament, Schichthöhe', r1.felder.join('|') === 'Slicer|Hersteller|Drucker|Filament|Schichthöhe', r1.felder);
ok('Auswahl: Anycubic Slicer Next · Anycubic · Kobra 3 · PETG · 0,16', r1.werte[0] === 'Anycubic Slicer Next' && r1.werte[1] === 'Anycubic' && /^Kobra 3 0,4 mm Düse$/.test(r1.werte[2]) && /PETG/.test(r1.werte[3]) && /^0,16 mm/.test(r1.werte[4]), r1.werte);
ok('alle Hersteller wählbar', ['BBL', 'Snapmaker', 'Anycubic', 'Elegoo', 'Prusa', 'Creality'].every(h => r1.hersteller.includes(h)), r1.hersteller);

// Herstellerwechsel → Elegoo-Drucker, dann zurück auf Anycubic Kobra 3
await pg.evaluate(() => _b3Set('vendor', 'Elegoo'));
await pg.waitForFunction(() => /Elegoo/.test(document.getElementById('b3-check')?.innerText || ''), { timeout: 30000 });
const r1b = await pg.evaluate(() => [...document.querySelectorAll('#b3-wahl select')][2].selectedOptions[0].textContent);
ok('Hersteller Elegoo → Elegoo-Drucker', /Centauri|Neptune|OrangeStorm/.test(r1b), r1b);
await pg.evaluate(() => { _b3Set('vendor', 'Anycubic'); });
await pg.waitForFunction(() => /Anycubic/.test(document.getElementById('b3-check')?.innerText || ''), { timeout: 30000 });
await pg.evaluate(() => { _b3Set('machine', 'Anycubic Kobra 3 0.4 nozzle'); });
await pg.waitForFunction(() => /Kobra 3/.test(document.getElementById('b3-check')?.innerText || ''), { timeout: 30000 });
await pg.evaluate(() => { _b3Set('ftype', 'PETG'); });
await pg.waitForFunction(() => /V3D Druckcheck/.test(document.getElementById('b3-check')?.innerText || ''), { timeout: 30000 });
await pg.evaluate(() => { _b3Set('lh', '0.16'); });
await pg.waitForFunction(() => /V3D Druckcheck/.test(document.getElementById('b3-check')?.innerText || ''), { timeout: 30000 });

// 2. Download
const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), pg.click('#b3-save')]);
mkdirSync('/tmp/v3d-sp-test', { recursive: true });
const datei = '/tmp/v3d-sp-test/kobra3.3mf';
await dl.saveAs(datei);
const z = unzip(readFileSync(datei));
const ps = z['Metadata/project_settings.config'] ? JSON.parse(z['Metadata/project_settings.config']) : null;
ok('3MF: Kennung BambuStudio-02.03.00.00', /<metadata name="Application">BambuStudio-02\.03\.00\.00<\/metadata>/.test(z['3D/3dmodel.model'] || ''));
ok('3MF: project_settings vollständig (> 300 Schlüssel)', ps && Object.keys(ps).length > 300, ps && Object.keys(ps).length);
ok('3MF: Anycubic-Profilnamen', ps && ps.printer_settings_id === 'Anycubic Kobra 3 0.4 nozzle' && /^0\.16mm .*@Anycubic Kobra 3/.test(ps.print_settings_id) && /PETG/.test(ps.filament_settings_id[0]) && ps.filament_type[0] === 'PETG',
  ps && [ps.printer_settings_id, ps.print_settings_id, ps.filament_settings_id, ps.filament_type]);
const tr = /<item objectid="\d+" transform="([^"]+)"/.exec(z['3D/3dmodel.model'] || ''); const t = tr ? tr[1].split(' ').map(Number) : [];
const bett = (ps.printable_area || []).map(s => s.split('x').map(Number)); const mx = (Math.min(...bett.map(q => q[0])) + Math.max(...bett.map(q => q[0]))) / 2;
ok('3MF: Modell auf der Plattenmitte des Kobra 3', t.length === 12 && Math.abs(t[9] - mx) < 15, [t.slice(9), mx]);
ok('keine Seitenfehler', !errs.length, errs.slice(0, 3));
await b.close();

// 3. echter OrcaSlicer: nur die eingebetteten Einstellungen
const ORCA = process.env.HOME + '/tools/orcaslicer/orca.sh';
if (existsSync(ORCA) && !process.env.OHNE_ORCA) {
  const outd = '/tmp/v3d-sp-test/out'; rmSync(outd, { recursive: true, force: true }); mkdirSync(outd, { recursive: true });
  let log = '';
  try { log = execFileSync(ORCA, ['--slice', '0', '--outputdir', outd, datei], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { log = String(e.stdout || '') + String(e.stderr || ''); }
  const gc = readdirSync(outd).filter(f => f.endsWith('.gcode'));
  const g = gc.length ? readFileSync(outd + '/' + gc[0], 'utf8') : '';
  ok('OrcaSlicer 2.4.2 slict mit den eingebetteten Einstellungen', gc.length === 1, gc.length ? gc : log.slice(-500));
  ok('G-Code: Kobra 3, 0,16 mm, PETG', /; printer_model = Anycubic Kobra 3\b/.test(g) && /; layer_height = 0\.16\b/.test(g) && /; filament_type = PETG/.test(g),
    [(/; printer_model = .*/.exec(g) || [''])[0], (/; layer_height = .*/.exec(g) || [''])[0], (/; filament_type = .*/.exec(g) || [''])[0]]);
} else console.log('  (OrcaSlicer fehlt – Schritt 3 übersprungen)');
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
