// Regressionstest 🔑 Öse anbringen (_kca*, Idee Printooly „Keychain Generator“).
//   1. Würfel + Öse rechts: ein Stück, wasserdicht, Volumen > Würfel, Breite wächst um Ring
//   2. Loch frei: senkrechter Strahl durch die Ringmitte trifft nichts
//   3. Ring liegt auf der Platte (Unterseite z = 0)
//   4. alle 8 Richtungen liefern eine Lage mit freiem Loch
//   5. bemalte Ente (GLB) behält ihre Farben, Ring bekommt Farbe
//   6. echter Weg: Eigenschaften-Knopf → Seitenfenster → „Öse anbringen“
// Start: python3 volme3d_server.py 8873 --dev  →  node tests/oese_test.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
const APP = process.env.V3D_URL || 'http://127.0.0.1:8873/volme3d.html';
const DUCK = new globalThis.URL('./fixtures/Duck.glb', import.meta.url).pathname;
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(APP, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof _kcaOpen === 'function' && typeof addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
await pg.evaluate(async () => { await _mfInit(); });

// Hilfsfunktionen in der Seite
await pg.evaluate(() => {
  window.__mess = (o) => {
    const t = _moldCollectTris(o), n = t.length / 9;
    const key = (i) => Math.round(t[i] * 1e3) + ',' + Math.round(t[i + 1] * 1e3) + ',' + Math.round(t[i + 2] * 1e3);
    const kanten = new Map(); let vol = 0;
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let f = 0; f < n; f++) {
      const o9 = f * 9, k = [key(o9), key(o9 + 3), key(o9 + 6)];
      for (let j = 0; j < 3; j++) { const a = k[j], c = k[(j + 1) % 3]; if (a === c) continue; const e = a < c ? a + '|' + c : c + '|' + a; kanten.set(e, (kanten.get(e) || 0) + 1); }
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.subarray(o9, o9 + 9);
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      for (let i = 0; i < 9; i++) { const a = i % 3; if (t[o9 + i] < mn[a]) mn[a] = t[o9 + i]; if (t[o9 + i] > mx[a]) mx[a] = t[o9 + i]; }
    }
    let offen = 0, hist = {}; for (const v of kanten.values()) if (v !== 2) { offen++; hist[v] = (hist[v] || 0) + 1; }
    return { vol, offen, hist, mn, mx };
  };
  // trifft ein senkrechter Strahl bei (x,y) mm das Objekt?
  window.__trifft = (o, x, y) => { raycaster.set(new THREE.Vector3(x / 10, 50, -y / 10), new THREE.Vector3(0, -1, 0)); return raycaster.intersectObject(o, true).filter(h => h.object.isMesh && !h.object.userData.isEdgeLines).length; };
});

const r1 = await pg.evaluate(async () => {
  _newCreate(false);
  addShape('box'); const o = objects[0]; o.updateMatrixWorld(true);
  const vor = __mess(o);
  _kca.p = { dir: 2, loch: 5, breite: 3, hoehe: 3 };
  selectObjs([o]); _kcaOpen();
  const ghost = !!_kca.ghost;
  const L = _kcaLage(_kca.cache, _kca.p);
  await _kcaApply();
  const m = objects[0]; m.updateMatrixWorld(true);
  const nach = __mess(m);
  return { vor, nach, L, ghost, anzahl: objects.length, ghostWeg: !_kca.ghost, lochHit: __trifft(m, L.cx, L.cy), ringHit: __trifft(m, L.cx + L.Ri + 1, L.cy), name: m.userData.name };
});
const brVor = r1.vor.mx[0] - r1.vor.mn[0], brNach = r1.nach.mx[0] - r1.nach.mn[0];
ok('Vorschau erscheint und verschwindet', r1.ghost && r1.ghostWeg);
ok('ein Objekt', r1.anzahl === 1, r1.anzahl);
ok('wasserdicht', r1.nach.offen === 0, r1.nach.offen);
ok('Volumen wächst', r1.nach.vol > r1.vor.vol + 10, [r1.vor.vol, r1.nach.vol].map(Math.round));
ok('Breite wächst um den Ring', Math.abs(brNach - brVor - (r1.L.off - r1.vor.mx[0] + r1.L.Ro)) < 0.3 && brNach > brVor + 7, [brVor, brNach]);
ok('Loch frei', r1.lochHit === 0, r1.lochHit);
ok('Ring vorhanden', r1.ringHit > 0, r1.ringHit);
ok('Unterseite auf der Platte', Math.abs(r1.nach.mn[2] - r1.vor.mn[2]) < 0.01, [r1.vor.mn[2], r1.nach.mn[2]]);
ok('Name mit „(Anhänger)“', /Anhänger/.test(r1.name), r1.name);

