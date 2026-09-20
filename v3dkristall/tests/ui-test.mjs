// Headless-Prüfung von V3D Kristall gegen den laufenden Dienst.
// Aufruf: cd ~ && node v3dkristall/tests/ui-test.mjs [basis-url]
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ARG = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASIS = ARG[0] || 'http://127.0.0.1:8799/';
const BILD = path.join(HIER, 'mona.jpg');
const AUS = path.join(HIER, 'ausgabe');
fs.mkdirSync(AUS, { recursive: true });

let fehler = 0;
const pruefe = (ok, text) => { console.log((ok ? '✓ ' : '✗ ') + text); if (!ok) fehler++; };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const seite = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const konsole = [];
seite.on('pageerror', (e) => konsole.push('pageerror: ' + e.message));
seite.on('console', (m) => { if (m.type() === 'error') konsole.push(m.text()); });

await seite.goto(BASIS);
await seite.evaluate(() => localStorage.clear());
await seite.reload();
await seite.waitForFunction(() => window._kristall);

// Foto laden, auf KI warten
await seite.setInputFiles('#datei', BILD);
await seite.waitForFunction(() => window._kristall.Q.tiefe && window._kristall.Q.person, null, { timeout: 60000 });
await seite.waitForTimeout(1500);
// Maschinenprofil xTool: Standard = PLY-Text, X/Z, Blockmitte
const profil = await seite.evaluate(() => { const S = window._kristall.einst; return [S.maschine, S.format, S.achsen, S.nullpunkt].join(','); });
pruefe(profil === 'xtool,plytext,xz,mitte', `Standardprofil xTool (${profil})`);
const st = await seite.evaluate(() => ({ n: window._kristall.PKT.n, zMin: window._kristall.PKT.zMin, zMax: window._kristall.PKT.zMax, zeit: window._kristallZeit, P: window._kristall.PKT.P }));
console.log('Punkte', st.n, 'z', st.zMin.toFixed(2), '…', st.zMax.toFixed(2), 'Rechenzeit', Math.round(st.zeit), 'ms');
pruefe(st.n > 50000 && st.n < 2000000, 'Punktzahl plausibel');
pruefe(st.zMax - st.zMin > 10 && st.zMax - st.zMin <= 40, 'Relief nutzt die Tiefe (Standard 20 mm + Schichten)');
pruefe(st.P.vx0 >= -20 && st.P.vx1 <= 20 && st.P.vy0 >= -35 && st.P.vy1 <= 35, 'Motiv innerhalb des Randes (50×80, Rand 5)');

// Punkte liegen alle im Block
const imBlock = await seite.evaluate(() => {
  const { pos, n } = window._kristall.PKT, S = window._kristall.einst;
  let raus = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (Math.abs(x) > S.B / 2 - S.rand + 0.1 || Math.abs(y) > S.H / 2 - S.rand + 0.1 || Math.abs(z) > S.T / 2 - S.rand + 0.01) raus++;
  }
  return raus;
});
pruefe(imBlock === 0, 'alle Punkte innerhalb Block minus Rand');

// Freistellung wirkt: Ecke oben links des Bildes (Landschaft) bleibt leer
const ecke = await seite.evaluate(() => {
  const { pos, n, P } = window._kristall.PKT;
  let drin = 0;
  const x1 = P.vx0 + (P.vx1 - P.vx0) * 0.12, y0 = P.vy1 - (P.vy1 - P.vy0) * 0.12;
  for (let i = 0; i < n; i++) if (pos[i * 3] < x1 && pos[i * 3 + 1] > y0) drin++;
  return drin;
});
pruefe(ecke < 200, `Hintergrund-Ecke fast leer (${ecke} Punkte)`);

for (const sicht of ['vorne', 'schraeg', 'seite']) {
  await seite.click(`[data-sicht=${sicht}]`);
  await seite.waitForTimeout(400);
  await seite.screenshot({ path: path.join(AUS, `ansicht-${sicht}.png`) });
}

