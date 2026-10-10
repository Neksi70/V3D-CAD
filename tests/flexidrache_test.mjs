// Regressionstest für den Generator „Flexi-Drache" (🐉, _fdr*).
//   1. Varianten bauen: alle Teile wasserdicht (Manifold-Roundtrip), Glieder = Anzahl Hüllen
//   2. Gelenke im Browser-Netz: kein Glied berührt ein anderes, jedes Gelenk schwenkt ±θ frei,
//      Stift sitzt fest (nach oben/hinten gezogen → Kollision), Anschlag hinter θ
//   3. Unterseite auf y = 0, passt aufs A1-mini-Bett (180 mm)
//   4. Echter Klick: Generator öffnen (Katalog), Vorlage Schlüsselanhänger, Erstellen →
//      2 Objekte (2 Farben), 3MF mit 2 Filamenten; Bearbeiten → ersetzt an Ort und Stelle; Speichern/Laden behält Parameter
// Start: python3 volme3d_server.py 8853 --dev   →   V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/flexidrache_test.mjs
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

const varianten = [
  { name: 'Standard (Drache, Akzente)', p: {} },
  { name: 'Schlüsselanhänger', p: { ..._dummy('anhaenger') } },
  { name: 'Groß, kräftig, Streifen', p: { laenge: 180, dicke: 8, glieder: 14, koerper: 'kraeftig', farbmodus: 'streifen' } },
  { name: 'Schlank, einfarbig, ±35°, Öse am Kopf', p: { laenge: 120, beweg: 35, koerper: 'schlank', zacken: 'klein', farbmodus: 'einfarbig', oese: 'kopf' } },
];
function _dummy(n){ return { __vorgabe: n }; }

for (const v of varianten) {
  const r = await pg.evaluate(p => {
    const W = _mfWasm, M = W.Manifold;
    Object.assign(_fdrP, _FDR_DEF, p.__vorgabe ? _FDR_VORGABEN[p.__vorgabe] : p);
    const t0 = performance.now();
    const res = _fdrBuild(W, _fdrP, 'fein'), d = res.d;
    const ms = performance.now() - t0;
    // fertiges Browser-Netz: zurück nach Manifold, muss genau ein Stück je Glied ergeben
    const mfs = res.teile.map(t => _mfFromSoup(W, t.geo.toNonIndexed().attributes.position.array));
    let bb = new THREE.Box3();
    for (const t of res.teile) { t.geo.computeBoundingBox(); bb.union(t.geo.boundingBox); }
    const yMin = bb.min.y;
    const all = mfs.length > 1 ? M.union(mfs) : mfs[0];
    const shells = all.decompose().length;
    const volOk = Math.abs(all.volume() - res.teile.reduce((a, t) => a + t.vol, 0)) < 1;
    // Gelenke: Glieder aus demselben App-Code (Prüf-Modus liefert sie einzeln)
    const G = _fdrBuild(W, _fdrP, 'pruefung').glieder, J = res.joints, N = d.N;
    const X = x => x;
    const rotZ = (m, x, deg) => m.translate([-x, 0, 0]).rotate([0, 0, deg]).translate([x, 0, 0]);
    const out = { ms: Math.round(ms), N, shells, volOk, leer: G.length === N + 1 ? 0 : -1, ruhe: 0, klemmt: [], hoch: [], raus: [], anschlag: [],
      yMin, box: [bb.max.x - bb.min.x, bb.max.z - bb.min.z].map(v => v * 1), vol: res.teile.map(t => Math.round(t.vol)), teile: res.teile.length };
    for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) if (G[i] && G[j]) out.ruhe = Math.max(out.ruhe, M.intersection(G[i], G[j]).volume());
    for (let k = 1; k <= N; k++) {
      if (!G[k] || !G[k - 1]) continue;
      const jx = X(J[k - 1]);
      let maxV = 0;
      for (let a = -d.th; a <= d.th + 1e-9; a += d.th / 5) maxV = Math.max(maxV, M.intersection(G[k - 1], rotZ(G[k], jx, a)).volume());
      if (maxV > 1e-3) out.klemmt.push(k);
      if (M.intersection(G[k - 1], G[k].translate([0, 0, 1])).volume() < 0.05) out.hoch.push(k);
      if (M.intersection(G[k - 1], G[k].translate([-2.5, 0, 0])).volume() < 0.05) out.raus.push(k);
      if (M.intersection(G[k - 1], rotZ(G[k], jx, d.th + 15)).volume() < 0.01) out.anschlag.push(k);
    }
    return out;
  }, v.p);
  console.log(v.name, JSON.stringify({ ms: r.ms, N: r.N, teile: r.teile, vol: r.vol, box: r.box.map(x => Math.round(x)) }));
  ok(v.name + ': Netz = ein Stück je Glied (' + (r.N + 1) + ')', r.shells === r.N + 1 && r.volOk && r.leer === 0, { shells: r.shells, volOk: r.volOk });
  ok(v.name + ': Ruhelage berührungsfrei', r.ruhe < 1e-3, r.ruhe);
  ok(v.name + ': alle Gelenke frei über ±θ', r.klemmt.length === 0, r.klemmt);
  ok(v.name + ': Stift nach oben gesichert', r.hoch.length === 0, r.hoch);
  ok(v.name + ': Stift nach hinten gesichert', r.raus.length === 0, r.raus);
  ok(v.name + ': Anschlag hinter θ', r.anschlag.length === 0, r.anschlag);
  ok(v.name + ': liegt auf dem Bett (y = 0)', Math.abs(r.yMin) < 1e-3, r.yMin);
  ok(v.name + ': passt auf 180-mm-Bett', Math.max(...r.box) <= 180.5, r.box);
}

