// 1:1-Gegencheck Kamin-Kern ↔ OpenSCAD-Vorlage (~/v3d-generatoren/kamin-adventskalender/v3d_kamin_adventskalender.scad):
// OpenSCAD rendert jedes Teil als STL (Docker openscad/openscad:dev mit Manifold, sonst /usr/bin/openscad),
// Manifold vergleicht mit kakBuild: Volumen, Box und Differenzvolumen (A−B, B−A). Text-Teile (Zahl, Name) nur Box, weil Schrift abweicht.
import Module from '/home/v3da/node_modules/manifold-3d/manifold.js';
import fs from 'fs'; import { spawnSync } from 'child_process';
const SCAD = process.env.HOME + '/v3d-generatoren/kamin-adventskalender/v3d_kamin_adventskalender.scad', TMP = '/tmp/kak_scad';
fs.mkdirSync(TMP, { recursive: true });
const w = await Module(); w.setup();
const K = new Function('module', fs.readFileSync(new URL('../tools/kamin-adventskalender/kak_core.js', import.meta.url), 'utf8') + '; return { KAK_DEF, kakBuild };')(undefined);
const B = K.kakBuild(w, { ...K.KAK_DEF, bogen: 0, schnee: 0 }, null);   // ohne Deko = Form der Vorlage
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const docker = spawnSync('docker', ['image', 'inspect', 'openscad/openscad:dev'], { stdio: 'ignore' }).status === 0;
function scad(part, day = 1) {
  const out = `${TMP}/${part}_${day}_${K.KAK_DEF.margin_t}_${K.KAK_DEF.in_w}x${K.KAK_DEF.in_d}_${K.KAK_DEF.base_w}x${K.KAK_DEF.base_d}.stl`;
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(SCAD).mtimeMs) return out;
  const D = ['margin_t', 'in_w', 'in_d', 'wall', 'base_w', 'base_d', 'base_h', 'open_w', 'open_h'].flatMap(k2 => ['-D', `${k2}=${K.KAK_DEF[k2]}`]);   // Maße wie unser Standard
  const args = ['-o', out, '-D', `part="${part}"`, '-D', `day=${day}`, ...D, '--export-format', 'binstl'];
  const r = docker ? spawnSync('docker', ['run', '--rm', '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${SCAD}:/in.scad:ro`, '-v', `${TMP}:${TMP}`, 'openscad/openscad:dev', 'openscad', '--backend', 'manifold', ...args, '/in.scad'], { encoding: 'utf8', timeout: 900000 })
                   : spawnSync('openscad', [...args, SCAD], { encoding: 'utf8', timeout: 1800000 });
  if (!fs.existsSync(out)) throw new Error(`OpenSCAD ${part}: ${(r.stderr || '').slice(-800)}`);
  return out;
}
function ladeStl(f) {                                                     // Binär-STL → Manifold (Punkte verschweißen)
  const b = fs.readFileSync(f), n = b.readUInt32LE(80), idx = new Map(), V = [], T = new Uint32Array(n * 3);
  for (let t = 0; t < n; t++) for (let j = 0; j < 3; j++) { const o = 84 + t * 50 + 12 + j * 12, p = [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)], key = p.map(v => v.toFixed(4)).join(',');
    let i = idx.get(key); if (i === undefined) { i = V.length / 3; idx.set(key, i); V.push(...p); } T[t * 3 + j] = i; }
  const mesh = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(V), triVerts: T }); mesh.merge();
  return new w.Manifold(mesh);
}
const box = mf => { const b = mf.boundingBox(); return [...b.min, ...b.max]; };
function vergleich(name, unser, part, day, nurBox) {
  let s; try { s = ladeStl(scad(part, day)); } catch (e) { ok(false, `${name}: ${e.message}`); return; }
  const bu = box(unser), bs = box(s), dBox = Math.max(...bu.map((v, i) => Math.abs(v - bs[i])));
  if (nurBox) { ok(dBox < 0.6, `${name}: Box-Abweichung ${dBox.toFixed(2)} mm (nur Box – Schrift Helvetiker statt Liberation)`); return; }
  const vu = unser.volume(), vs = s.volume(), nurU = unser.subtract(s).volume(), nurS = s.subtract(unser).volume(), rel = (nurU + nurS) / vs;
  ok(dBox < 0.02 && rel < 0.002, `${name}: Volumen ${(vu / 1000).toFixed(2)} / ${(vs / 1000).toFixed(2)} cm³ (unser/OpenSCAD), nur bei uns ${(nurU).toFixed(1)} mm³, nur in OpenSCAD ${(nurS).toFixed(1)} mm³ (${(rel * 100).toFixed(3)} %), Box ±${dBox.toFixed(3)} mm`);
}
const t0 = Date.now();
// Turm und Schieber sind seit dem Umbau (Schieber links/rechts, Foto 13.11.) eigene Konstruktion → nur noch Feuerstelle, Krone, Aufsatz gegen die .scad
vergleich('Feuerstelle (ohne Name)', B.base(), 'base');
vergleich('Kaminkrone (Drucklage, Rand oben ' + K.KAK_DEF.margin_t + ')', B.cap_print(), 'cap');
vergleich('Kronen-Aufsatz', B.cap_top(), 'cap_top');
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s, ${docker ? 'OpenSCAD dev + Manifold (Docker)' : '/usr/bin/openscad'})`);
B.aufraeumen();
console.log(fail ? `${fail} Abweichungen` : 'alles grün – Feuerstelle/Krone = OpenSCAD-Vorlage'); process.exit(fail ? 1 : 0);
