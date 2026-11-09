// Regressionstest für die Kinder-/Spielwelt-Generatoren (_kg*, Gerüst _kgReg).
// Für jeden registrierten Generator, jede Vorlage und ein paar Sonderfälle:
//   1. baut, jedes Teil wasserdicht, Volumen > 0
//   2. Farbteile überlappen sich nicht (Mehrfarbdruck)
//   3. ein zusammenhängendes Modell (freie Teile wie der Ständer zählen extra)
//   4. liegt auf dem Bett (Unterkante y = 0) und passt aufs 256er-Bett
//   5. Erstellen, Speichern/Laden (kgParams), Bearbeiten ersetzt an Ort und Stelle
// Start: python3 volme3d_server.py 18871 --dev   →   V3D_URL=http://127.0.0.1:18871/volme3d.html node tests/kinder_gen_test.mjs [generator]
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const NUR = process.argv[2] || '';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

// Sonderfälle je Generator (zusätzlich zu allen Vorlagen + einfarbig)
const EXTRA = {
  staender: [{ aufnahme: 'teller', neigung: 25 }, { aufnahme: 'gabel', fussForm: 'eckig' }, { neigung: 0, hoehe: 200 }, { neigung: 30, hoehe: 20 }],
  pflanze: [{ vorlage: 'laub', sockel: 'keiner' }, { vorlage: 'tanne', hoehe: 160 }, { vorlage: 'busch', hoehe: 15 }, { vorlage: 'palme', seed: 7 }, { vorlage: 'kaktus', hoehe: 20 }, { vorlage: 'apfel', farbig: 0 }],
  landschaft: [{ vorlage: 'berg', raster: 224, hoehe: 140 }, { vorlage: 'huegel', raster: 96, seed: 9 }, { vorlage: 'wald', baeume: 12 }, { vorlage: 'fluss', flussB: 60 }, { vorlage: 'see', farbig: 0 }],
  bruecke: [{ vorlage: 'buckel', fahrweg: 'strasse' }, { vorlage: 'auffahrt', laenge: 216, enden: 'mm' }, { vorlage: 'hoch', laenge: 54, enden: 'mm' }, { vorlage: 'fachwerk', fahrweg: 'strasse', laenge: 216 }, { vorlage: 'buckel', hoehe: 120, laenge: 108, enden: 'ww' }, { vorlage: 'hoch', hoehe: 30 }],
  haus: [{ vorlage: 'haus', schild: 'Nr. 7' }, { vorlage: 'hochhaus', geschosse: 12, geschossH: 20 }, { vorlage: 'haus', geschosse: 1, breite: 30, tiefe: 25, neigung: 60 }, { vorlage: 'stadthaus', dach: 'sattel', schild: 'CAFÉ' }, { vorlage: 'laden', schild: '' }, { vorlage: 'feuer', breite: 140, farbig: 0 }, { vorlage: 'bahnhof', breite: 40, geschosse: 1 }],
  fahrzeug: [{ vorlage: 'auto', laenge: 50 }, { vorlage: 'bus', laenge: 160 }, { vorlage: 'feuer', laenge: 60 }, { vorlage: 'traktor', laenge: 50 }, { vorlage: 'renn', farbig: 0 }, { vorlage: 'lkw', laenge: 160 }, { vorlage: 'polizei', laenge: 120 }],
  strasse: [{ vorlage: 'kreuzung', raster: 96, fahrbahn: 50, gehweg: 6 }, { vorlage: 'kreisel', raster: 224, fahrbahn: 120, gehweg: 24 }, { vorlage: 'kurve', gehweg: 0 }, { vorlage: 'tkreuzung', farbig: 0 }, { vorlage: 'ende', raster: 96 }, { vorlage: 'zebra', fahrbahn: 40 }],
  zug: [{ vorlage: 'dampf', kupplung: 'haken' }, { vorlage: 'personen', laenge: 160 }, { vorlage: 'gueter', laenge: 50, kupplung: 'keine' }, { vorlage: 'elok', farbig: 0 }, { vorlage: 'kessel', kupplung: 'haken', laenge: 50 }],
  schienen: [{ vorlage: 'gerade', laenge: 18 }, { vorlage: 'gerade', laenge: 216, enden: 'ww' }, { vorlage: 'kurve', enden: 'mm' }, { vorlage: 'kurve', winkel: 90, radius: 110 }, { vorlage: 'weiche', richtung: 'rechts' }, { vorlage: 'weiche', laenge: 216, winkel: 30 }, { vorlage: 'kreuzung', laenge: 108 }, { vorlage: 'prellbock', laenge: 54 }],
  becher: [{ vorlage: 'tasse', name: 'Florian' }, { vorlage: 'katze', name: 'Mia', nameSeite: 'hinten' }, { vorlage: 'stifte', name: 'Stifte', schrift: 'pacifico_local' }, { vorlage: 'frosch', farbig: 0, name: 'Ben' }, { form: 'wellen', henkel: 1, konisch: 30 }, { vorlage: 'hase', hoehe: 40, durchm: 40 }, { vorlage: 'baer', hoehe: 160, durchm: 120, henkel: 1, name: 'Maximilian' }],
  uboot: [{ vorlage: 'modern', darst: 'voll' }, { vorlage: 'klassik', darst: 'voll', staender: 0 }, { vorlage: 'comic', darst: 'voll' }, { vorlage: 'comic', farbig: 0 }, { vorlage: 'klassik', platte: 0 }, { vorlage: 'modern', laenge: 60, dicke: 6 }, { vorlage: 'comic', laenge: 220, dicke: 32, turmH: 200 }, { vorlage: 'comic', kanone: 1 }, { vorlage: 'modern', kanone: 1, darst: 'voll' }, { vorlage: 'modern', kanone: 1, laenge: 60, dicke: 6 }],
  flugzeug: [{ vorlage: 'jet', staender: 0 }, { vorlage: 'prop', triebw: 2, fenster: 1 }, { vorlage: 'jaeger', laenge: 60 }, { vorlage: 'jumbo', laenge: 250, spann: 90 }, { vorlage: 'segler', farbig: 0 }],
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

const gens = await pg.evaluate(() => Object.keys(_KG).map(id => ({ id, vorlagen: _KG[id].vorlagen ? Object.keys(_KG[id].vorlagen) : [], farbig: _KG[id].params.some(x => x.k === 'farbig') })));
for (const g of gens) {
  if (NUR && g.id !== NUR) continue;
  const varianten = [];
  if (g.vorlagen.length) for (const v of g.vorlagen) varianten.push({ name: g.id + ' ' + v, p: { vorlage: v }, vor: true });
  else varianten.push({ name: g.id + ' Standard', p: {} });
  if (g.farbig) varianten.push({ name: g.id + ' einfarbig', p: { farbig: 0 } });
  for (const x of EXTRA[g.id] || []) varianten.push({ name: g.id + ' ' + JSON.stringify(x), p: x, vor: !!x.vorlage });

  for (const v of varianten) {
    const r = await pg.evaluate(({ id, p, vor }) => {
      const def = _KG[id];
      const P = { ...def.DEF };
      if (vor && def.vorlagen) Object.assign(P, def.vorlagen[p.vorlage].p || {});
      Object.assign(P, p);
      const W = _mfWasm, t0 = performance.now();
      let res;
      try { res = _kgBau(W, id, P, 'fein'); } catch (e) { return { err: String(e && e.stack || e) }; }
      const out = { ms: Math.round(performance.now() - t0), teile: res.teile.length, wasserdicht: true, vol: [], ueber: 0, minY: Infinity, mass: res.mass };
      const mfs = [];
      for (const t of res.teile) {
        const pos = t.geo.toNonIndexed().attributes.position.array;
        let mY = Infinity; for (let i = 1; i < pos.length; i += 3) mY = Math.min(mY, pos[i]);
        out.minY = Math.min(out.minY, mY);
        if (t.frei) out.freiY = Math.max(out.freiY || 0, Math.abs(mY)); else out.festY = Math.min(out.festY ?? Infinity, mY);
        let mf;
        try { mf = _mfFromSoup(W, pos); } catch (e) { out.wasserdicht = false; out.err = String(e); continue; }
        if (mf.isEmpty()) { out.wasserdicht = false; continue; }
        out.vol.push(Math.round(mf.volume()));
        mfs.push({ mf, frei: t.frei });
      }
      for (let i = 0; i < mfs.length; i++) for (let j = i + 1; j < mfs.length; j++) {
        const x = mfs[i].mf.intersect(mfs[j].mf); out.ueber = Math.max(out.ueber, x.volume()); x.delete();
      }
      const fest = mfs.filter(m => !m.frei).map(m => m.mf);
      const all = W.Manifold.union(fest);
      out.koerper = all.decompose().filter(x => x.volume() > 1).length;
      out.frei = mfs.filter(m => m.frei).map(m => m.mf.decompose().filter(x => x.volume() > 1).length);
      out.minVol = Math.min(...out.vol);
      all.delete(); for (const m of mfs) m.mf.delete();
      return out;
    }, { id: g.id, p: v.p, vor: v.vor });
    if (r.err && !r.vol) { ok(v.name + ': baut', false, r.err.slice(0, 400)); continue; }
    ok(v.name + ': baut, wasserdicht', r.wasserdicht && r.vol.every(x => x > 0), { ms: r.ms, teile: r.teile, vol: r.vol, err: r.err });
    ok(v.name + ': keine Überlappung der Farbteile', r.ueber < Math.max(0.5, 0.005 * r.minVol), r.ueber);
    ok(v.name + ': ein zusammenhängendes Modell', r.koerper === 1 && r.frei.every(n => n === 1), { koerper: r.koerper, frei: r.frei });
    ok(v.name + ': liegt auf dem Bett (Modell + jedes freie Teil)', Math.abs(r.minY) < 0.01 && Math.abs(r.festY) < 0.01 && (r.freiY || 0) < 0.01, { minY: r.minY, festY: r.festY, freiY: r.freiY });
    ok(v.name + ': passt aufs Bett (≤ 256 mm)', Math.max(r.mass.lx, r.mass.by) <= 256.5, r.mass);
  }

  // Erstellen, Speichern/Laden, Bearbeiten
  const e = await pg.evaluate(async (id) => {
    _newCreate(false);
    const def = _KG[id];
    _kgS.id = null;
    _kgOpen(id);
    await _kgCreate();
    const n1 = objects.length, sets = new Set(objects.map(o => o.userData.kgSet));
    const d = objectToData(objects[0]);
    const back = d.kgParams && d.kgParams.gen;
    const range = def.params.find(x => x.t === 'range');
    _kgEdit(objects[0]);
    const offen = document.getElementById('kg-modal').classList.contains('show');
    const neu = Math.min(range.max, range.v + range.step * 2);
    _kgS.p[range.k] = neu;
    await _kgCreate();
    return { n1, sets: sets.size, back, offen, n2: objects.length, wert: objects[0].userData.kgParams[range.k], neu, starter: _STARTERS.some(s => s.kg === id), thema: _GEN_THEMEN.some(t => t[1].includes(def.name)) };
  }, g.id);
  ok(g.id + ': Erstellen legt einen Satz an', e.n1 >= 1 && e.sets === 1, e);
  ok(g.id + ': objectToData behält kgParams', e.back === g.id, e.back);
  ok(g.id + ': Bearbeiten öffnet das Fenster', e.offen, e);
  ok(g.id + ': Bearbeiten ersetzt an Ort und Stelle', e.n2 === e.n1 && e.wert === e.neu, e);
  ok(g.id + ': steht in der Generatorliste + Thema', e.starter && e.thema, e);
}

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
