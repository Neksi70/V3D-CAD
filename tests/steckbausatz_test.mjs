// Test: Steckbausatz (_snp*) — Zapfen/Buchse an den Kontaktflächen.
// Geprüft wird, woran der Generator scheitert:
//   (1) zwei aufeinanderstehende Körper bekommen überhaupt Verbinder,
//   (2) der Zapfen sitzt am KLEINEREN Teil, die Buchse im größeren
//       (Volumen des kleinen steigt, das des großen fällt),
//   (3) beide Ergebnisse sind geschlossen (sonst druckt niemand das),
//   (4) ineinandersteckende Körper werden entflochten — danach überlappt
//       sich nichts mehr, das ist der Punkt, an dem der Druck sonst klemmt,
//   (5) Teile ohne Berührung ändern gar nichts und sagen das auch.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('snp-test','test@lokal'))"],
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

// Szene aufbauen, Dialog öffnen, erzeugen, messen.
// teile: [sx,sy,sz, x,y,z] in App-Einheiten (1 = 10 mm)
const lauf = async (setup) => pg.evaluate(async (setup) => {
  const meldungen = [];
  const origNotify = window.notify;
  window.notify = (m, t) => { meldungen.push(t + ': ' + m); return origNotify(m, t); };
  for (const o of [...objects]) { scene.remove(o); objects.splice(objects.indexOf(o), 1); }
  const teile = [];
  for (let i = 0; i < setup.teile.length; i++) { addShape('box'); teile.push(objects[objects.length - 1]); }
  // Erst ALLE Körper anlegen, dann setzen: die Platzierung schiebt beim
  // Hinzufügen sonst die schon vorhandenen Körper beiseite.
  teile.forEach((o, i) => { const [sx, sy, sz, x, y, z] = setup.teile[i];
                            o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.updateMatrixWorld(true); });
  // Volumen vorher (mm³, über Manifold — dieselbe Rechnung wie im Generator)
  const W = await _mfInit();
  const volVon = o => { try { const m = _mfFromSoup(W, _moldCollectTris(o)); const v = m.volume(); m.delete(); return v; }
                        catch (e) { return -1; } };
  const vorher = teile.map(volVon);
  selectObjs(teile);
  _snpOpen();
  const el = id => document.getElementById(id);
  if (setup.d !== undefined) el('snp-d').value = setup.d;
  if (setup.L !== undefined) el('snp-l').value = setup.L;
  if (setup.anz !== undefined) _snpSetAnz(setup.anz);
  if (setup.loesen !== undefined) el('snp-loesen').checked = setup.loesen;
  if (setup.tragen !== undefined) el('snp-tragen').checked = setup.tragen;
  const offenVorher = objects.length;
  await _snpCreate();
  await new Promise(r => setTimeout(r, 120));
  window.notify = origNotify;

  const neu = objects.slice();
  // Dichtheit + Volumen der Ergebnisse
  const info = neu.map(o => {
    const soup = _moldCollectTris(o);
    let dicht = false, vol = -1, tri = soup.length / 9;
    try { const m = _mfFromSoup(W, soup); vol = m.volume(); dicht = m.genus() >= 0 && m.numTri() > 0; m.delete(); }
    catch (e) { dicht = false; }
    return { name: o.userData.name, vol, tri, snp: o.userData._snp || null };
  });
  // Überlappen sich die Ergebnisse noch?
  let maxOverlap = 0;
  const mfs = neu.map(o => { try { return _mfFromSoup(W, _moldCollectTris(o)); } catch (e) { return null; } });
  for (let i = 0; i < mfs.length; i++) for (let j = i + 1; j < mfs.length; j++) {
    if (!mfs[i] || !mfs[j]) continue;
    try { const s = W.Manifold.intersection(mfs[i], mfs[j]); maxOverlap = Math.max(maxOverlap, s.volume()); s.delete(); } catch (e) {}
  }
  mfs.forEach(m => m && m.delete());
  return { vorher, info, meldungen, dbg: _snpDbg(), anzObj: neu.length, offenVorher, maxOverlap };
}, setup);

