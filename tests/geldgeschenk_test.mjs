// Regressionstest für den Generator „Geldgeschenk-Platten (Laser)" (💶, _ggp*).
//   1. Varianten: Kontur, Löcher/Schlitze vorne und hinten deckungsgleich
//   2. alles innerhalb der Platte, Motiv mit Steg ≥ 3 mm zum Rand, kein
//      Motiv-Ring berührt Text, Löcher oder das Band
//   3. Weltkarte: genug Kontinente/Inseln, „ohne kleine Inseln" lässt weniger übrig
//   4. Text mit Umlauten ergibt Formen, zu langer Text wird schmaler gesetzt
//   5. SVG: Ebenen Gravieren/Schneiden, Gravur je Platte verschweißt (ein Pfad),
//      Maße in mm, mehrere Garnituren bleiben in der Arbeitsfläche
//   6. Dialog: Vorlage setzt Text + Motiv, DIN-Formate/Hochformat/freie Maße, keine Seitenfehler; Screenshot
// Start: python3 volme3d_server.py 8766 --dev   →   node tests/geldgeschenk_test.mjs
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window._ggpOpen === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  localStorage.removeItem('v3d_ggp');
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

const varianten = [
  { name: 'Standard (Reisekasse, Weltkarte, Löcher)', p: {} },
  { name: 'Schlitze, Band links+rechts',              p: { bind: 'schlitz' } },
  { name: 'Schlitze, Band oben+unten, Text unten',    p: { bind: 'schlitz', band: 'waag', textPos: 'unten' } },
  { name: 'Herz, zweite Zeile, Rückgravur',           p: { text1: 'Hochzeitskasse', motiv: 'herz', text2: 'Anna & Tom 2026', rueck: 'Alles Liebe!' } },
  { name: 'Haus, Pacifico, klein 120×80',             p: { text1: 'Fürs Nest', motiv: 'haus', font: 'pacifico_local', B: 120, H: 80 } },
  { name: 'Ballon',                                   p: { text1: 'Happy Birthday', motiv: 'ballon' } },
  { name: 'Stern graviert',                           p: { motiv: 'stern', motivArt: 'eng' } },
  { name: 'Fenster, ohne Bindung',                    p: { motiv: 'fenster', bind: 'keine' } },
  { name: 'Oval, große Ecken',                        p: { motiv: 'oval', rad: 15 } },
  { name: 'kein Motiv, groß',                         p: { motiv: 'keins', textH: 30 } },
  { name: 'Weltkarte ohne kleine Inseln',             p: { inseln: false } },
  { name: 'DIN A4 quer',                              p: { B: 297, H: 210, textH: 42 } },
  { name: 'DIN A4 hoch',                              p: { B: 210, H: 297, textH: 42 } },
  { name: 'DIN A3 quer, Schlitze',                    p: { B: 420, H: 297, textH: 59.5, bind: 'schlitz' } },
  { name: 'DIN A6 quer',                              p: { B: 148, H: 105, textH: 21 } },
  { name: 'DIN A7 quer',                              p: { B: 105, H: 74, textH: 15 } },
  { name: 'DIN lang',                                 p: { B: 210, H: 99, textH: 20 } },
];

