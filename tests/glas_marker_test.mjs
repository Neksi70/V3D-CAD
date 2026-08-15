// Regressionstest für den Glas-Marker-Generator (🍷 Glas-Marker).
//
// Geprüft wird, was beim Drucken und beim Aufclipsen zählt:
//   1. jeder Marker ist WASSERDICHT (Kantenparität) und hat positives Volumen
//   2. die Halterung lässt wirklich frei, was sie umgreifen soll
//      (Stieltasche, Ringinneres, Bügelspalt) — sonst passt der Clip nicht
//   3. "durchbrochen" nimmt Material weg, "erhaben" legt welches drauf
//   4. alle 26 Motive bauen ohne Fehler
//   5. Schrift-Kennungen (Namen/Buchstaben/Zahlen) bauen und stehen erhaben
//   6. Erstellen legt genau so viele Marker an wie eingestellt
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

await pg.evaluate(() => {
  window._gmkT = {
    watertight(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const key = i => { const j = idx ? idx.getX(i) : i;
        return Math.round(p.getX(j)*1e4)+','+Math.round(p.getY(j)*1e4)+','+Math.round(p.getZ(j)*1e4); };
      const m = new Map(); let tris = 0, degen = 0;
      for (let t = 0; t < n; t += 3) {
        const a = key(t), b = key(t+1), c = key(t+2);
        if (a===b || b===c || a===c) { degen++; continue; }
        tris++;
        for (const [u,v] of [[a,b],[b,c],[c,a]]) m.set(u+'|'+v, (m.get(u+'|'+v)||0)+1);
      }
      let bad = 0;
      for (const [k,v] of m) { const [u,w] = k.split('|'); if (v !== 1 || (m.get(w+'|'+u)||0) !== 1) bad++; }
      return { tris, degen, offen: bad };
    },
    vol(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count; let V = 0;
      const g = (i,k) => { const j = idx ? idx.getX(i) : i; return k===0?p.getX(j):k===1?p.getY(j):p.getZ(j); };
      for (let t = 0; t < n; t += 3) {
        const ax=g(t,0),ay=g(t,1),az=g(t,2), bx=g(t+1,0),by=g(t+1,1),bz=g(t+1,2), cx=g(t+2,0),cy=g(t+2,1),cz=g(t+2,2);
        V += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx);
      }
      return V/6;
    },
    // Freie Bohrung um die Achse (0,0) auf Höhe y, in mm.
    //
    // Eckpunkte in einem Höhenband abzufragen bringt hier NICHTS: ein
    // Strangkörper hat Eckpunkte nur an den beiden Deckflächen, dazwischen
    // liegt kein einziger. Der alte Test war deshalb immer grün, egal wie eng
    // der Ring war. Also echten Querschnitt legen und dessen kleinsten
    // Achsabstand nehmen — das ist die Innenwand.
    bohrung(geo, y) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const g = (i,k) => { const j = idx ? idx.getX(i) : i; return k===0?p.getX(j):k===1?p.getY(j):p.getZ(j); };
      let rmin = Infinity;
      for (let t = 0; t < n; t += 3) {
        const v = [0,1,2].map(o => [g(t+o,0), g(t+o,1), g(t+o,2)]);
        for (let e = 0; e < 3; e++) {
          const a = v[e], b = v[(e+1)%3];
          if ((a[1]-y)*(b[1]-y) >= 0) continue;
          const f = (y-a[1])/(b[1]-a[1]);
          const x = a[0]+f*(b[0]-a[0]), z = a[2]+f*(b[2]-a[2]);
          rmin = Math.min(rmin, Math.hypot(x,z));
        }
      }
      return rmin*20;                       // Einheiten → mm-Durchmesser
    },
    // Marker bauen (mm-Werte kommen in App-Einheiten zurück: 1 = 10 mm)
    // _gmk.warn wird gesetzt, wenn der Manifold-Boolean scheitert und der
    // Notnagel greift. Der Notnagel liefert ein wasserdichtes Netz — ohne
    // diese Prüfung würden alle Motivtests fälschlich grün.
    async bau(over, motiv) {
      const p = Object.assign({}, _GMK_DEFAULTS, over || {});
      const m = motiv || { k:'sym', v:'herz', n:'Herz' };
      _gmk.warn = '';
      const g = await _gmkBuildOne(p, m);
      if (_gmk.warn) throw new Error('Notnagel statt Boolean: ' + _gmk.warn);
      return g;
    }
  };
});

