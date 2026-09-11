// Test: Klemmbaustein-Look (_lgo*) — aus einem beliebigen Modell wird ein
// gerastertes, DRUCKBARES Teil. Geprüft wird das, was im Slicer weh tut:
//   (1) das Ergebnisnetz ist geschlossen UND mannigfaltig (keine Kante, an der
//       vier Flächen hängen — sonst verweigern spätere Boolean-Schritte),
//   (2) Noppen sitzen nur auf freiliegenden Oberseiten, Aufnahmen nur unten,
//   (3) Maßstab und Raster stimmen (Breite in Noppen → echte mm),
//   (4) eingeschlossene Hohlräume bekommen KEINE Noppen.
// Läuft standardmäßig gegen den Dev-Server (rohe Arbeitskopie, `npm run dev`).
// Mit V3D_URL=http://localhost:8765/volme3d.html auch gegen die minifizierte
// Auslieferung — dann braucht es ein Sitzungs-Cookie, das wir uns selbst
// ausstellen (gleicher HMAC-Schlüssel wie der Server, kein Firebase-Login).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('lego-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie ausgestellt: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

// Kantenbilanz im Browser: jede gerichtete Kante genau einmal + Gegenkante da.
await pg.evaluate(() => {
  window._lgoAudit = (pos) => {
    const n = pos.length / 9, q = 1e4;
    const vid = new Map(), ids = new Int32Array(n * 3);
    for (let i = 0; i < n * 3; i++) {
      const k = Math.round(pos[i*3]*q) + '|' + Math.round(pos[i*3+1]*q) + '|' + Math.round(pos[i*3+2]*q);
      let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); }
      ids[i] = id;
    }
    const seen = new Set(); let dup = 0;
    for (let t = 0; t < n; t++) for (let e = 0; e < 3; e++) {
      const k = ids[t*3+e] + '>' + ids[t*3+(e+1)%3];
      if (seen.has(k)) dup++; else seen.add(k);
    }
    let open = 0;
    for (const k of seen) { const p = k.split('>'); if (!seen.has(p[1] + '>' + p[0])) open++; }
    let vol = 0;
    for (let t = 0; t < n; t++) { const i = t*9;
      vol += pos[i]*(pos[i+4]*pos[i+8]-pos[i+5]*pos[i+7]) - pos[i+1]*(pos[i+3]*pos[i+8]-pos[i+5]*pos[i+6]) + pos[i+2]*(pos[i+3]*pos[i+7]-pos[i+4]*pos[i+6]); }
    return { tris: n, dup, open, vol: vol/6 };
  };
  // Ergebniskörper messen. Achtung: der Körper steht Y-up in der Szene
  // (mm/Z-up → Editor), die Bauhöhe ist also die WELT-Y-Ausdehnung.
  window._lgoMeasure = (mesh) => {
    const s = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).multiplyScalar(10);
    return Object.assign(window._lgoAudit(mesh.geometry.attributes.position.array),
                         { breite: s.x, hoehe: s.y, tiefe: s.z });
  };
  // Generator ohne Dialog fahren
  window._lgoRun = async (shape, cfg) => {
    if (objects.length) { selectObjs(objects.slice()); deleteSelected(); }
    shape();
    const o = objects[objects.length - 1];
    selectObjs([o]);
    _lgoOpen();
    for (const [id, v] of Object.entries(cfg)) {
      if (id[0] === '_') continue;
      const el = document.getElementById(id);
      if (el.type === 'checkbox') el.checked = v; else el.value = v;
    }
    if (cfg._grid) _lgoSetGrid(cfg._grid);
    _lgoInfo();
    const before = objects.length;
    await _lgoCreate();
    for (let i = 0; i < 200 && objects.length === before; i++) await new Promise(r => setTimeout(r, 50));
    const res = objects[objects.length - 1];
    return Object.assign(window._lgoMeasure(res), { name: res.userData.name });
  };
});

// ── 1) Kugel, Standardeinstellungen ────────────────────────────────────────
const r1 = await pg.evaluate(() => _lgoRun(() => addShape('sphere'),
  { 'lgo-studs': 10, 'lgo-fill': 40, 'lgo-studs-on': true, 'lgo-sockets': true,
    'lgo-seams': true, 'lgo-weld': true, 'lgo-clear': 0.2 }));
