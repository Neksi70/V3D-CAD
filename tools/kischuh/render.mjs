// Headless-Render von Manifold-Netzen: node render.mjs out.png teil1.bin:#hex[:opacity] …
// .bin = Float32 Dreiecks-Ecken (x,y,z, Z oben). 4 Ansichten: seitlich, oben, vorn, schräg.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import fs from 'fs';
const [out, ...teile] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.route('**/*', r => {
  const u = new URL(r.request().url()).pathname;
  if (u === '/') return r.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><script src="/three.js"></script></body></html>' });
  if (u === '/three.js') return r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync('/home/v3da/lib/three.min.js') });
  return r.fulfill({ body: fs.readFileSync(new URL(r.request().url()).searchParams.get('f')) });
});
await p.goto('http://x/');
await p.evaluate(async (teile) => {
  const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); R.setSize(1200, 900); document.body.appendChild(R.domElement);
  R.setScissorTest(true); R.setClearColor(0xe8eef5);
  const sc = new THREE.Scene(); sc.add(new THREE.AmbientLight(0xffffff, 0.45)); const dl = new THREE.DirectionalLight(0xffffff, 0.75); dl.position.set(1, -2, 3); sc.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.3); dl2.position.set(-2, 1, 1); sc.add(dl2);
  const box = new THREE.Box3();
  for (const t of teile) {
    const [f, col, op] = t.split(':');
    const buf = await (await fetch('/datei?f=' + encodeURIComponent(f))).arrayBuffer(), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf), 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col || '#cccccc', flatShading: true, transparent: !!op, opacity: op ? +op : 1, side: THREE.DoubleSide, depthWrite: !op }));
    sc.add(m); g.computeBoundingBox(); box.union(g.boundingBox);
  }
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() * 0.55;
  const views = [[0, -1, 0.05], [0, -0.001, 1], [1, 0, 0.1], [0.8, -1, 0.7]];
  views.forEach((v, i) => {
    const cam = new THREE.OrthographicCamera(-r * 4 / 3, r * 4 / 3, r, -r, 0.1, r * 20); cam.up.set(0, 0, 1);
    cam.position.copy(c).add(new THREE.Vector3(...v).normalize().multiplyScalar(r * 5)); cam.lookAt(c);
    const x = (i % 2) * 600, y = Math.floor(i / 2) * 450;
    R.setViewport(x, 900 - y - 450, 600, 450); R.setScissor(x, 900 - y - 450, 600, 450); R.render(sc, cam);
  });
}, teile);
await p.screenshot({ path: out }); await b.close();