const res = await pg.evaluate((varianten) => {
  const out = [];
  const bbox = rs => { const b = [1e9, 1e9, -1e9, -1e9]; for (const r of rs) for (const q of r){ b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); } return b; };
  const dist = (p, r) => { let m = 1e9; for (let i = 0; i < r.length; i++){ const a = r[i], c = r[(i + 1) % r.length]; const dx = c[0] - a[0], dy = c[1] - a[1], L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); m = Math.min(m, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])); } return m; };
  for (const v of varianten){
    const p = Object.assign({}, _GGP_DEF, v.p);
    const L = _ggpLayout(p);
    const nHole = p.bind === 'keine' ? 0 : 4;
    const fHoles = L.front.cut.slice(1, 1 + nHole), bHoles = L.back.cut.slice(1);
    const motiv = p.motivArt === 'eng' ? [] : L.front.cut.slice(1 + nHole);
    const all = bbox(L.front.cut);
    // Motiv: Abstand jedes Punkts zum Plattenrand
    let steg = 1e9; const mb = L.info.motivBox;
    if (mb) steg = Math.min(mb[0], mb[1], p.B - mb[2], p.H - mb[3]);
    // Text-Box gegen Motiv-Box
    const textRings = p.motivArt === 'eng' ? null : L.front.eng.flat();
    const tbb = textRings && textRings.length ? bbox(textRings) : null;
    const overlapTM = (tbb && mb) ? !(tbb[2] < mb[0] || mb[2] < tbb[0] || tbb[3] < mb[1] || mb[3] < tbb[1]) : false;
    // Löcher gegen Motiv: Mindestabstand Lochmitte → Motivringe
    let holeClr = 1e9;
    for (const h of fHoles){ const c = bbox([h]); const cx = (c[0] + c[2]) / 2, cy = (c[1] + c[3]) / 2, rr = Math.max(c[2] - c[0], c[3] - c[1]) / 2;
      for (const r of motiv) holeClr = Math.min(holeClr, dist([cx, cy], r) - rr); }
    // Band-Linie gegen Motiv/Text: Band liegt bei x=a (senk) bzw. y=a (waag)
    const bd = L.info.band; let bandClr = 1e9;
    if (p.bind !== 'keine') for (const r of [...motiv, ...(textRings || [])]) for (const q of r){
      bandClr = Math.min(bandClr, bd.senk ? Math.min(Math.abs(q[0] - bd.a), Math.abs(q[0] - (p.B - bd.a))) : Math.min(Math.abs(q[1] - bd.a), Math.abs(q[1] - (p.H - bd.a))));
    }
    const same = fHoles.length === bHoles.length && fHoles.every((h, i) => h.length === bHoles[i].length && h.every((q, j) => Math.abs(q[0] - bHoles[i][j][0]) < 1e-9 && Math.abs(q[1] - bHoles[i][j][1]) < 1e-9));
    out.push({ name: v.name, inside: all[0] >= -1e-6 && all[1] >= -1e-6 && all[2] <= p.B + 1e-6 && all[3] <= p.H + 1e-6,
      nHole: fHoles.length, wantHole: nHole, same, steg: +steg.toFixed(2), overlapTM, holeClr: +holeClr.toFixed(2), bandClr: +bandClr.toFixed(2),
      nMotiv: motiv.length, nEng: L.front.eng.length, nBackEng: L.back.eng.length, textH: +L.info.textH.toFixed(1), scheine: L.info.scheine, motiv: p.motiv, art: p.motivArt, rueck: !!p.rueck });
  }
  return out;
}, varianten);

for (const r of res){
  console.log(`\n${r.name}`);
  ok('innerhalb der Platte', r.inside);
  ok(`Löcher vorne = ${r.wantHole} und hinten deckungsgleich`, r.nHole === r.wantHole && r.same, { n: r.nHole });
  if (r.motiv !== 'keins'){
    ok('Motiv vorhanden', r.art === 'eng' ? r.nEng > 1 : r.nMotiv > 0, { n: r.nMotiv });
    ok('Steg Motiv → Plattenrand ≥ 3 mm', r.steg >= 3, r.steg);
    ok('Motiv überlappt Text nicht', !r.overlapTM);
    if (r.wantHole && r.art !== 'eng') ok('Motiv ≥ 2 mm von Löchern/Schlitzen', r.holeClr >= 2, r.holeClr);
  }
  if (r.wantHole) ok('Text/Motiv ≥ 2 mm neben dem Band', r.bandClr >= 2, r.bandClr);
  ok('Text erzeugt', r.nEng > 0 && r.textH > 3, r.textH);
  if (r.rueck) ok('Rückplatte graviert', r.nBackEng > 0);
}
const welt = res.find(r => r.name.startsWith('Standard')), ohne = res.find(r => r.name.includes('ohne kleine'));
console.log('\nWeltkarte');
ok('Weltkarte ≥ 20 Teile', welt.nMotiv >= 20, welt.nMotiv);
ok('ohne kleine Inseln weniger Teile', ohne.nMotiv < welt.nMotiv, [ohne.nMotiv, welt.nMotiv]);
ok('Standardplatte: 50-€-Schein passt ungefaltet', welt.scheine.includes(50), welt.scheine);

// Text: Umlaute + zu langer Text
const tx = await pg.evaluate(() => {
  const a = _ggpText('Für euch – süß & schön', 'greatvibes_local', 20, 0, 0, 1000);
  const c = _ggpText('Eine sehr sehr lange Reisekasse für alle', 'greatvibes_local', 20, 0, 0, 100);
  return { n: a.shapes.length, h: a.h, wLong: c.w, hLong: c.h };
});
console.log('\nText');
ok('Umlaute/ß/& ergeben Formen', tx.n >= 12, tx.n);
ok('zu langer Text passt in die Breite', tx.wLong <= 100.001 && tx.hLong < 20, tx);

