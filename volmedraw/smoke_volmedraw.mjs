// Smoke-Test Volme Draw (Paint.NET-Oberflaeche, Vektor-Kern).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8798;
const srv = spawn('python3', ['volme3d_server.py', String(PORT)], { cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 900));

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('dialog', d => d.dismiss().catch(() => {}));
// Onboarding-Overlay vorab abschalten, damit es die Klicks nicht blockiert
await page.addInitScript(() => { try { localStorage.setItem('volmedraw:onboarded', '1'); } catch (e) {} });

let served = '?';
try {
  const resp = await page.goto(`http://localhost:${PORT}/volmedraw/volmedraw.html`, { waitUntil: 'load', timeout: 20000 });
  served = resp.status();
  await page.waitForTimeout(1500);
} catch (e) { errors.push('GOTO: ' + e.message); }

const globals = await page.evaluate(() => {
  const names = ['setTool', 'zoomFit', 'align', 'distribute', 'groupSel', 'ungroupSel',
    'doDuplicate', 'doPaste', 'makeMask', 'unmask', 'clipToSelection', 'buildGenerated',
    'refreshLayers', 'refreshMeasures', 'buildMenus', 'buildPalette', 'exportSVG', 'restoreIndex',
    'clearSelection', 'saveProject', 'applyProjectData', 'setDocSize', 'applyFont', 'tryRestoreAutosave',
    'objToPolys', 'polysToPath', 'applyOffset', 'openOffsetModal', 'combineShapes', 'applyReplicate', 'openRepModal',
    'setLineStyle', 'applyRegMarks', 'clearRegMarks', 'applyTextOnCurve', 'openCurveModal', 'openRegModal'];
  const out = {}; for (const n of names) out[n] = typeof window[n]; return out;
});
const fabricLoaded = await page.evaluate(() => typeof window.fabric);
const uxOk = await page.evaluate(() => {
  const obHidden = document.getElementById('onboarding').classList.contains('hidden');
  toast('Test ✓');
  const hasToast = document.querySelectorAll('#toast-wrap .toast').length >= 1;
  showOnboarding(); const shown = !document.getElementById('onboarding').classList.contains('hidden');
  document.getElementById('onboarding').classList.add('hidden');
  return obHidden && hasToast && shown;
});
const menuCount = await page.evaluate(() => document.querySelectorAll('#menus .menu-title').length);
const paletteCount = await page.evaluate(() => document.querySelectorAll('#palette .pc').length);

const box = await page.locator('canvas.upper-canvas').boundingBox();
async function tool(t) { await page.evaluate(n => setTool(n), t); }
async function drag(x0, y0, x1, y1) {
  await page.mouse.move(box.x + x0, box.y + y0); await page.mouse.down();
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(120);
}

await tool('rect'); await drag(120, 100, 300, 240);
await tool('polygon'); await drag(360, 120, 500, 260);

// Auswahl-Maske ziehen, dann Pinselstrich hinein
await tool('sel-rect'); await drag(140, 130, 280, 220);
await tool('brush'); await drag(150, 150, 260, 200);
await page.keyboard.press('Escape');

const layerCount = await page.evaluate(() => document.querySelectorAll('#layers li').length);
const histCount = await page.evaluate(() => document.querySelectorAll('#history li').length);

// mm-Dokumentgroesse (A4 hoch = 210x297 mm bei 4 px/mm -> 840x1188 px)
const docOk = await page.evaluate(() => { setDocSize(210, 297); return canvas.getWidth() === 840 && canvas.getHeight() === 1188; });

// Auf Auswahl zuschneiden (runde Maske)
await tool('select'); await page.keyboard.press('Control+a'); await tool('sel-ellipse'); await drag(150, 150, 320, 300);
const clipOk = await page.evaluate(() => { clipToSelection(); return !!canvas.getObjects().find(o => o.clipPath); });

