// Regressionstest für den Generator „Geflochtener Kranz" (🕯️, _krz*).
//
// Geprüft wird, was beim Drucken und Bestücken zählt:
//   1. alle Varianten bauen, der Kranz ist wasserdicht, EIN Stück, Volumen > 0,
//      Geschlecht 1 (Ring) — mit Boden in der Mitte Geschlecht 0
//   2. Unterseite liegt eben auf y = 0, nichts hängt unter die Platte
//   3. jede Kerzenmulde ist wirklich offen (Strahl von oben trifft erst den Boden)
//      und hat einen Boden (endet nicht im Leeren)
//   4. Gliederzahl passt zur Kerzenzahl, Außen-Ø stimmt
//   5. Erstellen legt ein Teil in Druck-Lage an
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SHOTS = process.env.SHOTS === '1';
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
  { name: 'Standard (4 Stabkerzen, Strick)', p: {} },
  { name: 'Teelichter, Kordel',             p: { haut: 'kordel', kerzeD: 39.5, tiefe: 12, strang: 48, dia: 250 } },
  { name: 'Glatt, 5 Kerzen',                p: { haut: 'glatt', anzahl: 5 } },
  { name: 'Mitte Stumpen',                  p: { kerzen: 'mitte', kerzeD: 61, tiefe: 10 } },
  { name: 'Ohne Kerzen, klein',             p: { kerzen: 'keine', dia: 140, strang: 24 } },
  { name: 'Weit + flach, 8 Kerzen',         p: { weite: 120, woelb: 60, anzahl: 8, kerzeD: 15, tiefe: 8 } },
];

for (const v of varianten) {
  const r = await pg.evaluate(p => {
    Object.assign(_krzP, _KRZ_DEF, p);
    const t0 = performance.now();
    const res = _krzBuild(_mfWasm, _krzP, 'fein'), d = res.d, geo = res.geo;
    const ms = performance.now() - t0;
    const mf = _mfFromSoup(_mfWasm, geo.toNonIndexed().attributes.position.array);
    const genus = mf.genus(), vol = mf.volume(), parts = mf.decompose().length;
    mf.delete();
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const rc = new THREE.Raycaster();
    const mulden = [];
    const spots = d.mitte ? [{ x: 0, z: 0, floor: d.boden }] : d.cand;
    for (const c of spots) {
      rc.set(new THREE.Vector3(c.x, 500, c.z), new THREE.Vector3(0, -1, 0));
      const hits = rc.intersectObject(mesh, false);
      mulden.push({ ersterTreffer: hits.length ? +hits[0].point.y.toFixed(2) : null, floor: +c.floor.toFixed(2) });
    }
    geo.dispose();
    return { ms: Math.round(ms), tris: geo.index.count / 3, genus, vol, parts, minY: bb.min.y, maxY: bb.max.y,
             dia: bb.max.x - bb.min.x, rOut: d.rOut, nG: d.nG, N: d.N, mitte: d.mitte, mulden,
             okLoch: d.okLoch, okKerze: d.okKerze, halt: d.halt, wand: d.wandMin };
  }, v.p);
  console.log(v.name, JSON.stringify({ ms: r.ms, tris: r.tris, genus: r.genus, nG: r.nG, dia: +r.dia.toFixed(1), h: +r.maxY.toFixed(1), halt: +r.halt.toFixed(1), wand: +r.wand.toFixed(1) }));
  ok(v.name + ': ein Stück, Volumen > 0', r.parts === 1 && r.vol > 0, { parts: r.parts, vol: Math.round(r.vol) });
  ok(v.name + ': Geschlecht ' + (r.mitte ? 0 : 1), r.genus === (r.mitte ? 0 : 1), r.genus);
  ok(v.name + ': liegt eben auf y = 0', Math.abs(r.minY) < 1e-3, r.minY);
  ok(v.name + ': Außen-Ø', Math.abs(r.dia - 2 * r.rOut) < 1.5, [r.dia, 2 * r.rOut]);
  if (r.N > 0) ok(v.name + ': Glieder Vielfaches der Kerzen', r.nG % r.N === 0, r.nG);
  for (const m of r.mulden) ok(v.name + ': Mulde offen bis zum Boden', m.ersterTreffer !== null && Math.abs(m.ersterTreffer - m.floor) < 0.05, m);
}

// Erstellen
await pg.evaluate(() => { Object.assign(_krzP, _KRZ_DEF); _krzOpen(); });
await pg.waitForFunction(() => _gpv['krz'] && _gpv['krz'].group, { timeout: 20000 });
const vorher = await pg.evaluate(() => objects.length);
await pg.evaluate(() => _krzCreate());
await pg.waitForFunction(n => objects.length > n, vorher, { timeout: 60000 });
const erst = await pg.evaluate(() => {
  const o = objects[objects.length - 1], bb = new THREE.Box3().setFromObject(o);
  return { name: o.userData.name, minY: bb.min.y, w: (bb.max.x - bb.min.x) * 10, offen: document.getElementById('krz-modal').classList.contains('show') };
});
ok('Erstellen: Teil in Druck-Lage', /Flechtkranz/.test(erst.name) && Math.abs(erst.minY) < 1e-3 && Math.abs(erst.w - 240) < 2 && !erst.offen, erst);

if (SHOTS) {
  for (const [n, p] of [['strick', {}], ['kordel', { haut: 'kordel', kerzeD: 39.5, tiefe: 12, strang: 48, dia: 250 }], ['mitte', { kerzen: 'mitte', kerzeD: 61, tiefe: 10 }]]) {
    await pg.evaluate(p => { Object.assign(_krzP, _KRZ_DEF, p); _krzOpen(); _krzSync(); _gpvUpdate('krz'); }, p);
    await pg.waitForTimeout(600);
    await pg.locator('#krz-modal .g3box').screenshot({ path: '/tmp/kranz_' + n + '.png' });
  }
}
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles grün');
process.exit(fails.length ? 1 : 0);
