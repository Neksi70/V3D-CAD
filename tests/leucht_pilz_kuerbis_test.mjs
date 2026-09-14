// Regressionstest: Lichtpunkte, Schriftzug und Schuppen (Bausteine der Eichel)
// in Pilz und Kürbis.
//
//   Pilz:   jedes Lichtloch geht in den hohlen Stiel durch (Manifold-Genus steigt
//           um genau die Lochzahl), Schrift steht vor bzw. liegt tief, Stiel und
//           Schuppen-Hut sind gültige Körper, das Gewinde bleibt unberührt
//   Kürbis: in allen Modi Körper/Deckel gültig, Löcher gehen durch, Schrift ändert
//           nur den Körper (nie den Deckel), massiv bekommt keine Löcher
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
await pg.evaluate(async () => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
  await _mfInit();
  await new Promise(res => _litLoadFonts({ textMode: 'relief', text1: 'A', font1: 'helvetiker_bold', text2: 'b', font2: 'pacifico_local' }, res));
  // Geometrie → {genus, vol, status} über Manifold (wirft bei nicht-manifold)
  window._lt = geo => {
    const ng = geo.index ? geo.toNonIndexed() : geo;
    try { const m = _mfFromSoup(_mfWasm, new Float32Array(ng.attributes.position.array));
          const r = { genus: m.genus(), vol: m.volume(), status: String(m.status()) }; m.delete(); return r; }
    catch (e) { return { err: String(e) }; }
    finally { if (ng !== geo) ng.dispose(); }
  };
});

// ── Pilz ────────────────────────────────────────────────────────────────────
const pilzV = [
  { name: 'Löcher + LED',          p: { lamp: 1, holes: 14, holeD: 3 } },
  { name: 'Löcher hohl ohne LED',  p: { hollow: 1, holes: 10, holeD: 2.5, ribs: 0 } },
  { name: 'Löcher massiv (keine)', p: { hollow: 0, holes: 10 }, keineLoecher: true },
  { name: 'Schrift erhaben',       p: { textMode: 'relief', stemDia: 50, stemH: 80, ribs: 0, holes: 0 } },
  { name: 'Schrift vertieft',      p: { textMode: 'gravur', stemDia: 50, stemH: 80, ribs: 0, holes: 0 } },
  { name: 'Schrift auf Rippen',    p: { textMode: 'gravur', stemDia: 50, stemH: 80, holes: 0 }, nurGueltig: true },
  { name: 'Alles + LED + Schuppen', p: { lamp: 1, holes: 12, textMode: 'relief', stemDia: 50, stemH: 90, skin: 'schuppen' }, nurGueltig: true },
];
for (const v of pilzV) {
  const r = await pg.evaluate(({ over }) => {
    const p = { ..._pilzP, ...over }, d = _pilzDims(p);
    try {
      const base = _lt(_pilzStemGeo(p, 120));
      const t = _pilzText(p, d), holes = _pilzHolePts(p, d, t && t.box);
      const g = _pilzStemFinal(_mfWasm, p, 120, false), fin = _lt(g);
      const cap = _lt(_pilzCapGeo(p, p.skin === 'schuppen' ? 220 : 90));
      let vor = null;
      if (t) {   // Strahl von vorn auf die Blockmitte, quer über die Zeile: max. Abweichung von der Grundfläche
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(true);
        // Mitte der ERSTEN Zeile — die Blockmitte fällt in die Lücke zwischen den Zeilen
        const hL = (p.textH / 10 - p.textH / 100) / 2, yc = t.box[3] - hL / 2; let best = 0;
        for (let x = t.box[0]; x <= t.box[1]; x += 0.01) {
          const h = new THREE.Raycaster(new THREE.Vector3(x, yc, 50), new THREE.Vector3(0, 0, -1)).intersectObject(mesh, false)[0];
          if (!h) continue;
          const dz = h.point.z - Math.sqrt(Math.max(0, d.rStem(yc) ** 2 - x * x));
          if (p.textMode === 'relief' ? dz > best : dz < best) best = dz;
        }
        vor = +(best * 10).toFixed(2);
      }
      return { base, fin, cap, loecher: holes.length, vor, soll: p.textT, text: !!t };
    } catch (e) { return { err: String(e && e.stack || e) }; }
  }, { over: v.p });
  if (r.err) { ok('Pilz ' + v.name + ': baut', false, r.err); continue; }
  ok('Pilz ' + v.name + ': Stiel gültig', !r.fin.err && r.fin.status === 'NoError' && r.fin.vol > 0, r.fin);
  ok('Pilz ' + v.name + ': Hut gültig', !r.cap.err && r.cap.status === 'NoError' && r.cap.genus === 0, r.cap);
  if (v.keineLoecher) ok('Pilz ' + v.name + ': ohne Hohlraum keine Löcher', r.loecher === 0, { loecher: r.loecher });
  else if (v.p.holes) {
    ok('Pilz ' + v.name + ': Lichtpunkte untergebracht', r.loecher >= Math.floor(v.p.holes * 0.8), { hat: r.loecher, soll: v.p.holes });
    ok('Pilz ' + v.name + ': jedes Loch geht durch', r.fin.genus - r.base.genus === r.loecher, { genusVorher: r.base.genus, nachher: r.fin.genus, loecher: r.loecher });
  }
  if (v.p.textMode && !v.nurGueltig) ok('Pilz ' + v.name + ': Schriftzug gesetzt', r.text, r.text);
  if (v.nurGueltig) continue;
  if (v.p.textMode === 'relief') ok('Pilz ' + v.name + ': Schrift steht vor', r.text && r.vor > r.soll * 0.8 && r.vor < r.soll + 0.5, { vorMm: r.vor, soll: r.soll });
  if (v.p.textMode === 'gravur') ok('Pilz ' + v.name + ': Schrift liegt tiefer', r.text && r.vor < -r.soll * 0.8 && r.vor > -r.soll - 0.5, { vorMm: r.vor, soll: r.soll });
}

