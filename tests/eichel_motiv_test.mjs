// Regressionstest für das Motiv in der Eichel-Nuss (🌰 → Gruppe „Motiv").
//
// Geprüft wird:
//   1. jedes Motiv baut, die Nuss bleibt wasserdicht und ein Stück
//   2. „Fenster" bricht wirklich durch — Geschlecht = Zahl der Motive (+ Löcher)
//   3. „Vertieft" liegt unter, „Erhaben" steht über der Oberfläche
//   4. die Lichtpunkte weichen dem Motiv aus
//   5. das Fenster warnt, wenn Motiv und Schriftzug übereinander liegen
//   6. die Motivliste im Fenster ist gefüllt, die Regler erscheinen
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
  window._eicM = {
    // wasserdicht / Teile / Volumen über den Index des Manifold-Netzes
    topo(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count, key = i => idx ? String(idx.getX(i))
        : Math.round(p.getX(i)*1e4)+','+Math.round(p.getY(i)*1e4)+','+Math.round(p.getZ(i)*1e4);
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
      const roots = new Set(); for (let i = 0; i < par.length; i++) roots.add(find(i));
      return { offen, teile: roots.size, vol: V6 / 6 };
    },
    genus(geo) { const ng = geo.toNonIndexed(), m = _mfFromSoup(_mfWasm, ng.attributes.position.array);
                 const g = m.genus(); m.delete(); ng.dispose(); return g; }
  };
});

// ── 1+2: Motive als Fenster ─────────────────────────────────────────────────
for (const [key, name] of [['herz','Herz'], ['stern','Stern'], ['blatt','Blatt'], ['klee','Kleeblatt'], ['katze','Katze']]) {
  const r = await pg.evaluate(({ key }) => {
    const p = { ..._eicP, symbol: key, symMode: 'fenster', symH: 30, symPos: 42, symN: 1,
                holes: 0, textMode: 'keine' };
    try {
      const res = _eicBuild(_mfWasm, p, 'vorschau');
      const t = _eicM.topo(res.nutGeo), g = _eicM.genus(res.nutGeo);
      const sym = _eicSymLoops(p, _eicDims(p));
      res.nutGeo.dispose(); res.capGeo.dispose();
      return { t, g, durch: res.symDurch, box: sym.box.map(v => +v.toFixed(1)) };
    } catch (e) { return { err: String(e && e.stack || e) }; }
  }, { key });
  if (r.err) { ok(name + ': baut', false, r.err); continue; }
  ok(name + ': Nuss wasserdicht, ein Stück', r.t.offen === 0 && r.t.teile === 1 && r.t.vol > 0, r.t);
  ok(name + ': Fenster bricht durch (Geschlecht 1)', r.g === 1 && r.durch, { genus: r.g, durch: r.durch, box: r.box });
}

// mehrere Motive rundum + Lichtpunkte
const mehr = await pg.evaluate(() => {
  const p = { ..._eicP, symbol: 'herz', symMode: 'fenster', symH: 26, symPos: 42, symN: 3,
              holes: 12, holeD: 3.5, textMode: 'keine' };
  const d = _eicDims(p), sym = _eicSymLoops(p, d);
  const res = _eicBuild(_mfWasm, p, 'vorschau');
  const g = _eicM.genus(res.nutGeo), t = _eicM.topo(res.nutGeo);
  // Liegt ein Lichtpunkt im Motivfeld?
  const zonen = sym.winkel.map(a => ({ ang: a, box: sym.box }));
  const pts = _eicHolePts(p, d, zonen);
  let drin = 0;
  for (const h of pts) for (const z of zonen) {
    const a = z.ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const zx = h.c[0] * ca - h.c[2] * sa, zz = h.c[0] * sa + h.c[2] * ca;
    if (zz > 0 && zx > z.box[0] && zx < z.box[1] && h.c[1] > z.box[2] && h.c[1] < z.box[3]) drin++;
  }
  res.nutGeo.dispose(); res.capGeo.dispose();
  return { g, t, loecher: res.holes, drin, winkel: sym.winkel };
});
ok('3 Herzen rundum + 12 Lichtpunkte: Geschlecht stimmt', mehr.g === 3 + mehr.loecher, { genus: mehr.g, loecher: mehr.loecher });
ok('Nuss bleibt wasserdicht, ein Stück', mehr.t.offen === 0 && mehr.t.teile === 1, mehr.t);
ok('Kein Lichtpunkt liegt im Motiv', mehr.drin === 0, { drin: mehr.drin, winkel: mehr.winkel });

