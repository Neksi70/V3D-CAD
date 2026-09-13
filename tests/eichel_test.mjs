// Regressionstest für den Eichel-Generator (🌰 Eichel, Hänge-Leuchte zum Schrauben).
//
// Geprüft wird, was beim Drucken, Zusammenschrauben und Leuchten zählt:
//   1. alle Varianten bauen, beide Teile sind wasserdicht, ein Stück, Volumen > 0
//      (Geschlecht exakt über Manifold.genus)
//   2. jedes Lichtloch geht wirklich in den Hohlraum durch (Geschlecht der Nuss =
//      Zahl der Löcher), die Öse ist ein echter Ring (Geschlecht des Huts = 1)
//   3. verschraubt steckt kein Punkt der Nuss im Hut-Material, und der Hut lässt
//      sich über den ganzen Schraubweg eindrehen
//   4. erhabene Schrift steht vor, vertiefte liegt unter der Oberfläche
//   5. das LED-Teelicht passt durch den Hals
//   6. Erstellen legt zwei Teile in Druck-Lage an (Unterkante y = 0)
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
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
await pg.evaluate(async () => {
  await _mfInit();
  await new Promise(res => _eicLoadFonts(res));
  window._eicT = {
    // Kantenparität + Euler-Charakteristik + Zusammenhangskomponenten
    topo(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      // Manifold liefert indizierte Netze — dann exakt über den Index, sonst gerundet
      const key = i => { if (idx) return String(idx.getX(i));
        return Math.round(p.getX(i)*1e4)+','+Math.round(p.getY(i)*1e4)+','+Math.round(p.getZ(i)*1e4); };
      const m = new Map(), vid = new Map(), par = [];
      const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
      let F = 0, V6 = 0;
      for (let t = 0; t < n; t += 3) {
        const ks = [key(t), key(t+1), key(t+2)];
        if (ks[0]===ks[1] || ks[1]===ks[2] || ks[0]===ks[2]) continue;
        F++;
        const ids = ks.map(k => { if (!vid.has(k)) { vid.set(k, par.length); par.push(par.length); } return vid.get(k); });
        par[find(ids[1])] = find(ids[0]); par[find(ids[2])] = find(ids[0]);
        for (const [u,v] of [[ks[0],ks[1]],[ks[1],ks[2]],[ks[2],ks[0]]]) m.set(u+'|'+v, (m.get(u+'|'+v)||0)+1);
      }
      for (let t = 0; t < n; t += 3) {
        const g = (i,k) => { const j = idx ? idx.getX(i) : i; return k===0?p.getX(j):k===1?p.getY(j):p.getZ(j); };
        const ax=g(t,0),ay=g(t,1),az=g(t,2), bx=g(t+1,0),by=g(t+1,1),bz=g(t+1,2), cx=g(t+2,0),cy=g(t+2,1),cz=g(t+2,2);
        V6 += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx);
      }
      let offen = 0;
      for (const [k,v] of m) { const [u,w] = k.split('|'); if (v !== 1 || (m.get(w+'|'+u)||0) !== 1) offen++; }
      const V = vid.size, E = m.size / 2;
      const roots = new Set(); for (let i = 0; i < par.length; i++) roots.add(find(i));
      return { offen, teile: roots.size, genus: Math.round((2 * roots.size - (V - E + F)) / 2), vol: V6 / 6 };
    },
    inside(mesh, pt) {
      const rc = new THREE.Raycaster(pt.clone(), new THREE.Vector3(0.5771, 0.5773, 0.5775).normalize(), 0, 1e4);
      return rc.intersectObject(mesh, false).length % 2 === 1;
    }
  };
});

