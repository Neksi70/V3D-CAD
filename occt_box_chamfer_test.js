const { test, expect } = require('@playwright/test');
const URL = 'http://localhost:8080/volme3d.html';

test('OCCT Box Chamfer - alle Flächen sichtbar', async ({ page }) => {
  await page.goto(URL);
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  await page.waitForTimeout(500);

  // Box erstellen
  await page.evaluate(() => {
    addShape('box');
    const objs = window._getObjects();
    const box = objs[objs.length - 1];
    box.scale.set(30, 20, 25);
    box.position.set(0, 20, 0);
    box.updateWorldMatrix(true, true);
    window._testBox = box;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/occt_before.png' });

  // Edge-Mode + Kante selektieren
  await page.evaluate(() => {
    const objs = window._getObjects();
    const box = objs[objs.length - 1];
    const sel = window._getSelectedObjs();
    sel.length = 0; sel.push(box);
    enterEdgeMode();
    _edgeSel.add(0);
    _edgeSel.add(4);
    _updateEdgeColors();
  });
  await page.waitForTimeout(300);

  // OCCT warten und Chamfer anwenden
  const result = await page.evaluate(async () => {
    await _applyEdgeHandleValue(3.0);
    const objs = window._getObjects();
    const obj = objs[objs.length - 1];
    return {
      wasBox: obj?.userData?.wasBox,
      hasOcctParams: !!obj?.userData?._occtParams,
      ops: obj?.userData?._occtParams?.ops?.length ?? 0,
      verts: obj?.geometry?.attributes?.position?.count ?? -1,
      shapeType: obj?.userData?.shapeType
    };
  });
  console.log('OCCT Box Chamfer Ergebnis:', result);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/occt_after.png' });

  expect(result.wasBox).toBe(true);
  expect(result.hasOcctParams).toBe(true);
  expect(result.verts).toBeGreaterThan(50);
  console.log('✓ OCCT Chamfer OK — Vertices:', result.verts, '| ops:', result.ops);
});
