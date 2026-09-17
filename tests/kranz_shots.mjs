// Bildbelege für den Kranz-Generator: große Renderings verschiedener Varianten
// nach /tmp/kranz_big_*.png (Dev-Server 8766).
import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(async f => { await _mfInit(); window.__krzFine = f[0]; window.__krzZoom = f[1]; }, [process.env.FINE === '1', +(process.env.ZOOM || 1)]);
const varianten = JSON.parse(process.env.VAR || 'null') || [
  ['strick', {}], ['kordel', { haut: 'kordel', kerzeD: 39.5, tiefe: 12, strang: 48, dia: 250 }],
  ['glatt', { haut: 'glatt' }], ['mitte', { kerzen: 'mitte', kerzeD: 61, tiefe: 10 }],
];
for (const [n, p] of varianten) {
  const url = await pg.evaluate(p => {
    Object.assign(_krzP, _KRZ_DEF, p);
    const geo = (() => { if (!window.__krzFine) return _krzPreviewGeo();
      const r = _krzBuild(_mfWasm, _krzP, 'fein'), g = r.geo.toNonIndexed(); r.geo.dispose();
      const c = new Float32Array(g.attributes.position.count * 3).fill(0.8);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.scale(0.1, 0.1, 0.1); g.computeVertexNormals(); return g; })();
    const cv = document.createElement('canvas'); cv.width = 1000; cv.height = 750;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
    r.setClearColor(0x2a2f3a);
    const sc = new THREE.Scene();
    sc.add(new THREE.AmbientLight(0xffffff, 0.25));
    const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.intensity = 0.75; dl.position.set(-8, 7, 6); sc.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffe0c0, 0.35); dl2.position.set(6, 3, -4); sc.add(dl2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    sc.add(m);
    const cam = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 500);
    if (window.__krzZoom > 1) { cam.position.set(0, 9, 22); cam.lookAt(0, 1, 9.5); } else { cam.position.set(0, 26, 30); cam.lookAt(0, 0, 0); }
    r.render(sc, cam);
    const u = cv.toDataURL('image/png'); r.dispose(); geo.dispose(); return u;
  }, p);
  fs.writeFileSync('/tmp/kranz_big_' + n + '.png', Buffer.from(url.split(',')[1], 'base64'));
  console.log('/tmp/kranz_big_' + n + '.png');
}
await b.close();
