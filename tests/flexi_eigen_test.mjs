// Regressionstest „Flexi – eigenes Motiv + wählbare Gelenkstellen“ (_fdr*, Wunsch von Tester Ralf).
//   1. SVG (Fisch) und JPG (Wurm, im Canvas erzeugt) → Umriss → Glieder: wasserdicht, ein Stück je Glied,
//      Glieder getrennt (minGap), Gelenke frei über ±θ um die (verschobene) Gelenkmitte, Stift gesichert, Anschlag
//   2. Gelenkstellen: Anzahl stimmt, Wunsch-% werden eingehalten; schmale Stelle (Hantel-Steg) → automatisch verschoben,
//      durchgehend zu schmal → Warnung statt Absturz
//   3. Drache mit ungleichmäßigen Gelenkstellen besteht dieselben Prüfungen
//   4. Oberfläche: Eigenes Motiv, Datei laden (setInputFiles), Gelenk im 2D-Plan ziehen / hinzufügen / entfernen,
//      %-Feld, Erstellen, Bearbeiten, Speichern/Laden behält Kontur + Gelenkstellen
// Start: python3 volme3d_server.py 8842 --dev   →   V3D_URL=http://127.0.0.1:8842/volme3d.html node tests/flexi_eigen_test.mjs
import { chromium } from 'playwright';
import fs from 'fs';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const FISCH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><ellipse cx="80" cy="50" rx="70" ry="34" fill="#123"/>
<polygon points="140,50 196,14 186,50 196,86" fill="#123"/><circle cx="40" cy="42" r="6" fill="#fff"/></svg>`;
// Hantel: zwei Kugeln, dazwischen ein 6 % breiter Steg (bei 120 mm Länge ≈ 6 mm – zu schmal fürs Gelenk)
const HANTEL = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><circle cx="60" cy="60" r="55"/><circle cx="240" cy="60" r="55"/>
<rect x="60" y="51" width="180" height="18"/></svg>`;
// Schlange: überall nur ~5 mm breit → jedes Gelenk zu schmal
const SCHLANGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 20"><rect x="0" y="6" width="400" height="8" rx="4"/></svg>`;

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

// Motiv in den Generator laden (derselbe Weg wie der Datei-Knopf)
async function lade(kind, data){
  return pg.evaluate(async ({ kind, data }) => {
    Object.assign(_fdrP, _FDR_DEF);
    let blob;
    if (kind === 'svg') blob = new Blob([data], { type: 'image/svg+xml' });
    else {                                                                      // JPG: Wurm als dicke Sinuslinie
      const cv = document.createElement('canvas'); cv.width = 480; cv.height = 160;
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 480, 160);
      cx.strokeStyle = '#222'; cx.lineWidth = 42; cx.lineCap = 'round'; cx.beginPath();
      for (let x = 30; x <= 450; x += 4) { const y = 80 + 30 * Math.sin((x - 30) / 420 * 2 * Math.PI); x === 30 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
      cx.stroke();
      blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
    }
    const okk = await _fdrLoadBlob(blob, kind === 'svg' ? 'test.svg' : 'wurm.jpg');
    return { ok: okk, n: _fdrP.kontur ? _fdrP.kontur.pts.length : 0, motiv: _fdrP.motiv };
  }, { kind, data });
}

