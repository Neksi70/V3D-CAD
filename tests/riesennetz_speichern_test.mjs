// Riesen-Netze in voller Auflösung: schnelle Reduktion = alte (bitgleich), Paket
// verlustfrei, Design speichern → neu laden = volles Netz (IndexedDB), .v3d hin und
// zurück, Duplizieren/Muster voll, Aufräumen löscht nur Verwaistes.
// Aufruf: node tests/riesennetz_speichern_test.mjs  (braucht /tmp/bigstl/scan500k.stl,
// erzeugen: node /tmp/bigstl/gen.mjs /tmp/bigstl/scan500k.stl 500000)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const STL = '/tmp/bigstl/scan500k.stl', ALT = fs.readFileSync('/tmp/v3d_decim_alt.js', 'utf8').replace('function _clusterDecimateFlat(', 'function _decimAlt(');
const PORT = 8962;
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const pg = await br.newPage({ viewport: { width: 1300, height: 850 } });
const fehler = []; pg.on('pageerror', e => fehler.push(String(e).slice(0, 200)));
let ok = true; const check = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) ok = false; };
try {
  await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof hideStarter === 'function' && typeof _geoPack === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => { hideStarter(); _newCreate(false); clearInterval(_autoSaveTimer); });
  await pg.addScriptTag({ content: ALT });

  // 1. Reduktion alt = neu
  const d = await pg.evaluate(() => {
    const g = new THREE.TorusKnotGeometry(5, 1.5, 900, 160).toNonIndexed(), v = g.attributes.position.array;
    const out = [];
    for (const [t, n0] of [[150000, 300], [60000, undefined], [20000, 64]]) {
      let t0 = performance.now(); const a = _decimAlt(v, t, n0); const ta = performance.now() - t0;
      t0 = performance.now(); const b = _clusterDecimateFlat(v, t, n0); const tb = performance.now() - t0;
      const fa = Float32Array.from(a); let gleich = fa.length === b.length; for (let i = 0; gleich && i < fa.length; i++) if (fa[i] !== b[i]) gleich = false;
      out.push({ ziel: t, tris: b.length / 9, gleich, alt: Math.round(ta), neu: Math.round(tb) });
    }
    return { n: v.length / 9, out };
  });
  for (const o of d.out) check(o.gleich, `Reduktion ${d.n} → ${o.tris} (Ziel ${o.ziel}): bitgleich, alt ${o.alt} ms → neu ${o.neu} ms`);

  // 2. Paket verlustfrei
  const p = await pg.evaluate(() => {
    const gleich = (a, b, tol) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) return false; return true; };
    const proben = {};
    const kugel = new THREE.SphereGeometry(5, 120, 80); kugel.deleteAttribute('uv');
    const scan = kugel.toNonIndexed(); scan.computeVertexNormals();       // flach, wie STL
    const bem = scan.clone(); const C = new Float32Array(bem.attributes.position.count * 3); for (let i = 0; i < C.length; i++) C[i] = ((i * 7919) % 97) / 97; bem.setAttribute('color', new THREE.BufferAttribute(C, 3));
    const idx = new THREE.SphereGeometry(5, 120, 80); idx.deleteAttribute('uv');
    const glatt = idx.toNonIndexed();                                                                      // nicht indiziert, glatte Normalen
    for (const [k, g] of Object.entries({ scan, bem, idx, glatt })) {
      const pk = _geoPack(g), u = _geoUnpack(pk), b64 = _geoUnpack(_geoB64Dec(_geoB64Enc(g)));
      const pos = gleich(g.attributes.position.array, u.attributes.position.array, 0) && gleich(g.attributes.position.array, b64.attributes.position.array, 0);
      const nor = gleich(g.attributes.normal.array, u.attributes.normal.array, 1e-4);
      const col = !g.attributes.color || gleich(g.attributes.color.array, u.attributes.color.array, 0);
      const idxOk = !g.index || gleich(g.index.array, u.index.array, 0);
      proben.uvNull = _geoPack(new THREE.SphereGeometry(1, 8, 6)) === null;   // fremde Attribute → altes Verhalten
      proben[k] = { pos, nor, col, idxOk, roh: g.attributes.position.array.byteLength, paket: pk.pos.byteLength + (pk.idx ? pk.idx.byteLength : 0) };
    }
    return proben;
  }).catch(async e => { throw e; });
  check(p.uvNull === true, 'Netz mit UV-Koordinaten wird nicht gepackt (bleibt beim alten Verhalten)'); delete p.uvNull;
  for (const [k, v] of Object.entries(p)) check(v.pos && v.nor && v.col && v.idxOk, `Paket ${k}: Positionen bitgleich, Normalen/Farben/Index ok (${(v.roh / 1e6).toFixed(1)} → ${(v.paket / 1e6).toFixed(1)} MB)`);

  // 3. Import 500k ohne Reduktion
  await pg.setInputFiles('#fimport', STL);
  await pg.waitForFunction(() => objects.length >= 1 && document.getElementById('sz-decim-row').style.display !== 'none', null, { timeout: 300000 });
  const imp = await pg.evaluate(async () => {
    document.getElementById('sz-decim-chk').checked = false; _confirmSize(); await new Promise(r => setTimeout(r, 300));
    const o = objects[0], g = o.geometry, P = g.attributes.position.array; let sum = 0; for (let i = 0; i < P.length; i += 97) sum += P[i];
    window._ref = { n: P.length, sum };
    return { tris: P.length / 9 };
  });
  check(imp.tris > 400000, `Import: ${imp.tris} Dreiecke behalten`);

  // 4. Duplizieren + Muster in voller Auflösung
  const dup = await pg.evaluate(() => {
    const tris = o => o.geometry.attributes.position.count / 3;
    selectObjs([objects[0]]); smartDuplicate(); const a = tris(objects[objects.length - 1]);
    scene.remove(objects[objects.length - 1]); objects.pop();
    selectObjs([objects[0]]); _applyLinearPattern(2, 12, 0, 0); const b = tris(objects[objects.length - 1]);
    scene.remove(objects[objects.length - 1]); objects.pop(); selectObjs([objects[0]]);
    return { a, b, soll: tris(objects[0]) };
  });
  check(dup.a === dup.soll && dup.b === dup.soll, `Duplizieren ${dup.a} / Muster ${dup.b} Dreiecke (Original ${dup.soll})`);

  // 5. Design-Schnappschuss → volles Netz liegt in IndexedDB, Neuladen tauscht es ein
  const r5 = await pg.evaluate(async () => {
    const t0 = performance.now(); const snap = _sceneSnapshot(); const json = JSON.stringify(snap); const tSnap = performance.now() - t0;
    const key = snap.objects[0].geometry.__full;
    await new Promise(r => setTimeout(r, 1500));   // IndexedDB schreibt asynchron
    const db = await _geoIdb(); const da = await new Promise(r => { const q = db.transaction('g').objectStore('g').get(key); q.onsuccess = () => r(!!q.result); });
    // „Neu laden": Szene leeren, aus JSON bauen
    objects.forEach(o => scene.remove(o)); objects.length = 0;
    const o = buildObjectFromData(JSON.parse(json).objects[0]); scene.add(o); objects.push(o);
    const sofort = o.geometry.attributes.position.count / 3;
    for (let i = 0; i < 60 && o.geometry.attributes.position.count / 3 === sofort; i++) await new Promise(r => setTimeout(r, 100));
    const P = o.geometry.attributes.position.array; let sum = 0; for (let i = 0; i < P.length; i += 97) sum += P[i];
    return { key, da, zeichen: json.length, tSnap: Math.round(tSnap), sofort, danach: P.length / 9, gleich: P.length === window._ref.n && sum === window._ref.sum };
  });
  console.log('  Schnappschuss', r5.tSnap, 'ms,', (r5.zeichen / 1e6).toFixed(1), 'Mio. Zeichen, Schlüssel', r5.key);
  check(!!r5.key && r5.da, 'volles Netz in IndexedDB abgelegt, JSON verweist darauf');
  check(r5.sofort < 400000 && r5.gleich, `Neuladen: erst ${r5.sofort} (vereinfacht), dann ${r5.danach} Dreiecke — bitgleich mit dem Import`);

  // 6. .v3d-Datei hin und zurück
  const r6 = await pg.evaluate(() => {
    let t0 = performance.now(); const j = _sceneJson(); const tS = performance.now() - t0;
    t0 = performance.now(); _loadSceneFromJSON(j, 'test'); const tL = performance.now() - t0;
    const P = objects[0].geometry.attributes.position.array; let sum = 0; for (let i = 0; i < P.length; i += 97) sum += P[i];
    return { zeichen: j.length, tS: Math.round(tS), tL: Math.round(tL), gleich: P.length === window._ref.n && sum === window._ref.sum, tris: P.length / 9 };
  });
  check(r6.gleich, `.v3d: ${(r6.zeichen / 1e6).toFixed(1)} Mio. Zeichen (schreiben ${r6.tS} ms, laden ${r6.tL} ms), sofort ${r6.tris} Dreiecke bitgleich`);

  // 7. Aufräumen: verwaister alter Eintrag weg, benutzter bleibt
  const r7 = await pg.evaluate(async () => {
    const db = await _geoIdb();
    await new Promise(r => { const tx = db.transaction('g', 'readwrite'); tx.objectStore('g').put({ v: 1, ts: 1 }, 'g00000000deadbeef_1'); tx.oncomplete = r; });
    const snap = _sceneSnapshot(); dsSaveDesign('testgc', snap, '', 'GC-Test', true);
    const key = snap.objects[0].geometry.__full; _geoFullPut.delete(key);   // so tun, als wäre es eine alte Sitzung
    await new Promise(r => { const tx = db.transaction('g', 'readwrite'); const st = tx.objectStore('g'); const q = st.get(key); q.onsuccess = () => { const v = q.result; v.ts = 1; st.put(v, key); }; tx.oncomplete = r; });
    const weg = await _geoGc();
    const hat = k => new Promise(r => { const q = db.transaction('g').objectStore('g').get(k); q.onsuccess = () => r(!!q.result); });
    return { weg, verwaist: await hat('g00000000deadbeef_1'), benutzt: await hat(key) };
  });
  check(r7.weg === 1 && !r7.verwaist && r7.benutzt, `Aufräumen: ${r7.weg} verwaister Eintrag gelöscht, gespeichertes Design behält sein Netz`);
  // 8. Auto-Speichern: gzip im Worker, Ergebnis korrekt; gelöschtes Design bleibt gelöscht
  const r8 = await pg.evaluate(async () => {
    const snap = _sceneSnapshot(), json = _jsonOf(snap);
    let t0 = performance.now(); _dsCompress(json); const tSync = performance.now() - t0;
    t0 = performance.now(); const p = dsSaveDesignAsync('testasync', snap, '', 'Async-Test'); const tRuck = performance.now() - t0;
    const ok = await p; const zurueck = dsLoadData('testasync');
    const gleich = !!zurueck && JSON.stringify(zurueck) === json;
    const p2 = dsSaveDesignAsync('testweg', snap, '', 'Weg'); dsDeleteDesign('testweg'); await p2;
    return { tSync: Math.round(tSync), tRuck: Math.round(tRuck), ok, gleich, gz: (localStorage.getItem(_dsDataKey('testasync')) || '').startsWith('GZ1:'), weg: localStorage.getItem(_dsDataKey('testweg')) === null };
  });
  check(r8.ok && r8.gleich && r8.gz, `Auto-Speichern im Worker: Design korrekt gepackt gespeichert (Haupt-Thread ${r8.tRuck} ms statt ${r8.tSync} ms)`);
  check(r8.weg, 'zwischendurch gelöschtes Design wird nicht wieder angelegt');
  check(!fehler.length, 'keine Seitenfehler' + (fehler.length ? ': ' + fehler[0] : ''));
} catch (e) { console.error(e); ok = false; }
await br.close(); srv.kill();
console.log(ok ? 'ALLES OK' : 'FEHLER');
process.exit(ok ? 0 : 1);
