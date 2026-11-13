// Test: kak3mfMehrplatten → 3 Platten in EINER 3MF, geprüft mit dem Bambu-Studio-CLI (02.08.02.61, H2C-Profil).
// Aufruf: node tests/kak_3mf_test.mjs            (VARIANTE=ohneProjekt|ohneApp|minimal zum Vergleichen)
// Prüft: CLI liest 3 Platten, slict alle 3 (plate_1..3.gcode), jedes Objekt liegt auf seiner Platte
// (Objektname im G-Code der richtigen Platte + Plattenzuordnung in der Ausgabe-3MF), Gruppe = 1 Objekt mit 2 Teilen/2 Extrudern.
import { createRequire } from 'module';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const fflate = require('fflate');
const { kak3mfMehrplatten, kakPlattenUrsprung } = require('../tools/kamin-adventskalender/kak_3mf.js');

const BS = path.join(process.env.HOME, 'tools/bambustudio');
const PROF = '/tmp/bs-profile';
const OUT3MF = '/tmp/kak_test.3mf', OUTDIR = '/tmp/kak_test_out';
const BETT = [330, 320, 325];                                     // H2C printable_area 0..330 × 0..320
const VAR = process.env.VARIANTE || 'standard';
let fehler = 0;
const ok = (b, msg) => { console.log((b ? '  ✔ ' : '  ✘ ') + msg); if (!b) fehler++; };

function quader(x0, y0, z0, sx, sy, sz) {
  const v = new Float32Array([x0, y0, z0, x0 + sx, y0, z0, x0 + sx, y0 + sy, z0, x0, y0 + sy, z0,
    x0, y0, z0 + sz, x0 + sx, y0, z0 + sz, x0 + sx, y0 + sy, z0 + sz, x0, y0 + sy, z0 + sz]);
  const t = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { vert: v, tri: t };
}
const ROT = '#C0392B', WEISS = '#F5F5F5';
const platten = [
  { name: 'Turm', teile: [
    { name: 'WuerfelA', hex: ROT, ...quader(40, 40, 0, 30, 30, 20) },
    { name: 'Stein1', hex: ROT, gruppe: 'Stein1', ...quader(200, 150, 0, 40, 20, 3) },
    { name: 'Zahl1', hex: WEISS, gruppe: 'Stein1', ...quader(210, 155, 3, 20, 10, 0.6) }] },
  { name: 'Sockel', teile: [
    { name: 'WuerfelB', hex: WEISS, ...quader(100, 100, 0, 25, 25, 15) },
    { name: 'WuerfelC', hex: ROT, ...quader(250, 250, 0, 20, 20, 10) }] },
  { name: 'Steine', teile: [
    { name: 'Stein3', hex: ROT, gruppe: 'Stein3', ...quader(150, 60, 0, 40, 20, 3) },
    { name: 'Zahl3', hex: WEISS, gruppe: 'Stein3', ...quader(160, 65, 3, 20, 10, 0.6) }] },
];
// erwartet: Objektname → Platte (1-basiert)
const SOLL = { WuerfelA: 1, Stein1: 1, WuerfelB: 2, WuerfelC: 2, Stein3: 3 };
// erwartete XY-Box je Objekt in Plattenkoordinaten (= Eingabe, Gruppen-Box = Box aller Teile)
const BOX = { WuerfelA: [40, 40, 70, 70], Stein1: [200, 150, 240, 170], WuerfelB: [100, 100, 125, 125], WuerfelC: [250, 250, 270, 270], Stein3: [150, 60, 190, 80] };

// Profile wie slice.sh (H2C, Textured PEI, Reinigungsturm erreichbar, 2× ASA)
if (!fs.existsSync(PROF + '/process.json')) {
  fs.mkdirSync(PROF, { recursive: true });
  execFileSync('python3', [BS + '/flatten.py'], { cwd: PROF });
  execFileSync('python3', ['-c', `import json
p=json.load(open('process.json')); p['curr_bed_type']='Textured PEI Plate'; p['wipe_tower_x']=['250']; p['wipe_tower_y']=['240']; json.dump(p,open('process.json','w'),indent=1)
a=json.load(open('asa.json'))
for fn,c in [('asa_blau.json','#0078FF'),('asa_weiss.json','#F5F5F5')]:
    e=dict(a); e['filament_colour']=[c]; json.dump(e,open(fn,'w'),indent=1)`], { cwd: PROF });
}