// Schrift auf Text anwenden
const fontOk = await page.evaluate(() => {
  const t = new fabric.IText('Hallo', { left: 100, top: 400, fontFamily: 'Arial' });
  canvas.add(t); canvas.setActiveObject(t);
  document.getElementById('font-family').value = 'Georgia';
  document.getElementById('font-family').dispatchEvent(new Event('change'));
  return t.fontFamily === 'Georgia';
});

// opentype + Text -> Pfade (Laser-Schrift, async geladen -> pollen)
const otLoaded = await page.evaluate(() => typeof window.opentype);
let t2pOk = false;
for (let i = 0; i < 8 && !t2pOk; i++) {
  t2pOk = await page.evaluate(() => {
    if (typeof opentype === 'undefined') return false;
    const t = new fabric.IText('Volme', { left: 120, top: 500, fontFamily: 'Poppins', fontSize: 60 });
    canvas.add(t); canvas.setActiveObject(t);
    textToPath();
    const ok = !!canvas.getObjects().find(o => o.type === 'path' && o.vType === 'textpath');
    if (!ok) canvas.remove(t);
    return ok;
  });
  if (!t2pOk) await page.waitForTimeout(500);
}

// Foto -> Vektor (ImageTracer) + Bildfilter
const itLoaded = await page.evaluate(() => typeof window.ImageTracer);
const traceOk = await page.evaluate(() => new Promise(res => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140"><rect width="140" height="140" fill="white"/><circle cx="70" cy="70" r="45" fill="black"/></svg>';
  const url = 'data:image/svg+xml;base64,' + btoa(svg);
  fabric.Image.fromURL(url, img => {
    img.set({ left: 60, top: 60 }); canvas.add(img); canvas.setActiveObject(img);
    img.vFx = { thresholdOn: true, threshold: 128 }; rebuildFilters(img);
    try { tracePhoto(); } catch (e) { return res(false); }
    setTimeout(() => res(!!canvas.getObjects().find(o => o.vType === 'trace')), 1000);
  });
}));

// Laser-Aufgabe (Schnitt/Gravur = Farbe fuer LightBurn-Ebenen)
const laserOk = await page.evaluate(() => {
  const r = new fabric.Rect({ left: 30, top: 30, width: 40, height: 40, fill: '#00ff00' });
  canvas.add(r); canvas.setActiveObject(r);
  setLaserMode('cut'); const cutOk = r.stroke === '#ff0000' && !r.fill && r.vLaser === 'cut';
  setLaserMode('engrave'); const engOk = r.fill === '#000000' && r.vLaser === 'engrave';
  return cutOk && engOk;
});

// clipper-lib + Offset/Kontur (Rechteck 80x60 um 4mm nach aussen -> groesser, vLaser=cut)
const clipperLoaded = await page.evaluate(() => typeof window.ClipperLib);
const offsetOk = await page.evaluate(() => {
  const r = new fabric.Rect({ left: 60, top: 60, width: 80, height: 60, fill: '#ff0000' });
  canvas.add(r); canvas.setActiveObject(r);
  document.getElementById('off-dist').value = '4';
  document.getElementById('off-dir').value = 'out';
  document.getElementById('off-join').value = 'round';
  const before = canvas.getObjects().length;
  applyOffset();
  const c = canvas.getObjects().find(o => o.vType === 'offset');
  return !!c && canvas.getObjects().length === before + 1 && c.vLaser === 'cut' && c.getScaledWidth() > 80;
});

// Boolean: zwei ueberlappende Rechtecke verschweissen -> ein 'bool'-Pfad, Anzahl -1
const boolOk = await page.evaluate(() => {
  const a = new fabric.Rect({ left: 300, top: 300, width: 80, height: 80, fill: '#00aa00' });
  const b = new fabric.Rect({ left: 340, top: 340, width: 80, height: 80, fill: '#00aa00' });
  canvas.add(a); canvas.add(b);
  canvas.setActiveObject(new fabric.ActiveSelection([a, b], { canvas }));
  const before = canvas.getObjects().length;
  combineShapes('union');
  const res = canvas.getObjects().find(o => o.vType === 'bool');
  return !!res && canvas.getObjects().length === before - 1;
});

