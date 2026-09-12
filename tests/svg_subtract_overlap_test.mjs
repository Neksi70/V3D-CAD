// Josy 13.9.26: "6 Löcher geschlossen", danach trotzdem "Abziehen nicht möglich:
// kein gültiges Werkzeug — bitte Reparieren auf die Motive anwenden."
// Verdacht: Motive mit ueberlappenden Konturen (Feder!) ergeben ein
// selbstschneidendes Netz — wasserdicht ja, aber fuer den Boolean unbrauchbar.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
// Zwei sich UEBERLAPPENDE Pfade (wie Federkiel + Fahne)
const SVG_UEBERLAPP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20,20 H60 V60 H20 Z"/><path d="M40,40 H80 V80 H40 Z"/></svg>`;
// Zur Kontrolle: saubere, getrennte Pfade
const SVG_SAUBER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10,10 H40 V40 H10 Z"/><path d="M60,60 H90 V90 H60 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// Prueft, ob Manifold das Motiv als Werkzeug akzeptiert
const pruefe = (svgText, name) => pg.evaluate(async ([svgText, name]) => {
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: 30, name });
  m.userData.isHole = true;
  m.updateMatrixWorld(true);
  const w = await _mfInit();
  const tris = _moldCollectTris(m);
  let direkt = null;
  try { _mfFromSoup(w, tris); direkt = 'ok'; }
  catch (e) { direkt = String(e.message || e).slice(0, 90); }
  // Wie sieht das Netz aus? offene Kanten zaehlen
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
  const pos = g.attributes.position;
  const KEY = (i) => [0,1,2].map(k => Math.round(pos.getComponent ? 0 : 0)).join();
  const kanten = new Map();
  const key = (ax, ay, az, bx, by, bz) => {
    const A = [ax,ay,az].map(v=>Math.round(v*1e4)).join('_');
    const B = [bx,by,bz].map(v=>Math.round(v*1e4)).join('_');
    return A < B ? A+'|'+B : B+'|'+A;
  };
  for (let t = 0; t < pos.count; t += 3)
    for (let e = 0; e < 3; e++) {
      const i = t + e, j = t + (e + 1) % 3;
      const k = key(pos.getX(i),pos.getY(i),pos.getZ(i), pos.getX(j),pos.getY(j),pos.getZ(j));
      kanten.set(k, (kanten.get(k) || 0) + 1);
    }
  let offen = 0; for (const n of kanten.values()) if (n !== 2) offen++;
  return { name, direkt, dreiecke: pos.count / 3, offeneKanten: offen };
}, [svgText, name]);

await pg.evaluate(() => { addShape('box'); const b2 = objects[objects.length-1]; b2.scale.set(3,3,3); b2.position.set(0,3,0); b2.userData.name='Koerper'; });
const sauber = await pruefe(SVG_SAUBER, 'Sauber');
console.log('getrennte Pfade: ', JSON.stringify(sauber));
const ueber = await pruefe(SVG_UEBERLAPP, 'Ueberlappend');
console.log('überlappende Pfade:', JSON.stringify(ueber));
ok('getrennte Konturen sind als Werkzeug brauchbar', sauber.direkt === 'ok', sauber);
ok('überlappende Konturen ebenfalls (hier hakt es bei Josy)', ueber.direkt === 'ok', ueber);
console.log('errs', errs);
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