// SVG
const sv = await pg.evaluate(async () => {
  const p = Object.assign({}, _GGP_DEF, { anzahl: 3, blatt: 400, rueck: 'Gute Reise!' });
  const svg = await _ggpBuildSVG(p);
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const g = id => doc.getElementById(id);
  const L = _ggpLayout(p), S = _ggpSheet(L, p.anzahl, p.blatt);
  // gerade/ungerade-Füllung des verschweißten Textes: Fläche > 0 und kein Ring doppelt
  return { err: !!doc.querySelector('parsererror'), w: root.getAttribute('width'), h: root.getAttribute('height'),
    nEng: g('gravieren').querySelectorAll('path').length, nCut: g('schneiden').querySelectorAll('path').length,
    wantCut: 3 * (L.front.cut.length + L.back.cut.length), SW: S.SW, maxX: Math.max(...S.placed.map(q => q.dx + L.W)),
    stroke: g('schneiden').getAttribute('stroke'), fill: g('gravieren').getAttribute('fill'), len: svg.length };
});
console.log('\nSVG');
ok('SVG gültig', !sv.err);
ok('Maße in mm', /mm$/.test(sv.w) && /mm$/.test(sv.h), [sv.w, sv.h]);
ok('Gravur verschweißt: 1 Pfad je Platte (3 vorne + 3 hinten)', sv.nEng === 6, sv.nEng);
ok('alle Schnittkonturen drin', sv.nCut === sv.wantCut, [sv.nCut, sv.wantCut]);
ok('Schneiden rot / Gravieren schwarz', sv.stroke === '#ff0000' && sv.fill === '#000000');
ok('3 Garnituren in 400 mm Arbeitsfläche', sv.maxX <= 400, sv.maxX);
ok('SVG nicht riesig (< 1,5 MB)', sv.len < 1.5e6, sv.len);

// Dialog
await pg.evaluate(() => _ggpOpen());
await pg.waitForTimeout(300);
await pg.selectOption('#ggp-spruch', 'Hochzeitskasse');
await pg.waitForTimeout(200);
const ui = await pg.evaluate(() => ({ t: document.getElementById('ggp-text1').value, m: _ggpP.motiv, on: document.querySelector('#ggp-motive .vtb.on')?.dataset.k }));
ok('Vorlage setzt Text + Motiv', ui.t === 'Hochzeitskasse' && ui.m === 'herz' && ui.on === 'herz', ui);
await pg.selectOption('#ggp-spruch', 'Reisekasse');
await pg.waitForTimeout(300);
await pg.locator('#ggp-modal .g3box').screenshot({ path: '/tmp/ggp_dialog.png' });
await pg.evaluate(() => { _ggpSet('bind', 'schlitz'); _ggpSet('text2', 'Für Lena & Max'); });
await pg.waitForTimeout(300);
await pg.locator('#ggp-canvas').screenshot({ path: '/tmp/ggp_schlitz.png' });
await pg.evaluate(() => _ggpReset());
// Formate
const fm = await pg.evaluate(() => {
  const r = {};
  _ggpSetFmt('a4'); r.a4 = [_ggpP.B, _ggpP.H, _ggpP.fmt, _ggpP.textH, document.getElementById('ggp-Bn').value];
  _ggpSetOri('hoch'); r.hoch = [_ggpP.B, _ggpP.H, _ggpP.fmt, document.querySelector('#ggp-ori .vtb.on')?.dataset.v];
  _ggpSetFmt('a6'); r.a6hoch = [_ggpP.B, _ggpP.H];
  _ggpSet('B', 123.5); r.frei = [_ggpP.B, _ggpP.fmt, document.getElementById('ggp-fmt').value];
  _ggpSet('B', 210); _ggpSet('H', 99); r.lang = _ggpP.fmt;
  _ggpSet('H', 999); r.clamp = _ggpP.H;
  return r;
});
console.log('\nFormate');
ok('DIN A4 setzt 297 × 210 und skaliert die Schrift', fm.a4[0] === 297 && fm.a4[1] === 210 && fm.a4[2] === 'a4' && fm.a4[3] === 42 && fm.a4[4] === '297', fm.a4);
ok('Hochformat tauscht Breite/Höhe, Format bleibt A4', fm.hoch[0] === 210 && fm.hoch[1] === 297 && fm.hoch[2] === 'a4' && fm.hoch[3] === 'hoch', fm.hoch);
ok('Formatwechsel behält Hochformat', fm.a6hoch[0] === 105 && fm.a6hoch[1] === 148, fm.a6hoch);
ok('freie Maße → „Eigene Maße"', fm.frei[0] === 123.5 && fm.frei[1] === 'eigen' && fm.frei[2] === 'eigen', fm.frei);
ok('getippte 210 × 99 erkennen DIN lang', fm.lang === 'lang', fm.lang);
ok('Maße auf 450 mm begrenzt', fm.clamp === 450, fm.clamp);
await pg.evaluate(() => { _ggpReset(); _ggpSetFmt('a5'); _ggpSetOri('hoch'); });
await pg.waitForTimeout(300);
await pg.locator('#ggp-modal .g3box').screenshot({ path: '/tmp/ggp_a5hoch.png' });
await pg.evaluate(() => _ggpReset());
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES OK');
process.exit(fails.length ? 1 : 0);
