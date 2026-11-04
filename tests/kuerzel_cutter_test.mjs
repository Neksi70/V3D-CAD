// Regressionstest gemeinsame Kürzel (I Messen, V Ein-/Ausblenden, Pos1 Ansicht zurücksetzen) in allen drei
// Arbeitsweisen + Begriff „Cutter“ statt „Bohrung“ für den Abzieh-Modus (echte Bohrung in SionCAD-H bleibt).
// Start: python3 volme3d_server.py 8880 --dev  →  node tests/kuerzel_cutter_test.mjs
import { chromium } from 'playwright';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8880/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _vTaste === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); localStorage.setItem('v3d_umsteiger_hinweis', '1'); document.getElementById('umsteiger-hinweis')?.remove(); });
const druecke = async k => { await pg.evaluate(() => document.activeElement && document.activeElement.blur()); await pg.keyboard.press(k); await pg.waitForTimeout(80); };
for (const modus of ['beginner', 'advanced', 'shape']) {
  await pg.evaluate(m => { _advSet(m); _newCreate(false); addShape('box'); selectObjs([objects[0]]); if (_measureMode) _measureExit(); sph.phi = 1.2; sph.theta = 2; sph2cam(); }, modus);
  await druecke('i');
  const messen = await pg.evaluate(() => { const r = _measureMode; if (_measureMode) _measureExit(); return r; });
  ok(modus + ': I = Messen', messen === true);
  await pg.evaluate(() => selectObjs([objects[0]]));
  await druecke('v');
  const weg = await pg.evaluate(() => objects[0].visible === false || !!objects[0].userData.hidden);
  ok(modus + ': V = Auswahl ausblenden', weg);
  await pg.evaluate(() => { showAllObjects(); });
  await druecke('Home');
  const ansicht = await pg.evaluate(() => ({ phi: +sph.phi.toFixed(2), theta: +sph.theta.toFixed(2), persp: _camIsPerspective }));
  ok(modus + ': Pos1 = ISO-Ansicht', ansicht.phi === 0.75 && ansicht.theta === 0.6 && ansicht.persp, ansicht);
}
await pg.evaluate(() => _advSet('beginner'));
// Begriff Cutter
const t = await pg.evaluate(() => {
  _newCreate(false); addShape('box'); selectObjs([objects[0]]);
  const txt = id => (document.getElementById(id) || {}).textContent || '';
  setObjMode('hole');
  const meldung = [...document.querySelectorAll('#notif .ni')].map(e => e.textContent).pop();
  return { mb: txt('mb-h'), choice: (document.getElementById('choice-hole') || {}).textContent.trim(), fp: [...document.querySelectorAll('.fp-mode-lbl')].map(e => e.textContent), meldung,
    sion: [...document.querySelectorAll('.umg-vus .kr')].map(e => e.textContent).find(x => /^H/.test(x)) };
});
ok('Knopf „○ Cutter“', /○ Cutter/.test(t.mb), t.mb);
ok('Auswahlfeld „Cutter“', t.choice === 'Cutter', t.choice);
ok('Eigenschaften-Feld „Solid | Cutter“', t.fp.join('|') === 'Solid|Cutter', t.fp);
ok('Meldung „Als Cutter markiert“', /Als Cutter markiert/.test(t.meldung || ''), t.meldung);
ok('SionCAD H bleibt „Bohrung“ (echtes Loch)', /Bohrung/.test(t.sion || ''), t.sion);
// Tooltip zeigt die Taste
const tip = await pg.evaluate(() => document.getElementById('btn-measure').title);
ok('Messen-Knopf zeigt Taste I', /\bI\b/.test(tip), tip.slice(0, 120));
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