// ── 1+2: die drei Halterungen ───────────────────────────────────────────────
for (const halt of ['wein','flasche','glas']) {
  const r = await pg.evaluate(async (halt) => {
    const g = await window._gmkT.bau({ halt });
    const wt = window._gmkT.watertight(g);
    const v  = window._gmkT.vol(g);
    g.computeBoundingBox(); const bb = g.boundingBox;
    return { wt, v, bb: { x:[bb.min.x,bb.max.x], y:[bb.min.y,bb.max.y], z:[bb.min.z,bb.max.z] } };
  }, halt);
  ok(halt + ': wasserdicht', r.wt.offen === 0 && r.wt.tris > 200, r.wt);
  ok(halt + ': Volumen positiv', r.v > 0.05, +(r.v*1000).toFixed(1) + ' mm³');
  ok(halt + ': steht auf der Platte', Math.abs(r.bb.y[0]) < 1e-6, r.bb.y);
}

// Stieltasche: Stiel + Spiel muss durchgehen (Ringmittelpunkt liegt bei x=0,z=0)
{
  const r = await pg.evaluate(async () => {
    const g = await window._gmkT.bau({ halt:'wein', stiel:8 });
    return [0.15,0.45,0.75].map(y => +window._gmkT.bohrung(g,y).toFixed(2));
  });
  ok('wein: Stieltasche ≥ Ø8 auf ganzer Höhe', r.every(d => d >= 8.0 && d < 9.2), r);
}
// Flaschenring: Bohrung muss ENGER sein als der Hals (sonst klemmt nichts)
{
  const r = await pg.evaluate(async () => {
    const auf = await window._gmkT.bau({ halt:'flasche', hals:26, klemm:0.6 });
    const los = await window._gmkT.bau({ halt:'flasche', hals:26, klemm:0 });
    return { klemmend: +window._gmkT.bohrung(auf,0.3).toFixed(2),
             lose:     +window._gmkT.bohrung(los,0.3).toFixed(2) };
  });
  ok('flasche: Ring klemmt (Bohrung < Hals-Ø)', r.klemmend > 24.9 && r.klemmend < 25.7, r.klemmend + ' mm bei Hals 26');
  ok('flasche: Klemmung 0 gibt vollen Hals-Ø', Math.abs(r.lose - 26) < 0.3, r.lose + ' mm');
}
// Öffnung: enger eingestellt heißt auch wirklich enger
{
  const r = await pg.evaluate(async () => {
    const w = {}; for (const o of [70, 90]) {
      const g = await window._gmkT.bau({ halt:'flasche', hals:26, oeffnung:o });
      const p = g.attributes.position; let xmin = 1e9;   // Armenden liegen unten (z minimal)
      let zmin = 1e9; for (let i=0;i<p.count;i++) zmin = Math.min(zmin, p.getZ(i));
      for (let i=0;i<p.count;i++) if (p.getZ(i) < zmin+0.06) xmin = Math.min(xmin, Math.abs(p.getX(i)));
      w[o] = +(xmin*20).toFixed(1);
    }
    return w;
  });
  ok('flasche: kleinere Öffnung = engerer Spalt', r[70] < r[90], r);
}
// Bügelspalt frei? (Spalt liegt zwischen x=0 und x=spalt)
{
  const r = await pg.evaluate(async () => {
    const g = await window._gmkT.bau({ halt:'glas', rand:2.4, wand:2.2 });
    const p = g.attributes.position, idx = g.index, n = idx ? idx.count : p.count;
    let drin = 0;
    for (let i=0;i<n;i++){ const j = idx?idx.getX(i):i;
      const x=p.getX(j), z=p.getZ(j);
      // Spalt: x zwischen 0,06 und 0,21 Einheiten (0,6…2,1 mm), z unter der Brücke
      if (x>0.06 && x<0.21 && z<-0.05 && z>-0.70) drin++; }
    return drin;
  });
  ok('glas: Bügelspalt bleibt frei', r === 0, r + ' Punkte im Spalt');
}

// ── 3: durchbrochen nimmt weg, erhaben legt drauf ──────────────────────────
{
  const r = await pg.evaluate(async () => {
    const leer = await window._gmkT.bau({ halt:'wein', motiv:0.001 });
    const durch = await window._gmkT.bau({ halt:'wein', art:'durch' });
    const erh  = await window._gmkT.bau({ halt:'wein', art:'erhaben' });
    const V = window._gmkT.vol;
    return { leer:V(leer), durch:V(durch), erh:V(erh),
             wtD:window._gmkT.watertight(durch).offen, wtE:window._gmkT.watertight(erh).offen };
  });
  ok('durchbrochen entfernt Material', r.durch < r.leer - 0.005, { leer:+r.leer.toFixed(4), durch:+r.durch.toFixed(4) });
  ok('erhaben fügt Material hinzu',    r.erh   > r.leer + 0.002, { leer:+r.leer.toFixed(4), erhaben:+r.erh.toFixed(4) });
  ok('beide Ausführungen wasserdicht', r.wtD === 0 && r.wtE === 0, r);
}

