// Regressionstest für den Generator „Schalen mit Einsätzen" (🍱, _dsh*).
//   1. alle Teile wasserdicht (jede gerichtete Kante genau einmal + Gegenkante), EIN Stück, Volumen > 0
//   2. Einsätze passen: keine Überschneidung mit Wand/Boden/Nachbarn; um 0,9·Spiel
//      verschoben weiter frei, um 1,15·Spiel verschoben stoßen sie an (Spalt ≈ Spiel)
//   3. Deckel passt über die Schale (gleiches Prinzip mit Deckel-Spiel), Einsätze stoßen nicht an
//   4. kein Überhang flacher als 45° (außer Unterseite)
//   5. Erstellen: Teile einzeln, auf y = 0, nebeneinander ohne Überlappung
//   6. Parameter überleben objectToData → buildObjectFromData; Bearbeiten ersetzt/entfernt Teile
// Start: node tests/schalen_test.mjs   (startet selbst python3 volme3d_server.py 8871 --dev)
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const PORT = process.env.V3D_PORT || '8871';
const URL = process.env.V3D_URL || `http://127.0.0.1:${PORT}/volme3d.html`;
let srv = null;
if (!process.env.V3D_URL) {
  srv = spawn('python3', ['volme3d_server.py', PORT, '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 1500));
}
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
try {
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function' && typeof _dshBuild === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  try { hideStarter(); } catch (e) { document.getElementById('start-modal')?.classList.remove('show'); }
  document.getElementById('auth-overlay')?.classList.add('hidden');
});
await pg.evaluate(async () => { await _mfInit(); });

const varianten = [
  { name: 'Standard 3×2, Griffmulde',              p: {} },
  { name: 'Grifflasche + Stülpdeckel',             p: { griff: 'lasche', deckel: 1 } },
  { name: 'Tablett 4×3, ohne Griff, Deckel',       p: { tablett: 1, spalten: 4, reihen: 3, griff: 'keine', deckel: 1, deckelH: 6 } },
  { name: '1×1, großer Eckradius (wird gekappt)',  p: { spalten: 1, reihen: 1, rund: 30, breite: 60, tiefe: 50 } },
  { name: 'eckig, Spiel 0,8, dicke Wände',         p: { rund: 0, spiel: 0.8, wand: 4, boden: 3, ewand: 2, spalten: 2, reihen: 2, deckel: 1, dspiel: 0.6 } },
  { name: '5×1 schmal, Lasche',                    p: { spalten: 5, reihen: 1, breite: 200, tiefe: 60, griff: 'lasche' } },
];

for (const v of varianten) {
  const r = await pg.evaluate(p => {
    Object.assign(_dshP, _DSH_DEF, p);
    const W = _mfWasm, res = _dshBuild(W, _dshP), d = res.d, out = { d: { ok: d.ok, griff: d.griff, rk: d.rk, n: d.pos.length } };
    // Y oben → Z oben, Manifold
    const toZ = geo => { const a = geo.toNonIndexed().attributes.position.array, o = new Float32Array(a.length);
      for (let i = 0; i < a.length; i += 3) { o[i] = a[i]; o[i + 1] = -a[i + 2]; o[i + 2] = a[i + 1]; } return o; };
    const dicht = arr => {                       // gerichtete Kanten: jede genau einmal, Gegenkante genau einmal
      const q = x => Math.round(x * 1e4), key = i => q(arr[i]) + ',' + q(arr[i + 1]) + ',' + q(arr[i + 2]), m = new Map();
      for (let t = 0; t < arr.length; t += 9) for (let e = 0; e < 3; e++) {
        const k = key(t + 3 * e) + '>' + key(t + 3 * ((e + 1) % 3)); m.set(k, (m.get(k) || 0) + 1); }
      let bad = 0; for (const [k, c] of m) { const [a1, b1] = k.split('>'); if (c !== 1 || m.get(b1 + '>' + a1) !== 1) bad++; }
      return bad;
    };
    const ueber = arr => {                       // Fläche mit Normale steiler als 45° nach unten, oberhalb der Unterseite (Z oben)
      let u = 0;
      for (let i = 0; i < arr.length; i += 9) {
        const ux = arr[i+3]-arr[i], uy = arr[i+4]-arr[i+1], uz = arr[i+5]-arr[i+2], vx = arr[i+6]-arr[i], vy = arr[i+7]-arr[i+1], vz = arr[i+8]-arr[i+2];
        const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx, nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-9 || Math.min(arr[i+2], arr[i+5], arr[i+8]) < 0.01) continue;
        if (nz / nl < -0.72) u += nl / 2;
      }
      return u;
    };
    const mf = {};
    for (const k of ['schale', 'ein', 'deckel']) {
      if (!res[k]) continue;
      const arr = toZ(res[k]);
      const m = _mfFromSoup(W, arr);
      const bb = m.boundingBox();
      out[k] = { offen: dicht(arr), vol: m.volume(), teile: m.decompose().length, ueber: ueber(arr), zmin: bb.min[2], zmax: bb.max[2],
        bx: bb.max[0] - bb.min[0], by: bb.max[1] - bb.min[1] };
      mf[k] = m;
    }
    const vol = m => { const v = m.volume(); return v; };
    const hit = (a, bm) => { const x = a.intersect(bm), v = x.volume(); x.delete(); return v; };
    // Einsätze einsetzen
    const ein = d.pos.map(([x, y]) => mf.ein.translate([x, y, d.b]));
    const alle = W.Manifold.union([mf.schale, ...ein]);
    let ueberlapp = 0;
    for (let i = 0; i < ein.length; i++) { ueberlapp = Math.max(ueberlapp, hit(ein[i], mf.schale)); for (let j = i + 1; j < ein.length; j++) ueberlapp = Math.max(ueberlapp, hit(ein[i], ein[j])); }
    out.ueberlapp = ueberlapp;
    // Spalt: verschieben
    const s = _dshP.spiel, dirs = [[1,0],[-1,0],[0,1],[0,-1]], diag = [[1,1],[1,-1],[-1,1],[-1,-1]];
    let frei09 = true, stoss115 = true, freiDiag = true;
    for (let i = 0; i < ein.length; i++) {
      const andere = W.Manifold.union([mf.schale, ...ein.filter((_, j) => j !== i)]);
      for (const [dx, dy] of dirs) {
        const a = ein[i].translate([dx * 0.9 * s, dy * 0.9 * s, 0]); if (hit(a, andere) > 0.001) frei09 = false; a.delete();
        const c = ein[i].translate([dx * 1.15 * s, dy * 1.15 * s, 0]); if (hit(c, andere) < 0.001) stoss115 = false; c.delete();
      }
      for (const [dx, dy] of diag) { const a = ein[i].translate([dx * 0.63 * s, dy * 0.63 * s, 0]); if (hit(a, andere) > 0.001) freiDiag = false; a.delete(); }
      andere.delete();
    }
    Object.assign(out, { frei09, stoss115, freiDiag, einTop: d.b + out.ein.zmax, H: d.H });
    // Deckel aufsetzen: umdrehen, Decke liegt auf dem Rand
    if (mf.deckel) {
      const ds = _dshP.dspiel, dk = mf.deckel.rotate([180, 0, 0]).translate([0, 0, d.H + d.tp]);
      out.deckelUeber = hit(dk, alle);
      let df = true, dst = true;
      for (const [dx, dy] of dirs) {
        const a = dk.translate([dx * 0.9 * ds, dy * 0.9 * ds, 0]); if (hit(a, mf.schale) > 0.001) df = false; a.delete();
        const c = dk.translate([dx * 1.15 * ds, dy * 1.15 * ds, 0]); if (hit(c, mf.schale) < 0.001) dst = false; c.delete();
      }
      // Deckel sitzt auf: 0,1 mm tiefer stößt er an
      const tief = dk.translate([0, 0, -0.1]); out.deckelSitzt = hit(tief, mf.schale) > 0.001; tief.delete();
      Object.assign(out, { deckelFrei: df, deckelStoss: dst });
      dk.delete();
    }
    for (const e of ein) e.delete(); alle.delete();
    for (const k in mf) mf[k].delete();
    for (const k of ['schale', 'ein', 'deckel']) if (res[k]) res[k].dispose();
    return out;
  }, v.p);
  console.log('▶ ' + v.name, JSON.stringify(r.d));
  for (const k of ['schale', 'ein', 'deckel']) {
    if (!r[k]) continue;
    ok(`${k}: wasserdicht (gerichtet)`, r[k].offen === 0, r[k].offen);
    ok(`${k}: ein Stück, Volumen > 0`, r[k].teile === 1 && r[k].vol > 0, { teile: r[k].teile, vol: Math.round(r[k].vol) });
    ok(`${k}: Unterseite z = 0`, Math.abs(r[k].zmin) < 1e-3, r[k].zmin);
    ok(`${k}: kein Überhang > 45°`, r[k].ueber < 0.5, Math.round(r[k].ueber * 10) / 10);
  }
  ok('Einsätze: keine Überschneidung mit Schale/Nachbarn', r.ueberlapp < 0.01, r.ueberlapp);
  ok('Einsätze: um 0,9·Spiel verschoben noch frei', r.frei09);
  ok('Einsätze: um 1,15·Spiel verschoben stoßen an (Spalt ≈ Spiel)', r.stoss115);
  ok('Einsätze: diagonal 0,9·Spiel frei (Ecken)', r.freiDiag);
  ok('Einsätze: Oberkante unter dem Rand', r.einTop <= r.H - 0.1, { top: r.einTop, H: r.H });
  if (v.p.deckel) {
    ok('Deckel: keine Überschneidung mit Schale + Einsätzen', r.deckelUeber < 0.01, r.deckelUeber);
    ok('Deckel: um 0,9·Spiel verschoben frei', r.deckelFrei);
    ok('Deckel: um 1,15·Spiel verschoben stößt an', r.deckelStoss);
    ok('Deckel: liegt auf dem Rand auf', r.deckelSitzt);
  }
  if (v.p.griff !== 'keine') ok('Griff vorhanden', r.d.griff === (v.p.griff || 'mulde'), r.d.griff);
}

