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

  // ── 1b) „Außenrand": derselbe Ring, aber Innenfläche zu → 1 Fläche, 0 Löcher ──
  _vecP.mode = 1; _vecProcess();
  const oa = _vec.out;
  out.outer = oa ? { faces: oa.layers[0].faces.length, holes: oa.layers[0].faces[0].holes.length } : null;
  const svgA = _vecSvgText();
  out.outerSubpaths = svgA ? (svgA.match(/M/g) || []).length : 0;

  // Strichzeichnung (Ring aus dünner Linie, wie nachgezeichnete Kontur):
  // „Nachzeichnen" ergibt den schmalen Ring, „Außenrand" die volle Scheibe.
  _vec.img = await mkImg(300, 300, cx => {
    cx.strokeStyle = '#000'; cx.lineWidth = 6;
    cx.beginPath(); cx.arc(150, 150, 100, 0, 7); cx.stroke();
  });
  _vecP.mode = 0; _vecProcess();
  const oL = _vec.out;
  out.lineTrace = { faces: oL.layers[0].faces.length, holes: oL.layers[0].faces[0].holes.length };
  _vecP.mode = 1; _vecProcess();
  const oF = _vec.out;
  out.lineFilled = { faces: oF.layers[0].faces.length, holes: oF.layers[0].faces[0].holes.length };
  _vecP.mode = 0;

  // ── 1c) Löcher müssen den Weg durch den SVGLoader in den Topper überstehen ──
  _vec.img = await mkImg(300, 300, cx => {
    cx.fillStyle = '#000'; cx.beginPath(); cx.arc(150, 150, 110, 0, 7); cx.fill();
    cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(150, 150, 45, 0, 7); cx.fill();
  });
  _vecProcess();
  _ttSetMotif(_vecSvgText(), 'Ring');
  out.motifHoles = _ttMotif ? { polys: _ttMotif.polys.length, holes: _ttMotif.polys.map(p => p.holes.length) } : null;
  _ttMotifClear();

  // ── 1d) Ausschnitt: zwei Klötze nebeneinander, nur der linke wird gewählt ──
  _vec.img = await mkImg(400, 200, cx => {
    cx.fillStyle = '#000';
    cx.fillRect(30, 50, 100, 100);          // links
    cx.fillRect(270, 50, 100, 100);         // rechts
  });
  _vecP.crop = null; _vecProcess();
  out.cropOff = { faces: _vec.out.layers[0].faces.length };
  _vecP.crop = { x: 0, y: 0, w: 0.5, h: 1 };   // linke Bildhälfte
  _vecProcess();
  out.cropOn = { faces: _vec.out.layers[0].faces.length };
  // Der Ausschnitt darf die mm-Maße nicht verfälschen: Klotz ist quadratisch
  out.cropSquare = Math.abs(_vec.out.bb.w - _vec.out.bb.h) / _vec.out.bb.w < 0.05;
  _vecP.crop = null;

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
  Object.assign(_vecP, { mode: 2, ncol: 4, bg: 1 });
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

// ── Rahmen mit der echten Maus aufziehen (Bedienung, nicht nur Rechnung) ──
const drag = await page.evaluate(async () => {
  const cv = document.createElement('canvas'); cv.width = 400; cv.height = 200;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 400, 200);
  cx.fillStyle = '#000'; cx.fillRect(30, 50, 100, 100); cx.fillRect(270, 50, 100, 100);
  await new Promise((r, j) => { const im = new Image(); im.onload = () => { _vec.img = im; r(); }; im.onerror = j; im.src = cv.toDataURL(); });
  _vecP.crop = null; _vecP.mode = 0;
  if (typeof hideStarter === 'function') hideStarter();   // Startgalerie liegt sonst darüber
  _vecOpen(); _vecFitCanvas();
  const c = document.getElementById('vec-canvas');
  return { w: c.width, h: c.height, aspectOk: Math.abs(c.width / c.height - 2) < 0.05 };
});
await page.waitForTimeout(300);
await page.click('#vec-sel-btn');
const box = await page.locator('#vec-canvas').boundingBox();
await page.mouse.move(box.x + box.width * 0.03, box.y + box.height * 0.10);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.90, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(500);
const afterDrag = await page.evaluate(() => ({
  crop: _vecP.crop ? { x: +_vecP.crop.x.toFixed(2), w: +_vecP.crop.w.toFixed(2) } : null,
  selOff: _vecSel === false,
  clrShown: document.getElementById('vec-sel-clr').style.display !== 'none',
  faces: _vec.out ? _vec.out.layers[0].faces.length : -1,
  info: document.getElementById('vec-info').textContent.startsWith('Ausschnitt'),
}));
const afterClear = await page.evaluate(() => { _vecCropClear(); return null; });
await page.waitForTimeout(400);
const cleared = await page.evaluate(() => ({
  crop: _vecP.crop,
  faces: _vec.out ? _vec.out.layers[0].faces.length : -1,
  clrHidden: document.getElementById('vec-sel-clr').style.display === 'none',
}));
res.canvas = drag;
res.drag = afterDrag;
res.cleared = cleared;

