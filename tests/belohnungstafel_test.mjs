// Regressionstest für den Generator „Belohnungstafel (Laser)" (⭐, _bel*).
//   1. Varianten: alles innerhalb der Platte, Gravur nicht über Löcher/Rand,
//      Rückplatte deckungsgleich mit einem Loch je Feld
//   2. Symbole: Stichwörter → richtiges Symbol, jedes Symbol ergibt Formen
//   3. Marker passen ins Feld, Magnet-Prüfung, Ringe mit Loch
//   4. SVG: Ebenen, Gravur je Teil verschweißt, Maße in mm, Arbeitsbreite eingehalten
//   5. Dialog: Aufgaben hinzufügen/löschen, keine Seitenfehler; Screenshot
// Start: python3 volme3d_server.py 8766 --dev   →   node tests/belohnungstafel_test.mjs
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window._belOpen === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  localStorage.removeItem('v3d_bel');
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

const varianten = [
  { name: 'Standard 380×300',                  p: {} },
  { name: 'Theo, Mo–Fr, lange Tage',           p: { titel: 'Theos Belohnungstafel', tage: 5, tagForm: 'lang', kinder: [{ n: 'Theo', z: 15, b: 'Eis essen gehen' }] } },
  { name: '3 Kinder, kurze Tage',              p: { tagForm: 'kurz', kinder: [{ n: 'Theo', z: 15, b: 'Kino' }, { n: 'Amelie', z: 20, b: 'Spieleabend' }, { n: 'Ben', z: 10, b: 'Eis' }] } },
  { name: '3 Kinder, Rückplatte',              p: { halt: 'scheiben', kinder: [{ n: 'A', z: 1, b: '' }, { n: 'B', z: 2, b: '' }, { n: 'C', z: 3, b: '' }] } },
  { name: 'Rückplatte mit Löchern',            p: { halt: 'scheiben' } },
  { name: 'Hochformat 297×420, 10 Aufgaben',   p: { B: 297, H: 420, tasks: Array.from({ length: 10 }, (_, i) => ({ t: 'Aufgabe Nummer ' + (i + 1) + ' mit langem Text', i: 'auto' })) } },
  { name: 'klein 200×150, ohne Fuß/Deko',      p: { B: 200, H: 150, fuss: false, deko: 'keine', aufh: false } },
  { name: 'Marker als Form + Ring',            p: { mForm: 'kontur', mMag: 'ring', mMotiv: 'stern', mGr: 90 } },
  { name: 'Herz-Form, kleiner Magnet',         p: { mForm: 'kontur', mMotiv: 'herz', magD: 6, B: 420, H: 400 } },
];
const res = await pg.evaluate((varianten) => {
  const out = [];
  const bbox = rs => { const b = [1e9, 1e9, -1e9, -1e9]; for (const r of rs) for (const q of r){ b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); } return b; };
  for (const v of varianten){
    const p = Object.assign(JSON.parse(JSON.stringify(_BEL_DEF)), v.p);
    const L = _belLayout(p), I = L.info;
    const eb = bbox(L.front.eng.flat());
    const inside = eb[0] >= I.m - 1 && eb[1] >= I.m - 1 && eb[2] <= p.B - I.m + 1 && eb[3] <= p.H - I.m + 1;
    // Aufhängelöcher: kein Gravurpunkt näher als 1 mm
    let holeClr = 1e9;
    for (const h of L.front.cut.slice(1)){ const c = bbox([h]), cx = (c[0] + c[2]) / 2, cy = (c[1] + c[3]) / 2, r = (c[2] - c[0]) / 2;
      for (const g of L.front.eng) for (const q of g[0]) holeClr = Math.min(holeClr, Math.hypot(q[0] - cx, q[1] - cy) - r); }
    const nTasks = p.tasks.filter(t => t.t.trim()).length;
    out.push({ name: v.name, inside, eb, holeClr, nShapes: L.front.eng.length,
      back: L.back ? L.back.cut.length - 1 - (p.aufh ? 2 : 0) : null, cells: nTasks * (p.tage === 5 ? 5 : 7) + (I.parkHoles || 0), parkHoles: I.parkHoles || 0,
      kidMot: [...new Set(L.markers.map(k => k.motiv))].join(','), nK: p.fuss ? p.kinder.length : 1,
      markerD: 2 * I.R, cell: I.cell, magFit: I.magFit, nMarker: L.markers.length, mAnz: p.mAnz, titleH: I.titleShrunk });
  }
  return out;
}, varianten);
for (const r of res){
  ok(`${r.name}: Gravur innerhalb der Platte`, r.inside, r.eb.map(x => +x.toFixed(1)));
  ok(`${r.name}: Abstand Gravur–Aufhängeloch ≥ 1 mm`, r.holeClr >= 1, +r.holeClr.toFixed(2));
  ok(`${r.name}: Marker kleiner als Feld`, r.markerD < r.cell - 1, [+r.markerD.toFixed(1), +r.cell.toFixed(1)]);
  ok(`${r.name}: Markeranzahl`, r.nMarker === r.mAnz * r.nK, [r.nMarker, r.mAnz, r.nK]);
  if (r.back !== null) ok(`${r.name}: ein Loch je Feld in der Rückplatte`, r.back === r.cells, [r.back, r.cells]);
}
ok('Herz-Form mit Ø6-Magnet passt (große Tafel)', res.find(r => /Herz-Form/.test(r.name)).magFit);
ok('3 Kinder: Stern, Herz, Sonne', res.find(r => r.name === '3 Kinder, kurze Tage').kidMot === 'stern,herz,sonne', res.find(r => r.name === '3 Kinder, kurze Tage').kidMot);
ok('Rückplatte: Löcher auch im Sternen-Feld', res.find(r => r.name === '3 Kinder, Rückplatte').parkHoles > 0);