// Vollprüfung eines Builds mit den aktuellen _fdrP (+ Überschreibungen)
async function pruefe(name, over, erwartN){
  const r = await pg.evaluate(over => {
    const W = _mfWasm, M = W.Manifold;
    Object.assign(_fdrP, over);
    const res = _fdrBuild(W, _fdrP, 'fein'), d = res.d;
    const mfs = res.teile.map(t => _mfFromSoup(W, t.geo.toNonIndexed().attributes.position.array));
    const bb = new THREE.Box3(); for (const t of res.teile) { t.geo.computeBoundingBox(); bb.union(t.geo.boundingBox); }
    const all = mfs.length > 1 ? M.union(mfs) : mfs[0];
    const shells = all.decompose().length;
    const volOk = Math.abs(all.volume() - res.teile.reduce((a, t) => a + t.vol, 0)) < 1;
    const P = _fdrBuild(W, _fdrP, 'pruefung'), G = P.glieder, N = d.N;
    const rotZ = (m, x, y, deg) => m.translate([-x, -y, 0]).rotate([0, 0, deg]).translate([x, y, 0]);
    const out = { N, shells, volOk, gap: 1e9, ber: [], klemmt: [], hoch: [], raus: [], anschlag: [], yMin: bb.min.y,
      len: bb.max.x - bb.min.x, box: [bb.max.x - bb.min.x, bb.max.z - bb.min.z], teile: res.teile.length,
      verl: res.gesamt ? res.verloren / res.gesamt : 0, gel: res.gelenke.map(g => ({ pct: +g.pct.toFixed(1), w: +g.wunsch.toFixed(1), v: g.verschoben, s: g.schmal })) };
    const minG = Math.min(0.2, _fdrP.spiel * 0.5);
    for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) {
      const g = G[i].minGap(G[j], 1); out.gap = Math.min(out.gap, g);
      if (g < minG) out.ber.push(i + '/' + j);
    }
    for (let k = 1; k <= N; k++) {
      const jx = P.joints[k - 1], jy = P.jointsY[k - 1];
      let maxV = 0;
      for (let a = -d.th; a <= d.th + 1e-9; a += d.th / 5) maxV = Math.max(maxV, M.intersection(G[k - 1], rotZ(G[k], jx, jy, a)).volume());
      if (maxV > 1e-3) out.klemmt.push(k);
      if (M.intersection(G[k - 1], G[k].translate([0, 0, 1])).volume() < 0.05) out.hoch.push(k);
      if (M.intersection(G[k - 1], G[k].translate([-2.5, 0, 0])).volume() < 0.05) out.raus.push(k);
      if (M.intersection(G[k - 1], rotZ(G[k], jx, jy, d.th + 15)).volume() < 0.01) out.anschlag.push(k);
    }
    return out;
  }, over);
  console.log(name, JSON.stringify({ N: r.N, teile: r.teile, len: +r.len.toFixed(1), gap: +r.gap.toFixed(3), verl: +r.verl.toFixed(3), gel: r.gel }));
  ok(name + ': ' + erwartN + ' Gelenke', r.N === erwartN, r.N);
  ok(name + ': Netz = ein Stück je Glied (' + (r.N + 1) + ')', r.shells === r.N + 1 && r.volOk, { shells: r.shells, volOk: r.volOk });
  ok(name + ': Glieder berühren sich nicht (minGap)', r.ber.length === 0, { ber: r.ber, gap: r.gap });
  ok(name + ': alle Gelenke frei über ±θ', r.klemmt.length === 0, r.klemmt);
  ok(name + ': Stift nach oben gesichert', r.hoch.length === 0, r.hoch);
  ok(name + ': Stift nach hinten gesichert', r.raus.length === 0, r.raus);
  ok(name + ': Anschlag hinter θ', r.anschlag.length === 0, r.anschlag);
  ok(name + ': liegt auf dem Bett (y = 0)', Math.abs(r.yMin) < 1e-3, r.yMin);
  return r;
}

// ── 1. Fisch als SVG ─────────────────────────────────────────────────────────
let l = await lade('svg', FISCH);
ok('SVG-Fisch: Umriss erkannt, Modus „eigen“', l.ok && l.n >= 20 && l.motiv === 'eigen', l);
let r = await pruefe('Fisch (SVG) 5 Gelenke', { laenge: 120, glieder: 5, dicke: 6, farbmodus: 'streifen' }, 5);
ok('Fisch: Länge = 120 mm', Math.abs(r.len - 120) < 1.5, r.len);
ok('Fisch: Streifen = 2 Teile', r.teile === 2, r.teile);
ok('Fisch: kaum etwas abgetrennt (< 2 %)', r.verl < 0.02, r.verl);

// gewählte Stellen in %
r = await pruefe('Fisch, Gelenke bei 20/35/55/70 %', { gelenkPos: [20, 35, 55, 70], glieder: 4, farbmodus: 'einfarbig' }, 4);
const ist = r.gel.map(g => g.pct).sort((a, b) => a - b);
ok('Fisch: Gelenke sitzen auf den gewählten Stellen', [20, 35, 55, 70].every((v, i) => Math.abs(ist[i] - v) < 0.6), ist);
ok('Fisch: einfarbig = 1 Teil', r.teile === 1, r.teile);

// ── 2. Wurm als JPG (aus Canvas) ─────────────────────────────────────────────
l = await lade('jpg');
ok('JPG-Wurm: Umriss erkannt', l.ok && l.n >= 20, l);
r = await pruefe('Wurm (JPG) 7 Gelenke, Öse am Kopf', { laenge: 140, glieder: 7, dicke: 6, oese: 'kopf', beweg: 30 }, 7);
ok('Wurm: Länge inkl. Öse ≈ 140 + Öse', r.len > 140 && r.len < 150, r.len);