// Boolean: Abziehen (oberste weg) ergibt Ergebnis-Pfad
const diffOk = await page.evaluate(() => {
  const a = new fabric.Rect({ left: 500, top: 60, width: 90, height: 90, fill: '#883399' });
  const b = new fabric.Ellipse({ left: 540, top: 100, rx: 30, ry: 30, fill: '#883399' });
  canvas.add(a); canvas.add(b);
  canvas.setActiveObject(new fabric.ActiveSelection([a, b], { canvas }));
  combineShapes('diff');
  return !!canvas.getObjects().find(o => o.vType === 'bool');
});

// Replizieren: 2x2-Raster aus 1 Rechteck -> +3 Klone (async clone)
const repOk = await page.evaluate(() => new Promise(res => {
  const r = new fabric.Rect({ left: 650, top: 400, width: 30, height: 30, fill: '#0000aa' });
  canvas.add(r); canvas.setActiveObject(r);
  document.getElementById('rep-cols').value = '2';
  document.getElementById('rep-rows').value = '2';
  document.getElementById('rep-gx').value = '2';
  document.getElementById('rep-gy').value = '2';
  document.getElementById('rep-mirror').value = 'none';
  const before = canvas.getObjects().length;
  applyReplicate();
  setTimeout(() => res(canvas.getObjects().length === before + 3), 500);
}));

// Linienstil (Perf-Cut) -> strokeDashArray + vDash
const lineStyleOk = await page.evaluate(() => {
  const r = new fabric.Rect({ left: 60, top: 460, width: 60, height: 40, fill: null, stroke: '#f00', strokeWidth: 2 });
  canvas.add(r); canvas.setActiveObject(r);
  setLineStyle('perf');
  return Array.isArray(r.strokeDashArray) && r.strokeDashArray.length === 2 && r.vDash === 'perf';
});

// Passermarken (Print & Cut) setzen + entfernen
const regOk = await page.evaluate(() => {
  document.getElementById('reg-margin').value = '5'; document.getElementById('reg-size').value = '8'; document.getElementById('reg-thick').value = '1.2';
  applyRegMarks();
  const has = canvas.getObjects().some(o => o.vType === 'regmark');
  clearRegMarks();
  const gone = !canvas.getObjects().some(o => o.vType === 'regmark');
  return has && gone;
});

// Text auf Kurve (opentype Laser-Schrift -> curvetext-Pfad); Font async -> pollen
let curveOk = false;
for (let i = 0; i < 8 && !curveOk; i++) {
  curveOk = await page.evaluate(() => {
    if (typeof LOADED_FONTS === 'undefined' || !LOADED_FONTS['Poppins']) return false;
    const t = new fabric.IText('BADGE', { left: 250, top: 150, fontFamily: 'Poppins', fontSize: 40, fill: '#000' });
    const c = new fabric.Ellipse({ left: 200, top: 150, rx: 80, ry: 80, fill: '#eeeeee' });
    canvas.add(c); canvas.add(t);
    canvas.setActiveObject(new fabric.ActiveSelection([t, c], { canvas }));
    document.getElementById('curve-side').value = 'top';
    applyTextOnCurve();
    const p = canvas.getObjects().find(o => o.vType === 'curvetext');
    if (!p) { canvas.remove(t); canvas.remove(c); }
    return !!p && p.type === 'path';
  });
  if (!curveOk) await page.waitForTimeout(500);
}

// Pinch-Zoom (zwei synthetische Touch-Punkte auseinanderziehen -> Zoom rein)
const pinchOk = await page.evaluate(() => {
  if (typeof TouchEvent === 'undefined' || typeof Touch === 'undefined') return 'skip';
  const el = canvas.upperCanvasEl, r = el.getBoundingClientRect();
  const mk = (id, x, y) => new Touch({ identifier: id, target: el, clientX: x, clientY: y });
  const opt = ts => ({ touches: ts, targetTouches: ts, changedTouches: ts, bubbles: true, cancelable: true });
  const z0 = canvas.getZoom();
  el.dispatchEvent(new TouchEvent('touchstart', opt([mk(1, r.left + 120, r.top + 120), mk(2, r.left + 200, r.top + 120)])));
  el.dispatchEvent(new TouchEvent('touchmove', opt([mk(1, r.left + 80, r.top + 120), mk(2, r.left + 260, r.top + 120)])));
  const z1 = canvas.getZoom();
  el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [], bubbles: true, cancelable: true }));
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  return z1 > z0 * 1.5;
});

