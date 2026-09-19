// Test: Bausatz-Rahmen (_spr*) — Teile im Gussrahmen mit Nummern-Fähnchen.
// Geprüft wird, woran ein Bausatz scheitert:
//   (1) alles hängt zusammen (EIN Stück), ist geschlossen und liegt auf z = 0,
//   (2) der Rahmen passt aufs Druckbett, sonst entstehen mehrere Rahmen A, B …,
//   (3) jedes Teil hat seine Angüsse, die Sollbruchstelle hat die eingestellte Stärke,
//   (4) Mehrteil-Importe werden in Einzelteile getrennt (Innenwand bleibt dran),
//   (5) die Teileliste nennt jede Nummer und bringt Bilder mit.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('spr-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 90000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

// Teile bauen, wählen, Dialog öffnen, Optionen setzen, erzeugen, auswerten
const lauf = async (setup) => pg.evaluate(async (setup) => {
  for (const o of [...objects]) { scene.remove(o); objects.splice(objects.indexOf(o), 1); }
  const teile = [];
  for (const [typ, sx, sy, sz, x, z] of setup.teile) {
    addShape(typ); const o = objects[objects.length - 1];
    o.scale.set(sx, sy, sz); o.position.set(x, o.position.y, z); o.updateMatrixWorld(true);
    teile.push(o);
  }
  selectObjs(teile);
  _sprOpen();
  const el = id => document.getElementById(id);
  _sprSetGates(setup.gates || 2);
  el('spr-prefix').value = setup.prefix || '';
  el('spr-bedw').value = setup.bed; el('spr-bedd').value = setup.bed;
  el('spr-gate').value = setup.gate || 1;
  _sprInfo();
  const est = el('spr-est').textContent;
  await _sprCreate();
  const W = await _mfInit();
  const res = objects.filter(o => o.userData.bausatz);
  const out = { est, rahmen: [], versteckt: teile.every(o => !o.visible) };
  for (const r of res) {
    const t = _moldCollectTris(r);
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < t.length; i += 3) {
      x0 = Math.min(x0, t[i]); x1 = Math.max(x1, t[i]); y0 = Math.min(y0, t[i+1]); y1 = Math.max(y1, t[i+1]);
      z0 = Math.min(z0, t[i+2]); z1 = Math.max(z1, t[i+2]); }
    let stuecke = -1, dicht = false, vol = 0;
    try { const m = _mfFromSoup(W, t.slice()); dicht = m.numTri() > 0; vol = m.volume();
          const d = m.decompose(); stuecke = d.length; d.forEach(q => q.delete()); m.delete(); } catch (e) { dicht = false; }
    out.rahmen.push({ name: r.userData.name, teile: r.userData.bausatz.teile.map(q => q.nr),
      w: x1 - x0, d: y1 - y0, zMin: z0, stuecke, dicht, vol });
  }
  const ov = document.getElementById('lgo-guide-ov');
  const fr = ov && ov.querySelector('iframe');
  out.anleitung = fr ? fr.srcdoc : '';
  _lgoGuideClose();
  return out;
}, setup);

// ── 1) Sechs verschiedene Teile, ein Rahmen ────────────────────────────────
const r1 = await lauf({ bed: 256, teile: [
  ['tube', 1, 3, 1, 0, 0], ['box', 2, 1, 1, 5, 0], ['sphere', 1, 1, 1, -5, 3],
  ['cylinder', 1.5, 1, 1.5, 3, -4], ['cone', 1, 2, 1, -3, -3], ['box', 0.5, 0.5, 3, 8, 8]] });
