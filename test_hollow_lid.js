// Test der /api/occt-hollow-lid Pipeline mit generiertem Test-STL (Quader).
// Startet die Express-App auf ephemerem HTTP-Port (kein HTTPS/3001) und prüft,
// dass body+lid valide Solids ergeben. Auch der "zu flach"-Guard wird getestet.
const http = require('http');
const { getOC, makeBox, solidToSTLBuffer, stlToOCCTSolid, getBBoxNum, app } = require('./occt-server.js');

function post(server, body) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: '/api/occt-hollow-lid',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
      r => { let buf = ''; r.on('data', d => buf += d); r.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('Bad JSON: ' + buf.slice(0,200))); } }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

const triCount = b64 => { const buf = Buffer.from(b64, 'base64'); return (buf.length - 84) / 50; };

(async () => {
  const oc = await getOC();

  // Test-STL: 30×24×40 mm Quader (minDim=24, wall=2 → passt)
  const boxSolid = makeBox(oc, 0, 0, 0, 30, 24, 40);
  const stlBuf = solidToSTLBuffer(oc, boxSolid);
  const stlBase64 = stlBuf.toString('base64');
  console.log(`Test-STL: ${stlBuf.length} B, ${(stlBuf.length-84)/50} Dreiecke`);

  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));

  let fail = 0;
  const check = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };

  // ── Test 1: Standardlauf (Ring-Falz + Bohrung) ──────────────────────────
  console.log('\n[Test 1] wall=2 cutAt=0.5 lip=5 clear=0.25 bore=6 ring=true');
  const r1 = await post(server, { stlBase64, wall: 2, cutAt: 0.5, lipDepth: 5, clear: 0.25, boreDia: 6 });
  if (r1.error) { console.log('  ✗ Fehler:', r1.error); fail++; }
  else {
    check(!!r1.bodyStlBase64, 'body vorhanden');
    check(!!r1.lidStlBase64,  'lid vorhanden');
    check(triCount(r1.bodyStlBase64) > 12, `body Dreiecke=${triCount(r1.bodyStlBase64)} (>12)`);
    check(triCount(r1.lidStlBase64)  > 12, `lid Dreiecke=${triCount(r1.lidStlBase64)} (>12)`);
    // Re-Import → valider Solid?
    const bodyS = stlToOCCTSolid(oc, Buffer.from(r1.bodyStlBase64, 'base64'));
    const lidS  = stlToOCCTSolid(oc, Buffer.from(r1.lidStlBase64,  'base64'));
    check(bodyS && bodyS.ShapeType().value === 2, 'body re-import = Solid');
    check(lidS  && lidS.ShapeType().value  === 2, 'lid re-import = Solid');
    const bbB = bodyS && getBBoxNum(oc, bodyS), bbL = lidS && getBBoxNum(oc, lidS);
    if (bbB) check(bbB.zMax <= 20.6, `body endet bei zCut~20 (zMax=${bbB.zMax.toFixed(2)})`);
    if (bbL) check(bbL.zMin <= 15.1, `lid-Falz ragt unter zCut (zMin=${bbL.zMin.toFixed(2)} ≤ ~15)`);
  }

  // ── Test 2: Vollpfropfen-Falz, keine Bohrung ────────────────────────────
  console.log('\n[Test 2] ringLip=false, boreDia=0');
  const r2 = await post(server, { stlBase64, wall: 2, ringLip: false, boreDia: 0 });
  if (r2.error) { console.log('  ✗ Fehler:', r2.error); fail++; }
  else { check(!!r2.bodyStlBase64 && !!r2.lidStlBase64, 'body+lid vorhanden'); }

  // ── Test 3: Guard "zu flach" (3mm dünn, wall=2 → 2*wall=4 > 3) ───────────
  console.log('\n[Test 3] Guard: flacher Quader 30×30×3, wall=2 → muss abbrechen');
  const flat = solidToSTLBuffer(oc, makeBox(oc, 0, 0, 0, 30, 30, 3)).toString('base64');
  const r3 = await post(server, { stlBase64: flat, wall: 2 });
  check(!!r3.error && /klein|flach/.test(r3.error), `sauberer Abbruch: "${r3.error || 'KEIN Fehler!'}"`);
  check(!r3.bodyStlBase64, 'kein Müll-Output (kein body)');

  // ── Test 4: Decimate-Vorschritt bei dichtem Mesh (feine Kugel) ──────────
  console.log('\n[Test 4] Dichtes Mesh (feinvernetzte Kugel) → Decimate + body+lid');
  const sph = new oc.BRepPrimAPI_MakeSphere_5(new oc.gp_Pnt_3(0,0,0), 20).Shape();
  // sehr fein vernetzen → >20000 Dreiecke (löst den Decimate-Vorschritt aus)
  new oc.BRepMesh_IncrementalMesh_2(sph, 0.008, false, 0.05, false);
  const sphStl = solidToSTLBuffer(oc, sph);
  const denseTris = (sphStl.length-84)/50;
  console.log(`  dichtes STL: ${denseTris} Dreiecke`);
  check(denseTris > 20000, `Mesh dicht genug für Decimate (${denseTris} > 20000)`);
  const r4 = await post(server, { stlBase64: sphStl.toString('base64'), wall: 2, decimateGrid: 64 });
  if (r4.error) { console.log('  ✗ Fehler:', r4.error); fail++; }
  else {
    check(!!r4.bodyStlBase64 && !!r4.lidStlBase64, 'body+lid trotz dichtem Mesh');
    check(triCount(r4.bodyStlBase64) > 12, `body Dreiecke=${triCount(r4.bodyStlBase64)}`);
    const bodyS = stlToOCCTSolid(oc, Buffer.from(r4.bodyStlBase64, 'base64'));
    check(bodyS && bodyS.ShapeType().value === 2, 'decimierter body = valider Solid');
  }

  server.close();
  console.log(fail === 0 ? '\n✅ ALLE TESTS BESTANDEN' : `\n❌ ${fail} FEHLER`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
