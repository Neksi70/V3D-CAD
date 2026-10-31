// Regressionstest für den Generator „Lichttüte" (🛍️, _ltt*): Papiertüte mit Zackenrand,
// vorne Kranz + zwei Textzeilen + Motiv als Lithophanie.
//   1. alle Varianten bauen wasserdicht, EIN Stück, Volumen > 0
//   2. Maße: innen/graviert exakt B × H × T, außen wächst nur vorne/hinten um das Relief
//   3. Innen-Relief: Front wird dicker (Wand + Relief), aber nie bis an die Seitenwand
//   4. Zackenrand: Spitzen erreichen H, Täler liegen H − Tiefe; gerade = überall H
//   5. Schrift trifft: Volumen mit Text > ohne Text; Text lesbar (nicht gespiegelt): erster
//      Buchstabe links von außen gesehen
//   6. Erstellen + Speichern + Bearbeiten an Ort und Stelle
// Start: python3 volme3d_server.py 8861 --dev → V3D_URL=http://127.0.0.1:8861/volme3d.html node tests/lichttuete_test.mjs
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
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});
await pg.evaluate(async () => { await _mfInit(); _lttFont('greatvibes_local'); _lttFont('sniglet_local'); });

const varianten = [
  { name: 'Adventszauber innen (Standard)', p: {} },
  { name: 'außen erhaben, hinten dasselbe', p: { art: 'aussen', rueck: 'gleich' } },
  { name: 'graviert, Wand 1,6', p: { art: 'gravur', wand: 1.6, relief: 0.8 } },
  { name: 'Weihnachten, gerade, ohne Boden, glatt', p: { text1: 'Frohe', text2: 'WEIHNACHTEN', motiv: 'tanne', rand: 'gerade', boden: 0, falten: 0, kranz: 'kreis' } },
  { name: 'Name ohne Kranz, kleine Tüte', p: { text1: 'Lena', text2: '', motiv: 'sterne', kranz: 'keiner', breite: 50, tiefe: 40, hoehe: 70, sternchen: 0 } },
  { name: 'Riesentext schrumpft, Hirsch', p: { h1: 50, h2: 40, motiv: 'hirsch', motivH: 60 } },
  { name: 'nur Kranz, keine Schrift, kein Motiv', p: { text1: '', text2: '', motiv: 'keins', sternchen: 0 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(p => {
    Object.assign(_lttP, JSON.parse(JSON.stringify(_LTT_DEF)), p);
    const t0 = performance.now();
    const res = _lttBuild(_mfWasm, _lttP, 'fein'), d = res.d;
    const ms = Math.round(performance.now() - t0);
    const pos = res.geo.toNonIndexed().attributes.position.array, mf = _mfFromSoup(_mfWasm, pos);
    res.geo.computeBoundingBox(); const bb = res.geo.boundingBox;
    // Y oben, Vorderseite bei z = +D/2 (nach −90° um X)
    let frontIn = -1e9, nahSeite = 0, topMin = 1e9, topMax = -1e9;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (y > d.zLo && y < d.zHi && z > 0 && Math.abs(x) < d.W / 2 - d.t - 0.01) frontIn = Math.max(frontIn, d.D / 2 - z);  // wie weit reicht die Front nach innen
      if (y > d.zLo && y < d.zHi && z > 0 && d.D / 2 - z > d.t + 0.05 && d.D / 2 - z < d.t + 3.5 && Math.abs(Math.abs(x) - (d.W / 2 - d.t)) < 0.05) nahSeite++;
    }
    // Oberkante entlang der Front-Außenseite
    for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i + 2] - d.D / 2) < 0.01 && pos[i + 1] > d.H - d.zT - 1) { topMin = Math.min(topMin, pos[i + 1]); topMax = Math.max(topMax, pos[i + 1]); }
    return { ms, warn: res.warn, genus: mf.genus(), vol: mf.volume(), parts: mf.decompose().length,
      bb: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map(x => Math.round(x * 100) / 100),
      d: { W: d.W, D: d.D, H: d.H, t: d.t, zT: d.zT }, frontIn, nahSeite, topMin, topMax };
  }, v.p);
  console.log('— ' + v.name + ' (' + r.ms + ' ms)' + (r.warn.length ? ' warn: ' + r.warn.join(' | ') : ''));
  const d = r.d, art = v.p.art || 'innen', rz = v.p.relief || 1;
  ok('dicht, 1 Teil, Vol>0', r.parts === 1 && r.vol > 0 && r.genus >= 0, { parts: r.parts, vol: Math.round(r.vol), genus: r.genus });
  const ex = art === 'aussen' ? rz * (v.p.rueck === 'gleich' ? 2 : 1) : 0;
  ok('Maße', Math.abs(r.bb[3] - r.bb[0] - d.W) < 0.02 && Math.abs(r.bb[4] - r.bb[1] - d.H) < 0.02 && Math.abs(r.bb[5] - r.bb[2] - d.D - ex) < 0.05, r.bb);
  if (art === 'innen' && !(v.p.text1 === '' && v.p.motiv === 'keins' && !v.p.kranz)) ok('Front innen dicker (Wand+Relief)', Math.abs(r.frontIn - (d.t + rz)) < 0.02, r.frontIn);
  ok('Relief berührt Seitenwand nicht', r.nahSeite === 0, r.nahSeite);
  if (d.zT) ok('Zacken: Spitze H, Tal H−Tiefe', Math.abs(r.topMax - d.H) < 0.02 && Math.abs(r.topMin - (d.H - d.zT)) < 0.05, [r.topMin, r.topMax]);
  else ok('gerade Oberkante', Math.abs(r.topMin - d.H) < 0.02, [r.topMin, r.topMax]);
}