// ── 3. Schmale Stellen ───────────────────────────────────────────────────────
l = await lade('svg', HANTEL);
ok('Hantel geladen', l.ok, l);
r = await pruefe('Hantel, Gelenk mitten auf dem Steg (50 %)', { laenge: 120, glieder: 1, gelenkPos: [50], achse: 'bild' }, 1);
ok('Hantel: Gelenk automatisch vom Steg weg verschoben', r.gel[0].v && !r.gel[0].s && Math.abs(r.gel[0].pct - 50) > 10, r.gel);
const sch = await pg.evaluate(async svg => {
  Object.assign(_fdrP, _FDR_DEF);
  await _fdrLoadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'schlange.svg');
  Object.assign(_fdrP, { laenge: 120, glieder: 3 });
  const g = _fdrJoints(_fdrP, _fdrDims(_fdrP)).info;
  let baut = false; try { const res = _fdrBuild(_mfWasm, _fdrP, 'vorschau'); baut = res.teile.length > 0; } catch (e) {}
  _fdrInfo();
  return { schmal: g.filter(x => x.schmal).length, baut };
}, SCHLANGE);
ok('Schlange (zu schmal): alle Gelenke als „zu schmal“ markiert, Bau klappt trotzdem', sch.schmal === 3 && sch.baut, sch);

// ── 4. Drache mit eigenen Gelenkstellen ──────────────────────────────────────
await pg.evaluate(() => { Object.assign(_fdrP, _FDR_DEF); });
r = await pruefe('Drache, ungleichmäßige Gelenke', { glieder: 6, gelenkPos: [14, 22, 34, 48, 60, 74] }, 6);
const ist2 = r.gel.map(g => g.pct).sort((a, b) => a - b);
ok('Drache: Gelenkstellen übernommen', [14, 22, 34, 48, 60, 74].every((v, i) => Math.abs(ist2[i] - v) < 0.6), ist2);

// ── 5. Oberfläche ────────────────────────────────────────────────────────────
fs.writeFileSync('/tmp/fdr_fisch_test.svg', FISCH);
await pg.evaluate(() => { Object.assign(_fdrP, _FDR_DEF); _fdrImg = null; _newCreate(false); });
const n0 = await pg.evaluate(() => objects.length);
await pg.evaluate(() => { const s = _STARTERS.find(x => x.t === 'Flexi-Drache'); s.run(); });
await pg.waitForSelector('#fdr-modal.show');
await pg.click('#fdr-motiv-bg .vtb[data-v="eigen"]');
ok('Eigenes Motiv: Laden-Knopf sichtbar, Drachen-Optionen ausgeblendet', await pg.evaluate(() =>
  getComputedStyle(document.getElementById('fdr-eigen-box')).display !== 'none' && getComputedStyle(document.getElementById('fdr-drache-form')).display === 'none'));
