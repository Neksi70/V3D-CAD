// Regressionstest PLY-Import (_parsePLY/_importPLY) + 📏 Mit Zielhöhe drucken (_stz*), Ideen aus KIS3D.
//   PLY: ASCII mit Vertexfarben (2 Farben) → Mehrfarb-Bemalung; binär (LE) mit Vierecken; Punktwolke → Hinweis, kein Objekt;
//        Z oben (Höhe der Datei = Höhe in der Szene); echter Weg über #fimport
//   Zielhöhe: STL aus der Bibliothek auf 32 mm / 50 % → skalierte STL, Original unverändert, Helfer-Weg + Download-Weg, Knopf in der Karte
// Start: python3 volme3d_server.py 8875 --dev  →  node tests/ply_zielhoehe_test.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8875/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// Würfel 20×10×30 (B×T×H, Z oben), Vierecke; untere Hälfte rot, obere blau (Vertexfarben)
const V = [[0,0,0],[20,0,0],[20,10,0],[0,10,0],[0,0,30],[20,0,30],[20,10,30],[0,10,30]];
const Fq = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
const farbe = i => V[i][2] > 0 ? [0, 0, 255] : [255, 0, 0];
// ASCII: Dreiecke mit Farben – Würfel in Dreiecken, Farbe je Fläche über Vertexfarben (Ober-/Unterseite eindeutig)
let ascii = 'ply\nformat ascii 1.0\ncomment test\nelement vertex 8\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 6\nproperty list uchar int vertex_indices\nend_header\n';
for (let i = 0; i < 8; i++) ascii += V[i].join(' ') + ' ' + farbe(i).join(' ') + '\n';
for (const f of Fq) ascii += '4 ' + f.join(' ') + '\n';
// binär LE: double-Koordinaten, Flächenliste uchar/uint, Zusatz-Eigenschaft (Normalen) die übersprungen werden muss
const kopf = 'ply\nformat binary_little_endian 1.0\nelement vertex 8\nproperty double x\nproperty double y\nproperty double z\nproperty float nx\nelement face 6\nproperty list uchar uint vertex_indices\nproperty uchar flag\nend_header\n';
const kb = Buffer.from(kopf, 'latin1'), body = Buffer.alloc(8 * 28 + 6 * (1 + 16 + 1));
let o = 0;
for (const v of V) { for (const c of v) { body.writeDoubleLE(c, o); o += 8; } body.writeFloatLE(0.5, o); o += 4; }
for (const f of Fq) { body.writeUInt8(4, o++); for (const i of f) { body.writeUInt32LE(i, o); o += 4; } body.writeUInt8(7, o++); }
const binB = Buffer.concat([kb, body]);
const wolke = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n';
const dir = mkdtempSync(join(tmpdir(), 'plytest-')), fAscii = join(dir, 'wuerfel_farbig.ply');
writeFileSync(fAscii, ascii);

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _importPLY === 'function' && typeof _stzOpen === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });

const r = await pg.evaluate(async ({ ascii, bin, wolke }) => {
  const u8 = s => new TextEncoder().encode(s).buffer;
  const fromB64 = b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; };
  const groesse = m => { m.updateMatrixWorld(true); const s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()); return [s.x, s.y, s.z].map(v => +(v * 10).toFixed(2)); };
  const out = {};
  _newCreate(false);
  await _importPLY(u8(ascii), 'wuerfel_farbig.ply', { n: 2 });
  let m = objects[0];
  out.a = { n: objects.length, gr: groesse(m), tris: m.geometry.attributes.position.count / 3, paint: m.userData._mmuPaint, base: m.userData._mmuBase, slots: m.userData._mmuSlots, name: m.userData.name };
  _newCreate(false);
  await _importPLY(fromB64(bin), 'wuerfel_bin.ply', { n: 1 });
  m = objects[0];
  out.b = { n: objects.length, gr: groesse(m), tris: m.geometry.attributes.position.count / 3, paint: !!m.userData._mmuPaint };
  _newCreate(false);
  out.w = { ret: await _importPLY(u8(wolke), 'wolke.ply'), n: objects.length };
  return out;
}, { ascii, bin: binB.toString('base64'), wolke });
ok('ASCII-PLY: ein Objekt, 12 Dreiecke (Vierecke zerlegt)', r.a.n === 1 && r.a.tris === 12, r.a);
ok('ASCII-PLY: Z oben → 20 × 30 hoch × 10 (Szene x,y,z)', r.a.gr[0] === 20 && r.a.gr[1] === 30 && r.a.gr[2] === 10, r.a.gr);
ok('ASCII-PLY: 2 Filamentfarben aus Vertexfarben', r.a.paint === 1 && r.a.slots.length === 1, [r.a.base, r.a.slots]);
ok('ASCII-PLY: Name ohne Endung', r.a.name === 'wuerfel_farbig', r.a.name);
ok('Binär-PLY (double, Zusatzeigenschaften): Maße + 12 Dreiecke, ohne Farbe', r.b.n === 1 && r.b.tris === 12 && r.b.gr.join() === '20,30,10' && !r.b.paint, r.b);
ok('Punktwolke → kein Objekt', r.w.ret === false && r.w.n === 0, r.w);