// ── Einfügen aus der Zwischenablage (Strg+V bei offenem Fenster) ──
res.paste = await page.evaluate(async () => {
  _vec.img = null; _vec.out = null; _vec.name = 'alt';
  _vecOpen();
  // Screenshot-artiges PNG bauen und als Zwischenablage-Ereignis schicken
  const cv = document.createElement('canvas'); cv.width = 240; cv.height = 240;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 240, 240);
  cx.fillStyle = '#000'; cx.beginPath(); cx.arc(120, 120, 80, 0, 7); cx.fill();
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 600));
  return {
    gotImage: !!_vec.img && _vec.img.width === 240,
    name: _vec.name,
    faces: _vec.out ? _vec.out.layers[0].faces.length : -1,
    btn: !!document.querySelector('[onclick="_vecPasteBtn()"]'),
    saveOn: !document.getElementById('vec-save-btn').disabled,
  };
});
// ── Falsches Bild wieder loswerden ──
res.clearImg = await page.evaluate(async () => {
  const had = !!_vec.img && !!_vec.out;
  _vecP.crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };   // auch ein Ausschnitt muss weg
  _vecSelSyncUI();
  _vecClearImage();
  await new Promise(r => setTimeout(r, 400));        // ein noch laufender Lauf darf nichts zurückholen
  return {
    had,
    img: _vec.img, out: _vec.out, crop: _vecP.crop, name: _vec.name,
    btnHidden: document.getElementById('vec-img-clr').style.display === 'none',
    cropBtnHidden: document.getElementById('vec-sel-clr').style.display === 'none',
    saveOff: document.getElementById('vec-save-btn').disabled
          && document.getElementById('vec-scene-btn').disabled
          && document.getElementById('vec-topper-btn').disabled,
    dropReset: document.getElementById('vec-drop').textContent.indexOf('Bild wählen') >= 0,
    info: document.getElementById('vec-info').textContent.indexOf('Noch kein Bild') >= 0,
  };
});
// Danach muss ein neues Bild wieder normal ankommen
res.afterClear = await page.evaluate(async () => {
  _vecOpen();
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 200, 200);
  cx.fillStyle = '#000'; cx.beginPath(); cx.arc(100, 100, 70, 0, 7); cx.fill();
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 's.png', { type: 'image/png' }));
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 600));
  return {
    faces: _vec.out ? _vec.out.layers[0].faces.length : -1,
    btnShown: document.getElementById('vec-img-clr').style.display !== 'none',
    saveOn: !document.getElementById('vec-save-btn').disabled,
  };
});

// Paste außerhalb des Fensters darf nichts anfassen
res.pasteClosed = await page.evaluate(async () => {
  _vecClose();
  const before = _vec.img && _vec.img.width;
  const cv = document.createElement('canvas'); cv.width = 80; cv.height = 80;
  cv.getContext('2d').fillRect(0, 0, 80, 80);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'x.png', { type: 'image/png' }));
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 400));
  return { unchanged: (_vec.img && _vec.img.width) === before };
});

console.log(JSON.stringify(res, null, 2));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const ok =
  res.ring && res.ring.layers === 1 && res.ring.faces === 1 && res.ring.holes === 1 &&
  res.svgHasMM && res.svgEvenOdd && res.svgSubpaths === 2 && Math.abs(res.svgH - 100) < 1 &&
  // Außenrand macht das Loch zu: eine Fläche, ein Subpfad
  res.outer && res.outer.faces === 1 && res.outer.holes === 0 && res.outerSubpaths === 1 &&
  res.lineTrace.holes === 1 && res.lineFilled.holes === 0 &&
  // Loch überlebt SVG-Text → SVGLoader → Topper-Motiv
  res.motifHoles && res.motifHoles.polys === 1 && res.motifHoles.holes[0] === 1 &&
  res.spanTop > 0 && res.spanBottom > res.spanTop * 3 &&
  res.invFaces === 1 &&
  res.colLayers && res.colLayers.length === 3 && res.colSorted &&
  res.sceneAdded === 1 && Math.abs(res.sceneMM[0] - 100) < 2 && Math.abs(res.sceneMM[1] - 3) < 0.3 &&
  // Ausschnitt rechnerisch: 2 Klötze → 1 Klotz, Seitenverhältnis bleibt heil
  res.cropOff.faces === 2 && res.cropOn.faces === 1 && res.cropSquare &&
  // Ausschnitt per Maus: Leinwand im Bild-Seitenverhältnis, Rahmen sitzt links,
  // Auswahl-Modus schaltet sich ab, nur noch ein Klotz erfasst
  res.canvas.aspectOk &&
  res.drag.crop && res.drag.crop.x < 0.1 && Math.abs(res.drag.crop.w - 0.42) < 0.08 &&
  res.drag.selOff && res.drag.clrShown && res.drag.faces === 1 && res.drag.info &&
  // Aufheben → wieder ganzes Bild
  res.cleared.crop === null && res.cleared.faces === 2 && res.cleared.clrHidden &&
  // Zwischenablage: Strg+V bei offenem Fenster übernimmt das Bild und rechnet los
  res.paste.gotImage && res.paste.name === 'zwischenablage' && res.paste.faces === 1 &&
  res.paste.btn && res.paste.saveOn &&
  // ✕ wirft Bild, Ergebnis, Ausschnitt und die Knopf-Freigaben zurück auf Anfang
  res.clearImg.had && res.clearImg.img === null && res.clearImg.out === null &&
  res.clearImg.crop === null && res.clearImg.name === 'motiv' &&
  res.clearImg.btnHidden && res.clearImg.cropBtnHidden && res.clearImg.saveOff &&
  res.clearImg.dropReset && res.clearImg.info &&
  // und danach geht es normal weiter
  res.afterClear.faces === 1 && res.afterClear.btnShown && res.afterClear.saveOn &&
  res.pasteClosed.unchanged;

console.log(ok ? '\n✅ Bild → SVG: alle Prüfungen bestanden' : '\n❌ Bild → SVG: Prüfung fehlgeschlagen');

await browser.close();
srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