// Projekt speichern (Strg+S -> Download .vdraw)
let saveOk = false;
try {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), page.keyboard.press('Control+s')]);
  const s = await dl.createReadStream(); let t = ''; for await (const c of s) t += c;
  const d = JSON.parse(t); saveOk = d.app === 'volmedraw' && d.docWmm === 210 && d.objects && Array.isArray(d.objects.objects);
} catch (e) { errors.push('SAVE: ' + e.message); }

// Projekt-Roundtrip: Daten neu einspielen
const loadOk = await page.evaluate(() => new Promise(res => {
  const before = canvas.getObjects().length;
  const data = { app: 'volmedraw', v: 1, docWmm: 150, docHmm: 100, bg: '#ffffff', objects: canvas.toJSON(['vName', 'vType']) };
  applyProjectData(data, 'Test');
  setTimeout(() => res(docWmmGetter() === 150 && canvas.getObjects().length === before), 400);
  function docWmmGetter() { return canvas.getWidth() / 4; }
}));

// SVG-Export (mm, kein Hintergrund)
let svgOk = false;
try {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), page.click('#q-svg')]);
  const s = await dl.createReadStream(); let t = ''; for await (const c of s) t += c;
  svgOk = t.includes('<svg') && t.includes('150mm');
} catch (e) { errors.push('SVG: ' + e.message); }

await browser.close(); srv.kill();

console.log('HTTP:          ', served, ' fabric:', fabricLoaded);
console.log('Menues:        ', menuCount, ' Palette:', paletteCount, ' Onboarding/Toast ok:', uxOk);
console.log('Globals fehlen:', Object.entries(globals).filter(([, t]) => t !== 'function').map(([n]) => n).join(', ') || '(keine)');
console.log('Ebenen:', layerCount, ' Verlauf:', histCount);
console.log('mm-Doc ok:', docOk, ' Zuschnitt ok:', clipOk, ' Schrift ok:', fontOk);
console.log('opentype:', otLoaded, ' Text→Pfade ok:', t2pOk);
console.log('ImageTracer:', itLoaded, ' Foto→Vektor ok:', traceOk, ' Laser-Aufgabe ok:', laserOk);
console.log('ClipperLib:', clipperLoaded, ' Offset ok:', offsetOk, ' Boolean ok:', boolOk, ' Abziehen ok:', diffOk, ' Replizieren ok:', repOk);
console.log('Linienstil ok:', lineStyleOk, ' Passermarken ok:', regOk, ' Text auf Kurve ok:', curveOk);
console.log('Pinch-Zoom ok:', pinchOk);
console.log('Speichern ok:', saveOk, ' Laden-Roundtrip ok:', loadOk, ' SVG ok:', svgOk);
console.log('Fehler:', errors.length);
for (const e of errors) console.log('   •', e.slice(0, 180));

const allFns = Object.values(globals).every(t => t === 'function');
const ok = allFns && uxOk && fabricLoaded === 'object' && menuCount >= 6 && paletteCount >= 8 && layerCount >= 2 &&
  histCount >= 2 && docOk && clipOk && fontOk && otLoaded === 'object' && t2pOk &&
  itLoaded === 'object' && traceOk && laserOk && (pinchOk === true || pinchOk === 'skip') && saveOk && loadOk && svgOk &&
  clipperLoaded === 'object' && offsetOk && boolOk && diffOk && repOk &&
  lineStyleOk && regOk && curveOk && errors.length === 0;
console.log('\n=> Smoke:', ok ? 'BESTANDEN ✓' : 'FEHLGESCHLAGEN ✗');
process.exit(ok ? 0 : 1);
