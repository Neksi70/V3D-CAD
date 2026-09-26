// Ralf 26.9.26, zwei Meldungen:
//  1. „Ab M10 ist eine Macke/Kerbe im Außengewinde" — _buildThreadGeo bekam bei
//     krummer Gangzahl (Länge/Steigung, M10×20 = 13,33) ein gebrochenes Gitter.
//  2. „Wie kann ich beim Füllen die Platte markieren?" — mit nur EINEM gewählten
//     Teil füllt ▦ Füllen jetzt die Druckplatte.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _buildThreadGeo === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });

const thr = await pg.evaluate(() => {
  const out = [];
  for (const [k, s] of Object.entries(SCREW_SPECS)) for (const len of [20, 17, 33]) {
    const g = _threadShaft(s, len, false);
    const idx = g.index.array, n = g.attributes.position.count;
    let bad = 0; for (const v of idx) if (v >= n || v !== Math.floor(v)) bad++;
    const e = new Map();
    for (let t = 0; t < idx.length; t += 3) for (let q = 0; q < 3; q++) {
      const a = idx[t+q], c = idx[t+(q+1)%3], key = a < c ? a+'_'+c : c+'_'+a; e.set(key, (e.get(key)||0)+1); }
    let open = 0; for (const m of e.values()) if (m !== 2) open++;
    out.push({ k, len, turns: +(len / s.pitch).toFixed(2), bad, open });
  }
  return out;
});
for (const r of thr) ok(`${r.k}×${r.len} (${r.turns} Gänge): Gewinde wasserdicht`, r.bad === 0 && r.open === 0, r);

const fill = await pg.evaluate(() => {
  _newCreate(false);
  buildplateW = 256; buildplateH = 256; buildGrid();   // Bambu P1S/X1C wie bei Ralf
  addShape('cube');
  const o = getFirst(); o.scale.set(1.5, 0.5, 1.5); o.position.set(0, 0.5, 0); o.updateMatrixWorld(true);
  selectObjs([o]);
  fillPlateTool();
  const title = document.getElementById('pat-title').textContent;
  const shown = document.getElementById('pat-modal').classList.contains('show');
  document.getElementById('pat-fill-gap').value = 3; document.getElementById('pat-fill-margin').value = 5;
  _applyPat();
  const bw = buildplateW / 10, bh = buildplateH / 10;
  let inside = true;
  for (const x of objects) { const bb = getMeshBox(x);
    if (bb.min.x < -bw/2 - 1e-3 || bb.max.x > bw/2 + 1e-3 || bb.min.z < -bh/2 - 1e-3 || bb.max.z > bh/2 + 1e-3) inside = false; }
  return { title, shown, n: objects.length, inside, groundSel: selectedObjs.includes(groundMesh),
           expect: Math.floor((buildplateW - 10 + 3) / 33) ** 2 };
});
ok('Füllen mit einem Teil öffnet den Dialog für die Druckplatte', fill.shown && /Druckplatte/.test(fill.title), fill.title);
ok('Druckplatte wird gefüllt (mindestens Rasteranzahl)', fill.n >= fill.expect, { n: fill.n, raster: fill.expect });
ok('alle Kopien liegen auf der Druckplatte', fill.inside);
ok('Druckplatte selbst wird nicht ausgewählt', !fill.groundSel);
ok('Keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
if (fails.length) { console.log('\nFEHLGESCHLAGEN: ' + fails.length); process.exit(1); }
console.log('\nAlle Prüfungen bestanden.');