const opt = { fflate, bett: BETT, titel: 'kak_test' };
if (VAR === 'ohneApp') opt.app = null;
if (VAR !== 'ohneApp' && VAR !== 'ohneProjekt') {
  // Projekt-Einstellungen: vollständige project_settings.config, wie das Bambu-CLI sie selbst schreibt
  // (einmal einen Würfel slicen und die Einstellungen aus dessen Ausgabe-3MF nehmen). In der App: _bbsProjekt(…).settings.
  const REF = '/tmp/kak_ref/platte.gcode.3mf';
  if (!fs.existsSync(REF)) {
    const V = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
    const T = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
    fs.writeFileSync('/tmp/kak_cube.stl', 'solid c\n' + T.map(t => 'facet normal 0 0 0\nouter loop\n' + t.map(i => `vertex ${V[i].join(' ')}\n`).join('') + 'endloop\nendfacet\n').join('') + 'endsolid c\n');
    execFileSync(BS + '/slice.sh', ['/tmp/kak_ref', '/tmp/kak_cube.stl'], { stdio: 'ignore', timeout: 240000 });
  }
  let ps = JSON.parse(fflate.strFromU8(fflate.unzipSync(fs.readFileSync(REF))['Metadata/project_settings.config']));
  ps.filament_colour = [ROT, WEISS];
  if (VAR === 'minimal') {                                        // nur, was das CLI beim Laden zwingend liest
    const KEYS = (process.env.KEYS || 'printer_settings_id,print_settings_id,printer_model,filament_settings_id,nozzle_diameter,filament_colour,version').split(',');
    ps = Object.fromEntries(KEYS.filter(k => k in ps).map(k => [k, ps[k]]));
  }
  opt.projectSettings = ps;
}
const zip = kak3mfMehrplatten(platten, opt);
fs.writeFileSync(OUT3MF, zip);
console.log(`3MF (${VAR}): ${OUT3MF}, ${zip.length} Byte, Filamente ${zip.legende.join(' ')}${zip.warnungen.length ? ', Warnungen: ' + zip.warnungen.join('; ') : ''}`);

// eigene Datei prüfen
{
  const f = fflate.unzipSync(zip), model = fflate.strFromU8(f['3D/3dmodel.model']), cfg = fflate.strFromU8(f['Metadata/model_settings.config']);
  ok((cfg.match(/<plate>/g) || []).length === 3, '3 <plate>-Blöcke in model_settings.config');
  ok((model.match(/<item /g) || []).length === 5, '5 Build-Items (Gruppen = 1 Objekt)');
  const o2 = kakPlattenUrsprung(1, 3, BETT), o3 = kakPlattenUrsprung(2, 3, BETT);
  ok(o2[0] === 396 && o2[1] === 0 && o3[0] === 0 && o3[1] === -384, `Raster: Platte 2 @ ${o2}, Platte 3 @ ${o3} (2 Spalten, Abstand ×1,2)`);
}

// Bambu-CLI: alle Platten slicen, NICHT anordnen
fs.rmSync(OUTDIR, { recursive: true, force: true }); fs.mkdirSync(OUTDIR, { recursive: true });
const t0 = Date.now();
const r = spawnSync(BS + '/squashfs-root/bin/bambu-studio', ['--debug', '2', '--arrange', '0', '--slice', '0',
  '--load-settings', `${PROF}/machine.json;${PROF}/process.json`, '--load-filaments', `${PROF}/asa_blau.json;${PROF}/asa_weiss.json`,
  '--outputdir', OUTDIR, '--export-3mf', 'aus.gcode.3mf', OUT3MF], {
  env: { ...process.env, LD_LIBRARY_PATH: `${BS}/squashfs-root/bin:${BS}/libs/usr/lib/x86_64-linux-gnu`, LC_ALL: 'C' },
  encoding: 'utf8', timeout: 240000, maxBuffer: 64 << 20 });
