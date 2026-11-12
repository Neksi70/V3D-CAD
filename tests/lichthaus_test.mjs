// Regressionstest für den Generator „Lichthaus mit LED-Halter" (🏠, _lhs*).
//   1. Varianten: Haus und Bodenplatte je ein Stück, Öffnungen vorhanden
//   2. Passung: Haus auf der Platte (z = Plattendicke) überschneidet sie nicht, sitzt über dem Kragen
//      (seitlich 1 mm verschoben stößt es an); LED-Teelicht (Mulden-Ø − 1,5) × 16 passt in die Mulde
//   3. Drucklage (Haus aufrecht, Platte flach): Stützvolumen 0
// Start: python3 volme3d_server.py 8853 --dev → V3D_URL=http://127.0.0.1:8853/volme3d.html node tests/lichthaus_test.mjs
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => { console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); if (!cond) fails.push(name); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
await pg.evaluate(async () => { await _mfInit(); });
const varianten = [
  { name: 'Schlitze + Teelicht (Standard)', p: {} },
  { name: 'Fenster + Teelicht', p: { muster: 'fenster' } },
  { name: 'Geschlossen + Lichterkette', p: { muster: 'ohne', licht: 'kette' } },
  { name: 'Groß 140×120×160, 45°, breite Schlitze', p: { breite: 140, tiefe: 120, wandH: 160, neigung: 45, sb: 4, sa: 10 } },
  { name: 'Klein 50×45, steil 70°, Fenster', p: { breite: 50, tiefe: 45, wandH: 50, neigung: 70, muster: 'fenster', ledD: 30 } },
  { name: 'Dorf: Haus (Dachüberstand, Schornstein)', p: { breite: 64, tiefe: 64, wandH: 88, neigung: 55, muster: 'dorf', sockel: 8, dach: 1, kamin: 1, turm: 0 } },
  { name: 'Dorf: Stadthaus', p: { breite: 56, tiefe: 70, wandH: 105, neigung: 58, muster: 'dorf', sockel: 8, dach: 1, kamin: 1, turm: 0 } },
  { name: 'Dorf: Kirche mit Turm', p: { breite: 66, tiefe: 92, wandH: 78, neigung: 52, muster: 'dorf', sockel: 8, dach: 1, kamin: 0, turm: 1 } },
  { name: 'Dorf: Klein', p: { breite: 54, tiefe: 54, wandH: 62, neigung: 52, muster: 'dorf', sockel: 8, dach: 1, kamin: 1, turm: 0 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(P => {
    const w = _mfWasm, M = w.Manifold;
    Object.assign(_lhsP, _LHS_DEF, P);
    const R = _lhsBuild(w, _lhsP), d = R.d, H = R.haus, Pl = R.platte;
    const hit = (a, bb) => { const i = a.intersect(bb), v = i.volume(); i.delete(); return +v.toFixed(3); };
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
        for (const [z, n] of e) { if (n > 0) boden = z; else { if (n < -0.75 && z - boden > 0.4) vol += z - boden; boden = z; } } }
      return Math.round(vol); };
    const res = { teile: [H.decompose().length, Pl.decompose().length], oeff: R.oeffnungen, warn: R.warn, stuetz: [stuetz(H), stuetz(Pl)] };
    const Hs = H.translate([0, 0, d.pt]), Hx = H.translate([1, 0, d.pt]);
    res.sitzt = hit(Hs, Pl); res.seitlich = hit(Hx, Pl);
    if (P.licht !== 'kette') { const rt = _lhsP.ledD / 2 - 0.75, tl = M.cylinder(16, rt, rt, 64).translate([0, 0, d.pt + d.kh - d.muldeT + 0.05]); res.teelicht = hit(tl, Pl); tl.delete(); }
    [H, Pl, Hs, Hx].forEach(m => m.delete());
    return res;
  }, v.p);
  console.log('— ' + v.name, JSON.stringify(r));
  ok(v.name + ': Haus und Platte je ein Stück, ohne Warnung', r.teile[0] === 1 && r.teile[1] === 1 && !r.warn.length, [r.teile, r.warn]);
  if (v.p.muster !== 'ohne') ok(v.name + ': Öffnungen vorhanden', r.oeff > 4, r.oeff);
  ok(v.name + ': Haus sitzt über dem Kragen (frei, seitlich stößt an)', r.sitzt < 0.01 && r.seitlich > 1, [r.sitzt, r.seitlich]);
  if (r.teelicht !== undefined) ok(v.name + ': LED-Teelicht passt in die Mulde', r.teelicht < 0.01, r.teelicht);
  if (v.p.muster === 'dorf') {                                             // Rundbögen/Sprossen = kurze Brücken (≤ 11 mm) → Gerüst (Dach, Schornstein, Turm) ohne Fenster streng prüfen
    const g = await pg.evaluate(async (P) => { const w = await _mfInit(), R = _lhsBuild(w, { ..._lhsP, ...P, muster: 'ohne', licht: 'ohne' }), H = R.haus, me = H.getMesh(), V = me.vertProperties, T = me.triVerts, np = me.numProp;
      let flaeche = 0; for (let t = 0; t < T.length; t += 3) { const A = [0, 1, 2].map(i => [V[T[t + i] * np], V[T[t + i] * np + 1], V[T[t + i] * np + 2]]);
        const u = A[1].map((x, i) => x - A[0][i]), vv = A[2].map((x, i) => x - A[0][i]), c = [u[1] * vv[2] - u[2] * vv[1], u[2] * vv[0] - u[0] * vv[2], u[0] * vv[1] - u[1] * vv[0]], L = Math.hypot(...c);
        if (L > 0 && c[2] / L < -0.75 && Math.min(A[0][2], A[1][2], A[2][2]) > 0.5) flaeche += L / 2; }
      H.delete(); return flaeche; }, v.p);
    ok(v.name + ': Gerüst (Dach, Schornstein, Turm) ohne nach unten zeigende Flächen > 45°', g < 6, Math.round(g) + ' mm²');   // < 6: Rechensplitter (8 × 0,46 mm²) an der Naht Turmwand/Helm-Innenseite
  } else ok(v.name + ': ohne Stützen druckbar', r.stuetz[0] === 0 && r.stuetz[1] === 0, r.stuetz);
}
{
  const r = await pg.evaluate(async () => { _newCreate(false); Object.assign(_lhsP, _LHS_DEF); _lhsOpen(); await new Promise(res => setTimeout(res, 300));
    const prev = _lhsPreviewGeo().attributes.position.count; await _lhsCreate();
    return { prev, objs: objects.map(o => { const bb = new THREE.Box3().setFromObject(o); return [o.userData.name, +bb.min.y.toFixed(3)]; }) }; });
  ok('Vorschau + Erstellen: Haus und Bodenplatte auf der Platte', r.prev > 1000 && r.objs.length === 2 && r.objs.every(o => Math.abs(o[1]) < 0.01), r);
}
ok('keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nalles OK');
process.exit(fails.length ? 1 : 0);