// Exporte
async function lade(format, achsen = 'xy', nullpunkt = 'mitte') {
  await seite.selectOption('[data-k=format]', format);
  await seite.selectOption('[data-k=achsen]', achsen);
  await seite.selectOption('[data-k=nullpunkt]', nullpunkt);
  const [dl] = await Promise.all([seite.waitForEvent('download'), seite.click('#export')]);
  const ziel = path.join(AUS, dl.suggestedFilename());
  await dl.saveAs(ziel);
  return ziel;
}
const n = st.n;
const dxf = await lade('dxf');
const dt = fs.readFileSync(dxf, 'utf8');
pruefe((dt.match(/\nPOINT\n/g) || []).length === n && dt.endsWith('EOF\n'), `DXF: ${n} POINT-Einträge, sauber abgeschlossen (${(dt.length / 1e6).toFixed(1)} MB)`);

const ply = await lade('ply', 'xz', 'ecke');
const pb = fs.readFileSync(ply), kopfEnde = pb.indexOf('end_header\n') + 11;
const kopf = pb.subarray(0, kopfEnde).toString();
const f32 = new Float32Array(pb.buffer.slice(pb.byteOffset + kopfEnde, pb.byteOffset + pb.length));
let minP = [1e9, 1e9, 1e9], maxP = [-1e9, -1e9, -1e9];
for (let i = 0; i < f32.length; i += 3) for (let k = 0; k < 3; k++) { minP[k] = Math.min(minP[k], f32[i + k]); maxP[k] = Math.max(maxP[k], f32[i + k]); }
pruefe(kopf.includes(`element vertex ${n}`) && f32.length === n * 3, 'PLY: Kopf und Datenmenge passen');
pruefe(minP.every((v) => v >= 0) && maxP[0] <= 50 && maxP[1] <= 50 && maxP[2] <= 80, `PLY X/Z+Ecke: alles positiv, im Block 50(X)×50(Y=Tiefe)×80(Z=Höhe) → max ${maxP.map((v) => v.toFixed(1))}`);

const xyz = await lade('xyz');
pruefe(fs.readFileSync(xyz, 'utf8').trim().split('\n').length === n, 'XYZ: eine Zeile je Punkt');

const stl = await lade('stl');
const sb = fs.readFileSync(stl), nt = sb.readUInt32LE(80);
pruefe(nt > 10000 && sb.length === 84 + nt * 50, `STL: ${nt} Dreiecke, Länge stimmt`);

const plyt = await lade('plytext', 'xz', 'mitte');
const zeilen = fs.readFileSync(plyt, 'utf8').split('\n');
const kEnde = zeilen.indexOf('end_header');
const pts = zeilen.slice(kEnde + 1).filter(Boolean).map((z) => z.split(' ').map(Number));
pruefe(zeilen[1] === 'format ascii 1.0' && zeilen.includes(`element vertex ${n}`) && pts.length === n, 'PLY-Text: Kopf und Zeilenzahl passen');
const ext = (k) => pts.reduce((a, q) => [Math.min(a[0], q[k]), Math.max(a[1], q[k])], [Infinity, -Infinity]);
const [ex, ey, ez] = [ext(0), ext(1), ext(2)];
pruefe(ez[1] - ez[0] > 50 && ey[1] - ey[0] < 35 && ex[1] - ex[0] <= 40.5, `PLY-Text: Z = Höhe (${(ez[1] - ez[0]).toFixed(1)}), Y = Tiefe (${(ey[1] - ey[0]).toFixed(1)}), X = Breite (${(ex[1] - ex[0]).toFixed(1)})`);
// intern z = zum Betrachter → Export Y = −z (vorne = −Y), Z = Höhe
const intern = await seite.evaluate(() => Array.from(window._kristall.PKT.pos.subarray(0, 3)));
pruefe(Math.abs(pts[0][0] - intern[0]) < 1e-3 && Math.abs(pts[0][1] + intern[2]) < 1e-3 && Math.abs(pts[0][2] - intern[1]) < 1e-3, 'X/Z-Achsen: Betrachterseite = −Y, Bildhöhe = Z');
await seite.check('[data-k=gedreht]');
const plyd = await lade('plytext', 'xz', 'mitte');
const zd = fs.readFileSync(plyd, 'utf8').split('\n'), p0 = zeilen[kEnde + 1].split(' ').map(Number), d0 = zd[kEnde + 1].split(' ').map(Number);
pruefe(Math.abs(p0[0] + d0[0]) < 1e-3 && Math.abs(p0[1] + d0[1]) < 1e-3 && Math.abs(p0[2] - d0[2]) < 1e-3, '180°-Drehung: X und Y gewendet, Z bleibt (keine Spiegelung)');
await seite.uncheck('[data-k=gedreht]');
await seite.selectOption('[data-k=format]', 'plytext');
await seite.selectOption('#vorlage', '120x80x80');
await seite.evaluate(() => document.querySelector('[data-k=fuellen]').closest('details').open = true);
await seite.check('[data-k=fuellen]');
await seite.waitForTimeout(1200);
const mel = await seite.locator('#meldungen').innerText();
pruefe(/Arbeitsraum nur 70/.test(mel), 'Warnung: Motiv (110 mm, Fläche füllen) breiter als 70 mm Arbeitsraum');
await seite.uncheck('[data-k=fuellen]');
await seite.selectOption('#maschine', 'wecreat');
await seite.selectOption('#vorlage', '60x100x60');
await seite.waitForTimeout(1200);
const mel2 = await seite.locator('#meldungen').innerText(), info = await seite.locator('#maschinenInfo').innerText();
pruefe(!/Arbeitsraum nur/.test(mel2) && /MakeIt/.test(info), 'WeCreat-Profil: 60×100×60 passt, Hinweis zu MakeIt');
await seite.selectOption('#maschine', 'xtool');
await seite.selectOption('#vorlage', '50x80x50');
await seite.waitForTimeout(1200);