ok('Kugel: Netz geschlossen (keine offenen Kanten)', r1.open === 0, r1.open);
ok('Kugel: Netz mannigfaltig (keine Doppelkanten)', r1.dup === 0, r1.dup);
ok('Kugel: positives Volumen', r1.vol > 0, Math.round(r1.vol));
ok('Kugel: Breite = 10 Noppen = 80 mm', Math.abs(r1.breite - 80) < 0.5, [r1.breite, r1.hoehe, r1.tiefe]);
ok('Kugel: Ergebnis heißt "… — Klemmbaustein"', /Klemmbaustein$/.test(r1.name), r1.name);

// ── 2) Würfel: Maße exakt nachrechenbar ────────────────────────────────────
// 6 Noppen breit, Steinraster 9,6 mm, ohne Noppen/Aufnahmen/Fugen
// → glatter Quader 48 × 48 × (n·9,6) mm mit Volumen = Zellzahl · 8 · 8 · 9,6
const r2 = await pg.evaluate(() => _lgoRun(() => addShape('box'),
  { 'lgo-studs': 6, 'lgo-fill': 40, 'lgo-studs-on': false, 'lgo-sockets': false,
    'lgo-seams': false, 'lgo-weld': true, _grid: 'brick' }));
ok('Würfel nackt: geschlossen + mannigfaltig', r2.open === 0 && r2.dup === 0, [r2.open, r2.dup]);
ok('Würfel nackt: 48 mm breit', Math.abs(r2.breite - 48) < 0.01, r2.breite);
ok('Würfel nackt: Volumen ist ein Vielfaches der Zelle (8·8·9,6)',
   Math.abs(r2.vol / (8*8*9.6) - Math.round(r2.vol / (8*8*9.6))) < 1e-3, r2.vol / (8*8*9.6));
ok('Würfel nackt: 12 Dreiecke je Zelle wären zu viel — Innenflächen entfallen',
   r2.tris < 6 * 6 * 6 * 12, r2.tris);

// ── 3) Noppen erhöhen die Bauhöhe um genau 1,8 mm ──────────────────────────
const r3 = await pg.evaluate(() => _lgoRun(() => addShape('box'),
  { 'lgo-studs': 6, 'lgo-fill': 40, 'lgo-studs-on': true, 'lgo-sockets': false,
    'lgo-seams': false, 'lgo-weld': true, _grid: 'brick' }));
ok('Mit Noppen: geschlossen + mannigfaltig', r3.open === 0 && r3.dup === 0, [r3.open, r3.dup]);
ok('Mit Noppen: 1,8 mm höher als ohne', Math.abs((r3.hoehe - r2.hoehe) - 1.8) < 0.01, r3.hoehe - r2.hoehe);
ok('Mit Noppen: Volumen größer', r3.vol > r2.vol, [Math.round(r2.vol), Math.round(r3.vol)]);

// ── 4) Aufnahmen unten nehmen Material weg ─────────────────────────────────
const r4 = await pg.evaluate(() => _lgoRun(() => addShape('box'),
  { 'lgo-studs': 6, 'lgo-fill': 40, 'lgo-studs-on': false, 'lgo-sockets': true,
    'lgo-seams': false, 'lgo-weld': true, 'lgo-clear': 0.2, _grid: 'brick' }));
ok('Mit Aufnahme: geschlossen + mannigfaltig', r4.open === 0 && r4.dup === 0, [r4.open, r4.dup]);
ok('Mit Aufnahme: Volumen kleiner als nackt', r4.vol < r2.vol, [Math.round(r2.vol), Math.round(r4.vol)]);
ok('Mit Aufnahme: Außenmaß unverändert', Math.abs(r4.hoehe - r2.hoehe) < 0.01, r4.hoehe - r2.hoehe);

// ── 5) Plattenraster: dreifache Höhenauflösung ─────────────────────────────
const r5 = await pg.evaluate(() => _lgoRun(() => addShape('sphere'),
  { 'lgo-studs': 8, 'lgo-fill': 40, 'lgo-studs-on': true, 'lgo-sockets': true,
    'lgo-seams': true, 'lgo-weld': true, 'lgo-clear': 0.2, _grid: 'plate' }));
ok('Platte 3,2: geschlossen + mannigfaltig', r5.open === 0 && r5.dup === 0, [r5.open, r5.dup]);
ok('Platte 3,2: Breite = 8 Noppen = 64 mm', Math.abs(r5.breite - 64) < 0.5, r5.breite);

// ── 6) Torus: Loch in der Mitte, viele Kanten-Berührungen → Härtetest ──────
const r6 = await pg.evaluate(() => _lgoRun(() => addShape('torus'),
  { 'lgo-studs': 14, 'lgo-fill': 35, 'lgo-studs-on': true, 'lgo-sockets': true,
    'lgo-seams': true, 'lgo-weld': true, 'lgo-clear': 0.2, _grid: 'plate' }));