console.log('  Info im Dialog:', r1.est);
ok('ein Rahmen', r1.rahmen.length === 1, r1.rahmen.length);
const a = r1.rahmen[0];
ok('Nummern 1–6', JSON.stringify(a.teile.slice().sort()) === JSON.stringify(['1','2','3','4','5','6']), a.teile);
ok('geschlossen + mannigfaltig', a.dicht);
ok('EIN zusammenhängendes Stück (alle Teile angebunden)', a.stuecke === 1, a.stuecke);
ok('liegt auf z = 0', Math.abs(a.zMin) < 1e-3, a.zMin);
ok('passt aufs 256er-Bett', a.w <= 256 && a.d <= 256, [Math.round(a.w), Math.round(a.d)]);
ok('Originale ausgeblendet', r1.versteckt);
ok('Teileliste mit allen Nummern', ['1','2','3','4','5','6'].every(n => r1.anleitung.includes('<td class="nr">' + n + '</td>')));
ok('Teileliste hat Bilder', (r1.anleitung.match(/<img src="data:image\/png/g) || []).length === 6);
ok('Rahmenplan als SVG', r1.anleitung.includes('<svg') && r1.anleitung.includes('<polygon'));

// ── 2) Kleines Bett → mehrere Rahmen A, B, …; vier Angüsse, Vorsilbe ───────
const r2 = await lauf({ bed: 130, gates: 4, prefix: 'P', teile: [
  ['tube', 1, 3, 1, 0, 0], ['box', 2, 1, 1, 5, 0], ['sphere', 1, 1, 1, -5, 3],
  ['cylinder', 1.5, 1, 1.5, 3, -4], ['cone', 1, 2, 1, -3, -3], ['box', 0.5, 0.5, 3, 8, 8]] });
console.log('  Info im Dialog:', r2.est);
ok('mehrere Rahmen', r2.rahmen.length >= 2, r2.rahmen.map(r => r.name));
for (const r of r2.rahmen) {
  ok(r.name + ': ein Stück, dicht', r.dicht && r.stuecke === 1, [r.dicht, r.stuecke]);
  ok(r.name + ': passt aufs 130er-Bett', r.w <= 130 && r.d <= 130, [Math.round(r.w), Math.round(r.d)]);
}
const alle = r2.rahmen.flatMap(r => r.teile).sort();
ok('Nummern mit Vorsilbe P1–P6, jede genau einmal', JSON.stringify(alle) === JSON.stringify(['P1','P2','P3','P4','P5','P6']), alle);

// ── 3) Anguss-Geometrie: Sollbruchstelle hat die eingestellte Stärke ──────
const neck = await pg.evaluate(async () => {
  const W = await _mfInit(), M = W.Manifold, R = {};
  for (const t of [0.8, 1.0, 1.6]) {
    const g = _sprGate(M, 0, 0, 0, 10, { gateT: t, runH: 3 });
    const u = M.union(g); const bb = u.boundingBox();
    // Querschnitt 0,1 mm vor dem Teil (x = 10 − Eindringtiefe − 0,1)
    const sl = u.slice ? null : null;
    const box = M.cube([0.05, 10, 10], true).translate([10 - 0.2, 0, 0]);
    const cut = u.intersect(box).boundingBox();
    R[t] = { breite: +(cut.max[1] - cut.min[1]).toFixed(3), hoehe: +(cut.max[2] - cut.min[2]).toFixed(3),
             zMin: +bb.min[2].toFixed(3), wurzel: +(u.intersect(M.cube([0.05, 10, 10], true).translate([0.1, 0, 0])).boundingBox().max[1] * 2).toFixed(2) };
    g.forEach(q => q.delete()); u.delete(); box.delete();
  }
  return R;
});
for (const [t, r] of Object.entries(neck)) {
  ok('Anguss ' + t + ' mm: Querschnitt am Teil = ' + t + ' × ' + t, Math.abs(r.breite - t) < 0.01 && Math.abs(r.hoehe - t) < 0.01, r);
  ok('Anguss ' + t + ' mm: am Stab breiter als am Teil', r.wurzel > +t, r.wurzel);
  ok('Anguss ' + t + ' mm: steht auf z = 0', r.zMin === 0, r.zMin);
}

// ── 4) Mehrteil-Import trennen, Innenwand bleibt beim Teil ─────────────────
const split = await pg.evaluate(async () => {
  const W = await _mfInit();
  const box = (x, y, z, s, inv) => {
    const g = new THREE.BoxGeometry(s, s, s).toNonIndexed(); g.translate(x, y, z);
    const p = g.attributes.position.array.slice();
    if (inv) for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const q = p[i+3+k]; p[i+3+k] = p[i+6+k]; p[i+6+k] = q; }
    return p;
  };
  const teile = [box(0,0,0,10), box(30,0,0,10), box(0,0,0,6,true), box(60,0,0,4)];
  const all = new Float32Array(teile.reduce((s, t) => s + t.length, 0)); let o = 0;
  for (const t of teile) { all.set(t, o); o += t.length; }
  return _sprSplitShells(all, W).map(t => t.length / 9).sort((a, b) => a - b);
});
ok('Mehrteil-Import: 3 Teile (Hohlwürfel bleibt ein Teil)', JSON.stringify(split) === JSON.stringify([12, 12, 24]), split);

// ── 4b) Ralf, 19.9.26: zusammengebautes Teil aus mehreren Körpern ──────────
// Rohr + Platten, die nur anliegen, eingesteckt sind oder einen Haarspalt
// haben, gehören zusammen (Rohr 24 + 3 × 12 = 60 Dreiecke); echte Einzelteile
// daneben (auch 1 mm entfernt) nicht.
const ralf = await pg.evaluate(async () => {
  const W = await _mfInit();
  const quader = (x0, y0, z0, x1, y1, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return Array.from(g.attributes.position.array);
  };
  const rohr = [ // hohles Vierkantrohr als EIN Netz: Außen + umgedrehte Innenwand
    ...quader(0, 0, 0, 20, 20, 60),
    ...(() => { const p = quader(2, 2, -0.001, 18, 18, 60.001); for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const q = p[i+3+k]; p[i+3+k] = p[i+6+k]; p[i+6+k] = q; } return p; })()];
  const teile = {
    rohr,
    platteBuendig:  quader(20, 5, 10, 22, 15, 50),       // liegt flach an
    platteSteckt:   quader(-3, 5, 10, 1, 15, 50),        // steckt 1 mm in der Wand
    platteSpalt:    quader(4, 20.05, 10, 16, 22, 50),    // 0,05 mm Haarspalt
    einzelteil:     quader(40, 0, 0, 50, 10, 10),        // loses Einzelteil
    nachbar:        quader(51, 0, 0, 61, 10, 10)         // 1 mm neben dem Einzelteil
  };
  const all = new Float32Array(Object.values(teile).flat());
  const erg = _sprSplitShells(all, W).map(t => t.length / 9).sort((a, b) => a - b);
  // Ohne Manifold (nicht wasserdicht) greift die Bbox-Regel
  const offen = _sprSplitShells(new Float32Array([...teile.rohr, ...teile.platteSteckt.slice(0, 9 * 10)]), null).length;
  return { erg, offen };
});
ok('zusammengebautes Rohr bleibt EIN Teil, Einzelteile getrennt', JSON.stringify(ralf.erg) === JSON.stringify([12, 12, 60]), ralf.erg);
ok('offenes Netz im Rohr (Bbox-Rückfall) bleibt dran', ralf.offen === 1, ralf.offen);

// ── 4c) Ganzer Ablauf mit dem Mehrteil-Import als EIN Objekt ───────────────
const ganz = await pg.evaluate(async () => {
  for (const o of [...objects]) { scene.remove(o); objects.splice(objects.indexOf(o), 1); }
  const quader = (x0, y0, z0, x1, y1, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return Array.from(g.attributes.position.array);
  };
  // Editor-Einheiten (1 = 10 mm), Y-up: Rohr mit Platte + zwei Einzelteile
  const pos = new Float32Array([...quader(0, 0, 0, 2, 6, 2), ...quader(2, 0.5, 0.5, 2.2, 5.5, 1.5),
                                ...quader(4, 0, 0, 5, 1, 1), ...quader(6, 0, 0, 7, 2, 1)]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
  m.userData = { id: idCtr++, type: 'import', shapeType: 'import', name: 'Pumpe.stl' };
  scene.add(m); objects.push(m); selectObjs([m]);
  _sprOpen();
  await new Promise(r => setTimeout(r, 1500));      // Trennen läuft im Hintergrund
  const liste = document.getElementById('spr-list').textContent;
  await _sprCreate();
  const r = objects.find(o => o.userData.bausatz);
  document.getElementById('lgo-guide-ov') && _lgoGuideClose();
  return { liste, teile: r ? r.userData.bausatz.teile.length : 0 };
});
ok('Dialog zeigt vorab „3 Teile aus 1 Objekt"', /3 Teile aus 1 Objekt/.test(ganz.liste), ganz.liste.slice(0, 120));
ok('Rahmen hat 3 Teile (Rohr+Platte zusammen)', ganz.teile === 3, ganz.teile);

ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));