// Rückseite: geschlossener Körper, mittig in der Tiefe
const rueck = {};
for (const art of ['aus', 'gerundet', 'gespiegelt']) {
  await seite.selectOption('[data-k=rueck]', art);
  await seite.waitForTimeout(900);
  rueck[art] = await seite.evaluate(() => { const K = window._kristall.PKT; return { n: K.n, zMin: K.zMin, zMax: K.zMax, geklemmt: K.geklemmt }; });
}
pruefe(rueck.gerundet.n > rueck.aus.n * 1.5, `Rückseite bringt Punkte dazu (${rueck.aus.n} → ${rueck.gerundet.n})`);
pruefe(rueck.gerundet.zMax - rueck.gerundet.zMin > rueck.aus.zMax - rueck.aus.zMin + 5, `Rücken vertieft das Motiv (${(rueck.aus.zMax - rueck.aus.zMin).toFixed(1)} → ${(rueck.gerundet.zMax - rueck.gerundet.zMin).toFixed(1)} mm)`);
pruefe(rueck.gerundet.geklemmt === 0 && Math.abs(rueck.gerundet.zMin + rueck.gerundet.zMax) < 1.5, 'Tiefe automatisch mittig, nichts geklemmt');
const tiefe = (r) => r.zMax - r.zMin;
pruefe(tiefe(rueck.gespiegelt) > tiefe(rueck.aus) + 5, `Gespiegelte Rückseite vertieft ebenfalls (${tiefe(rueck.aus).toFixed(1)} → ${tiefe(rueck.gespiegelt).toFixed(1)} mm)`);
await seite.selectOption('[data-k=rueck]', 'gerundet');
await seite.waitForTimeout(900);

// Text + Modi
await seite.evaluate(() => document.querySelector('[data-k=text]').closest('details').open = true);
await seite.fill('[data-k=text]', 'Mona Lisa\n1503');
await seite.dispatchEvent('[data-k=text]', 'input');
await seite.waitForTimeout(900);
const mitText = await seite.evaluate(() => window._kristall.PKT.n);
pruefe(mitText > 0 && mitText !== n, `Text ergänzt Punkte (${mitText})`);
const ausgaben = await seite.evaluate(() => [...document.querySelectorAll('output')].map((o) => o.textContent).filter((t) => /NaN|undefined/.test(t)));
pruefe(ausgaben.length === 0, 'alle Wertanzeigen gültig' + (ausgaben.length ? ': ' + ausgaben.join(', ') : ''));
await seite.click('[data-sicht=vorne]');
await seite.waitForTimeout(300);
await seite.screenshot({ path: path.join(AUS, 'mit-text.png') });

await seite.click('[data-modus=flach]');
await seite.waitForTimeout(900);
const flach = await seite.evaluate(() => { const { PKT } = window._kristall; return PKT.zMax - PKT.zMin; });
pruefe(flach < 3, `Flach 2D: keine Rückseite, Tiefe nur Schichten (${flach.toFixed(2)} mm)`);

