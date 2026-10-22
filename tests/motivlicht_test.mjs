// Regressionstest für den Generator „Motivlicht" (🏮, _mtl*): viereckiger Schirm
// mit Motiv-Schichten + Holzsockel.
//   1. alle Varianten bauen wasserdicht, je EIN Stück, Volumen > 0
//   2. Maße: Schirm innen-Relief = exakt B × H × T, außen wächst um ≤ 3 Stufen
//   3. Innen-Relief bleibt über dem Kragen und unter dem oberen Rand, nie tiefer als Wand + 3 Stufen
//   4. Kragen passt: Außenmaß = Schirm innen − 2 × Passung
//   5. Ausrichtung: asymmetrisches SVG (Quadrat oben links) steht auf Seite 1 und 2
//      richtig herum und nicht gespiegelt (von außen betrachtet)
//   6. Rundum-Wald erreicht alle vier Seiten; Loch-Ebene bricht durch (Volumen sinkt)
//   7. Erstellen legt Schirm + Sockel an, Speichern behält die Einstellungen,
//      Bearbeiten ersetzt an Ort und Stelle
// Start: python3 volme3d_server.py 8853 --dev   →   V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/motivlicht_test.mjs
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
await pg.evaluate(async () => { await _mfInit(); });

const MARKER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0H30V30H0Z"/><path d="M0 80H100V100H0Z"/></svg>';

const varianten = [
  { name: 'Winterwald innen (Standard)', p: {}, vorlage: 'winterwald' },
  { name: 'Winterwald außen',            p: { relief: 'aussen' }, vorlage: 'winterwald' },
  { name: 'Häuser, rechteckig 120×70',   p: { breite: 120, tiefe: 70, schirmH: 140 }, vorlage: 'haeuser' },
  { name: 'Sternenhimmel, 4 Leisten, Kabel', p: { leisten: 4, kabel: 1 }, vorlage: 'sterne' },
  { name: 'Nur Schirm, klein',           p: { teile: 'schirm', breite: 50, tiefe: 50, schirmH: 60 }, vorlage: 'winterwald' },
  { name: 'Nur Sockel, glatt, ohne Mulde', p: { teile: 'sockel', leisten: 0, ledD: 0 }, vorlage: 'leer' },
  { name: 'Dicke Stufen, großer Rand',   p: { wand: 1.2, stufe: 1.5, rand: 12 }, vorlage: 'winterwald' },
];

for (const v of varianten) {
  const r = await pg.evaluate(({ p, vorlage }) => {
    Object.assign(_mtlP, JSON.parse(JSON.stringify(_MTL_DEF)), p);
    _mtlVorlage(vorlage);
    const t0 = performance.now();
    const res = _mtlBuild(_mfWasm, _mtlP, 'fein'), d = res.d;
    const ms = Math.round(performance.now() - t0);
    const an = geo => {
      if (!geo) return null;
      const pos = geo.toNonIndexed().attributes.position.array, mf = _mfFromSoup(_mfWasm, pos);
      geo.computeBoundingBox(); const bb = geo.boundingBox;
      return { pos, genus: mf.genus(), vol: mf.volume(), parts: mf.decompose().length, bb: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z] };
    };
    const S = an(res.shade), B = an(res.base);
    const out = { ms, warn: res.warn, d: { W: d.W, D: d.D, H: d.H, t: d.t, vLo: d.vLo, vHi: d.vHi, ci: d.ci, cj: d.cj, Hs: d.Hs, innen: d.innen } };
    if (S) {
      const st = _mtlP.stufe, maxR = d.t + 3 * st + 0.02;
      let tief = 0, unterKragen = 0, ueberRand = 0;
      for (let i = 0; i < S.pos.length; i += 3) {
        const x = S.pos[i], y = S.pos[i + 1], z = S.pos[i + 2];
        const a = Math.min(d.W / 2 - Math.abs(x), d.D / 2 - Math.abs(z));    // Abstand zur Außenwand (innen > 0)
        if (a > tief) tief = a;
        if (d.innen && a > d.t + 0.02) { if (y < d.vLo - 0.02) unterKragen++; if (y > d.vHi + 0.02) ueberRand++; }
      }
      out.S = { genus: S.genus, vol: S.vol, parts: S.parts, bb: S.bb, tief, maxR, unterKragen, ueberRand };
    }
    if (B) {
      let kragen = 0;
      for (let i = 0; i < B.pos.length; i += 3) if (B.pos[i + 1] > d.Hs + 0.01) kragen = Math.max(kragen, Math.abs(B.pos[i]));
      out.B = { genus: B.genus, vol: B.vol, parts: B.parts, bb: B.bb, kragen };
    }
    return out;
  }, v);
  console.log('— ' + v.name + ' (' + r.ms + ' ms)');
  const d = r.d;
  if (r.S) {
    ok('Schirm wasserdicht, 1 Stück', r.S.parts === 1 && r.S.vol > 0, { parts: r.S.parts, vol: Math.round(r.S.vol) });
    const [x0, y0, z0, x1, y1, z1] = r.S.bb, e = 0.02;
    if (d.innen) ok('Schirm-Maße exakt B×H×T', Math.abs(x1 - x0 - d.W) < e && Math.abs(z1 - z0 - d.D) < e && Math.abs(y0) < e && Math.abs(y1 - d.H) < e, r.S.bb);
    else ok('Schirm außen: Relief steht ≤ 3 Stufen vor', x1 - x0 > d.W + 0.1 && x1 - x0 <= d.W + 2 * 3 * 0.8 + e && Math.abs(y1 - d.H) < e, r.S.bb);
    if (d.innen) {
      ok('Relief nicht tiefer als Wand + 3 Stufen', r.S.tief <= r.S.maxR, { tief: r.S.tief, max: r.S.maxR });
      ok('Relief bleibt über dem Kragen / unter dem Rand', r.S.unterKragen === 0 && r.S.ueberRand === 0, { unterKragen: r.S.unterKragen, ueberRand: r.S.ueberRand });
    }
  }
  if (r.B) {
    ok('Sockel wasserdicht, 1 Stück', r.B.parts === 1 && r.B.vol > 0, { parts: r.B.parts, vol: Math.round(r.B.vol) });
    ok('Sockel steht auf y = 0, Grundfläche = Schirm', Math.abs(r.B.bb[1]) < 0.02 && Math.abs(r.B.bb[3] - r.B.bb[0] - d.W) < 0.02, r.B.bb);
    ok('Kragen = Schirm innen − 2 × Passung', Math.abs(r.B.kragen - d.ci) < 0.02, { kragen: r.B.kragen, soll: d.ci });
  }
}

