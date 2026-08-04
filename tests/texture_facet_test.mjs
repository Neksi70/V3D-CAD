// Regressionstest für die kantigen Texturen ("Kantig"-Profil).
//
// Geprüft wird, was beim Drucken zählt:
//   1. die Muster-Höhenfunktion ist im kantigen Profil stückweise LINEAR
//      (ebene Flanken statt Sinus-Rundung)
//   2. das erzeugte Netz zerfällt in große ebene Facetten mit scharfen Graten
//      statt in eine gleichmäßig gekrümmte Wellenlandschaft
//   3. die Knick-Verfeinerung bleibt WASSERDICHT (jede Kante genau 2 Dreiecke) —
//      das ist die eigentliche Gefahr beim Verschieben der Teilungspunkte
//   4. das runde Profil liefert weiter das alte Ergebnis
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK  ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
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

console.log('\n=== 1. Höhenfunktion: kantig ist stückweise linear ===');
const r1 = await pg.evaluate(() => {
  // Zweite Ableitung entlang einer Linie: bei einer Sinuswelle überall ≠ 0,
  // bei einer Dreiecks-/Trapezform fast überall 0 mit einzelnen Ausreißern
  // an den Knicken.
  const scan = (pat, sharp) => {
    const N = 400, h = [];
    for (let i = 0; i <= N; i++) h.push(_patternHeight(pat, i / N * 2 - 1, 0.137, 4, sharp));
    const d2 = [];
    for (let i = 1; i < N; i++) d2.push(Math.abs(h[i - 1] - 2 * h[i] + h[i + 1]));
    const max = Math.max(...d2);
    return { flach: d2.filter(v => v < max * 0.02).length / d2.length, max: +max.toFixed(5) };
  };
  return {
    riffelRund:   scan('riffel', false),
    riffelKantig: scan('riffel', true),
    diaRund:      scan('diamant', false),
    diaKantig:    scan('diamant', true),
    wabenKantig:  scan('waben', true),
    // organische Muster dürfen sich NICHT ändern (weder Höhe noch Pipeline)
    rauschGleich: _patternHeight('rauschen', 0.3, 0.7, 4, true) === _patternHeight('rauschen', 0.3, 0.7, 4, false),
    holzGleich:   _patternHeight('holz', 0.3, 0.7, 4, true) === _patternHeight('holz', 0.3, 0.7, 4, false),
    // Wertebereich bleibt 0..1
    spanne: (() => { let mn = 9, mx = -9;
      for (const p of ['riffel','diamant','waben','wellen','punkte'])
        for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
          const t = _patternHeight(p, i/30 - 1, j/30 - 1, 4, true);
          mn = Math.min(mn, t); mx = Math.max(mx, t);
        }
      return [+mn.toFixed(3), +mx.toFixed(3)]; })()
  };
});
console.log('   ', JSON.stringify(r1));
ok('Riffel rund ist überall gekrümmt', r1.riffelRund.flach < 0.2, r1.riffelRund);
ok('Riffel kantig ist fast überall gerade', r1.riffelKantig.flach > 0.9, r1.riffelKantig);
ok('Diamant kantig ist fast überall gerade', r1.diaKantig.flach > 0.9, r1.diaKantig);
ok('Waben kantig ist fast überall gerade', r1.wabenKantig.flach > 0.85, r1.wabenKantig);
ok('Rauschen bleibt unverändert (organisch)', r1.rauschGleich);
ok('Holz bleibt unverändert (organisch)', r1.holzGleich);
ok('Höhen bleiben in 0..1', r1.spanne[0] >= 0 && r1.spanne[1] <= 1, r1.spanne);