console.log('\n── (1)(2)(3) Zwei Quader aufeinander: Zapfen unten klein, Buchse oben groß ──');
// kleiner Quader (20×20×20 mm) steht auf großem (60×60×20 mm); y so, dass sie sich berühren
let r = await lauf({ teile: [[6, 2, 6, 0, 1, 0], [2, 2, 2, 0, 3, 0]], d: 4, L: 6, anz: 2 });
console.log('   Meldungen:', r.meldungen.join(' | '));
ok('Verbinder entstanden', !!(r.dbg && r.dbg.verb && r.dbg.verb.length >= 1), r.dbg && r.dbg.verb);
ok('zwei Teile in der Szene', r.anzObj === 2, r.anzObj);
const sortiert = r.info.slice().sort((a, b) => a.vol - b.vol);
const klein = sortiert[0], gross = sortiert[sortiert.length - 1];
ok('kleines Teil hat Zapfen (Volumen gestiegen)', !!klein && klein.snp && klein.snp.zapfen > 0 && klein.vol > r.vorher[1],
   klein && { vol: Math.round(klein.vol), vorher: Math.round(r.vorher[1]), snp: klein.snp });
ok('großes Teil hat Buchse (Volumen gefallen)', !!gross && gross.snp && gross.snp.buchsen > 0 && gross.vol < r.vorher[0],
   gross && { vol: Math.round(gross.vol), vorher: Math.round(r.vorher[0]), snp: gross.snp });
ok('beide Ergebnisse geschlossen', r.info.every(i => i.vol > 0), r.info.map(i => Math.round(i.vol)));
ok('Teile passen zusammen (kein Rest-Überlapp)', r.maxOverlap < 30, { ueberlapp_mm3: Math.round(r.maxOverlap) });
ok('alle Verbinder in EINER Steckrichtung', !!r.dbg && new Set(r.dbg.verb.map(v => v.namen)).size === 1, r.dbg && r.dbg.verb.length);
ok('zwei Zapfen gesetzt (verdrehsicher)', !!r.dbg && r.dbg.verb.length === 2, r.dbg && r.dbg.verb.length);

console.log('\n── (4) Ineinandersteckende Quader werden entflochten ──');
r = await lauf({ teile: [[6, 2, 6, 0, 1, 0], [2, 2, 2, 0, 2.4, 0]], d: 4, L: 5, anz: 2, loesen: true });
console.log('   Meldungen:', r.meldungen.join(' | '));
ok('kein nennenswerter Rest-Überlapp', r.maxOverlap < 50, { ueberlapp_mm3: Math.round(r.maxOverlap) });
ok('mindestens ein Teil wurde beschnitten', r.info.some(i => i.snp && i.snp.beschnitten), r.info.map(i => i.snp));

console.log('\n── (5) Teile ohne Berührung: nichts passiert, klare Ansage ──');
r = await lauf({ teile: [[2, 2, 2, -4, 1, 0], [2, 2, 2, 4, 1, 0]], d: 4, L: 6 });
console.log('   Meldungen:', r.meldungen.join(' | '));
ok('Szene unverändert', r.anzObj === 2 && r.info.every(i => !i.snp), r.info.map(i => i.snp));
ok('Meldung nennt die Kontaktfläche', r.meldungen.some(m => /Kontaktfl/i.test(m)), r.meldungen);

console.log('\n── (6) Zylinder auf Platte: kleine, runde Kontaktfläche ──');
r = await pg.evaluate(async () => {
  const meldungen = []; const on = window.notify;
  window.notify = (m, t) => { meldungen.push(t + ': ' + m); return on(m, t); };
  for (const o of [...objects]) { scene.remove(o); objects.splice(objects.indexOf(o), 1); }
  addShape('box'); addShape('cylinder');
  const A = objects[0], B = objects[1];
  A.scale.set(4, 0.5, 4); A.position.set(0, 0.5, 0); A.updateMatrixWorld(true);
  // Zylinder (Ø 20 mm) steht auf der Platte: Oberkante Platte = y 1
  B.scale.set(1.5, 1.5, 1.5); B.position.set(0, 1 + 1.5, 0); B.updateMatrixWorld(true);
  selectObjs([A, B]);
  _snpOpen();
  document.getElementById('snp-d').value = 4; document.getElementById('snp-l').value = 5;
  _snpSetAnz(2);
  await _snpCreate(); await new Promise(x => setTimeout(x, 120));
  window.notify = on;
  const W = await _mfInit();
  let ueber = 0;
  const mfs = objects.map(o => { try { return _mfFromSoup(W, _moldCollectTris(o)); } catch (e) { return null; } });
  for (let i = 0; i < mfs.length; i++) for (let j = i + 1; j < mfs.length; j++)
    if (mfs[i] && mfs[j]) { const x = W.Manifold.intersection(mfs[i], mfs[j]); ueber = Math.max(ueber, x.volume()); x.delete(); }
  mfs.forEach(m => m && m.delete());
  return { meldungen, dbg: _snpDbg(), ueber, snp: objects.map(o => o.userData._snp || null) };
});
console.log('   Meldungen:', r.meldungen.join(' | '));
ok('runde Kontaktfläche trägt Verbinder', !!(r.dbg && r.dbg.verb.length >= 1), r.dbg && r.dbg.verb);
ok('Zylinder bekommt den Zapfen, Platte die Buchse',
   r.snp[0] && r.snp[1] && r.snp[1].zapfen > 0 && r.snp[0].buchsen > 0, r.snp);