await pg.setInputFiles('#fdr-file', '/tmp/fdr_fisch_test.svg');
await pg.waitForFunction(() => _fdrP.kontur && _fdrP.kontur.pts.length > 10, null, { timeout: 15000 });
await pg.evaluate(() => { _fdrSet('laenge', 120); _fdrSet('glieder', 4); });
await pg.waitForTimeout(1500);
// Plan: Gelenk 2 ziehen
const plan = await pg.evaluate(() => {
  const cv = document.getElementById('fdr-plan'), r = cv.getBoundingClientRect(), d = _fdrDims(_fdrP);
  const V = _fdrPlanView(cv, _fdrP, d, _fdrUmriss(_fdrP, d)), L = _fdrPctListe();
  const px = pc => r.left + V.X(pc / 100 * d.L) * r.width / cv.width;
  return { y: r.top + r.height / 2, x2: px(L[1]), ziel: px(L[1] + 6), leer: px((L[2] + L[3]) / 2), L, top: r.top };
});
await pg.mouse.move(plan.x2, plan.y); await pg.mouse.down(); await pg.mouse.move(plan.ziel, plan.y, { steps: 5 }); await pg.mouse.up();
await pg.waitForTimeout(400);
const nachZug = await pg.evaluate(() => _fdrP.gelenkPos && _fdrP.gelenkPos.slice());
ok('2D-Plan: Gelenk ziehen verschiebt es (~+6 %)', nachZug && Math.abs(nachZug[1] - plan.L[1] - 6) < 1.5 && nachZug.length === 4, { vorher: plan.L, nachher: nachZug });
await pg.mouse.click(plan.leer, plan.y);
await pg.waitForTimeout(400);
const nachKlick = await pg.evaluate(() => ({ n: _fdrP.glieder, pos: _fdrP.gelenkPos.slice() }));
ok('2D-Plan: Klick fügt ein Gelenk hinzu', nachKlick.n === 5 && nachKlick.pos.length === 5, nachKlick);
const lst = await pg.$$('#fdr-gelenk-liste input.fdr-gp');
ok('Liste zeigt 5 Gelenk-Felder', lst.length === 5, lst.length);
await pg.evaluate(() => { const cv = document.getElementById('fdr-plan'); cv.scrollIntoView(); });
const dbl = await pg.evaluate(() => {
  const cv = document.getElementById('fdr-plan'), r = cv.getBoundingClientRect(), d = _fdrDims(_fdrP);
  const V = _fdrPlanView(cv, _fdrP, d, _fdrUmriss(_fdrP, d)), L = _fdrPctListe();
  return { x: r.left + V.X(L[4] / 100 * d.L) * r.width / cv.width, y: r.top + r.height / 2 };
});
await pg.mouse.dblclick(dbl.x, dbl.y);
await pg.waitForTimeout(400);
ok('2D-Plan: Doppelklick entfernt ein Gelenk', await pg.evaluate(() => _fdrP.glieder === 4 && _fdrP.gelenkPos.length === 4));
await pg.fill('#fdr-gelenk-liste input.fdr-gp >> nth=0', '15');
await pg.dispatchEvent('#fdr-gelenk-liste input.fdr-gp >> nth=0', 'change');
await pg.waitForTimeout(1800);
const ui = await pg.evaluate(() => ({ pos: _fdrP.gelenkPos.slice(), info: document.getElementById('fdr-info').textContent }));
ok('%-Feld setzt Gelenk 1 auf 15 %', Math.abs(ui.pos[0] - 15) < 0.01, ui.pos);
ok('Info nennt 5 Glieder / 4 Gelenke', /5 Glieder/.test(ui.info) && /4 Gelenke/.test(ui.info), ui.info.slice(0, 140));
await pg.screenshot({ path: 'tests/flexi_eigen_fenster.png' });
await pg.click('#fdr-go');
await pg.waitForFunction(n => objects.length >= n + 1, n0, { timeout: 90000 });
await pg.waitForTimeout(300);
const neu = await pg.evaluate(n => objects.slice(n).map(o => ({ name: o.userData.name, set: o.userData.fdrSet, m: o.userData.flexidracheParams.motiv, k: o.userData.flexidracheParams.kontur && o.userData.flexidracheParams.kontur.pts.length })), n0);
ok('Erstellen: Objekte mit eigenem Motiv (Name nach Datei, Kontur gespeichert)', neu.length >= 1 && neu.every(x => x.m === 'eigen' && x.k > 10 && /Flexi-fdr_fisch_test/.test(x.name)), neu);
// Speichern/Laden
const rt = await pg.evaluate(() => { const o = objects.find(x => x.userData.fdrSet); const d = JSON.parse(JSON.stringify(objectToData(o))); const c = buildObjectFromData(d); const p = c.userData.flexidracheParams; return { m: p.motiv, k: p.kontur && p.kontur.pts.length, pos: p.gelenkPos, orig: o.userData.flexidracheParams.gelenkPos }; });
ok('Speichern/Laden behält Kontur und Gelenkstellen', rt.m === 'eigen' && rt.k > 10 && JSON.stringify(rt.pos) === JSON.stringify(rt.orig), rt);
// Bearbeiten
await pg.evaluate(() => { selectObjs([objects.find(o => o.userData.fdrSet)]); updateFP(); });
const knopf = await pg.$('button.fp-btn[onclick^="_fdrEdit"]');
ok('Eigenschaften: Knopf „Im Generator bearbeiten“', !!knopf);
if (knopf) {
  await knopf.click();
  await pg.waitForSelector('#fdr-modal.show');
  const ed = await pg.evaluate(() => ({ m: _fdrP.motiv, pos: _fdrP.gelenkPos, plan: !!_fdrKonturMM(_fdrP), sw: document.getElementById('fdr-schwelle').disabled }));
  ok('Bearbeiten öffnet mit Kontur + Gelenkstellen (Schwelle gesperrt ohne Bild)', ed.m === 'eigen' && ed.plan && ed.pos && ed.pos.length === 4 && ed.sw, ed);
  await pg.click('#fdr-farbmodus-bg .vtb[data-v="einfarbig"]');
  await pg.click('#fdr-go');
  await pg.waitForFunction(() => !document.getElementById('fdr-modal').classList.contains('show'), null, { timeout: 90000 });
  const nach = await pg.evaluate(n => objects.slice(n).map(o => o.userData.flexidracheParams.farbmodus), n0);
  ok('Übernehmen ersetzt das Motiv (1 Teil, einfarbig)', nach.length === 1 && nach[0] === 'einfarbig', nach);
}
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalle Prüfungen bestanden');
process.exit(fails.length ? 1 : 0);