// Symbole
const sym = await pg.evaluate(() => {
  const guess = ['Zähne putzen','Zimmer aufräumen','Anziehen','Hände waschen','Tisch decken','Ins Bett gehen','Hausaufgaben machen','Blumen gießen','Gassi gehen','Klavier üben','Freundlich sein','Schultasche packen','Wasser trinken','Pünktlich sein','Irgendwas'].map(t => [t, _belGuessIcon(t)]);
  const sizes = Object.keys(_BEL_ICONS).map(k => { const o = _belIcon(k, 0, 0, 20, 1, []); const xs = o.flat(2); let a = 1e9, b = -1e9; for (const q of xs){ a = Math.min(a, q[0], q[1]); b = Math.max(b, q[0], q[1]); } return [k, o.length, +a.toFixed(1), +b.toFixed(1)]; });
  return { guess, sizes };
});
const want = { 'Zähne putzen':'zahn','Zimmer aufräumen':'kiste','Anziehen':'shirt','Hände waschen':'tropfen','Tisch decken':'teller','Ins Bett gehen':'mond','Hausaufgaben machen':'buch','Blumen gießen':'blume','Gassi gehen':'pfote','Klavier üben':'note','Freundlich sein':'herz','Schultasche packen':'ranzen','Wasser trinken':'tasse','Pünktlich sein':'uhr','Irgendwas':'stern' };
for (const [t, k] of sym.guess) ok(`Symbol für „${t}"`, want[t] === k, k);
for (const [k, n, a, z] of sym.sizes) ok(`Symbol ${k} liegt im Kasten`, n > 0 && a >= -1.5 && z <= 21.5, [n, a, z]);

// SVG
const svg = await pg.evaluate(async () => {
  const r = {};
  for (const [nm, extra, teil] of [['alles', {}, 'alles'], ['ring', { mMag: 'ring', halt: 'scheiben', blatt: 450 }, 'alles'], ['marker', {}, 'marker']]){
    const p = Object.assign(JSON.parse(JSON.stringify(_BEL_DEF)), extra);
    const s = await _belBuildSVG(p, teil);
    const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
    const g = doc.getElementById('gravieren'), c = doc.getElementById('schneiden');
    r[nm] = { ok: !doc.querySelector('parsererror'), w: doc.documentElement.getAttribute('width'), h: doc.documentElement.getAttribute('height'),
      park: _belLayout(p).info.parkHoles || 0, eng: g.querySelectorAll('path').length, cut: c.querySelectorAll('path').length, len: s.length };
  }
  return r;
});
ok('SVG alles: gültig, mm', svg.alles.ok && /mm$/.test(svg.alles.w), svg.alles);
ok('SVG alles: Breite ≤ Arbeitsfläche 400', parseFloat(svg.alles.w) <= 400.01, svg.alles.w);
ok('SVG alles: Gravur verschweißt (1 Pfad je Teil = 1 + 21)', svg.alles.eng === 22, svg.alles.eng);
ok('SVG alles: Schnitte = Kontur + 2 Löcher + 21 Marker', svg.alles.cut === 24, svg.alles.cut);
ok('SVG Ring+Rückplatte: Schnitte', svg.ring.cut === 3 + (3 + 49 + svg.ring.park) + 21 + 21 * 2, [svg.ring.cut, svg.ring.park]);
ok('SVG nur Marker: 21 Gravur, 21 Schnitte', svg.marker.eng === 21 && svg.marker.cut === 21, svg.marker);

// Dialog
await pg.evaluate(() => _belOpen());
await pg.waitForTimeout(300);
const n0 = await pg.$$eval('#bel-tasks .bel-task', e => e.length);
await pg.click('#bel-add');
await pg.keyboard.type('Gassi gehen');
await pg.waitForTimeout(200);
const n1 = await pg.$$eval('#bel-tasks .bel-task', e => e.length);
const last = await pg.evaluate(() => _belP.tasks[_belP.tasks.length - 1].t);
ok('Aufgabe hinzufügen + tippen', n1 === n0 + 1 && last === 'Gassi gehen', [n0, n1, last]);
await pg.click('#bel-tasks .bel-task:first-child .vtb');
ok('Aufgabe löschen', (await pg.$$eval('#bel-tasks .bel-task', e => e.length)) === n0);
await pg.fill('#bel-titel', 'Theos Belohnungstafel');
await pg.waitForTimeout(300);
await pg.screenshot({ path: 'tests/belohnungstafel.png' });
ok('Katalog-Eintrag vorhanden', await pg.evaluate(() => _STARTERS.some(s => /Belohnungstafel/.test(s.t))));
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