ok('passt zusammen', r.ueber < 30, { ueberlapp_mm3: Math.round(r.ueber) });

console.log('\n── (7) Schwerer Ausleger: Zapfen wird verstärkt ──');
const trag = async (tragen) => pg.evaluate(async (tragen) => {
  for (const o of [...objects]) { scene.remove(o); objects.splice(objects.indexOf(o), 1); }
  addShape('box'); addShape('box');
  const A = objects[0], B = objects[1];
  A.scale.set(3, 3, 3); A.position.set(0, 1.5, 0); A.updateMatrixWorld(true);       // Klotz 60³ mm
  B.scale.set(15, 2, 2); B.position.set(3 + 15, 1.5, 0); B.updateMatrixWorld(true);  // Ausleger 300×40×40 mm
  selectObjs([A, B]);
  _snpOpen();
  document.getElementById('snp-d').value = 4; document.getElementById('snp-l').value = 8;
  document.getElementById('snp-tragen').checked = tragen;
  _snpSetAnz(2);
  await _snpCreate(); await new Promise(x => setTimeout(x, 120));
  return _snpDbg();
}, tragen);
const ohne = await trag(false), mit = await trag(true);
ok('ohne Verstärkung bleibt der Zapfen bei Ø 4 mm',
   !!ohne && ohne.verb.length > 0 && ohne.verb.every(v => Math.abs(v.r - 2) < 0.01), ohne && ohne.verb.map(v => v.r));
ok('mit Verstärkung wird er dicker',
   !!mit && mit.verb.length > 0 && mit.verb.some(v => v.r > 2.2), mit && mit.verb.map(v => Math.round(v.r * 100) / 100));

console.log('\n── (8) Dichtes Netz: halbierte Kugel (2 × 66k Dreiecke) ──');
// Der Fall, an dem die Ankersuche zuerst scheiterte: eine gekappte Fläche ist
// als Fächer vermascht, viele Dreiecke sind dünner als eine Rasterzelle.
r = await pg.evaluate(async () => {
  const meldungen = []; const on = window.notify;
  window.notify = (m, t) => { meldungen.push(t + ': ' + m); return on(m, t); };
  for (const o of [...objects]) { scene.remove(o); objects.splice(objects.indexOf(o), 1); }
  const W = await _mfInit(), M = W.Manifold;
  const kugel = M.sphere(40, 512);
  const u = kugel.trimByPlane([0, 0, -1], 0), o2 = kugel.trimByPlane([0, 0, 1], 0);
  const mk = (mf, n) => { const g = _mfToGeo(mf).toNonIndexed(); _moldNormals(g); return _moldSceneMesh(g, n); };
  const A = mk(u, 'Kugel unten'), B = mk(o2, 'Kugel oben');
  const tri = [A, B].map(x => x.geometry.attributes.position.count / 3);
  kugel.delete(); u.delete(); o2.delete();
  selectObjs([A, B]);
  _snpOpen();
  document.getElementById('snp-d').value = 5; document.getElementById('snp-l').value = 8;
  _snpSetAnz(2);
  const t0 = performance.now();
  await _snpCreate();
  const ms = Math.round(performance.now() - t0);
  await new Promise(x => setTimeout(x, 120));
  window.notify = on;
  return { tri, ms, meldungen, dbg: _snpDbg() };
});
console.log('   ' + r.tri.join(' + ') + ' Dreiecke, ' + r.ms + ' ms · ' + r.meldungen.join(' | '));
ok('zwei Zapfen auf der Schnittfläche', !!(r.dbg && r.dbg.verb.length === 2), r.dbg && r.dbg.verb.length);
// Auf einer Scheibe Ø 80 muss der beste Randabstand nahe 40 mm liegen. Lag er
// vorher bei 3,6 mm, war die Fläche löchrig gerastert — genau dieser Fehler.
ok('Randabstand passt zur Scheibe (≈ 40 mm)',
   !!(r.dbg && r.dbg.verb[0] && r.dbg.verb[0].margin > 30), r.dbg && r.dbg.verb.map(v => Math.round(v.margin)));
ok('unter 20 s durchgerechnet', r.ms < 20000, r.ms);

ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n✗ ' + fails.length + ' Fehler: ' + fails.join(', ') : '\n✓ alle Prüfungen bestanden');
process.exit(fails.length ? 1 : 0);
