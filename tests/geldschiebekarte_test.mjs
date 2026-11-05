// Regressionstest für den Generator „Geld-Schiebekarte" (💸, _gsk*).
//   1. Vorlagen × Scheingrößen × Textart × Schriften: Vorderteil und Schiebeplatte je EIN Stück,
//      keine losen Inseln (Schablonen-Stege greifen; Font-Überlappungen erzeugen keine Löcher)
//   2. Passung: Schiebeplatte im Vorderteil ohne Überschneidung; sie fällt nicht nach hinten heraus
//      (−z stößt an), stößt links an den Anschlag (−x), lässt sich rechts herausziehen (+x frei)
//   3. Geldscheine ungefaltet passen ins Fach (Schein-Quader im Fach ohne Überschneidung)
//   4. Drucklage ohne Stützen: Vorderteil Gesicht unten, Schiebeplatte flach — Stützvolumen ≈ 0
//   5. Erstellen legt zwei Teile auf die Platte
// Start: python3 volme3d_server.py 8853 --dev → V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/geldschiebekarte_test.mjs
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
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
await pg.evaluate(async () => {
  await _mfInit();
  for (const [k] of _GGP_FONTS) await new Promise(res => { if (window['_threeFont_' + k]) return res(); _npLoadFont(k, () => res()); setTimeout(res, 10000); });
});

