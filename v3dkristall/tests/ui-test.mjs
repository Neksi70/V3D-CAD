// Headless-Prüfung von V3D Kristall gegen den laufenden Dienst.
// Aufruf: cd ~ && node v3dkristall/tests/ui-test.mjs [basis-url]
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const BASIS = process.argv[2] || 'http://127.0.0.1:8799/';
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
pruefe(flach < 3, `Flach 2D: Tiefe nur Schichten (${flach.toFixed(2)} mm)`);

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

pruefe(konsole.length === 0, 'keine Konsolenfehler' + (konsole.length ? ': ' + konsole.join(' | ') : ''));
await browser.close();
console.log(fehler ? `${fehler} FEHLER` : 'alles ok');
process.exit(fehler ? 1 : 0);