// Ausrichtung: Quadrat oben links, von außen gesehen
for (const [seite, name] of [['0', 'Seite 1 (vorne, +Z)'], ['1', 'Seite 2 (rechts, +X)']]) {
  const r = await pg.evaluate(({ svg, seite }) => {
    Object.assign(_mtlP, JSON.parse(JSON.stringify(_MTL_DEF)), { relief: 'aussen', teile: 'schirm' });
    _mtlP.motive = [_mtlNeu('svg', { svg, name: 'Marker', seite, ebene: 3, h: 60, x: 0, y: 5 })];
    const res = _mtlBuild(_mfWasm, _mtlP, 'fein'), d = res.d, pos = res.shade.toNonIndexed().attributes.position.array;
    // vorstehende Punkte: Seite 1 bei z > T/2, Seite 2 bei x > B/2. „Links von außen“: vorne −X, rechts +Z.
    let oben = [], unten = [];
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      const vor = seite === '0' ? z > d.D / 2 + 0.5 : x > d.W / 2 + 0.5;
      if (!vor) continue;
      const links = seite === '0' ? -x : z;                                   // > 0 = links
      (y > d.vLo + 5 + 60 * 0.6 ? oben : unten).push(links);
    }
    const avg = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    return { nO: oben.length, nU: unten.length, oben: avg(oben), unten: avg(unten), minO: Math.min(...oben), maxU: Math.max(...unten) };
  }, { svg: MARKER, seite });
  ok(name + ': Quadrat oben links, Balken unten breit', r.nO > 0 && r.nU > 0 && r.oben > 10 && Math.abs(r.unten) < 3, r);
}

// Rundum erreicht alle Seiten; Loch bricht durch
{
  const r = await pg.evaluate(() => {
    Object.assign(_mtlP, JSON.parse(JSON.stringify(_MTL_DEF)), { relief: 'aussen', teile: 'schirm' });
    _mtlP.motive = [_mtlNeu('wald', { h: 50 })];
    let res = _mtlBuild(_mfWasm, _mtlP, 'fein'), d = res.d, pos = res.shade.toNonIndexed().attributes.position.array;
    const seiten = [0, 0, 0, 0];
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], z = pos[i + 2];
      if (z > d.D / 2 + 0.3) seiten[0]++; if (x > d.W / 2 + 0.3) seiten[1]++; if (z < -d.D / 2 - 0.3) seiten[2]++; if (x < -d.W / 2 - 0.3) seiten[3]++;
    }
    _mtlP.relief = 'innen'; _mtlP.motive = [];
    const v0 = _mtlBuild(_mfWasm, _mtlP, 'fein').shadeVol;
    _mtlP.motive = [_mtlNeu('mond', { ebene: 'loch', h: 40, y: 20 })];
    const r2 = _mtlBuild(_mfWasm, _mtlP, 'fein');
    const mf = _mfFromSoup(_mfWasm, r2.shade.toNonIndexed().attributes.position.array);
    return { seiten, v0, v1: r2.shadeVol, parts: mf.decompose().length };
  });
  ok('Rundum-Wald auf allen vier Seiten', r.seiten.every(n => n > 20), r.seiten);
  ok('Loch-Ebene bricht durch (Volumen sinkt, 1 Stück)', r.v1 < r.v0 - 10 && r.parts === 1, r);
}