// harte Formen und Lagen: das Fenster muss überall EIN Durchbruch bleiben —
// kopfüber gedruckt ist die Wand unten dicker als die Wandstärke, eine feste
// Schnitttiefe ließ dort ein zweites, halbes Loch stehen (Geschlecht 2).
const hart = await pg.evaluate(() => {
  const faelle = [
    { n: 'tief 70 %, klein',  o: { symPos: 70, symH: 14 } },
    { n: 'stumpfe Nuss',      o: { spitze: 0, zipfel: 0, symPos: 70, symH: 20 } },
    { n: 'dicke Wand 4 mm',   o: { wall: 4, symPos: 65, symH: 20 } },
    { n: 'kurze Nuss 30 mm',  o: { nutH: 30, symPos: 70, symH: 16 } },
    { n: 'spitz und lang',    o: { spitze: 100, nutH: 120, symPos: 70, symH: 20 } },
  ];
  return faelle.map(f => {
    const p = { ..._eicP, symbol: 'herz', symMode: 'fenster', symN: 1, holes: 0, textMode: 'keine', ...f.o };
    const res = _eicBuild(_mfWasm, p, 'vorschau');
    const t = _eicM.topo(res.nutGeo), g = _eicM.genus(res.nutGeo);
    res.nutGeo.dispose(); res.capGeo.dispose();
    return { n: f.n, g, durch: res.symDurch, teile: t.teile, offen: t.offen };
  });
});
for (const h of hart)
  ok('Fenster bleibt ein Durchbruch: ' + h.n, h.g === 1 && h.durch && h.teile === 1 && h.offen === 0, h);

// ── 3: vertieft / erhaben messen ────────────────────────────────────────────
for (const mode of ['gravur', 'relief']) {
  const r = await pg.evaluate(({ mode }) => {
    const p = { ..._eicP, symbol: 'herz', symMode: mode, symH: 30, symPos: 42, symN: 1,
                symT: 1.2, holes: 0, textMode: 'keine' };
    const d = _eicDims(p), sym = _eicSymLoops(p, d);
    const res = _eicBuild(_mfWasm, p, 'fein');
    const g = _eicM.genus(res.nutGeo);
    const mesh = new THREE.Mesh(res.nutGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true);
    const hitZ = (x, y) => { const rc = new THREE.Raycaster(new THREE.Vector3(x, y, 500), new THREE.Vector3(0, 0, -1));
                             const h = rc.intersectObject(mesh, false)[0]; return h ? h.point.z : null; };
    // Herzmitte (gefüllt) gegen eine Stelle weit daneben
    const yc = sym.yc - (sym.box[3] - sym.box[2]) * 0.1, base = d.nutR(yc);
    const mitte = hitZ(0, yc) - Math.sqrt(base * base);
    const neben = hitZ(sym.box[1] + 6, yc) - Math.sqrt(Math.max(0, base * base - (sym.box[1] + 6) ** 2));
    res.nutGeo.dispose(); res.capGeo.dispose();
    return { g, mitte: +mitte.toFixed(2), neben: +neben.toFixed(2), soll: p.symT };
  }, { mode });
  if (mode === 'gravur') ok('Vertieftes Herz liegt ~1,2 mm tiefer, dicht (Geschlecht 0)',
    r.g === 0 && r.mitte < -r.soll * 0.8 && r.mitte > -r.soll - 0.4 && Math.abs(r.neben) < 0.3, r);
  else ok('Erhabenes Herz steht ~1,2 mm vor, dicht (Geschlecht 0)',
    r.g === 0 && r.mitte > r.soll * 0.8 && r.mitte < r.soll + 0.4 && Math.abs(r.neben) < 0.3, r);
}

// ── 5+6: Fenster, Hinweise, Regler ──────────────────────────────────────────
await pg.evaluate(() => _eicOpen());
await pg.waitForFunction(() => !!(_gpv['eic'] && _gpv['eic'].group), { timeout: 30000 });
const ui = await pg.evaluate(() => {
  const sel = document.getElementById('eic-symbol');
  const zahl = sel.querySelectorAll('option').length;
  _eicStr('symbol', 'herz');
  const box = getComputedStyle(document.getElementById('eic-symbox')).display;
  const tiefe = getComputedStyle(document.getElementById('eic-row-symT')).display;   // Fenster: aus
  _eicStr('symMode', 'gravur');
  const tiefe2 = getComputedStyle(document.getElementById('eic-row-symT')).display;
  _eicStr('symMode', 'fenster');
  _eicSet('symPos', 42);
  const info1 = document.getElementById('eic-info').innerHTML;   // Schrift steht auf Standard = Überlappung
  _eicSet('symRot', 180);
  const info2 = document.getElementById('eic-info').innerHTML;
  return { zahl, box, tiefe, tiefe2, ueber1: /übereinander/.test(info1), ueber2: /übereinander/.test(info2),
           name: /Motiv <b>Herz<\/b>/.test(info1) };
});
ok('Motivliste ist gefüllt', ui.zahl > 20, { optionen: ui.zahl });
ok('Regler erscheinen, Tiefe nur ohne Fenster', ui.box !== 'none' && ui.tiefe === 'none' && ui.tiefe2 !== 'none', ui);
ok('Motivname steht im Hinweis', ui.name);
ok('Überlappung mit dem Schriftzug wird gemeldet', ui.ueber1 === true && ui.ueber2 === false, ui);

// Erstellen mit Motiv
const vor = await pg.evaluate(() => { _eicSet('holes', 10); return objects.length; });
await pg.evaluate(() => _eicCreate());
await pg.waitForFunction(n => objects.length >= n + 2, vor, { timeout: 60000 });
const teile = await pg.evaluate(n => objects.slice(n).map(o => o.userData.name), vor);
ok('Erstellen legt Nuss und Hut an', teile.length === 2 && /Nuss/.test(teile[0]), teile);

ok('Keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n❌ ' + fails.length + ' Fehler: ' + fails.join(', ') : '\n✅ alles grün');
process.exit(fails.length ? 1 : 0);
