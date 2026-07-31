// Test für „Bild → SVG" (_vec*): prüft Silhouette mit Loch, Bildlage (kein
// Y-Flip), mm-Maße, Farbflächen-Modus und den Weg „In die Szene".
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8792;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));

await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  const out = {};
  if (typeof _vecProcess !== 'function') return { err: '_vecProcess fehlt' };

  // Testbild malen und als _vec.img einhängen
  const mkImg = (w, h, draw) => new Promise((res, rej) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
    draw(cx);
    const im = new Image();
    im.onload = () => res(im); im.onerror = rej;
    im.src = cv.toDataURL('image/png');
  });

  // ── 1) Ring: schwarze Scheibe mit weißem Loch → 1 Ebene, 1 Fläche, 1 Loch ──
  _vec.img = await mkImg(400, 300, cx => {
    cx.fillStyle = '#000'; cx.beginPath(); cx.arc(200, 150, 110, 0, 7); cx.fill();
    cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(200, 150, 45, 0, 7); cx.fill();
  });
  Object.assign(_vecP, { mode: 0, thr: 55, inv: 0, smooth: 2, minA: 1.0, res: 300, wmm: 100 });
  _vecProcess();
  const o = _vec.out;
  out.ring = o ? {
    layers: o.layers.length,
    faces: o.layers[0].faces.length,
    holes: o.layers[0].faces[0].holes.length,
    nPts: o.nPts
  } : null;

  const svg = _vecSvgText();
  out.svgHead = svg ? svg.slice(0, 210) : null;
  out.svgHasMM = !!(svg && /width="[\d.]+mm" height="[\d.]+mm"/.test(svg));
  out.svgEvenOdd = !!(svg && svg.includes('fill-rule="evenodd"'));
  out.svgSubpaths = svg ? (svg.match(/M/g) || []).length : 0;
  // Zugeschnitten auf das Motiv: runder Ring → quadratisch, also 100 × 100 mm
  out.svgH = svg ? +(/height="([\d.]+)mm"/.exec(svg) || [])[1] : null;

  // ── 2) Lage: Dreieck mit Spitze oben → oben schmal, unten breit (kein Y-Flip) ──
  _vec.img = await mkImg(400, 400, cx => {
    cx.fillStyle = '#000'; cx.beginPath();
    cx.moveTo(200, 40); cx.lineTo(360, 340); cx.lineTo(40, 340); cx.closePath(); cx.fill();
  });
  _vecProcess();
  const pts = _vec.out.layers[0].faces[0].outer.pts;
  const bb = _vec.out.bb;
  const spanAt = frac => {                       // x-Breite auf Höhe frac (0 = oben)
    const yc = bb.y0 + bb.h * frac, band = bb.h * 0.08;
    let a = 1e9, b = -1e9;
    for (const p of pts) if (Math.abs(p.y - yc) < band) { if (p.x < a) a = p.x; if (p.x > b) b = p.x; }
    return b > a ? +((b - a) / bb.w).toFixed(2) : 0;
  };
  out.spanTop = spanAt(0.15);
  out.spanBottom = spanAt(0.85);

  // ── 3) Umkehren: weißes Motiv auf schwarzem Grund ──
  _vec.img = await mkImg(300, 300, cx => {
    cx.fillStyle = '#000'; cx.fillRect(0, 0, 300, 300);
    cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(150, 150, 90, 0, 7); cx.fill();
  });
  _vecP.inv = 1; _vecProcess();
  out.invFaces = _vec.out ? _vec.out.layers[0].faces.length : 0;
  _vecP.inv = 0;

  // ── 4) Farbflächen: drei Farbklötze auf weißem Grund ──
  _vec.img = await mkImg(360, 240, cx => {
    cx.fillStyle = '#d02020'; cx.fillRect(20, 40, 90, 160);
    cx.fillStyle = '#2050d0'; cx.fillRect(135, 40, 90, 160);
    cx.fillStyle = '#20a040'; cx.fillRect(250, 40, 90, 160);
  });
  Object.assign(_vecP, { mode: 1, ncol: 4, bg: 1 });
  _vecProcess();
  out.colLayers = _vec.out ? _vec.out.layers.map(L => L.color) : null;
  // groß nach klein sortiert?
  out.colSorted = _vec.out ? _vec.out.layers.every((L, i, a) => i === 0 || a[i - 1].w >= L.w) : false;

  // ── 5) In die Szene: Silhouette extrudieren ──
  _vecP.mode = 0; _vec.img = await mkImg(300, 300, cx => {
    cx.fillStyle = '#000'; cx.beginPath(); cx.arc(150, 150, 100, 0, 7); cx.fill();
  });
  _vecProcess();
  const before = objects.length;
  _vecToScene();
  await new Promise(r => setTimeout(r, 400));
  out.sceneAdded = objects.length - before;
  if (objects.length > before) {
    // Welt-Maße: 1 Einheit = 10 mm → 100 mm Motiv = 10 Einheiten, 3 mm dick = 0,3
    const b = new THREE.Box3().setFromObject(objects[objects.length - 1]);
    out.sceneMM = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +(v * 10).toFixed(1));
  }
  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const ok =
  res.ring && res.ring.layers === 1 && res.ring.faces === 1 && res.ring.holes === 1 &&
  res.svgHasMM && res.svgEvenOdd && res.svgSubpaths === 2 && Math.abs(res.svgH - 100) < 1 &&
  res.spanTop > 0 && res.spanBottom > res.spanTop * 3 &&
  res.invFaces === 1 &&
  res.colLayers && res.colLayers.length === 3 && res.colSorted &&
  res.sceneAdded === 1 && Math.abs(res.sceneMM[0] - 100) < 2 && Math.abs(res.sceneMM[1] - 3) < 0.3;

console.log(ok ? '\n✅ Bild → SVG: alle Prüfungen bestanden' : '\n❌ Bild → SVG: Prüfung fehlgeschlagen');

await browser.close();
srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
