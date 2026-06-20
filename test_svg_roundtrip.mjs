// Round-Trip-Test für den SVG-Rebuild: importiert eine SVG, serialisiert sie
// (objectToData → nur Pfaddaten, kein Mesh) und baut sie wieder (buildObjectFromData).
// Prüft: Geometrie identisch (BBox + Vertexzahl) und gespeicherte Daten klein.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8791;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));

await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0,0 L40,0 L40,40 L0,40 Z M10,10 L30,10 L30,30 L10,30 Z" fill="black"/></svg>';

const res = await page.evaluate((svgText) => {
  const bbox = g => { g.computeBoundingBox(); const b=g.boundingBox; return [b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z].map(v=>Math.round(v*1000)/1000); };
  if (typeof _importSvgConfirm !== 'function') return { err: '_importSvgConfirm fehlt' };
  const before = objects.length;
  _importSvgConfirm({ svgText, mode:'extrude', depthMM:3, targetMM:50, name:'RT' });
  if (objects.length <= before) return { err: 'kein SVG-Objekt erzeugt' };
  const o = objects[objects.length-1];
  const origBox = bbox(o.geometry);
  const origCount = o.geometry.attributes.position.count;

  const d = objectToData(o);
  const hasGeom = !!d.geometry;
  const hasPaths = !!d._svgPathData;
  const dataKB = Math.round(JSON.stringify(d).length/1024);
  // Vergleichsgröße: wie groß WÄRE es mit gebackenem Mesh?
  const bakedKB = Math.round(JSON.stringify(o.geometry.toJSON()).length/1024);

  const o2 = buildObjectFromData(d);
  if (!o2 || !o2.geometry) return { err: 'Rebuild lieferte kein Mesh' };
  const newBox = bbox(o2.geometry);
  const newCount = o2.geometry.attributes.position.count;

  const boxDiff = Math.max(...origBox.map((v,i)=>Math.abs(v-newBox[i])));
  return { hasGeom, hasPaths, dataKB, bakedKB, origCount, newCount,
           origBox, newBox, boxDiff,
           scaleOK: o2.scale.x>0 };
}, svg);

await browser.close();
srv.kill();

console.log(JSON.stringify(res, null, 2));
if (res.err) { console.log('✗', res.err); process.exit(1); }

const ok =
  res.hasPaths && !res.hasGeom &&            // gespeichert: Pfade, kein Mesh
  res.origCount === res.newCount &&          // gleiche Vertexzahl
  res.boxDiff < 0.01 &&                      // BBox identisch
  res.dataKB < res.bakedKB;                  // deutlich kleiner als gebacken
console.log(`\nGespeichert: ${res.dataKB} KB (gebacken wäre ${res.bakedKB} KB)`);
console.log(`Vertices: ${res.origCount} → ${res.newCount}, BBox-Abw.: ${res.boxDiff}`);
console.log(ok ? '\n✓ SVG-Round-Trip korrekt (kompakt gespeichert, Geometrie identisch)'
               : '\n✗ Round-Trip fehlerhaft');
for (const e of errs.slice(0,5)) console.log('  pageerror:', e.slice(0,140));
process.exit(ok ? 0 : 1);
