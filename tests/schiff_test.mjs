// Regressionstest für den Schiffsgenerator (🚢, _shf*).
//   1. alle Vorlagen × Wasserlinie/Vollrumpf × mehr-/einfarbig bauen, jedes Teil wasserdicht, Volumen > 0
//   2. Farbteile überlappen sich nicht (Mehrfarbdruck)
//   3. Schiff hängt zusammen: alle Teile außer dem Ständer vereint = 1 Körper
//   4. Wasserlinie: Unterkante y = 0, Boden flach (große Auflagefläche)
//   5. Länge passt zur Einstellung
//   6. Erstellen legt Teile an, Speichern/Laden behält schiffParams, Bearbeiten ersetzt in place
// Start: python3 volme3d_server.py 8853 --dev   →   V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/schiff_test.mjs
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

const typen = await pg.evaluate(() => Object.keys(_SHF_TYPEN));
const varianten = [];
for (const t of typen) {
  varianten.push({ name: t + ' Wasserlinie', typ: t, p: {} });
  varianten.push({ name: t + ' Vollrumpf', typ: t, p: { rumpf: 'voll' } });
}
varianten.push({ name: 'titanic einfarbig', typ: 'titanic', p: { farbig: 0 } });
varianten.push({ name: 'dreimaster ohne Segel, Gaffel', typ: 'dreimaster', p: { segel: 0 } });
varianten.push({ name: 'zweimaster Schoner', typ: 'zweimaster', p: { takelung: 'gaffel' } });
varianten.push({ name: 'schlacht 6 Türme 45°', typ: 'schlacht', p: { tuerme: 6, rohrW: 45 } });
varianten.push({ name: 'Mischung: Dampfsegler', typ: 'raddampfer', p: { masten: 2, segel: 1, bugspriet: 1, kastell: 1, tuerme: 2 } });
varianten.push({ name: 'klein 60 mm', typ: 'einmaster', p: { laenge: 60 } });

for (const v of varianten) {
  const r = await pg.evaluate(({ typ, p }) => {
    Object.assign(_shfP, _SHF_DEF, _SHF_TYPEN[typ].def, { typ }, p);
    const t0 = performance.now();
    const res = _shfBuild(_mfWasm, _shfP, 'fein');
    const ms = performance.now() - t0;
    const W = _mfWasm, out = { ms: Math.round(ms), teile: res.teile.length, wasserdicht: true, vol: [], ueber: 0, minY: Infinity, lx: res.mass.lx };
    const mfs = [];
    for (const t of res.teile) {
      const pos = t.geo.toNonIndexed().attributes.position.array;
      for (let i = 1; i < pos.length; i += 3) if (!t.stand) out.minY = Math.min(out.minY, pos[i]);
      let mf;
      try { mf = _mfFromSoup(W, pos); } catch (e) { out.wasserdicht = false; out.err = String(e); continue; }
      out.vol.push(Math.round(mf.volume()));
      mfs.push({ mf, stand: t.stand });
    }
    for (let i = 0; i < mfs.length; i++) for (let j = i + 1; j < mfs.length; j++) {
      const x = mfs[i].mf.intersect(mfs[j].mf); out.ueber = Math.max(out.ueber, x.volume()); x.delete();
    }
    const schiff = mfs.filter(m => !m.stand).map(m => m.mf);
    const all = W.Manifold.union(schiff);
    out.splitter = 0;
    // Splitter beim Vereinen im Test sind Rauschen der Kontaktflächen — nur echte Körper zählen
    out.koerper = all.decompose().filter(x => x.volume() > 1).length;
    for (const m of mfs) out.splitter += m.mf.decompose().filter(x => x.volume() <= 0.05).length;
    out.minVol = Math.min(...out.vol);
    // Bodenfläche: Dreiecke mit Normale nach unten auf y≈0
    const g = _mfToGeo(all).toNonIndexed(), a = g.attributes.position.array;
    let boden = 0;
    for (let i = 0; i < a.length; i += 9) {
      if (Math.max(Math.abs(a[i+1]), Math.abs(a[i+4]), Math.abs(a[i+7])) > 0.01) continue;
      const ux=a[i+3]-a[i],uz=a[i+5]-a[i+2],vx=a[i+6]-a[i],vz=a[i+8]-a[i+2];
      boden += Math.abs(ux*vz-uz*vx)/2;
    }
    out.boden = Math.round(boden);
    out.L = _shfP.laenge;
    all.delete(); for (const m of mfs) m.mf.delete();
    return out;
  }, v);
  const voll = !!v.p.rumpf;
  ok(v.name + ': baut, wasserdicht', r.wasserdicht && r.vol.every(x => x > 0), { ms: r.ms, teile: r.teile, vol: r.vol, err: r.err });
  // Kontaktflächen ergeben nach Float32 ein paar µm Rauschen — echte Überlappung wäre ≥ 0,3 mm tief
  ok(v.name + ': keine Überlappung der Farbteile', r.ueber < Math.max(0.5, 0.005 * r.minVol), r.ueber);
  ok(v.name + ': keine Splitter', r.splitter === 0, r.splitter);
  ok(v.name + ': ein zusammenhängendes Schiff', r.koerper === 1, r.koerper);
  if (!voll) ok(v.name + ': liegt flach auf (y=0, Boden)', Math.abs(r.minY) < 0.01 && r.boden > 0.5 * r.L * r.L * 0.05, { minY: r.minY, boden: r.boden });
  ok(v.name + ': Länge ≥ Rumpflänge', r.lx >= r.L - 0.5 && r.lx < r.L * 1.6, { lx: Math.round(r.lx), L: r.L });
}

// Erstellen, Speichern/Laden, Bearbeiten
const e = await pg.evaluate(async () => {
  _newCreate(false);
  Object.assign(_shfP, _SHF_DEF);
  _shfOpen();
  await _shfCreate();
  const n1 = objects.length, sets = new Set(objects.map(o => o.userData.shfSet));
  const d = objectToData(objects[0]);
  const back = d.schiffParams && d.schiffParams.typ;
  _shfEdit(objects[0]);
  _shfP.schorn = 2;
  await _shfCreate();
  return { n1, sets: sets.size, back, n2: objects.length, schorn: objects[0].userData.schiffParams.schorn };
});
ok('Erstellen legt Farbteile an (ein Satz)', e.n1 >= 5 && e.sets === 1, e);
ok('objectToData behält schiffParams', e.back === 'titanic', e.back);
ok('Bearbeiten ersetzt in place', e.n2 === e.n1 && e.schorn === 2, e);

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