// ── Echter Ablauf über die Oberfläche ───────────────────────────────────────
await pg.evaluate(() => { _newCreate(false); });
const n0 = await pg.evaluate(() => objects.length);
await pg.evaluate(() => { const s = _STARTERS.find(x => x.t === 'Flexi-Drache'); s.run(); });
await pg.waitForSelector('#fdr-modal.show');
await pg.click('#fdr-vorgabe-bg .vtb[data-v="anhaenger"]');
await pg.waitForTimeout(1500);
const info = await pg.textContent('#fdr-info');
ok('Info nennt Glieder und Gewicht', /Glieder/.test(info) && /g PLA/.test(info), info.slice(0, 120));
await pg.screenshot({ path: 'tests/flexidrache_fenster.png' });
await pg.click('#fdr-go');
await pg.waitForFunction(n => objects.length >= n + 1, n0, { timeout: 60000 });
await pg.waitForTimeout(300);
const neu = await pg.evaluate(n => objects.slice(n).map(o => ({ name: o.userData.name, col: o.userData.color, set: o.userData.fdrSet, p: !!o.userData.flexidracheParams })), n0);
ok('Erstellen legt 2 Teile an (2 Farben)', neu.length === 2 && neu[0].col !== neu[1].col && neu[0].set === neu[1].set && neu.every(x => x.p), neu);
const f3 = await pg.evaluate(async () => { const r = _build3mfBlob(objects.filter(o => o.userData.fdrSet)); return { parts: r.parts, colors: r.colors }; });
ok('3MF: 2 Teile, 2 Filamente', f3.parts === 2 && f3.colors === 2, f3);
// Bearbeiten über den Knopf im Eigenschaften-Feld
await pg.evaluate(() => { selectObjs([objects.find(o => o.userData.fdrSet)]); updateFP(); });
const knopf = await pg.$('button.fp-btn[onclick^="_fdrEdit"]');
ok('Eigenschaften: Knopf „Im Generator bearbeiten“', !!knopf);
if (knopf) {
  await knopf.click();
  await pg.waitForSelector('#fdr-modal.show');
  ok('Bearbeiten öffnet mit den Werten des Drachen', await pg.evaluate(() => _fdrP.laenge === 75 && _fdrP.oese === 'schwanz' && document.getElementById('fdr-go').textContent.includes('Übernehmen')));
  await pg.click('#fdr-farbmodus-bg .vtb[data-v="einfarbig"]');
  await pg.click('#fdr-go');
  await pg.waitForFunction(() => !document.getElementById('fdr-modal').classList.contains('show'), null, { timeout: 60000 });
  const nach = await pg.evaluate(n => objects.slice(n).map(o => ({ name: o.userData.name, m: o.userData.flexidracheParams.farbmodus })), n0);
  ok('Übernehmen ersetzt den Drachen (jetzt 1 Teil, einfarbig)', nach.length === 1 && nach[0].m === 'einfarbig', nach);
}
// Speichern/Laden
const rt = await pg.evaluate(() => { const o = objects.find(x => x.userData.fdrSet); const d = objectToData(o); const c = buildObjectFromData(d); return { p: c.userData.flexidracheParams && c.userData.flexidracheParams.laenge, set: c.userData.fdrSet === o.userData.fdrSet }; });
ok('Speichern/Laden behält die Generator-Einstellungen', rt.p === 75 && rt.set, rt);
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalle Prüfungen bestanden');
process.exit(fails.length ? 1 : 0);
