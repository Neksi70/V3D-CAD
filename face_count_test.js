const { test, expect } = require('@playwright/test');
const URL = 'http://localhost:8080/volme3d.html';

test('Face-Count Diagnose', async ({ page }) => {
  const consoleLogs = [];
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'warn') consoleLogs.push(msg.text());
  });

  await page.goto(URL);
  await page.waitForFunction(() => window._isReady === true, { timeout: 15000 });
  await page.addStyleTag({ content: '#auth-overlay { display: none !important; }' });
  await page.waitForTimeout(400);

  // Plain Box erstellen und OCCT direkt auf ihr aufrufen
  const result = await page.evaluate(async () => {
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
    const boxShape = bm.Shape();
    bm.delete();

    _occtShapeToThreeGeo(oc, boxShape, geoOff);
    return { sx, sy, sz };
  });

  await page.waitForTimeout(300);

  console.log('\n=== Browser Konsole ===');
  for (const log of consoleLogs) console.log(log);
  console.log('===================\n');
  console.log('Box scale:', result);
});
