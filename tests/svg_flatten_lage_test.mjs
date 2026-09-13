// Josy 13.9.26: "wenn ich ihn wegziehe, ist er schief und in der Luft — er legt
// sich nicht wieder flach auf den Boden. Und dann heftet er sich schief an."
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M5,40 H95 V60 H5 Z"/></svg>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const lage = () => pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  m.updateMatrixWorld(true);
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion).normalize();
  const bb = new THREE.Box3().setFromObject(m);
  return { normaleNachOben: +n.y.toFixed(3), untenY: +bb.min.y.toFixed(2),
           wrap: !!m.userData._svgWrap, winkelZuY: +(Math.acos(Math.min(1, Math.abs(n.y))) * 180 / Math.PI).toFixed(1) };
});

await pg.evaluate((svgText) => {
  addShape('tube'); const t = objects[objects.length - 1];
  t.scale.set(3, 4, 3); t.position.set(0, 4, 0); t.userData.name = 'Rohr';
  const m = _importSvgConfirm({ svgText, mode: 'extrude', depthMM: 3, targetMM: 30, name: 'Motiv' });
  t.position.set(0, 4, 0); m.position.set(0, 0.2, 10);
  objects.forEach(o => o.updateMatrixWorld(true));
}, SVG);
const l0 = await lage();
console.log('frisch eingefügt: ', JSON.stringify(l0));
ok('liegt flach auf der Platte', Math.abs(l0.normaleNachOben - 1) < 0.02 && l0.untenY < 0.3, l0);

// wickeln, dann abnehmen (Flatten)
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.shapeType === 'svg');
  const t = objects.find(o => o.userData.name === 'Rohr');
  const hit = new THREE.Vector3(3, 4, 0);
  const p = _svgWrapProbe(t, hit); _svgWrapApply(m, p, hit);
});
const l1 = await lage();
console.log('gewickelt:        ', JSON.stringify(l1));
ok('ist gewickelt', l1.wrap, l1);

await pg.evaluate(() => { const m = objects.find(o => o.userData.shapeType === 'svg'); _svgWrapFlatten(m); });
const l2 = await lage();
console.log('nach dem Abnehmen:', JSON.stringify(l2));
ok('liegt wieder flach (nicht schief in der Luft)',
   Math.abs(l2.normaleNachOben - 1) < 0.02 && l2.untenY < 0.3, l2);
ok('keine JS-Fehler', errs.length === 0, errs.slice(0, 2));
console.log(fails.length ? '❌ ' + fails.length : '✅ OK');
await b.close();
process.exit(fails.length ? 1 : 0);