// echter Weg über den Datei-Dialog (Farbfenster erscheint, 2 Farben wählen)
await pg.evaluate(() => _newCreate(false));
await pg.setInputFiles('#fimport', fAscii);
await pg.waitForSelector('#glb-modal.show', { timeout: 15000 });
await pg.selectOption('#glb-n', '2');
await pg.click('#glb-ok');
await pg.waitForFunction(() => objects.length === 1, { timeout: 15000 });
await pg.keyboard.press('Escape').catch(() => {});
const r2 = await pg.evaluate(() => ({ paint: objects[0].userData._mmuPaint, tris: objects[0].geometry.attributes.position.count / 3 }));
ok('Datei-Dialog-Weg: PLY mit 2 Farben', r2.paint === 1 && r2.tris === 12, r2);

// ── Zielhöhe ──
const z = await pg.evaluate(async () => {
  // STL-Würfel 20×10×30 mm als Bibliotheksdatei (FS-Access-Handle nachgebildet)
  _newCreate(false); addShape('box'); const box = objects[0];
  const stl = _geoToBinaryStl((() => { const g = new THREE.BufferGeometry(); const t = _moldCollectTris(box); for (let i = 0; i < t.length; i += 3) { t[i] *= 1; t[i+1] *= 0.5; t[i+2] *= 1.5; } g.setAttribute('position', new THREE.BufferAttribute(t, 3)); return g; })());
  const datei = new File([stl], 'wuerfel.stl');
  _stlFiles.splice(0, _stlFiles.length, { name: 'wuerfel.stl', path: 'wuerfel.stl', handle: { getFile: async () => datei }, size: datei.size, mtime: Date.now() });
  localStorage.removeItem('v3d_stz_hoehe'); localStorage.removeItem('v3d_stz_prozent');
  await _stzOpen(0);
  const sichtbar = document.getElementById('stz-modal').classList.contains('show');
  const alt = document.getElementById('stz-alt').textContent;
  const el = document.getElementById('stz-wert'); el.value = '32'; _stzUpd();
  const neuTxt = document.getElementById('stz-neu').textContent;
  const mess = blob => blob.arrayBuffer().then(ab => { const g = parseSTL(ab); g.computeBoundingBox(); const b = g.boundingBox; return { gr: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(3)), zmin: +b.min.z.toFixed(4) }; });
  const h = _stzBauen();
  const mh = await mess(h.blob);
  _stzModus('prozent'); const pWert = el.value;
  el.value = '50'; _stzUpd();
  const p = _stzBauen(); const mp = await mess(p.blob);
  // Helfer-Weg (fetch nachgebildet)
  const fe = window.fetch; let gesendet = null;
  window.fetch = async (url, o) => { if (String(url).endsWith('/print')) { gesendet = { name: decodeURIComponent(o.headers['X-Filename']), bytes: o.body.byteLength }; return new Response(JSON.stringify({ ok: true, slicer: 'Bambu Studio' })); } return fe(url, o); };
  _stlHelperOk = true; await _stzSend(true);
  window.fetch = fe;
  const zu = !document.getElementById('stz-modal').classList.contains('show');
  // Download-Weg ohne Helfer
  let geladen = null; const dl = window._downloadBlob; window._downloadBlob = (bl, n) => { geladen = n; };
  _stlHelperOk = false; await _stzOpen(0); const gemerkt = document.getElementById('stz-wert').value; await _stzSend(true); window._downloadBlob = dl;
  // Original unverändert
  const orig = await mess(await _stlFiles[0].handle.getFile());
  // Knopf in der Karte
  _stlRenderGrid && _stlRenderGrid();
  const knopf = !!document.querySelector('#stllib-grid button[onclick="_stzOpen(0)"]');
  return { sichtbar, alt, neuTxt, h: { name: h.name, ...mh }, pWert, p: { name: p.name, ...mp }, gesendet, zu, geladen, gemerkt, orig, knopf };
});
ok('Fenster öffnet, zeigt alte Maße', z.sichtbar && /20 × 10 × 30/.test(z.alt), z.alt);
ok('Vorschau-Text 32 mm', /21,3 × 10,7 × 32 mm/.test(z.neuTxt), z.neuTxt);
ok('Zielhöhe 32 → STL 32 mm hoch, gleichmäßig, auf der Platte', Math.abs(z.h.gr[2] - 32) < 0.01 && Math.abs(z.h.gr[0] - 21.333) < 0.01 && z.h.zmin === 0, z.h);
ok('Dateiname mit Höhe', z.h.name === 'wuerfel_32mm.stl', z.h.name);
ok('Umschalten auf Prozent rechnet um (106,7 %)', z.pWert === '106,7', z.pWert);
ok('50 % → 15 mm hoch', Math.abs(z.p.gr[2] - 15) < 0.01, z.p);
ok('Helfer-Weg: skalierte STL an /print, Fenster zu', z.gesendet && z.gesendet.name === 'wuerfel_15mm.stl' && z.zu, z.gesendet);
ok('ohne Helfer: Download, letzter Wert gemerkt', z.geladen === 'wuerfel_15mm.stl' && z.gemerkt === '50', [z.geladen, z.gemerkt]);
ok('Originaldatei unverändert', z.orig.gr[2] === 30, z.orig);
ok('📏-Knopf in der Bibliothekskarte', z.knopf);
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
