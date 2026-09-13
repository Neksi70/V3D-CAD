// Bildbelege für den Eichel-Generator: Ansicht verschraubt, Längsschnitt, Dialog-Vorschau.
// Start: npm run dev (8766). Bilder landen in /tmp/eichel_*.png
import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => console.log('ERR', String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window._eicBuild === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const over = JSON.parse(process.env.EIC || '{}');
const shots = await pg.evaluate(async (over) => {
  await _mfInit(); await new Promise(res => _eicLoadFonts(res));
  const p = { ..._eicP, ...over }, r = _eicBuild(_mfWasm, p, 'fein');
  const cv = document.createElement('canvas'); cv.width = 700; cv.height = 900;
  const R = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  R.localClippingEnabled = true; R.setClearColor(0xeeeae4);
  const out = {};
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(80, 120, 160); scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffeedd, 0.35); dl2.position.set(-120, -40, 60); scene.add(dl2);
  const mk = (g, col, clip) => { g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.75, side: THREE.DoubleSide, clippingPlanes: clip ? [clip] : [] })); };
  const nutG = r.nutGeo.toNonIndexed(), capG = r.capGeo.toNonIndexed();
  const shoot = (name, meshes, camPos, look) => {
    meshes.forEach(m => scene.add(m));
    const cam = new THREE.PerspectiveCamera(30, 700 / 900, 1, 3000); cam.position.set(...camPos); cam.lookAt(...look);
    R.render(scene, cam); out[name] = cv.toDataURL('image/png');
    meshes.forEach(m => scene.remove(m));
  };
  const cy = (r.d.yTop + r.d.yEnd) / 2;
  shoot('ansicht', [mk(nutG, 0xd8c7ad), mk(capG, 0x5b4034)], [0, cy + 40, 330], [0, cy, 0]);
  shoot('schraeg', [mk(nutG, 0xd8c7ad), mk(capG, 0x5b4034)], [230, cy + 120, 200], [0, cy, 0]);
  const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  shoot('schnitt', [mk(nutG, 0xd8c7ad, clip), mk(capG, 0x5b4034, clip)], [0, cy, 330], [0, cy, 0]);
  return out;
}, over);
for (const [k, v] of Object.entries(shots)) fs.writeFileSync('/tmp/eichel_' + k + '.png', Buffer.from(v.split(',')[1], 'base64'));
await pg.evaluate(() => _eicOpen());
await pg.waitForFunction(() => !!(_gpv['eic'] && _gpv['eic'].group), { timeout: 30000 });
await pg.mouse.move(700, 450); await pg.mouse.click(5, 5).catch(() => {});
await pg.evaluate(() => _eicOpen());
await new Promise(r => setTimeout(r, 1500));
await pg.locator('#eic-modal .g3box').screenshot({ path: '/tmp/eichel_dialog.png' });
await b.close();
console.log('ok');