console.log('\n=== 2./3. Netz: Facetten, Grate, Dichtheit ===');
const r2 = await pg.evaluate(async prof => {
  window._getObjects().length = 0;
  scene.children.filter(c => c.isMesh && c.userData && c.userData.id != null).forEach(c => scene.remove(c));
  addShape('box');
  const o = window._getObjects().slice(-1)[0];
  o.scale.set(2, 2, 2); o.position.set(0, 2, 0);
  o.updateWorldMatrix(true, true);
  selectObjs([o]);
  const res = {};
  for (const p of ['rund', 'kantig']) {
    o.userData.texProfile = p;
    o.userData._warpCache = null;
    const t0 = performance.now();
    applyDisplacement('pattern', 'diamant');
    _applyDisplacementNow('freq', 6);
    _applyDisplacementNow('amp', 1.5);
    const ms = performance.now() - t0;
    const g = o.geometry;
    const pos = g.attributes.position.array;
    const idx = g.index ? Array.from(g.index.array) : null;

    // Ecken über die Position verschweißen (kantig liefert nicht-indiziert)
    const key = i => Math.round(pos[i*3]*1e4)+'_'+Math.round(pos[i*3+1]*1e4)+'_'+Math.round(pos[i*3+2]*1e4);
    const vid = new Map(); const remap = [];
    const nV = pos.length / 3;
    for (let i = 0; i < nV; i++) { const k = key(i); let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); } remap[i] = id; }
    const tri = [];
    if (idx) for (let i = 0; i < idx.length; i += 3) tri.push([remap[idx[i]], remap[idx[i+1]], remap[idx[i+2]]]);
    else      for (let i = 0; i < nV;      i += 3) tri.push([remap[i], remap[i+1], remap[i+2]]);

    // Kanten-Nutzung: wasserdicht = jede Kante genau 2×
    const edge = new Map();
    const fn = [];
    // Flächennormalen
    const rawIdx = idx || Array.from({length: nV}, (_, i) => i);
    for (let t = 0; t < tri.length; t++) {
      const a = rawIdx[t*3]*3, bb = rawIdx[t*3+1]*3, c = rawIdx[t*3+2]*3;
      const ux = pos[bb]-pos[a], uy = pos[bb+1]-pos[a+1], uz = pos[bb+2]-pos[a+2];
      const vx = pos[c]-pos[a],  vy = pos[c+1]-pos[a+1],  vz = pos[c+2]-pos[a+2];
      let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      fn.push([nx/l, ny/l, nz/l]);
      const e = tri[t];
      for (let k = 0; k < 3; k++) {
        const x = e[k], y = e[(k+1)%3];
        const kk = x < y ? x+'_'+y : y+'_'+x;
        (edge.get(kk) || edge.set(kk, []).get(kk)).push(t);
      }
    }
    let offen = 0, mehrfach = 0;
    const winkel = [];
    edge.forEach(l => {
      if (l.length === 1) offen++;
      else if (l.length > 2) mehrfach++;
      else {
        const [x, y] = l;
        const d = Math.max(-1, Math.min(1, fn[x][0]*fn[y][0] + fn[x][1]*fn[y][1] + fn[x][2]*fn[y][2]));
        winkel.push(Math.acos(d) * 180 / Math.PI);
      }
    });
    winkel.sort((a, b2) => a - b2);
    res[p] = {
      verts: nV, tris: tri.length, ms: Math.round(ms), offen, mehrfach,
      eben:  +(winkel.filter(w => w < 2).length / winkel.length).toFixed(3),
      grate: +(winkel.filter(w => w > 25).length / winkel.length).toFixed(3),
      weich: +(winkel.filter(w => w >= 2 && w <= 25).length / winkel.length).toFixed(3),
      median: +winkel[Math.floor(winkel.length/2)].toFixed(2),
      max: +winkel[winkel.length-1].toFixed(1)
    };
  }
  return res;
});
console.log('    rund  :', JSON.stringify(r2.rund));
console.log('    kantig:', JSON.stringify(r2.kantig));
ok('rund: wasserdicht (keine offenen Kanten)', r2.rund.offen === 0 && r2.rund.mehrfach === 0, [r2.rund.offen, r2.rund.mehrfach]);
ok('kantig: wasserdicht trotz verschobener Teilungspunkte', r2.kantig.offen === 0 && r2.kantig.mehrfach === 0, [r2.kantig.offen, r2.kantig.mehrfach]);
// „weich" = die verwaschene Mitte: weder ebene Fläche noch echte Kante. Genau
// die soll verschwinden — das ist der Unterschied zwischen gedruckter Raute
// und gedrucktem Hügel.
ok('kantig halbiert die verwaschene Mitte', r2.kantig.weich < r2.rund.weich * 0.6, [r2.rund.weich, r2.kantig.weich]);
ok('kantig hat deutlich mehr ebene Fläche', r2.kantig.eben > r2.rund.eben, [r2.rund.eben, r2.kantig.eben]);
ok('kantig hat ein Vielfaches an echten Graten', r2.kantig.grate > r2.rund.grate * 5, [r2.rund.grate, r2.kantig.grate]);
ok('kantig braucht WENIGER Dreiecke als rund', r2.kantig.tris < r2.rund.tris, [r2.rund.tris, r2.kantig.tris]);
ok('kantig rechnet in vertretbarer Zeit (< 6 s)', r2.kantig.ms < 6000, r2.kantig.ms + ' ms');

console.log('\n=== 4. Alt-Szenen bleiben rund ===');
const r3 = await pg.evaluate(() => {
  // Laden simulieren: gespeicherter Datensatz MIT Textur, aber OHNE texProfile
  const alt = buildObjectFromData({ type: 'box', shapeType: 'box',
    displacementPattern: 'waben', displacementAmp: 1, displacementFreq: 4 });
  // … und ein gespeichertes Teil OHNE Textur
  const leer = buildObjectFromData({ type: 'box', shapeType: 'box' });
  return { alt: alt && alt.userData.texProfile, leer: leer && leer.userData.texProfile };
});
ok('geladenes Teil MIT Textur bleibt rund', r3.alt === 'rund', r3.alt);
ok('geladenes Teil ohne Textur startet kantig', r3.leer === 'kantig', r3.leer);