// Bild zum Anschauen (Draufsicht + Schräg)
await pg.evaluate(async () => {
  for (const o of [...objects]) { scene.remove(o); objects.splice(objects.indexOf(o), 1); }
  const teile = [];
  for (const [typ, sx, sy, sz, x, z] of [['tube', 1, 3, 1, 0, 0], ['box', 2, 1, 1, 5, 0], ['sphere', 1, 1, 1, -5, 3],
       ['cylinder', 1.5, 1, 1.5, 3, -4], ['cone', 1, 2, 1, -3, -3], ['box', 0.5, 0.5, 3, 8, 8]]) {
    addShape(typ); const o = objects[objects.length - 1]; o.scale.set(sx, sy, sz); o.position.set(x, o.position.y, z); teile.push(o);
  }
  selectObjs(teile); _sprOpen(); _sprSetGates(2);
  document.getElementById('spr-bedw').value = 256; document.getElementById('spr-bedd').value = 256;
  document.getElementById('spr-prefix').value = 'A';
  await _sprCreate();
});
await pg.mouse.click(5, 300);
await pg.waitForTimeout(800);
await pg.screenshot({ path: '/tmp/spr_plan.png' });
await pg.evaluate(() => _lgoGuideClose());
await pg.evaluate(() => { const r = objects.filter(o => o.userData.bausatz); selectObjs(r); fitToObjects(r); });
await pg.mouse.click(5, 300);
await pg.waitForTimeout(800);
await pg.screenshot({ path: '/tmp/spr_scene.png' });

await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nAlles OK');
process.exit(fails.length ? 1 : 0);