// Text trifft + nicht gespiegelt: „F" — Fläche liegt links vom Mittelpunkt (von außen gesehen = −x)
const t = await pg.evaluate(() => {
  const vol = p => { Object.assign(_lttP, JSON.parse(JSON.stringify(_LTT_DEF)), p); const r = _lttBuild(_mfWasm, _lttP, 'fein'); return { r, v: r.vol }; };
  const base = { kranz: 'keiner', motiv: 'keins', sternchen: 0, text2: '', font1: 'baloo_local', h1: 30 };
  const leer = vol({ ...base, text1: '' }).v, mit = vol({ ...base, text1: 'F' });
  const P = mit.r.geo.toNonIndexed().attributes.position.array, d = mit.r.d, tief = d.t + 1;
  let A = 0, AX = 0;
  for (let i = 0; i < P.length; i += 9) {
    const dz = k => Math.abs(d.D / 2 - P[i + k + 2] - tief) < 0.01;
    if (!(dz(0) && dz(3) && dz(6))) continue;
    const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], a = Math.abs(ux * vy - uy * vx) / 2;
    A += a; AX += a * (P[i] + P[i + 3] + P[i + 6]) / 3;
  }
  return { leer, mit: mit.v, A, cx: AX / A };
});
ok('Text erzeugt Relief', t.mit > t.leer + 50, t);
ok('Text nicht gespiegelt (F-Balken links)', t.A > 10 && t.cx < -0.5, t);

// Erstellen, Speichern, Bearbeiten
const e = await pg.evaluate(async () => {
  Object.assign(_lttP, JSON.parse(JSON.stringify(_LTT_DEF)));
  _lttOpen(); await _lttCreate();
  const o = objects.find(x => x.userData.lichttueteParams);
  if (!o) return { fehlt: true };
  const id = o.userData.id, n0 = objects.length;
  const data = objectToData(o);
  _lttEdit(o); _lttP.text1 = 'Hallo'; await _lttCreate();
  return { n0, n1: objects.length, same: objects.includes(o) && o.userData.id === id, text: o.userData.lichttueteParams.text1,
    saved: !!(data && data.lichttueteParams && data.lichttueteParams.text1 === 'Advents'), btn: typeof _lttEdit };
});
ok('Erstellen + Bearbeiten an Ort und Stelle', !e.fehlt && e.n0 === e.n1 && e.same && e.text === 'Hallo', e);
ok('Speichern behält Einstellungen', e.saved, e);
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
