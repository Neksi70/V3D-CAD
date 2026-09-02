// Sebastians Vorschlag: Lasso wie in CorelDRAW — beide Lesarten.
//  A) Freihand-Zeichnen in der Skizze (Strich → geglaettete Polylinie)
//  B) Freiform-Auswahl im 3D-Fenster
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 850 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await p.waitForTimeout(3000);
const rect = await p.evaluate(() => { const r = vpEl.getBoundingClientRect(); return { x: r.left, y: r.top }; });
let ok = true;
const say = (l, c, e = '') => { if (!c) ok = false; console.log(`${c ? '✓' : '✗'} ${l}${e ? ' — ' + e : ''}`); };

// ── A) Freihand in der Skizze ───────────────────────────────────────────
await p.evaluate(() => {
  const m = document.getElementById('start-modal'); if (m) m.classList.remove('show');
  while (objects.length) { const o = objects.pop(); scene.remove(o); }
  enterSketchMode(); _skSetTool('free'); setSnapGrid(0);
  sph.r = 40; sph2cam();
});
await p.waitForTimeout(300);
say('Freihand-Werkzeug aktiv', await p.evaluate(() => _sk.tool === 'free'));

// Kreis zeichnen (endet nahe am Anfang → muss sich schliessen), mit Zittern
const cx = rect.x + 500, cy = rect.y + 400, R = 150;
await p.mouse.move(cx + R, cy);
await p.mouse.down();
for (let i = 1; i <= 120; i++) {
  const a = i / 120 * Math.PI * 2;
  const jitter = (i % 3 - 1) * 1.5;                      // absichtliches Zittern
  await p.mouse.move(cx + (R + jitter) * Math.cos(a), cy + (R + jitter) * Math.sin(a));
}
const roh = await p.evaluate(() => _skFree.pts.length);
await p.mouse.up();
await p.waitForTimeout(300);
const ent = await p.evaluate(() => {
  const e = _sk.ents[_sk.ents.length - 1];
  if (!e) return null;
  const t = _skTess(e);
  let minU = 1e9, maxU = -1e9;
  t.pts.forEach(q => { minU = Math.min(minU, q.u); maxU = Math.max(maxU, q.u); });
  return { typ: e.type, zu: !!e.closed, punkte: e.pts.length, anzahl: _sk.ents.length,
           breiteMm: +((maxU - minU) * 10).toFixed(1) };
});
say('Strich wurde als Polylinie übernommen', ent && ent.typ === 'poly' && ent.anzahl === 1,
    ent ? `${ent.typ}, ${ent.punkte} Punkte` : 'nichts');
say('Kontur automatisch geschlossen', !!ent && ent.zu);
say('Zittern geglättet + ausgedünnt', !!ent && ent.punkte < roh * 0.6 && ent.punkte > 8,
    `${roh} roh → ${ent ? ent.punkte : 0} Punkte`);

// Geschlossene Freihand-Kontur muss extrudierbar sein
const koerper = await p.evaluate(() => {
  const vorher = objects.length;
  document.getElementById('sketch-h').value = '6';
  _skExtrude();
  const neu = objects.length - vorher;
  if (!neu) return { neu: 0 };
  const o = objects[objects.length - 1];
  const bb = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  return { neu, hoeheMm: +(bb.y * 10).toFixed(1), breiteMm: +(bb.x * 10).toFixed(1) };
});
say('Freihand-Kontur lässt sich extrudieren', koerper.neu === 1 && Math.abs(koerper.hoeheMm - 6) < 0.2,
    `Körper ${koerper.breiteMm}×${koerper.hoeheMm} mm`);

// Offener Strich darf NICHT als geschlossen gelten
const offen = await p.evaluate(() => { enterSketchMode(); _skSetTool('free'); sph.r = 40; sph2cam(); });
await p.waitForTimeout(300);
await p.mouse.move(rect.x + 300, rect.y + 300);
await p.mouse.down();
for (let i = 1; i <= 40; i++) await p.mouse.move(rect.x + 300 + i * 8, rect.y + 300 + i * 2);
await p.mouse.up();
await p.waitForTimeout(200);
say('offener Strich bleibt offen', await p.evaluate(() => {
  const e = _sk.ents[_sk.ents.length - 1]; return !!e && e.type === 'poly' && !e.closed; }));
