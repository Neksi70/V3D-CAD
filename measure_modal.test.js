// Regression: Der Messen-Modus hängt als Capture-Handler am window und prüfte nur die
// Viewport-Koordinaten. Modals (Generatoren) liegen mit position:fixed darüber — dort
// wurde jeder Klick geschluckt: Schieber reagierten nicht, es kam nur
// "Daneben — auf ein Objekt klicken". (Fehlerbericht Ralf, Gardena-Generator)
const { test, expect } = require('@playwright/test');

const URL = 'http://localhost:8766/volme3d.html';

async function boot(page) {
  await page.goto(URL);
  await page.waitForFunction(() => window._isReady === true, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { if (typeof hideStarter === 'function') hideStarter(); });
}

test('Schieber im Generator-Modal greifen trotz aktivem Messen-Modus', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => measureTool());                 // Messen an (Button orange)
  await page.evaluate(() => _openGardenaModal());
  await page.waitForSelector('#gardena-modal.show');
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => _gardP.lenA);
  const box = await page.locator('#gp-lenA').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.29, y);       // Thumb bei (16-6)/(40-6)
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => _gardP.lenA)).toBeGreaterThan(before);
});

test('Messen im 3D-Fenster funktioniert weiterhin', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => addShape('box'));               // Box in die Szene
  await page.waitForTimeout(600);
  await page.evaluate(() => measureTool());

  const vp = await page.locator('#vp').boundingBox();
  await page.mouse.click(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await page.waitForTimeout(300);

  // Klick auf die Box setzt einen Messpunkt oder erkennt einen Kreis
  expect(await page.evaluate(() => !!(_measureA || _measureCircle))).toBe(true);
});
