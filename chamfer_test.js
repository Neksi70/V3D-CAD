const { test, expect } = require('@playwright/test');
const URL = 'http://localhost:8080/volme3d.html';

async function waitForApp(page) {
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  // Auth-Overlay ausblenden für Tests
  await page.evaluate(() => document.getElementById('auth-overlay')?.classList.add('hidden'));
  await page.waitForTimeout(400);
}

test('Edge Chamfer auf CSG-Objekt', async ({ page }) => {
  await page.goto(URL);
  await waitForApp(page);

  // 1. Box + Kugel erstellen, CSG subtract
  await page.evaluate(() => {
    addShape('box');
    const objs = window._getObjects();
    const box = objs[objs.length - 1];
    box.scale.set(20, 20, 20);
    box.position.set(0, 10, 0);
    box.updateWorldMatrix(true, true);
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    addShape('sphere');
    const objs = window._getObjects();
    const sph = objs[objs.length - 1];
    sph.scale.set(8, 8, 8);
    sph.position.set(0, 10, 0);
    sph.userData.isHole = true;
    sph.updateWorldMatrix(true, true);

    const sel = window._getSelectedObjs();
    sel.length = 0;
    sel.push(objs[objs.length - 2], objs[objs.length - 1]);
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => subtractHoles());
  await page.waitForTimeout(2000);

  const csgInfo = await page.evaluate(() => {
    const objs = window._getObjects();
    const csg = objs[objs.length - 1];
    return {
      found: !!csg,
      type: csg?.userData?.type,
      shapeType: csg?.userData?.shapeType,
      vertCount: csg?.geometry?.attributes?.position?.count ?? -1
    };
  });
  console.log('CSG-Objekt:', csgInfo);
  expect(csgInfo.found).toBe(true);
  expect(csgInfo.vertCount).toBeGreaterThan(100);

  await page.evaluate(() => {
    const objs = window._getObjects();
    const csg = objs[objs.length - 1];
    const sel = window._getSelectedObjs();
    sel.length = 0;
    sel.push(csg);
  });
  await page.waitForTimeout(200);

  await page.evaluate(() => enterEdgeMode());
  await page.waitForTimeout(500);

  const edgeInfo = await page.evaluate(() => ({
    mode: _edgeMode,
    dynEdgesCount: _edgeObj?.userData?._dynamicEdges?.length ?? 0,
    selSize: _edgeSel.size
  }));
  console.log('Edge-Mode:', edgeInfo);
  expect(edgeInfo.mode).toBe(true);
  expect(edgeInfo.dynEdgesCount).toBeGreaterThan(0);

  const vertCountBefore = await page.evaluate(() => {
    _edgeSel.add(0);
    const e = _edgeObj.userData._dynamicEdges[0];
    _edgeBevelHandlePos = new THREE.Vector3(
      (e.worldA[0]+e.worldB[0])/2,
      (e.worldA[1]+e.worldB[1])/2,
      (e.worldA[2]+e.worldB[2])/2
    );
    _updateEdgeColors();
    return _edgeObj.geometry.attributes.position.count;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/chamfer_before.png' });
  console.log('Vor Chamfer — Vertices:', vertCountBefore);

  await page.evaluate(async () => { await _applyEdgeHandleValue(2.0); });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/chamfer_after.png' });

  const applyResult = await page.evaluate(() => {
    const objs = window._getObjects();
    const csg = objs[objs.length - 1];
    return csg?.geometry?.attributes?.position?.count ?? -1;
  });
  console.log('Nach Chamfer — Vertices:', applyResult);

  expect(applyResult).toBeGreaterThan(vertCountBefore);
  console.log('✓ Chamfer erfolgreich — Δ Vertices:', applyResult - vertCountBefore);
});

test('OCCT Box Chamfer - alle Flächen sichtbar', async ({ page }) => {
  await page.goto(URL);
  await waitForApp(page);

  // Box erstellen und selektieren
  await page.evaluate(() => {
    addShape('box');
    const objs = window._getObjects();
    const box = objs[objs.length - 1];
    box.scale.set(30, 20, 25);
    box.position.set(0, 20, 0);
    box.updateWorldMatrix(true, true);
    const sel = window._getSelectedObjs();
    sel.length = 0; sel.push(box);
    enterEdgeMode();
    _edgeSel.add(0); _edgeSel.add(4);
    _updateEdgeColors();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/occt_before.png' });

  // OCCT warten + Chamfer anwenden (async)
  const result = await page.evaluate(async () => {
    await _applyEdgeHandleValue(4.0);
    await new Promise(r => setTimeout(r, 3000));
    const objs = window._getObjects();
    const obj = objs[objs.length - 1];
    return {
      wasBox: obj?.userData?.wasBox,
      hasOcctParams: !!obj?.userData?._occtParams,
      ops: obj?.userData?._occtParams?.ops?.length ?? 0,
      verts: obj?.geometry?.attributes?.position?.count ?? -1,
    };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/occt_after.png' });
  console.log('OCCT Box Chamfer:', result);

  expect(result.wasBox).toBe(true);
  expect(result.verts).toBeGreaterThan(20); // flat box faces = wenige Vertices
  console.log('✓ OCCT Box Chamfer OK — Vertices:', result.verts, '| ops:', result.ops);
});

test('OCCT Box Chamfer - Canvas Screenshot', async ({ page }) => {
  await page.goto(URL);
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  await page.waitForTimeout(500);

  // Overlay mit !important CSS überschreiben
  await page.addStyleTag({ content: '#auth-overlay { display: none !important; }' });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    addShape('box');
    const objs = window._getObjects();
    const box = objs[objs.length - 1];
    box.scale.set(30, 20, 25);
    box.position.set(0, 20, 0);
    box.updateWorldMatrix(true, true);
    const sel = window._getSelectedObjs();
    sel.length = 0; sel.push(box);
    enterEdgeMode();
    _edgeSel.add(0); _edgeSel.add(8);
    _updateEdgeColors();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/canvas_before.png' });

  await page.evaluate(async () => { await _applyEdgeHandleValue(5.0); });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/canvas_after.png' });

  const verts = await page.evaluate(() => {
    const objs = window._getObjects();
    return objs[objs.length-1]?.geometry?.attributes?.position?.count ?? -1;
  });
  console.log('Nach OCCT Chamfer, Vertices:', verts);
  expect(verts).toBeGreaterThan(20);
});

test('Face-Count Diagnose — Plain Box', async ({ page }) => {
  const logs = [];
  page.on('console', msg => { if (['log','warn'].includes(msg.type())) logs.push(msg.text()); });

  await page.goto('http://localhost:8080/volme3d.html');
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  await page.addStyleTag({ content: '#auth-overlay { display: none !important; }' });
  await page.waitForTimeout(400);

  await page.evaluate(async () => {
    addShape('box');
    const objs = window._getObjects();
    const box = objs[objs.length - 1];
    box.scale.set(20, 20, 20);
    box.position.set(0, 20, 0);
    box.updateWorldMatrix(true, true);

    const oc = await _loadOCCT();
    const sx = box.scale.x, sy = box.scale.y, sz = box.scale.z;
    const geoOff = { x: box.position.x - sx, y: box.position.y - sy, z: box.position.z - sz };
    const bm = new oc.BRepPrimAPI_MakeBox_2(2*sx, 2*sy, 2*sz);
    _occtShapeToThreeGeo(oc, bm.Shape(), geoOff);
    bm.delete();
  });

  await page.waitForTimeout(500);
  console.log('\n=== Browser Logs ===');
  for (const l of logs) console.log('  ', l);
  console.log('===================');
});

test('Face-Count Diagnose — nach OCCT Chamfer', async ({ page }) => {
  const logs = [];
  page.on('console', msg => { if (['log','warn'].includes(msg.type())) logs.push(msg.text()); });

  await page.goto('http://localhost:8080/volme3d.html');
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  await page.addStyleTag({ content: '#auth-overlay { display: none !important; }' });
  await page.waitForTimeout(400);

  await page.evaluate(async () => {
    addShape('box');
    const objs = window._getObjects();
    const box = objs[objs.length - 1];
    box.scale.set(20, 20, 20);
    box.position.set(0, 20, 0);
    box.updateWorldMatrix(true, true);
    const sel = window._getSelectedObjs();
    sel.length = 0; sel.push(box);
    enterEdgeMode();
    // Kante 0 (oben) selektieren
    _edgeSel.add(0);
    _updateEdgeColors();
  });
  await page.waitForTimeout(300);

  await page.evaluate(async () => { await _applyEdgeHandleValue(3.0); });
  await page.waitForTimeout(2000);

  console.log('\n=== Browser Logs (nach Chamfer) ===');
  for (const l of logs) console.log('  ', l);
  console.log('====================================');

  const verts = await page.evaluate(() => {
    const objs = window._getObjects();
    return objs[objs.length-1]?.geometry?.attributes?.position?.count ?? -1;
  });
  console.log('Result verts:', verts);
});

test('OCCT Box Fillet — Handle links (negativ)', async ({ page }) => {
  await page.goto(URL);
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  await page.addStyleTag({ content: '#auth-overlay { display: none !important; }' });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    addShape('box');
    const objs = window._getObjects();
    const box = objs[objs.length - 1];
    box.scale.set(30, 20, 25);
    box.position.set(0, 20, 0);
    box.updateWorldMatrix(true, true);
    const sel = window._getSelectedObjs();
    sel.length = 0; sel.push(box);
    enterEdgeMode();
    _edgeSel.add(0);
    _updateEdgeColors();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/fillet_before.png' });

  // Negativer Wert → Fillet statt Chamfer
  await page.evaluate(async () => { await _applyEdgeHandleValue(-4.0); });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/fillet_after.png' });

  const result = await page.evaluate(() => {
    const objs = window._getObjects();
    const obj = objs[objs.length - 1];
    return {
      wasBox: obj?.userData?.wasBox,
      ops: obj?.userData?._occtParams?.ops ?? [],
      verts: obj?.geometry?.attributes?.position?.count ?? -1,
    };
  });
  console.log('Fillet Ergebnis:', result);
  console.log('Op-Typ:', result.ops[0]?.type);

  expect(result.wasBox).toBe(true);
  expect(result.ops[0]?.type).toBe('fillet');
  expect(result.verts).toBeGreaterThan(20);
  console.log('✓ Fillet OK — Vertices:', result.verts);
});