const varianten = [
  { name: 'Mäuse, 100 €, durchbrochen (Standard)', p: {} },
  { name: 'Mäuse, graviert', p: { textArt: 'gravur' } },
  { name: 'Geburtstag, 20 €, Great Vibes', p: { vorlage: 'geburtstag', schein: 20, font: 'greatvibes_local' } },
  { name: 'Hochzeit, 200 €, Pacifico', p: { vorlage: 'hochzeit', schein: 200, font: 'pacifico_local' } },
  { name: 'Glück, 50 €, Lobster, abwechselnd gespiegelt', p: { vorlage: 'glueck', schein: 50, font: 'lobster_local', spiegeln: 1 } },
  { name: 'Weihnachten, Sniglet, 6 Tannen', p: { vorlage: 'weihnacht', font: 'sniglet_local', anzahl: 6 } },
  { name: 'Hirsch, dicke Platten, ohne Mulde, Fach 2,5', p: { motiv: 'hirsch', anzahl: 3, vorn: 3, hinten: 2.5, fach: 2.5, mulde: 0, rand: 8 } },
  { name: 'Geschenk + Stern gemischt? (Geschenk, 8 Stück)', p: { motiv: 'geschenk', anzahl: 8 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(P => {
    const w = _mfWasm, M = w.Manifold;
    Object.assign(_gskP, JSON.parse(JSON.stringify(_GSK_DEF)));
    if (P.vorlage) _gskVorlage(P.vorlage);
    Object.assign(_gskP, P);
    const R = _gskBuild(w, _gskP, 'fein'), d = R.d, V = R.vorn, H = R.hinten;
    const hit = (a, bm) => { const i = a.intersect(bm), v = i.volume(); i.delete(); return v; };
    const mv = (m, x, y, z) => m.translate([x, y, z]);
    const res = { parts: [V.decompose().length, H.decompose().length], warn: R.L.warn, inseln: R.inseln || [] };
    res.drin = +hit(V, H).toFixed(3);
    const t1 = mv(H, 0, 0, -0.5), t2 = mv(H, -1, 0, 0), t3 = mv(H, d.W + 5, 0, 0), t4 = mv(H, 0, 0, 0.3);
    res.unten = +hit(V, t1).toFixed(2); res.links = +hit(V, t2).toFixed(2); res.raus = +hit(V, t3).toFixed(3); res.hoch = +hit(V, t4).toFixed(3);
    [t1, t2, t3, t4].forEach(m => m.delete());
    const schein = M.cube([d.sL, d.sH, Math.min(0.4, d.g - 0.1)], false).translate([d.X0 + 0.5, -d.sH / 2, d.tb + 0.05]);
    res.schein = +hit(V, schein).toFixed(3); schein.delete();
    // Stützvolumen in Drucklage (Spalten < 1 mm = Gravur-/Brückendecken zählen nicht)
    const stuetz = m => { const mesh = m.getMesh(), Vp = mesh.vertProperties, T = mesh.triVerts, np = mesh.numProp, col = new Map();
      for (let i = 0; i < T.length; i += 3) { const a = T[i] * np, bb = T[i + 1] * np, c = T[i + 2] * np;
        const ax = Vp[a], ay = Vp[a + 1], az = Vp[a + 2], bx = Vp[bb], by = Vp[bb + 1], bz = Vp[bb + 2], cx = Vp[c], cy = Vp[c + 1], cz = Vp[c + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
        if (!(L > 0) || Math.abs(nz) < 1e-9) continue;
        const dd = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
        for (let gx = Math.ceil(Math.min(ax, bx, cx)); gx <= Math.max(ax, bx, cx); gx++) for (let gy = Math.ceil(Math.min(ay, by, cy)); gy <= Math.max(ay, by, cy); gy++) {
          const l1 = ((bx - gx) * (cy - gy) - (cx - gx) * (by - gy)) / dd, l2 = ((cx - gx) * (ay - gy) - (ax - gx) * (cy - gy)) / dd, l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const k = gx * 100000 + gy; let e = col.get(k); if (!e) col.set(k, e = []); e.push([l1 * az + l2 * bz + l3 * cz, nz / L]); } }
      let vol = 0;
      for (const e of col.values()) { e.sort((p, q) => p[0] - q[0]); let boden = 0;
        for (const [z, n] of e) { if (n > 0) boden = z; else { if (n < -0.75 && z - boden > 1.0) vol += z - boden; boden = z; } } }
      return Math.round(vol); };
    const f1 = V.rotate([180, 0, 0]), f2 = f1.translate([0, 0, d.T]);
    res.stuetzVorn = stuetz(f2); res.stuetzHinten = stuetz(H);
    res.zmin = [+f2.boundingBox().min[2].toFixed(3), +H.boundingBox().min[2].toFixed(3)];
    [f1, f2, V, H].forEach(m => m.delete());
    return res;
  }, v.p);
  console.log('— ' + v.name, JSON.stringify(r));
  ok(v.name + ': beide Teile je ein Stück, keine Inseln', r.parts[0] === 1 && r.parts[1] === 1 && !r.inseln.length, [r.parts, r.inseln.length, r.warn]);
  ok(v.name + ': Schiebeplatte sitzt ohne Überschneidung', r.drin < 0.01, r.drin);
  ok(v.name + ': hält nach hinten, Anschlag links, rechts frei herausziehbar', r.unten > 1 && r.links > 1 && r.raus < 0.001, [r.unten, r.links, r.raus]);
  ok(v.name + ': Geldschein passt ungefaltet ins Fach', r.schein < 0.001, r.schein);
  ok(v.name + ': Drucklage ohne Stützen, beide liegen auf z = 0', r.stuetzVorn === 0 && r.stuetzHinten === 0 && r.zmin.every(z => Math.abs(z) < 0.01), [r.stuetzVorn, r.stuetzHinten, r.zmin]);
}

// Oberfläche + Erstellen
{
  const r = await pg.evaluate(async () => {
    _newCreate(false);
    Object.assign(_gskP, JSON.parse(JSON.stringify(_GSK_DEF)));
    _gskOpen();
    _gskVorlage('hochzeit');
    const t1 = document.getElementById('gsk-text1').value, on = document.querySelector('#gsk-vorlage-bg .vtb.on')?.dataset.v;
    await new Promise(res => setTimeout(res, 600));
    const prev = _gskPreviewGeo().attributes.position.count;
    await _gskCreate();
    return { t1, on, prev, objs: objects.map(o => { const bb = new THREE.Box3().setFromObject(o); return [o.userData.name, +bb.min.y.toFixed(3), +(bb.max.y * 10).toFixed(2)]; }) };
  });
  ok('Vorlage setzt Text + Knopf', r.t1 === 'Für eure Zukunft' && r.on === 'hochzeit', r);
  ok('Vorschau baut', r.prev > 1000, r.prev);
  ok('Erstellen: Vorderteil + Schiebeplatte auf der Platte', r.objs.length === 2 && r.objs.every(o => Math.abs(o[1]) < 0.01) && /Vorderteil/.test(r.objs[0][0]) && /Schiebeplatte/.test(r.objs[1][0]), r.objs);
}
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