const r4 = await pg.evaluate(() => {
  // Neu angelegter Körper: kantig als Standard
  addShape('box');
  const o = window._getObjects().slice(-1)[0];
  applyDisplacement('pattern', 'riffel');
  return o.userData.texProfile || 'kantig';
});
ok('neue Textur ist standardmäßig kantig', r4 === 'kantig', r4);

console.log('\n=== 5. Grenzfälle: harte Kanten-Muster, feine Skalierung, Rundkörper ===');
const r5 = await pg.evaluate(() => {
  const res = {};
  const bau = (form, pat, freq, prof) => {
    window._getObjects().length = 0;
    scene.children.filter(c => c.isMesh && c.userData && c.userData.id != null).forEach(c => scene.remove(c));
    addShape(form);
    const o = window._getObjects().slice(-1)[0];
    o.scale.set(3, 3, 3); o.position.set(0, 3, 0); o.updateWorldMatrix(true, true);
    selectObjs([o]);
    o.userData.texProfile = prof || 'kantig'; o.userData._warpCache = null;
    const t0 = performance.now();
    applyDisplacement('pattern', pat);
    _applyDisplacementNow('freq', freq);
    _applyDisplacementNow('amp', 1.2);
    const ms = Math.round(performance.now() - t0);
    const g = o.geometry, pos = g.attributes.position.array;
    const idx = g.index ? Array.from(g.index.array) : null;
    const nV = pos.length / 3;
    const key = i => Math.round(pos[i*3]*1e4)+'_'+Math.round(pos[i*3+1]*1e4)+'_'+Math.round(pos[i*3+2]*1e4);
    const vid = new Map(), remap = [];
    for (let i = 0; i < nV; i++) { const k = key(i); let id = vid.get(k); if (id === undefined) { id = vid.size; vid.set(k, id); } remap[i] = id; }
    const tri = [];
    if (idx) for (let i = 0; i < idx.length; i += 3) tri.push([remap[idx[i]], remap[idx[i+1]], remap[idx[i+2]]]);
    else      for (let i = 0; i < nV;      i += 3) tri.push([remap[i], remap[i+1], remap[i+2]]);
    const edge = new Map();
    for (const t of tri) for (let k = 0; k < 3; k++) {
      const x = t[k], y = t[(k+1)%3], kk = x < y ? x+'_'+y : y+'_'+x;
      edge.set(kk, (edge.get(kk) || 0) + 1);
    }
    let offen = 0, mehrfach = 0;
    edge.forEach(n => { if (n === 1) offen++; else if (n > 2) mehrfach++; });
    return { tris: tri.length, ms, offen, mehrfach, endlich: pos.every(v => isFinite(v)) };
  };
  res.gitterFein     = bau('box', 'gitter', 30);
  res.gitterFeinRund = bau('box', 'gitter', 30, 'rund');
  res.zylinder   = bau('cylinder', 'waben', 8);
  res.rauschen   = bau('box', 'rauschen', 8);
  return res;
});
console.log('   ', JSON.stringify(r5));
ok('feines Gitter (Skalierung 30) bleibt wasserdicht', r5.gitterFein.offen === 0 && r5.gitterFein.mehrfach === 0, r5.gitterFein);
// Bei sehr feiner Skalierung greift die (schon vorher vorhandene) Obergrenze der
// Unterteilung — kantig darf dabei nicht teurer werden als der runde Weg.
ok('feines Gitter kostet nicht mehr als rund', r5.gitterFein.tris <= r5.gitterFeinRund.tris, [r5.gitterFeinRund.tris, r5.gitterFein.tris]);
ok('feines Gitter rechnet in vertretbarer Zeit (< 15 s)', r5.gitterFein.ms < 15000, r5.gitterFein.ms + ' ms');
ok('Zylinder (gekrümmt, triplanar) bleibt wasserdicht', r5.zylinder.offen === 0 && r5.zylinder.mehrfach === 0, r5.zylinder);
ok('keine NaN-Koordinaten', r5.gitterFein.endlich && r5.zylinder.endlich && r5.rauschen.endlich);

const echteFehler = pageErrors.filter(e => !/favicon|firebase|net::ERR|Failed to load resource/i.test(e));
ok('keine JS-Fehler', echteFehler.length === 0, echteFehler.slice(0, 3));

await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLGESCHLAGEN: ' + fails.join(' | ') : '\nAlle Prüfungen bestanden.');
process.exit(fails.length ? 1 : 0);