ok('Torus: geschlossen + mannigfaltig', r6.open === 0 && r6.dup === 0, [r6.open, r6.dup]);
ok('Torus: positives Volumen', r6.vol > 0, Math.round(r6.vol));

// ── 7) Verschweißen: zwei Steine, die sich nur an einer Kante berühren ────
// Ohne Auffüllen treffen an dieser Kante vier Flächen aufeinander (nicht
// mannigfaltig) — genau das, woran Manifold später scheitert.
const r7 = await pg.evaluate(() => {
  const nx = 2, ny = 1, nz = 2, hz = 9.6;
  const opt = { studs: true, sockets: true, seams: true, clear: 0.2 };
  const mk = weld => {
    const f = new Uint8Array(nx*ny*nz), acc = new Float32Array(nx*ny*nz);
    f[0] = 1; acc[0] = 1;                     // (0,0,0)
    f[(1*ny)*nx + 1] = 1; acc[(1*ny)*nx + 1] = 1;   // (1,0,1) — nur Kantenkontakt
    if (weld) _lgoWeld(f, acc, nx, ny, nz);
    let n = 0; for (const v of f) n += v;
    return Object.assign(_lgoAudit(_lgoMesh(f, _lgoOutside(f, nx, ny, nz), nx, ny, nz, 0, 0, 0, hz, opt).pos), { zellen: n });
  };
  return { ohne: mk(false), mit: mk(true) };
});
ok('Diagonalfall ohne Auffüllen: nicht mannigfaltig (erwartet)', r7.ohne.dup > 0, r7.ohne.dup);
ok('Diagonalfall ohne Auffüllen: trotzdem geschlossen', r7.ohne.open === 0, r7.ohne.open);
ok('Diagonalfall MIT Auffüllen: mannigfaltig', r7.mit.dup === 0 && r7.mit.open === 0, [r7.mit.dup, r7.mit.open]);
ok('Auffüllen ergänzt genau eine Zelle', r7.mit.zellen === r7.ohne.zellen + 1, [r7.ohne.zellen, r7.mit.zellen]);

// ── 8) Eingeschlossener Hohlraum bekommt keine Noppen ─────────────────────
// Ein Voxelwürfel mit einer Luftblase in der Mitte: die Blasenwand darf weder
// Noppen noch Aufnahmen bekommen (die wären nie sichtbar und kosten nur Netz).
const r8 = await pg.evaluate(() => {
  const nx = 3, ny = 3, nz = 3, hz = 9.6;
  const opt = { studs: true, sockets: true, seams: true, clear: 0.2 };
  const f = new Uint8Array(nx*ny*nz).fill(1);
  f[(1*ny + 1)*nx + 1] = 0;                     // Blase in der Mitte
  const m = _lgoMesh(f, _lgoOutside(f, nx, ny, nz), nx, ny, nz, 0, 0, 0, hz, opt);
  // Zum Vergleich: dieselbe Blase, aber seitlich nach außen geöffnet
  const f2 = f.slice(); f2[(1*ny + 1)*nx + 2] = 0;
  const m2 = _lgoMesh(f2, _lgoOutside(f2, nx, ny, nz), nx, ny, nz, 0, 0, 0, hz, opt);
  return { zu: Object.assign(_lgoAudit(m.pos), { noppen: m.studs }),
           offen: Object.assign(_lgoAudit(m2.pos), { noppen: m2.studs }) };
});
ok('Hohlraum zu: 9 Noppen (nur die echte Oberseite)', r8.zu.noppen === 9, r8.zu.noppen);
ok('Hohlraum zu: geschlossen + mannigfaltig', r8.zu.dup === 0 && r8.zu.open === 0, [r8.zu.dup, r8.zu.open]);
// Sobald die Blase Außenluft hat, bekommen die beiden Böden darin Noppen —
// das belegt, dass die Flutfüllung wirklich zwischen innen und außen trennt.
ok('Hohlraum offen: die zwei Innenböden bekommen jetzt Noppen', r8.offen.noppen === 11, r8.offen.noppen);
ok('Hohlraum offen: geschlossen + mannigfaltig', r8.offen.dup === 0 && r8.offen.open === 0, [r8.offen.dup, r8.offen.open]);

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlle Klemmbaustein-Tests bestanden.');
process.exit(fails.length ? 1 : 0);