// ── 1+2: Varianten ───────────────────────────────────────────────────────────
const varianten = [
  { name: 'Standard',          p: {} },
  { name: 'Glatt, Stiel',      p: { skin: 'glatt', haenger: 'stiel' } },
  { name: 'Ohne Aufhänger',    p: { haenger: 'keine', textMode: 'keine' } },
  { name: 'Vertieft',          p: { textMode: 'gravur', textT: 1.2 } },
  { name: 'Einzeilig',         p: { text2: '', text1: 'Moin' } },
  { name: 'Stumpf, ohne Zipfel', p: { spitze: 0, zipfel: 0 } },
  { name: 'Spitz, lang',       p: { spitze: 100, nutH: 120, zipfel: 10 } },
  { name: 'Flacher Hut',       p: { capForm: 0, capH: 30 } },
  { name: 'Hohe Kuppel',       p: { capForm: 100, capH: 80 } },
  { name: 'Klein',             p: { nutDia: 40, nutH: 40, capDia: 48, capH: 26, holes: 6, holeD: 2, textH: 10, threadH: 5, pitch: 2, wall: 1.4, lampD: 20 } },
  { name: 'Groß',              p: { nutDia: 150, nutH: 190, capDia: 170, capH: 110, holes: 60, holeD: 8, textH: 70, threadH: 20, pitch: 5, wall: 3.5 } },
  { name: 'Viele Löcher',      p: { holes: 60, holeD: 2 } },
  { name: 'Grobe Schuppen',    p: { scale: 16, scaleD: 4 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(({ over }) => {
    const p = { ..._eicP, ...over }, d = _eicDims(p);
    try {
      const t0 = performance.now();
      const res = _eicBuild(_mfWasm, p, 'vorschau');
      // Geschlecht exakt über Manifold (die Kanten-Quantisierung oben verschmilzt
      // haarfeine Schriftsplitter und ist dafür zu grob)
      const mfG = g => { const ng = g.toNonIndexed(), m = _mfFromSoup(_mfWasm, ng.attributes.position.array); const r = m.genus(); m.delete(); ng.dispose(); return r; };
      const nut = _eicT.topo(res.nutGeo), cap = _eicT.topo(res.capGeo);
      nut.genus = mfG(res.nutGeo); cap.genus = mfG(res.capGeo);
      const out = { ms: Math.round(performance.now() - t0), ok: [d.okRim, d.okCap, d.okNut, d.okLamp],
                    nut, cap, holes: res.holes, soll: p.holes };
      res.nutGeo.dispose(); res.capGeo.dispose();
      return out;
    } catch (e) { return { err: String(e && e.stack || e) }; }
  }, { over: v.p });
  if (r.err) { ok(v.name + ': baut', false, r.err); continue; }
  ok(v.name + ': Prüfungen grün', r.ok.every(Boolean), r.ok);
  ok(v.name + ': Nuss wasserdicht, ein Stück', r.nut.offen === 0 && r.nut.teile === 1 && r.nut.vol > 0, r.nut);
  ok(v.name + ': Hut wasserdicht, ein Stück', r.cap.offen === 0 && r.cap.teile === 1 && r.cap.vol > 0, r.cap);
  ok(v.name + ': jedes Lichtloch geht durch', r.nut.genus === r.holes, { genus: r.nut.genus, loecher: r.holes, ms: r.ms });
  ok(v.name + ': Lichtpunkte (fast) alle untergebracht', r.holes >= Math.floor(r.soll * 0.8), { hat: r.holes, soll: r.soll });
  const oese = (v.p.haenger || 'oese') === 'oese';
  ok(v.name + ': Hut-Geschlecht passt zum Aufhänger', r.cap.genus === (oese ? 1 : 0), { genus: r.cap.genus });
}

// ── 3: verschraubt und beim Eindrehen ────────────────────────────────────────
for (const v of [{ name: 'Standard', p: {} }, { name: 'Grob', p: { pitch: 5, threadH: 14, clr: 0.2 } },
                 { name: 'Fein/eng', p: { pitch: 2, clr: 0.1 } }]) {
  const r = await pg.evaluate(({ over }) => {
    const p = { ..._eicP, ...over, skin: 'glatt' }, d = _eicDims(p);
    const nutG = _eicNutGrid(p, d, 140), capG = _eicCapGrid(p, d, 140, 0.8);
    const capMesh = new THREE.Mesh(capG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    capMesh.updateMatrixWorld(true);
    const pos = nutG.attributes.position;
    let stecken = 0, geprueft = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < d.yJ - 0.5) continue;
      geprueft++;
      // 0,02 mm tiefer: der Kegelsitz liegt planmäßig flächig auf
      if (_eicT.inside(capMesh, new THREE.Vector3(pos.getX(i), y - 0.02, pos.getZ(i)))) stecken++;
    }
    const TAU = Math.PI * 2;
    const male = (ys, th) => (ys < 0 || ys > d.Ht) ? 0 : _pilzThreadR(ys, th, 0, d.Ht, d.rCore, d.rThreadOut, d.P, 0);
    let minWeg = 1e9, wo = null;
    for (let e = 0; e <= d.Ht + 0.2; e += 0.1)
      for (let yc = 0; yc <= d.holeTop; yc += 0.04)
        for (let a = 0; a < 90; a++) {
          const th = a / 90 * TAU, ths = ((th - TAU * e / d.P) % TAU + TAU) % TAU;
          const g = _pilzFemR(d, yc, th) - male(yc + e, ths);
          if (g < minWeg) { minWeg = g; wo = { e: +e.toFixed(2), h: +yc.toFixed(2) }; }
        }
    let lochMin = 1e9;
    for (let yc = 0; yc <= d.holeTop; yc += 0.04) for (let a = 0; a < 90; a++) lochMin = Math.min(lochMin, _pilzFemR(d, yc, a / 90 * TAU));
    nutG.dispose(); capG.dispose();
    return { stecken, geprueft, minWeg: +minWeg.toFixed(3), wo, eingriff: +(d.rThreadOut - lochMin).toFixed(3),
             bohrung: +(2 * d.rBore).toFixed(1), lampD: p.lampD };
  }, { over: v.p });
  ok(v.name + ': Nuss steckt nicht im Hut-Material', r.stecken === 0 && r.geprueft > 500, { stecken: r.stecken, geprueft: r.geprueft });
  ok(v.name + ': Hut lässt sich eindrehen (Luft auf dem ganzen Weg)', r.minWeg >= -0.001, { minWegMm: r.minWeg, wo: r.wo });
  ok(v.name + ': Gewinde greift (Gang überdeckt ≥ 0,5 mm)', r.eingriff >= 0.5, { eingriffMm: r.eingriff });
  ok(v.name + ': LED-Teelicht passt durch den Hals', r.bohrung >= r.lampD + 1, { bohrung: r.bohrung, lampD: r.lampD });
}

// ── 4: Schrift steht vor bzw. liegt vertieft ─────────────────────────────────
for (const mode of ['relief', 'gravur']) {
  const r = await pg.evaluate(({ mode }) => {
    const p = { ..._eicP, textMode: mode, holes: 0, text1: 'IIII', text2: '' }, d = _eicDims(p);
    const t = _eicTextLoops(p, d);
    const res = _eicBuild(_mfWasm, p, 'fein');
    const mesh = new THREE.Mesh(res.nutGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true);
    // Strahl von vorn mitten auf den Strich des ersten „I" und daneben
    const [x0, x1, y0, y1] = t.box, yc = (y0 + y1) / 2;
    const hitZ = x => { const rc = new THREE.Raycaster(new THREE.Vector3(x, yc, 500), new THREE.Vector3(0, 0, -1));
                        const h = rc.intersectObject(mesh, false)[0]; return h ? h.point.z : null; };
    // Strichmitte des ersten I suchen: dort, wo die Oberfläche am weitesten vom Grund abweicht
    const base = d.nutR(yc);
    let best = 0;
    for (let x = x0; x <= x1; x += 0.1) { const z = hitZ(x); if (z == null) continue; const dz = z - Math.sqrt(Math.max(0, base * base - x * x)); if (Math.abs(dz) > Math.abs(best)) best = dz; }
    const neben = hitZ(x1 + 6) - Math.sqrt(base * base - (x1 + 6) ** 2);
    res.nutGeo.dispose(); res.capGeo.dispose();
    return { best: +best.toFixed(2), neben: +neben.toFixed(2), soll: p.textT };
  }, { mode });
  if (mode === 'relief') ok('Erhabene Schrift steht ~' + r.soll + ' mm vor', r.best > r.soll * 0.8 && r.best < r.soll + 0.4 && Math.abs(r.neben) < 0.3, r);
  else ok('Vertiefte Schrift liegt ~' + r.soll + ' mm tiefer', r.best < -r.soll * 0.8 && r.best > -r.soll - 0.4 && Math.abs(r.neben) < 0.3, r);
}

// ── 5: Warnungen greifen ─────────────────────────────────────────────────────
const w = await pg.evaluate(() => {
  const a = _eicDims({ ..._eicP, capDia: 60 });
  const c = _eicDims({ ..._eicP, nutDia: 44, lampD: 38 });
  return { schmalerHut: a.okRim, kleineNussLicht: c.okLamp };
});
ok('Zu schmaler Hut wird gemeldet', w.schmalerHut === false, w);
ok('Zu enger Hals fürs Teelicht wird gemeldet', w.kleineNussLicht === false, w);

// ── 6: Erstellen ─────────────────────────────────────────────────────────────
await pg.evaluate(() => _eicOpen());
await pg.waitForFunction(() => !!(_gpv['eic'] && _gpv['eic'].group), { timeout: 30000 });
const vor = await pg.evaluate(() => objects.length);
await pg.evaluate(() => _eicCreate());
await pg.waitForFunction(n => objects.length >= n + 2, vor, { timeout: 60000 });
const c = await pg.evaluate(n => objects.slice(n).map(o => {
  const bb = new THREE.Box3().setFromObject(o);
  return { name: o.userData.name, minY: +bb.min.y.toFixed(3), h: +((bb.max.y - bb.min.y) * 10).toFixed(1) };
}), vor);
ok('Erstellen legt Nuss und Hut an', c.length === 2 && /Nuss/.test(c[0].name) && /Hut/.test(c[1].name), c);
ok('Beide Teile stehen auf der Platte', c.every(o => Math.abs(o.minY) < 0.002), c);

ok('Keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles grün');
process.exit(fails.length ? 1 : 0);
