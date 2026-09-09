// Test: Die weißen Eck-Anfasser skalieren richtungsrichtig —
// nach AUSSEN ziehen macht größer, nach INNEN kleiner, und zwar an JEDER der
// acht Ecken. Ralf 9.9.26: "Links unten nach aussen ziehen und das Teil wird
// kleiner." (früher galt eine feste Diagonale: oben-rechts = größer)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

await pg.evaluate(() => {
  // Zieht an einer Ecke um `px` Pixel nach außen (px<0 = nach innen) und
  // meldet, wie sich das Volumen geändert hat.
  window._scTest = (key, px) => {
    const o = getFirst();
    o.scale.set(1, 1, 1); o.rotation.set(0, 0, 0); o.position.set(0, 1, 0);
    o.updateMatrixWorld(true);
    selectedObjs = [o];
    updateDimHandles();
    const item = _dimHandleData.find(d => d.key === key);
    if (!item) return { skip: 'kein Griff ' + key };
    if (item.el.style.visibility === 'hidden') return { skip: 'Griff hinten: ' + key };

    // Bildschirm-Mitte des Objekts → Richtung "nach außen"
    camera.updateMatrixWorld(true);
    const vr = vpEl.getBoundingClientRect(), cR = canvas.getBoundingClientRect();
    const c = getMeshBox(o).getCenter(new THREE.Vector3()).project(camera);
    const cs = { x: (cR.left - vr.left) + (c.x + 1) / 2 * vr.width,
                 y: (cR.top - vr.top) + (-c.y + 1) / 2 * vr.height };
    let ux = item.sx - cs.x, uy = item.sy - cs.y;
    const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;

    const sz0 = getMeshBox(o).getSize(new THREE.Vector3());
    const v0 = sz0.x * sz0.y * sz0.z;
    const from = { x: vr.left + item.sx, y: vr.top + item.sy };
    const to   = { x: from.x + ux * px,  y: from.y + uy * px };
    const pe = (type, x, y, tgt) => tgt.dispatchEvent(new PointerEvent(type,
      { clientX: x, clientY: y, button: 0, buttons: 1, pointerType: 'mouse',
        bubbles: true, cancelable: true }));
    pe('pointerdown', from.x, from.y, item.el);
    const grabbed = !!_dragHandle;
    pe('pointermove', to.x, to.y, window);
    const sz1 = getMeshBox(o).getSize(new THREE.Vector3());
    pe('pointerup', to.x, to.y, window);
    const v1 = sz1.x * sz1.y * sz1.z;
    return { grabbed, v0, v1, ratio: v1 / v0, outX: +ux.toFixed(2), outY: +uy.toFixed(2) };
  };
});

await pg.evaluate(() => { addShape('cube'); });

const KEYS = ['c000','c100','c010','c110','c001','c101','c011','c111'];
let getestet = 0;
for (const key of KEYS) {
  const out = await pg.evaluate(k => window._scTest(k,  90), key);
  const inn = await pg.evaluate(k => window._scTest(k, -90), key);
  if (out.skip) { console.log('  ÜBERSPRUNGEN ' + key + ' (' + out.skip + ')'); continue; }
  getestet++;
  ok(`Ecke ${key}: Griff gefasst`, out.grabbed === true);
  ok(`Ecke ${key}: nach AUSSEN ziehen macht größer`, out.ratio > 1.05,
     { faktor: +out.ratio.toFixed(3), richtung: [out.outX, out.outY] });
  ok(`Ecke ${key}: nach INNEN ziehen macht kleiner`, inn.ratio < 0.95,
     { faktor: +inn.ratio.toFixed(3) });
}
ok('Es wurden sichtbare Ecken getestet', getestet >= 4, { getestet });

// Die schwarzen Kanten-Griffe dürfen dabei nicht kaputtgehen
const blk = await pg.evaluate(() => {
  const res = {};
  for (const key of ['fx+','fx-','fz+','fz-','fy+','fy-']) {
    const o = getFirst();
    o.scale.set(1,1,1); o.rotation.set(0,0,0); o.position.set(0,1,0);
    o.updateMatrixWorld(true); selectedObjs = [o]; updateDimHandles();
    const item = _dimHandleData.find(d => d.key === key);
    if (!item || item.el.style.visibility === 'hidden') { res[key] = null; continue; }
    camera.updateMatrixWorld(true);
    const vr = vpEl.getBoundingClientRect(), cR = canvas.getBoundingClientRect();
    const c = getMeshBox(o).getCenter(new THREE.Vector3()).project(camera);
    const cs = { x: (cR.left-vr.left)+(c.x+1)/2*vr.width, y: (cR.top-vr.top)+(-c.y+1)/2*vr.height };
    let ux = item.sx - cs.x, uy = item.sy - cs.y;
    const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
    const sz0 = getMeshBox(o).getSize(new THREE.Vector3());
    const pe = (t,x,y,tg) => tg.dispatchEvent(new PointerEvent(t,
      { clientX:x, clientY:y, button:0, buttons:1, pointerType:'mouse', bubbles:true, cancelable:true }));
    pe('pointerdown', vr.left+item.sx, vr.top+item.sy, item.el);
    if (!_dragHandle) { res[key] = null; continue; }   // Griff im Bild verdeckt
    pe('pointermove', vr.left+item.sx+ux*90, vr.top+item.sy+uy*90, window);
    const sz1 = getMeshBox(o).getSize(new THREE.Vector3());
    pe('pointerup', vr.left+item.sx+ux*90, vr.top+item.sy+uy*90, window);
    const ax = key[1] === 'x' ? 'x' : key[1] === 'y' ? 'y' : 'z';
    res[key] = sz1[ax] / sz0[ax];
  }
  return res;
});
let kanten = 0;
for (const [k, v] of Object.entries(blk)) {
  if (v === null) { console.log('  ÜBERSPRUNGEN Kante ' + k + ' (im Bild verdeckt)'); continue; }
  kanten++;
  ok(`Kante ${k}: nach außen ziehen macht größer`, v > 1.05, { faktor: +v.toFixed(3) });
}
ok('Es wurden sichtbare Kanten getestet', kanten >= 4, { kanten });

ok('Keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
if (fails.length) { console.log('\nFEHLGESCHLAGEN: ' + fails.length + ' Prüfungen'); process.exit(1); }
console.log('\nAlle Prüfungen bestanden.');