const r2 = await pg.evaluate(() => {
  _newCreate(false); addShape('box'); const o = objects[0];
  const t = _moldCollectTris(o); const out = [];
  for (let d = 0; d < 8; d++) { const L = _kcaLage(t, { dir: d, loch: 5, breite: 3, hoehe: 3 }); out.push(L && L.frei && !L.geschoben); }
  return out;
});
ok('alle 8 Richtungen: Loch frei, ohne Verschieben', r2.every(Boolean), r2);

// Überhang: Kugel – oben breiter als unten → Ring muss nach außen rücken
const r3 = await pg.evaluate(async () => {
  _newCreate(false); addShape('sphere'); const o = objects[0];
  _kca.p = { dir: 0, loch: 5, breite: 3, hoehe: 2 }; selectObjs([o]); _kcaOpen();
  const L = _kcaLage(_kca.cache, _kca.p); await _kcaApply();
  const m = objects[0]; m.updateMatrixWorld(true);
  return { geschoben: L.geschoben, frei: L.frei, hit: __trifft(m, L.cx, L.cy), offen: __mess(m).offen };
});
ok('Kugel: Ring rückt nach außen, Loch frei, dicht', r3.geschoben > 0 && r3.frei && r3.hit === 0 && r3.offen === 0, r3);

// bemalte Ente
const b64 = readFileSync(DUCK).toString('base64');
const r4 = await pg.evaluate(async (b64) => {
  _newCreate(false);
  const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  await _importGLB(u8.buffer, 'Duck.glb', { n: 3 });
  const o = objects[0]; _kca.p = { dir: 4, loch: 5, breite: 3, hoehe: 3 }; selectObjs([o]); _kcaOpen(); await _kcaApply();
  const m = objects[0]; const col = m.geometry.getAttribute('color');
  const st = col ? _mmuTriStatesGeo(m.geometry, m.userData) : null;
  const zahl = st ? [0, 1, 2].map(k => st.states.filter(s => s === k).length) : null;
  return { paint: m.userData._mmuPaint, slots: m.userData._mmuSlots, zahl, offen: __mess(m).offen, anzahl: objects.length };
}, b64);
ok('Ente: Bemalung bleibt (3 Farben vorhanden)', r4.paint === 1 && r4.zahl && r4.zahl.every(z => z > 20), r4);
ok('Ente: dicht, ein Objekt', r4.offen === 0 && r4.anzahl === 1, r4);

// echter Weg über das Eigenschaften-Feld (Import-Ente, 60 mm breit → links < −33 mm)
await pg.evaluate(async (b64) => { _newCreate(false); const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); await _importGLB(u8.buffer, 'Duck.glb', { n: 1 }); selectObjs([objects[0]]); }, b64);
await pg.click('button.fp-btn:has-text("Öse anbringen")');
await pg.waitForSelector('#kca-modal.show');
await pg.click('#kca-dirs .vtb[data-i="6"]');
await pg.evaluate(() => fitToObjects(objects)); await pg.mouse.move(700, 600); await pg.mouse.move(720, 610); await pg.waitForTimeout(400);
await pg.screenshot({ path: '/tmp/oese_vorschau.png', clip: { x: 340, y: 250, width: 700, height: 600 } });
await pg.click('#kca-go');
await pg.waitForFunction(() => /Anhänger/.test(objects[0]?.userData?.name || ''), { timeout: 20000 });
const r5 = await pg.evaluate(() => { const m = objects[0]; const t = __mess(m); return { mnx: t.mn[0], offen: t.offen, hist: t.hist, tris: m.geometry.attributes.position.count / 3 }; });
ok('Knopf-Weg: Öse links angebracht', r5.mnx < -33 && r5.offen === 0, r5);
await pg.mouse.click(1300, 150); await pg.waitForTimeout(300);
await pg.screenshot({ path: '/tmp/oese_fertig.png' });
ok('keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nALLE OK');
process.exit(fails.length ? 1 : 0);