// Erstellen + Speichern/Laden + Bearbeiten
const c = await pg.evaluate(async () => {
  _newCreate(false);
  Object.assign(_dshP, _DSH_DEF, { deckel: 1, griff: 'lasche', spiel: 0.45 });
  _dshOpen(); await _dshCreate();
  const teile = objects.filter(o => o.userData.schalenParams);
  const boxes = teile.map(o => new THREE.Box3().setFromObject(o));
  let ueber = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], bb = boxes[j];
    if (a.min.x < bb.max.x - 1e-4 && bb.min.x < a.max.x - 1e-4 && a.min.z < bb.max.z - 1e-4 && bb.min.z < a.max.z - 1e-4) ueber++;
  }
  const yMin = Math.max(...boxes.map(x => Math.abs(x.min.y)));
  const parts = teile.map(o => o.userData._dshPart).sort();
  // Rundreise
  const sch = teile.find(o => o.userData._dshPart === 'schale');
  const data = JSON.parse(JSON.stringify(objectToData(sch)));
  const neu = buildObjectFromData(data);
  const rt = JSON.stringify(neu.userData.schalenParams) === JSON.stringify(sch.userData.schalenParams) &&
    neu.userData._dshPart === 'schale' && neu.userData._dshGid === sch.userData._dshGid && neu.userData._dshVerts === sch.userData._dshVerts;
  // Bearbeiten: 2×2 statt 3×2, ohne Deckel → 5 Teile, gleiche Gruppe, Schale bleibt dasselbe Objekt
  const pos0 = sch.position.clone();
  _dshEdit(sch); _dshP.spalten = 2; _dshP.deckel = 0; await _dshCreate();
  const nach = objects.filter(o => o.userData.schalenParams);
  return { n: teile.length, parts, ueber, yMin, rt, rtP: neu.userData.schalenParams,
    nachN: nach.length, gleicheSchale: nach.includes(sch), gid: new Set(nach.map(o => o.userData._dshGid)).size,
    posGleich: sch.position.distanceTo(pos0) < 1e-6, spaltenNeu: sch.userData.schalenParams.spalten };
});
console.log('▶ Erstellen / Laden / Bearbeiten', JSON.stringify(c.parts));
ok('Erstellen: Schale + 6 Einsätze + Deckel = 8 Teile', c.n === 8, c.n);
ok('Erstellen: Teile liegen auf y = 0', c.yMin < 1e-4, c.yMin);
ok('Erstellen: Teile nebeneinander ohne Überlappung', c.ueber === 0, c.ueber);
ok('objectToData → laden: Parameter + Teil-Kennung erhalten', c.rt, c.rtP);
ok('Bearbeiten: 2×2 ohne Deckel → 5 Teile, eine Gruppe', c.nachN === 5 && c.gid === 1, { n: c.nachN, gid: c.gid });
ok('Bearbeiten: Schale an Ort und Stelle ersetzt', c.gleicheSchale && c.posGleich && c.spaltenNeu === 2);
ok('Katalog: Eintrag in _STARTERS und Themen', await pg.evaluate(() =>
  _STARTERS.some(s => s.t === 'Schalen mit Einsätzen') && _GEN_THEMEN.some(([, l]) => l.includes('Schalen mit Einsätzen'))));
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
} finally {
  await b.close();
  if (srv) srv.kill();
}
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalle Prüfungen grün');
process.exit(fails.length ? 1 : 0);
