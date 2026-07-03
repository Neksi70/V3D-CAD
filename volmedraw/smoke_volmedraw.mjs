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
    'clearSelection', 'saveProject', 'applyProjectData', 'setDocSize', 'applyFont', 'tryRestoreAutosave'];
  const out = {}; for (const n of names) out[n] = typeof window[n]; return out;
});
const fabricLoaded = await page.evaluate(() => typeof window.fabric);
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
console.log('Menues:        ', menuCount, ' Palette:', paletteCount);
console.log('Globals fehlen:', Object.entries(globals).filter(([, t]) => t !== 'function').map(([n]) => n).join(', ') || '(keine)');
console.log('Ebenen:', layerCount, ' Verlauf:', histCount);
console.log('mm-Doc ok:', docOk, ' Zuschnitt ok:', clipOk, ' Schrift ok:', fontOk);
console.log('opentype:', otLoaded, ' Text→Pfade ok:', t2pOk);
console.log('Speichern ok:', saveOk, ' Laden-Roundtrip ok:', loadOk, ' SVG ok:', svgOk);
console.log('Fehler:', errors.length);
for (const e of errors) console.log('   •', e.slice(0, 180));

const allFns = Object.values(globals).every(t => t === 'function');
const ok = allFns && fabricLoaded === 'object' && menuCount >= 6 && paletteCount >= 8 && layerCount >= 2 &&
  histCount >= 2 && docOk && clipOk && fontOk && otLoaded === 'object' && t2pOk && saveOk && loadOk && svgOk && errors.length === 0;
console.log('\n=> Smoke:', ok ? 'BESTANDEN ✓' : 'FEHLGESCHLAGEN ✗');
process.exit(ok ? 0 : 1);