// ── 4: alle Motive ────────────────────────────────────────────────────────
{
  const r = await pg.evaluate(async () => {
    const keys = Object.keys(_GMK_SYM), schlecht = [];
    for (const k of keys) {
      for (const halt of ['wein','flasche','glas']) {
        for (const art of ['durch','erhaben']) {
          try {
            const g = await window._gmkT.bau({ halt, art }, { k:'sym', v:k, n:k });
            const wt = window._gmkT.watertight(g), v = window._gmkT.vol(g);
            if (wt.offen !== 0 || v <= 0) schlecht.push({ k, halt, art, offen:wt.offen, v:+v.toFixed(4) });
          } catch(e) { schlecht.push({ k, halt, art, err:String(e).slice(0,80) }); }
        }
      }
    }
    return { n: keys.length, schlecht };
  });
  ok('alle ' + r.n + ' Motive × 3 Halterungen × 2 Ausführungen', r.schlecht.length === 0, r.schlecht.slice(0,6));
}

// ── 5: Schrift-Kennungen ──────────────────────────────────────────────────
{
  const r = await pg.evaluate(async () => {
    await new Promise(res => _npLoadFont('baloo_local', f => { _gmk.font = f; res(); }));
    const out = {};
    for (const m of [{k:'txt',v:'Martina',n:'Martina'},{k:'txt',v:'B',n:'B'},{k:'txt',v:'12',n:'12'}]) {
      const g = await window._gmkT.bau({ halt:'wein', satz:'namen' }, m);
      out[m.v] = { offen: window._gmkT.watertight(g).offen, v: +window._gmkT.vol(g).toFixed(4) };
    }
    const leer = +window._gmkT.vol(await window._gmkT.bau({ halt:'wein', motiv:0.001 })).toFixed(4);
    return { out, leer };
  });
  const alleDicht = Object.values(r.out).every(o => o.offen === 0);
  const alleDrauf = Object.values(r.out).every(o => o.v > r.leer);
  ok('Namen/Buchstaben/Zahlen wasserdicht', alleDicht, r.out);
  ok('Schrift steht erhaben (mehr Material)', alleDrauf, { leer:r.leer, ...r.out });
}

// ── 6: Erstellen legt die richtige Anzahl an ──────────────────────────────
{
  const r = await pg.evaluate(async () => {
    _gmkP = Object.assign({}, _GMK_DEFAULTS, { halt:'flasche', anzahl:5, satz:'tiere' });
    const vorher = objects.length;
    await _gmkCreate();
    const g = objects[objects.length-1];
    return { neu: objects.length - vorher, kinder: g.children.length,
             name: g.userData.name, namen: g.children.map(c => c.userData.name) };
  });
  ok('Erstellen legt eine Gruppe an', r.neu === 1, r.name);
  ok('Gruppe enthält 5 verschiedene Marker', r.kinder === 5 && new Set(r.namen).size === 5, r.namen);
}

// ── 7: Motive lassen sich einzeln wählen ──────────────────────────────────
{
  const r = await pg.evaluate(() => {
    _gmkP = Object.assign({}, _GMK_DEFAULTS, { wahl:_GMK_SETS.tiere.slice(), anzahl:10 });
    const vorher = _gmkMotifList(_gmkP).map(m => m.v);
    _gmkP.wahl = ['herz','pilz','anker']; _gmkP.anzahl = 3;
    const nachher = _gmkMotifList(_gmkP).map(m => m.v);
    _gmkP.anzahl = 7;                                   // mehr Marker als Motive → zyklisch
    const zyklisch = _gmkMotifList(_gmkP).map(m => m.v);
    _gmkSyncUI();
    return { vorher, nachher, zyklisch, satz:_gmkP.satz, alle:_GMK_ALLE.length };
  });
  ok('alle 26 Motive stehen zur Wahl', r.alle === 26, r.alle);
  ok('eigene Auswahl schlägt auf die Marker durch',
     JSON.stringify(r.nachher) === JSON.stringify(['herz','pilz','anker']), r.nachher);
  ok('mehr Marker als Motive wiederholt zyklisch',
     JSON.stringify(r.zyklisch) === JSON.stringify(['herz','pilz','anker','herz','pilz','anker','herz']), r.zyklisch);
  ok('quer gewählt heißt im Menü „Eigene Mischung"', r.satz === 'mix', r.satz);
}

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0,4));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