// Einstellungen bleiben nach Neuladen
await seite.reload();
await seite.waitForFunction(() => window._kristall);
const gemerkt = await seite.evaluate(() => [window._kristall.einst.modus, window._kristall.einst.text]);
pruefe(gemerkt[0] === 'flach' && gemerkt[1].startsWith('Mona'), 'Einstellungen gespeichert');

// Handy-Breite
const handy = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await handy.goto(BASIS);
await handy.waitForFunction(() => window._kristall);
const breit = await handy.evaluate(() => document.documentElement.scrollWidth);
pruefe(breit <= 392, `Handy: keine Überbreite (${breit}px)`);
await handy.screenshot({ path: path.join(AUS, 'handy.png') });

// KI-Körper nur auf Wunsch: jeder Lauf kostet GPU-Kontingent bei Hugging Face
if (process.argv.includes('--koerper')) {
  const kp = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await kp.goto(BASIS);
  await kp.waitForFunction(() => window._kristall);
  await kp.setInputFiles('#datei', path.join(HIER, 'hund.jpg'));
  await kp.waitForFunction(() => window._kristall.Q.tiefe, null, { timeout: 60000 });
  await kp.selectOption('[data-k=frei]', 'tiefe');
  await kp.waitForTimeout(800);
  const t0 = Date.now();
  await kp.click('[data-modus=koerper]');
  await kp.waitForFunction(() => window._kristall.Q.koerper || window._kristall.Q.koerperFehler, null, { timeout: 300000 });
  await kp.waitForTimeout(2500);
  const k = await kp.evaluate(() => ({ fehler: window._kristall.Q.koerperFehler, K: window._kristall.Q.koerper,
    P: { n: window._kristall.PKT.n, zMin: window._kristall.PKT.zMin, zMax: window._kristall.PKT.zMax, geklemmt: window._kristall.PKT.geklemmt },
    relief: window._kristall.einst.relief, meldungen: document.getElementById('meldungen').innerText }));
  pruefe(!k.fehler, `KI-Körper gebaut in ${Math.round((Date.now() - t0) / 1000)} s` + (k.fehler ? ': ' + k.fehler : ''));
  if (k.K) {
    pruefe(k.K.drehung === 'vorne' && k.K.passung > 0.6, `Ausrichtung ${k.K.drehung}, Umriss-Passung ${k.K.passung}`);
    pruefe(k.K.tiefenpassung > 0.3, `Tiefe passt zur Foto-Tiefe (${k.K.tiefenpassung})`);
    pruefe(k.relief > 15, `Relief-Tiefe automatisch auf echte Proportion (${k.relief} mm)`);
    pruefe(k.P.zMax - k.P.zMin > 25, `Körper nutzt die Tiefe (${(k.P.zMax - k.P.zMin).toFixed(1)} mm)`);
    pruefe(!/liegen am Rand/.test(k.meldungen), 'nichts wird am Blockrand geklemmt');
    // Streifen quer durch den Block? Tiefe je Punkt darf nicht wild springen
    const ausreisser = await kp.evaluate(() => {
      const { pos, n } = window._kristall.PKT;
      const raster = new Map(); let schlimm = 0;
      for (let i = 0; i < n; i++) {
        const sx = Math.round(pos[i * 3] * 2), sy = Math.round(pos[i * 3 + 1] * 2), z = pos[i * 3 + 2];
        const s = sx + ',' + sy, v = raster.get(s);
        if (!v) raster.set(s, [z, z]); else { if (z < v[0]) v[0] = z; if (z > v[1]) v[1] = z; }
      }
      for (const v of raster.values()) if (v[1] - v[0] > 30) schlimm++;
      return schlimm;
    });
    pruefe(ausreisser < 20, `keine Punktschleier quer durch den Block (${ausreisser} Stellen mit >30 mm Sprung)`);
  }
  await kp.click('[data-sicht=seite]');
  await kp.waitForTimeout(600);
  await kp.screenshot({ path: path.join(AUS, 'koerper-seite.png') });
}

pruefe(konsole.length === 0, 'keine Konsolenfehler' + (konsole.length ? ': ' + konsole.join(' | ') : ''));
await browser.close();
console.log(fehler ? `${fehler} FEHLER` : 'alles ok');
process.exit(fehler ? 1 : 0);
