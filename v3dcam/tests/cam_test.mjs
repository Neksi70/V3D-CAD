// Test: V3D CAM — Rohteil und Schruppen.
//
// Geprüft wird mit einem Teil, dessen Sollwerte man ausrechnen kann: ein
// ZYLINDER (r=20, volle Höhe) mittig in einem Klotz 100×100×30. Damit ist
// jede Aussage nachrechenbar statt „sieht plausibel aus".
//
// Die teuerste Frage zuerst: Fasst der Fräser das Teil an? Kein Punkt einer
// Schnittbahn darf der Zylinderachse näher kommen als r + Aufmaß + Fräser-
// radius. Wird das verletzt, ist das Werkstück Schrott.
import { chromium } from 'playwright';

const URL = process.env.V3D_CAM_URL || 'http://127.0.0.1:8803/';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
// Achtung: const/let im Skript landen NICHT auf window — ohne Praefix pruefen.
await pg.waitForFunction(() => typeof _camSchruppen === 'function' && typeof _CNC_MAT === 'object', { timeout: 60000 });

ok('Gemeinsamer Kern ist geladen',
   await pg.evaluate(() => typeof _cncGcode === 'function' && typeof _cncTaschenLagen === 'function' && typeof _mfFromSoup === 'function'));

// Zylinder r=20, z von 0 bis 30, mittig auf (50,50) — Klotz wird 100×100×30
const erg = await pg.evaluate(async () => {
  const RC = 20, H = 30, N = 96, cx = 50, cy = 50, t = [];
  const P = (a, z) => [cx + RC * Math.cos(a), cy + RC * Math.sin(a), z];
  for (let i = 0; i < N; i++) {
    const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
    const A = P(a0, 0), B = P(a1, 0), C = P(a1, H), D = P(a0, H);
    // Wicklung durchgehend nach AUSSEN — sonst nimmt Manifold das Netz nicht
    // an („Not manifold"): jede gerichtete Kante darf nur einmal vorkommen.
    t.push(...A, ...B, ...C, ...A, ...C, ...D);                  // Mantel
    t.push(cx, cy, 0, ...B, ...A);                               // Boden
    t.push(cx, cy, H, ...D, ...C);                               // Deckel
  }
  _teil = { tris: new Float32Array(t), box: _camBox(new Float32Array(t)), name: 'pruefzylinder' };
  _camP.roh = 'hand';
  document.getElementById('r-x').value = 100;
  document.getElementById('r-y').value = 100;
  document.getElementById('r-z').value = 30;
  document.getElementById('d').value = 10;
  document.getElementById('auf').value = 0.4;
  document.getElementById('safe').value = 50;
  const Pa = _camParams();
  const e = await _camSchruppen(Pa);
  return { moves: e.moves, w: e.w, warn: e.warn, stats: e.stats, gcode: _cncGcode(e, Pa), R: _camRoh(), P: Pa };
});

const R = erg.R, P = erg.P;
ok('Rohteil 100 × 100 × 30 wie eingestellt',
   Math.abs(R.sx - 100) < 1e-6 && Math.abs(R.sy - 100) < 1e-6 && Math.abs(R.sz - 30) < 1e-6,
   { sx: R.sx, sy: R.sy, sz: R.sz });

// Zylinderachse in MASCHINEN-Koordinaten: Rohteil-Mitte
const ax = R.sx / 2, ay = R.sy / 2, minAbst = 20 + P.auf + P.d / 2;