await p.evaluate(() => exitSketchMode());

// ── B) Freiform-Auswahl im 3D-Fenster ───────────────────────────────────
const scene5 = await p.evaluate(() => {
  while (objects.length) { const o = objects.pop(); scene.remove(o); }
  for (let i = 0; i < 5; i++) { addShape('box'); const o = objects[i];
    o.scale.setScalar(0.5); o.position.set((i - 2) * 2.2, o.position.y, 0); }
  deselect(); setMode('select');
  fitToObjects(objects); sph.r *= 1.25; sph.theta = 0; sph.phi = 0.1; sph2cam();
  if (!_lassoOn) toggleLasso();
  return { n: objects.length, lasso: _lassoOn };
});
say('Lasso-Modus an, 5 Teile in einer Reihe', scene5.lasso && scene5.n === 5);
await p.waitForTimeout(400);

// Nur die mittleren drei umkreisen
const ziel = await p.evaluate(() => {
  const r = vpEl.getBoundingClientRect();
  return objects.map(o => {
    const c = getMeshBox(o).getCenter(new THREE.Vector3()).project(camera);
    return { x: (c.x + 1) / 2 * r.width, y: (-c.y + 1) / 2 * r.height };
  });
});
// nach Bildschirm-X sortieren und die Schlaufe genau zwischen die Nachbarn legen
const nachX = ziel.map((z, i) => ({ ...z, i })).sort((a, b) => a.x - b.x);
const mitte = nachX.slice(1, 4);                       // die drei mittleren
const erwartet = mitte.map(z => z.i).sort((a, b) => a - b).join(',');
const links  = (nachX[0].x + nachX[1].x) / 2;
const rechts = (nachX[3].x + nachX[4].x) / 2;
const oben = Math.min(...ziel.map(z => z.y)) - 60, unten = Math.max(...ziel.map(z => z.y)) + 60;
console.log(`  Bildschirm-X: ${nachX.map(z => Math.round(z.x)).join(', ')} | Schlaufe ${Math.round(links)}…${Math.round(rechts)}`);
const bahn = [[links, oben], [rechts, oben], [rechts, unten], [links, unten], [links, oben]];
await p.mouse.move(rect.x + bahn[0][0], rect.y + bahn[0][1]);
await p.mouse.down();
for (let i = 1; i < bahn.length; i++) {
  const [x0, y0] = bahn[i - 1], [x1, y1] = bahn[i];
  for (let t = 1; t <= 14; t++)
    await p.mouse.move(rect.x + x0 + (x1 - x0) * t / 14, rect.y + y0 + (y1 - y0) * t / 14);
}
const sichtbar = await p.evaluate(() => document.getElementById('lasso-svg').style.display === 'block'
                                     && document.querySelector('#lasso-svg path').getAttribute('d').length > 20);
say('Schlaufe wird während des Ziehens gezeichnet', sichtbar);
await p.mouse.up();
await p.waitForTimeout(300);
const sel = await p.evaluate(() => ({
  n: selectedObjs.length,
  idx: selectedObjs.map(o => objects.indexOf(o)).sort((a, b) => a - b),
  weg: document.getElementById('lasso-svg').style.display === 'none' }));
say('genau die umkreisten 3 Teile ausgewählt', sel.n === 3 && sel.idx.join(',') === erwartet,
    `ausgewählt [${sel.idx}], erwartet [${erwartet}]`);
say('Schlaufe nach dem Loslassen weg', sel.weg);

// Zurückschalten muss wieder das Rechteck geben
const zurueck = await p.evaluate(() => { toggleLasso(); return _lassoOn; });
say('Umschalter zurück auf Rechteck', zurueck === false);

say('keine Seitenfehler', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('=>', ok ? 'OK ✓' : 'FEHLGESCHLAGEN ✗');
await b.close();
process.exit(ok ? 0 : 1);