// Pilz: Lichtpunkte ändern nichts an Gewinde, Schulter und Einsatz-Tasche
const zone = await pg.evaluate(() => {
  const p = { ..._pilzP, lamp: 1, holes: 20, textMode: 'relief' }, d = _pilzDims(p);
  const pts = _pilzHolePts(p, d, null), hr = p.holeD / 20;
  return { minY: Math.min(...pts.map(q => q.c[1] - hr)), maxY: Math.max(...pts.map(q => q.c[1] + hr)), stopTop: d.stopTop, SH: d.SH, n: pts.length };
});
ok('Pilz: Löcher liegen über der Einsatz-Tasche und unter der Schulter', zone.minY > zone.stopTop && zone.maxY < zone.SH, zone);

// ── Kürbis ──────────────────────────────────────────────────────────────────
// _kbsCreate baut über die ganze App — Körper und Deckel aus der Szene lesen
async function kbs(over){
  return await pg.evaluate(async (over) => {
    const bak = { ..._kbsP };
    Object.assign(_kbsP, over);
    const n0 = objects.length;
    await _kbsCreate();
    Object.assign(_kbsP, bak);
    const root = objects[objects.length - 1];
    if (objects.length === n0) return { err: 'nichts erstellt' };
    const meshes = root.isGroup ? root.children : [root], out = {};
    for (const m of meshes) out[/Deckel/.test(m.userData.name) ? 'lid' : 'body'] = _lt(m.geometry);
    scene.remove(root); objects.pop();
    return out;
  }, over);
}
const kbsV = [
  { name: 'Hohl, kleiner Deckel', p: { modus: 'hohl', deckel: 'konisch', face: 'klassisch' } },
  { name: 'Hohl, Schulterdeckel', p: { modus: 'hohl', deckel: 'schulter', face: 'ohne', dia: 130, hoehe: 64 } },
  { name: 'Schale',               p: { modus: 'schale', face: 'ohne', dia: 180, hoehe: 58 } },
];
for (const v of kbsV) {
  const plain = await kbs({ ...v.p, holes: 0, textMode: 'keine' });
  const lit = await kbs({ ...v.p, holes: 18, holeD: 4, textMode: 'relief', textSeite: v.p.face === 'ohne' ? 'vorne' : 'hinten' });
  const erwartet = await pg.evaluate(over => { const p = { ..._kbsP, ...over, holes: 18, holeD: 4, textMode: 'relief', textSeite: over.face === 'ohne' ? 'vorne' : 'hinten' };
    const sh = _kbsShape(p), t = _kbsText(p, sh); return { loecher: _kbsHolePts(p, sh, t).length, text: !!t }; }, v.p);
  if (plain.err || lit.err) { ok('Kürbis ' + v.name + ': baut', false, plain.err || lit.err); continue; }
  ok('Kürbis ' + v.name + ': Körper gültig', lit.body.status === 'NoError' && lit.body.vol > 0, lit.body);
  ok('Kürbis ' + v.name + ': Lichtpunkte untergebracht', erwartet.loecher >= 14, erwartet);
  ok('Kürbis ' + v.name + ': jedes Loch geht durch', lit.body.genus - plain.body.genus === erwartet.loecher,
     { genusVorher: plain.body.genus, nachher: lit.body.genus, loecher: erwartet.loecher });
  ok('Kürbis ' + v.name + ': Schrift vorhanden', erwartet.text, erwartet);
  if (plain.lid) ok('Kürbis ' + v.name + ': Deckel bleibt unverändert', Math.abs(lit.lid.vol - plain.lid.vol) < 1e-6 * Math.max(1, plain.lid.vol) + 1e-9 && lit.lid.genus === plain.lid.genus,
     { vorher: plain.lid, nachher: lit.lid });
}
// massiv: nur Schrift, keine Löcher; erhaben = mehr, vertieft = weniger Volumen
{
  const base = await kbs({ modus: 'massiv', holes: 0, textMode: 'keine' });
  const rel = await kbs({ modus: 'massiv', holes: 20, textMode: 'relief', textSeite: 'hinten' });
  const grav = await kbs({ modus: 'massiv', holes: 20, textMode: 'gravur', textSeite: 'hinten' });
  ok('Kürbis massiv: keine Löcher', rel.body.genus === base.body.genus, { vorher: base.body.genus, nachher: rel.body.genus });
  ok('Kürbis massiv: erhaben legt Material auf, vertieft nimmt weg', rel.body.vol > base.body.vol && grav.body.vol < base.body.vol,
     { base: base.body.vol, relief: rel.body.vol, gravur: grav.body.vol });
}
// Vorschau zeigt Schrift und Lichtpunkte
const vs = await pg.evaluate(() => {
  const p = { ..._kbsP, holes: 12, textMode: 'relief' };
  return _kbsLitPreviewParts(p, _kbsShape(p)).map(g => g.idx.length / 3);
});
ok('Kürbis-Vorschau zeigt Schrift und Lichtpunkte', vs.length === 2 && vs.every(n => n > 0), vs);

ok('Keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles grün');
process.exit(fails.length ? 1 : 0);