let x = 0, y = 0, z = P.zSafe, naeheste = 1e9, tiefste = 0, eilTief = 1e9, stechen = 0, zuTief = 0, ausserhalb = 0;
for (const m of erg.moves) {
  const nx = m.x === undefined ? x : m.x, ny = m.y === undefined ? y : m.y, nz = m.z === undefined ? z : m.z;
  if (m.g === 1) {
    // Beide Endpunkte UND die Strecke dazwischen pruefen: eine Sehne kann
    // dichter an der Achse liegen als ihre Enden.
    for (let s = 0; s <= 1; s += 0.1) {
      const px = x + (nx - x) * s, py = y + (ny - y) * s, pz = z + (nz - z) * s;
      if (pz < -1e-9) naeheste = Math.min(naeheste, Math.hypot(px - ax, py - ay));
    }
    tiefste = Math.min(tiefste, nz);
    // Senkrecht abwaerts ist beim Schruppen erlaubt und noetig: Der Fraeser
    // setzt dort an, wo die VORIGE Ebene schon geraeumt hat — die freie
    // Flaeche schrumpft nach unten nur, sie waechst nie. Zwei Dinge muessen
    // aber stimmen, sonst steht er im Vollen:
    //   (a) es geht mit Eintauch-Vorschub, nicht mit Bahnvorschub,
    //   (b) es geht hoechstens eine Zustellung tief auf einmal.
    if (Math.hypot(nx - x, ny - y) < 1e-9 && nz < z - 0.01) {
      if ((m.f || 0) > erg.w.tauchen + 1) stechen++;
      if (z - nz > erg.w.ap + 3) zuTief++;
    }
  } else if (Math.abs(nx - x) > 1e-9 || Math.abs(ny - y) > 1e-9) {
    eilTief = Math.min(eilTief, Math.min(z, nz));
  }
  if (nx < -P.d || nx > R.sx + P.d || ny < -P.d || ny > R.sy + P.d) ausserhalb++;
  x = nx; y = ny; z = nz;
}

ok('Fräser fasst das Teil nicht an (Abstand ≥ r + Aufmaß + Fräserradius)',
   naeheste >= minAbst - 0.05, { naeheste: +naeheste.toFixed(2), nötig: minAbst });
ok('Bis auf die Teil-Unterkante geschruppt', Math.abs(tiefste + 30) < 1e-6, +tiefste.toFixed(3));
ok('Nie tiefer als das Rohteil', tiefste >= -R.sz - 1e-6, +tiefste.toFixed(3));
ok('Kein Eilgang in XY unter der Rohteil-Oberkante', eilTief >= -1e-9, +eilTief.toFixed(2));
ok('Abwärts immer mit Eintauch-Vorschub', stechen === 0, stechen);
ok('Nie mehr als eine Zustellung auf einmal abwärts', zuTief === 0, zuTief);
ok('Bahnen bleiben im Rohteil plus Fräserradius', ausserhalb === 0, ausserhalb);
ok('Aufspannung wird ausdrücklich NICHT geprüft — und das steht auch da',
   erg.warn.some(w => /Aufspannung/.test(w)), erg.warn);

// Der Ring um den Zylinder muss wirklich ausgeräumt werden: die Bahn muss
// bis an die Rohteilkante reichen, sonst bleibt aussen ein Kragen stehen.
let maxAbst = 0;
x = 0; y = 0;
for (const m of erg.moves) {
  if (m.x !== undefined) x = m.x; if (m.y !== undefined) y = m.y;
  if (m.g === 1) maxAbst = Math.max(maxAbst, Math.max(Math.abs(x - ax), Math.abs(y - ay)));
}
ok('Bahn reicht bis an die Rohteilkante', maxAbst >= R.sx / 2 - 0.5, +maxAbst.toFixed(2));

// G-Code: Fanuc ist Vorgabe, also gilt die Dezimalpunkt-Regel
const zeilen = erg.gcode.split('\n');
const ohnePunkt = zeilen.filter(l => l && !l.startsWith('(') && !l.startsWith('O') && l !== '%')
  .filter(l => l.split(' ').some(t => /^[XYZRQIJKF]-?[0-9]/.test(t) && !t.includes('.')));
ok('FANUC: jede Koordinate trägt einen Dezimalpunkt', ohnePunkt.length === 0, ohnePunkt.slice(0, 3));
ok('Programmkopf nennt V3D CAM, nicht V3D CAD', /O0001 \(V3D CAM SCHRUPPEN\)/.test(erg.gcode), zeilen[1]);
ok('Programm ist vollständig eingerahmt',
   zeilen[0] === '%' && erg.gcode.trim().endsWith('%') && erg.gcode.includes('G0 G17 G40 G49 G80 G90') && erg.gcode.includes('M30'));
ok('Schnittwerte kommen aus dem gemeinsamen Kern',
   erg.w.rpm === 9550 && erg.w.ap === 4, { rpm: erg.w.rpm, ap: erg.w.ap });

ok('Keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
