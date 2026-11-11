// Kantenlinien nach dem Neuladen (Volker 11.11., Schutzengel mit Punkten): Beim Speichern werden
// Ecken auf 0,001 cm gerundet; Splitter-Dreiecke an den Punkt-Kugeln kippen dadurch, und
// THREE.EdgesGeometry zog lange schwarze Striche über die Fläche. _kantenGeo nimmt bei Splittern
// die gespeicherte Normale.
//   Maß: Gesamtlänge der Linien auf der Oberseite (y = Dicke) – vor dem Speichern, nach dem
//   Neuladen mit EdgesGeometry (alt, muss deutlich mehr sein = Fehler nachgestellt) und mit _kantenGeo.
// Start: python3 volme3d_server.py 8874 --dev  →  node tests/kanten_splitter_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8874/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
const bereit = async () => { await pg.waitForFunction(() => typeof _sgeCreate === 'function' && typeof _kantenGeo === 'function', { timeout: 60000 });
  await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); }); };
await pg.goto(APP); await bereit();
await pg.evaluate(async () => { localStorage.clear(); _newCreate(false); await _mfInit(); _sgeFont('helvetiker_bold'); _sgeFont('greatvibes_local'); });
await pg.waitForFunction(() => window._threeFont_helvetiker_bold && window._threeFont_greatvibes_local, { timeout: 30000 });
const MESS = () => {
  window.__oben = (eg, y) => { const P = eg.attributes.position; let L = 0;
    for (let i = 0; i < P.count; i += 2) if (Math.abs(P.getY(i) - y) < 2e-3 && Math.abs(P.getY(i + 1) - y) < 2e-3) L += Math.hypot(P.getX(i) - P.getX(i + 1), P.getZ(i) - P.getZ(i + 1));
    return +L.toFixed(2); };
  const o = objects.find(x => /^Schutzengel/.test(x.userData.name)), y = 0.4;   // Dicke 4 mm (Vorgabe), Platte liegt auf y = 0
  return { alt: __oben(new THREE.EdgesGeometry(o.geometry, 60), y), neu: __oben(_kantenGeo(o.geometry, 60), y) };
};
await pg.evaluate(async () => { await _sgeCreate(); });
const vor = await pg.evaluate(MESS);
await pg.evaluate(() => _doAutoSave()); await pg.waitForTimeout(1500);
await pg.reload(); await bereit();
await pg.waitForFunction(() => objects.some(x => /^Schutzengel/.test(x.userData.name)), { timeout: 30000 });
const nach = await pg.evaluate(MESS);
console.log('  Linienlänge Oberseite (cm): vorher', vor, ' nachher', nach);
ok('vor dem Speichern: neue Berechnung ≈ three.js', Math.abs(vor.neu - vor.alt) / vor.alt < 0.03, [vor.alt, vor.neu]);
ok('Fehler nachgestellt: three.js nach dem Neuladen mit Strichen (> +10 %)', nach.alt > vor.alt * 1.1, [vor.alt, nach.alt]);
ok('neue Berechnung nach dem Neuladen ohne Striche (±5 %)', Math.abs(nach.neu - vor.neu) / vor.neu < 0.05, [vor.neu, nach.neu]);
ok('keine Seitenfehler', !errs.length, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