// Stresstest: viele Zufalls-Anordnungen (Ecken, Schichten, Größen) bleiben ein sauberes Stück
{
  const r = await pg.evaluate(() => {
    const rnd = _mtlRng(4711), bad = [];
    const arten = ['wald', 'tanne', 'hirsch', 'haeuser', 'sterne', 'mond', 'flocke'], seiten = ['0', '1', '2', '3', 'alle', 'rundum'];
    for (let n = 0; n < 24; n++) {
      Object.assign(_mtlP, JSON.parse(JSON.stringify(_MTL_DEF)), { teile: 'schirm', relief: n % 3 ? 'innen' : 'aussen',
        breite: 50 + Math.round(rnd() * 90), tiefe: 50 + Math.round(rnd() * 90), schirmH: 60 + Math.round(rnd() * 100), stufe: 0.6 + rnd() * 0.8 });
      const U = _mtlDims(_mtlP).U;
      _mtlP.motive = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => _mtlNeu(arten[Math.floor(rnd() * arten.length)], {
        seite: seiten[Math.floor(rnd() * seiten.length)], ebene: rnd() < 0.15 ? 'loch' : 1 + Math.floor(rnd() * 3),
        h: Math.round(U * (0.2 + rnd() * 0.75)), x: Math.round((rnd() - 0.5) * 60), y: Math.round(rnd() * U * 0.3), seed: 1 + Math.floor(rnd() * 999), spiegeln: rnd() < 0.5 }));
      const res = _mtlBuild(_mfWasm, _mtlP, 'fein');
      const mf = _mfFromSoup(_mfWasm, res.shade.toNonIndexed().attributes.position.array), parts = mf.decompose().length;
      if (parts !== 1 || !(res.shadeVol > 0)) bad.push({ n, parts, vol: res.shadeVol, p: { ..._mtlP, motive: _mtlP.motive.map(m => [m.src, m.seite, m.ebene, m.h, m.x, m.y, m.seed]) } });
    }
    return bad;
  });
  ok('24 Zufalls-Schirme: je ein sauberes Stück', r.length === 0, r.slice(0, 2));
}

// Erstellen, Speichern, Bearbeiten
{
  const r = await pg.evaluate(async () => {
    _newCreate(false);
    Object.assign(_mtlP, JSON.parse(JSON.stringify(_MTL_DEF)));
    _mtlOpen();
    await new Promise(res => setTimeout(res, 400));
    const prev = _mtlPreviewGeo().attributes.position.count;
    const listRows = document.querySelectorAll('#mtl-list .mtl-row').length;
    await _mtlCreate();
    const n1 = objects.length, names = objects.map(o => o.userData.name);
    const schirm = objects.find(o => o.userData._mtlPart === 'schirm');
    const data = objectToData(schirm);
    const kopie = buildObjectFromData(data);
    const saved = !!(kopie && kopie.userData.motivlichtParams && kopie.userData.motivlichtParams.motive.length === 3 && kopie.userData._mtlGid === schirm.userData._mtlGid);
    if (kopie) { scene.remove(kopie); const i = objects.indexOf(kopie); if (i >= 0) objects.splice(i, 1); }
    const n2 = objects.length;
    _mtlEdit(schirm);
    _mtlP.schirmH = 130;
    await _mtlCreate();
    schirm.geometry.computeBoundingBox();
    return { prev, listRows, n1, n2, n3: objects.length, names, saved, hNeu: schirm.geometry.boundingBox.max.y * 10,
      sockelH: objects.find(o => o.userData._mtlPart === 'sockel').userData.motivlichtParams.schirmH };
  });
  ok('Vorschau baut, Liste zeigt 3 Motive', r.prev > 1000 && r.listRows === 3, { prev: r.prev, rows: r.listRows });
  ok('Erstellen legt Schirm + Sockel an', r.n1 === 2 && r.names.some(n => /Schirm/.test(n)) && r.names.some(n => /Sockel/.test(n)), r.names);
  ok('Speichern/Laden behält Motive', r.saved);
  ok('Bearbeiten ersetzt an Ort und Stelle (beide Teile)', r.n3 === r.n2 && Math.abs(r.hNeu - 130) < 0.05 && r.sockelH === 130, r);
}

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