console.log(`CLI: Exit ${r.status}${r.signal ? ' Signal ' + r.signal : ''}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
let res = {};
try { res = JSON.parse(fs.readFileSync(OUTDIR + '/result.json', 'utf8')); } catch (e) { console.log((r.stderr || '').slice(-2000)); }
console.log('result.json:', JSON.stringify({ return_code: res.return_code, error_string: res.error_string,
  sliced_plates: (res.sliced_plates || []).map(s => ({ id: s.id, min: +(s.total_predication / 60).toFixed(1), objekte: (s.objects || []).map(o => o.name) })) }));
ok(r.status === 0 && res.return_code === 0, 'CLI ohne Fehler');
ok((res.sliced_plates || []).length === 3, `3 Platten geslict (result.json: ${(res.sliced_plates || []).length})`);

const ausP = OUTDIR + '/aus.gcode.3mf';
if (fs.existsSync(ausP)) {
  const f = fflate.unzipSync(fs.readFileSync(ausP));
  const gcodes = Object.keys(f).filter(k => /^Metadata\/plate_\d+\.gcode$/.test(k)).sort();
  ok(gcodes.length === 3, `G-Code-Dateien in der Ausgabe: ${gcodes.join(', ')}`);
  // Objekt → Platte + Lage: Bambu schreibt je Platte Metadata/plate_N.json mit Objektnamen und Box in PLATTENkoordinaten
  const lage = {};
  for (const g of gcodes) {
    const nr = +g.match(/plate_(\d+)/)[1], j = JSON.parse(fflate.strFromU8(f[`Metadata/plate_${nr}.json`]));
    for (const o of j.bbox_objects || []) lage[o.name] = { nr, bbox: o.bbox.map(v => +v.toFixed(2)) };
  }
  for (const [name, soll] of Object.entries(SOLL)) {
    const L = lage[name], dx = L ? Math.max(...L.bbox.map((v, i) => Math.abs(v - BOX[name][i]))) : 99;
    ok(L && L.nr === soll && dx < 0.05, `${name}: geslict auf Platte ${L ? L.nr : '–'} (soll ${soll}), Box ${L ? L.bbox.join('/') : '–'} (soll ${BOX[name].join('/')})`);
  }
  // Plattenzuordnung + Namen in der Ausgabe-3MF
  const cfg = fflate.strFromU8(f['Metadata/model_settings.config']);
  const objName = {}; for (const m of cfg.matchAll(/<object id="(\d+)">\s*<metadata key="name" value="([^"]*)"/g)) objName[m[1]] = m[2];
  const plates = [...cfg.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map(m => ({
    name: (m[1].match(/key="plater_name" value="([^"]*)"/) || [])[1],
    obj: [...m[1].matchAll(/key="object_id" value="(\d+)"/g)].map(x => objName[x[1]]) }));
  console.log('Ausgabe-3MF Platten:', JSON.stringify(plates));
  ok(plates.map(p => p.name).join('|') === 'Turm|Sockel|Steine', 'Plattennamen erhalten');
  for (const [name, soll] of Object.entries(SOLL)) ok(plates[soll - 1] && plates[soll - 1].obj.includes(name), `${name} in <plate> ${soll}`);
  // Gruppe: Stein1 = 1 Objekt, 2 Teile, Zahl auf Extruder 2
  const st = cfg.match(/<object id="\d+">\s*<metadata key="name" value="Stein1"\/>([\s\S]*?)<\/object>/);
  const parts = st ? [...st[1].matchAll(/<part id="\d+"[\s\S]*?key="name" value="([^"]*)"[\s\S]*?key="extruder" value="(\d+)"/g)].map(m => m[1] + ':' + m[2]) : [];
  ok(parts.length === 2 && parts.includes('Zahl1:2'), `Stein1 = ein Objekt mit Teilen ${parts.join(', ')}`);
  // Zahl-Farbe wirklich gedruckt: Platte 1 nutzt 2 Filamente
  const p1 = (res.sliced_plates || []).find(s => s.id === 1);
  ok(p1 && p1.filaments && p1.filaments.length === 2, `Platte 1 druckt ${p1 && p1.filaments ? p1.filaments.length : '?'} Filamente`);
} else ok(false, 'Ausgabe-3MF fehlt');

console.log(fehler ? `\n${fehler} Fehler` : '\nalles grün');
process.exit(fehler ? 1 : 0);
