/**
 * Vollständiger SVG-Prägung-Test
 * 1. SVG parsen (Three.js SVGLoader via Playwright)
 * 2. POST an occt-server
 * 3. Ergebnis STL analysieren + rendern
 */
import { chromium }  from 'playwright';
import * as fs       from 'fs';
import * as path     from 'path';
import { execSync }  from 'child_process';
import * as https    from 'https';

const SVG_FILE = '/home/v3da/test-logo.svg';
const STL_FILE = '/home/v3da/test-flyer.stl';
const OUT_FILE = '/home/v3da/test-result.stl';
const SERVER   = 'https://127.0.0.1:3001';

// HTTPS-POST mit rejectUnauthorized:false (Self-signed / Tailscale cert)
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const data = Buffer.from(body, 'utf8');
    const req  = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname,
      method: 'POST',
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Schritt 1: STL BBox ────────────────────────────────────────────────────────
function readSTLBBox(file) {
  const buf   = fs.readFileSync(file);
  const nTri  = buf.readUInt32LE(80);
  let minX=Infinity, minY=Infinity, minZ=Infinity;
  let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  for (let i = 0; i < nTri; i++) {
    const off = 84 + i * 50;
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(off + 12 + v*12);
      const y = buf.readFloatLE(off + 16 + v*12);
      const z = buf.readFloatLE(off + 20 + v*12);
      if (x<minX)minX=x; if (x>maxX)maxX=x;
      if (y<minY)minY=y; if (y>maxY)maxY=y;
      if (z<minZ)minZ=z; if (z>maxZ)maxZ=z;
    }
  }
  return { nTri, bytes: buf.length, minX, maxX, minY, maxY, minZ, maxZ,
    cx: (minX+maxX)/2, cy: (minY+maxY)/2, cz: (minZ+maxZ)/2 };
}

// ── Schritt 2: SVG parsen via Playwright (Three.js SVGLoader) ─────────────────
async function parseSvgWithThreeJs(svgFile) {
  const svgText = fs.readFileSync(svgFile, 'utf8');
  const browser = await chromium.launch({
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  // Minimal-HTML mit Three.js SVGLoader
  await page.setContent(`<!DOCTYPE html><html><head>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/SVGLoader.js"></script>
  </head><body></body></html>`);
  await page.waitForFunction(() => window.THREE && THREE.SVGLoader, { timeout: 15000 });

  const result = await page.evaluate((svgText) => {
    const loader = new THREE.SVGLoader();
    let data;
    try { data = loader.parse(svgText); } catch(e) { return { error: e.message }; }
    const paths = data.paths;
    if (!paths?.length) return { error: 'keine Pfade' };

    // Alle Shapes + Holes sammeln
    const allShapes = [];
    for (const path of paths) {
      const shapes = THREE.SVGLoader.createShapes
        ? THREE.SVGLoader.createShapes(path)
        : path.toShapes(true);
      for (const s of shapes) allShapes.push(s);
    }

    // BBox der SVG-Koordinaten
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for (const s of allShapes) {
      for (const p of s.getPoints(8)) {
        if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
        if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y;
      }
    }
    const svgW = maxX - minX, svgH = maxY - minY;
    const targetMM = 80; // Logo 80mm breit
    const scale  = targetMM / Math.max(svgW, svgH);
    const cx     = (minX + maxX) / 2;
    const cy     = (minY + maxY) / 2;
    const normF  = 2 / targetMM;
    const depthMM = 3;

    // _svgPathData extrahieren (gleicher Code wie _importSvgConfirm)
    const svgPathData = allShapes.map(shape => ({
      pts:   shape.getPoints(12).map(p => [p.x, p.y]),
      holes: (shape.holes||[]).map(h => h.getPoints(12).map(p => [p.x, p.y]))
    }));

    return {
      shapeCount: allShapes.length,
      svgW: +svgW.toFixed(2), svgH: +svgH.toFixed(2),
      scale: +scale.toFixed(6), cx: +cx.toFixed(4), cy: +cy.toFixed(4),
      normF: +normF.toFixed(6), depthMM, targetMM,
      svgPathData
    };
  }, svgText);

  await browser.close();
  return result;
}

// ── Schritt 3a: Zentroid der Frontfläche (Dreiecke nahe maxZ) berechnen ────────
function findFrontFaceCentroid(stlFile) {
  const buf  = fs.readFileSync(stlFile);
  const nTri = buf.readUInt32LE(80);
  const maxZ = (() => {
    let m = -Infinity;
    for (let i = 0; i < nTri; i++) {
      const off = 84 + i * 50;
      for (let v = 0; v < 3; v++) m = Math.max(m, buf.readFloatLE(off+20+v*12));
    }
    return m;
  })();
  // Dreiecke deren ALLE Eckpunkte nahe maxZ sind (±2mm)
  let xs = [], ys = [];
  for (let i = 0; i < nTri; i++) {
    const off = 84 + i * 50;
    const pts = [];
    for (let v = 0; v < 3; v++) pts.push([
      buf.readFloatLE(off+12+v*12), buf.readFloatLE(off+16+v*12), buf.readFloatLE(off+20+v*12)
    ]);
    if (pts.every(p => Math.abs(p[2]-maxZ) < 2)) {
      pts.forEach(p => { xs.push(p[0]); ys.push(p[1]); });
    }
  }
  const cx = xs.length ? xs.reduce((a,b)=>a+b)/xs.length : null;
  const cy = ys.length ? ys.reduce((a,b)=>a+b)/ys.length : null;
  return { cx, cy, maxZ };
}

// ── Schritt 3: matrixWorld für Frontfläche (Z-normal, mm-Koordinaten) ─────────
function buildFrontFaceMatrix(stlBBox, svgSize, frontFace) {
  // Platzierung: Zentroid der Frontfläche (triangles nahe maxZ)
  // Local Y → World -Z (Extrusion ins Solid hinein)
  // Local X → World  X (horizontal)
  // Local Z → World  Y (vertikal, "oben")
  // Skalierung: 2 lokale Einheiten = svgSize mm → Faktor = svgSize/2
  const S   = svgSize / 2;  // scale factor: local unit → mm
  const posX = frontFace?.cx ?? stlBBox.cx;
  const posY = frontFace?.cy ?? stlBBox.cy;
  const posZ = stlBBox.maxZ;

  // Three.js Matrix4 (column-major, 16 elements)
  // Col 0: local X → world X  scaled by S
  // Col 1: local Y → world -Z scaled by S  (extrusion INTO solid)
  // Col 2: local Z → world  Y scaled by S  (up)
  // Col 3: position (px, py, pz, 1)
  return [
    S, 0, 0, 0,   // col 0
    0, 0,-S, 0,   // col 1  (local Y → world -Z)
    0, S, 0, 0,   // col 2  (local Z → world  Y)
    posX, posY, posZ, 1  // col 3: position
  ];
}

// ── Schritt 4: POST an Server ──────────────────────────────────────────────────
async function postToServer(stlFile, svgData, matrix) {
  const stlBuf    = fs.readFileSync(stlFile);
  const stlBase64 = stlBuf.toString('base64');

  const body = JSON.stringify({
    stlBase64,
    svgPathData:          svgData.svgPathData,
    svgTransformM:        {
      scale:   svgData.scale,
      cx:      svgData.cx,
      cy:      svgData.cy,
      depthMM: svgData.depthMM,
      svgSize: svgData.targetMM
    },
    svgHoleMatrixElements: matrix
  });

  console.log(`\n[POST] ${SERVER}/api/occt-subtract`);
  console.log(`       Body: ${(body.length/1024).toFixed(0)} KB`);

  const raw  = await httpsPost(`${SERVER}/api/occt-subtract`, body);
  return JSON.parse(raw);
}

// ── Schritt 5: BBox aus Buffer lesen ──────────────────────────────────────────
function bboxFromBuf(buf) {
  const nTri = buf.readUInt32LE(80);
  let minX=Infinity, minY=Infinity, minZ=Infinity;
  let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  for (let i = 0; i < nTri; i++) {
    const off = 84 + i * 50;
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(off + 12 + v*12);
      const y = buf.readFloatLE(off + 16 + v*12);
      const z = buf.readFloatLE(off + 20 + v*12);
      if(x<minX)minX=x; if(x>maxX)maxX=x;
      if(y<minY)minY=y; if(y>maxY)maxY=y;
      if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
    }
  }
  return { nTri, bytes: buf.length, minX, maxX, minY, maxY, minZ, maxZ };
}

// ── Schritt 6: Render mit Three.js (Playwright + Screenshot) ─────────────────
async function renderSTL(stlFile, screenshotPath) {
  const stlData = fs.readFileSync(stlFile);
  const stlB64  = stlData.toString('base64');

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...process.env, DISPLAY: ':0' }
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 900, height: 600 });

  const html = `<!DOCTYPE html><html><head>
  <style>body{margin:0;background:#1a1a2e}canvas{display:block}</style>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/STLLoader.js"></script>
  </head><body>
  <canvas id="c"></canvas>
  <script>
  const renderer = new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true});
  renderer.setSize(900,600); renderer.shadowMap.enabled=true;
  renderer.setPixelRatio(window.devicePixelRatio||1);

  const scene  = new THREE.Scene(); scene.background = new THREE.Color(0x1a1a2e);
  const camera = new THREE.PerspectiveCamera(35, 900/600, 0.1, 5000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(200, 300, 400); scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0x8888ff, 0.5);
  dl2.position.set(-200, -100, 200); scene.add(dl2);

  // STL als Base64 laden
  const b64 = "${stlB64}";
  const bytes = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
  const loader = new THREE.STLLoader();
  const geo = loader.parse(bytes.buffer);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const cx = (bb.min.x+bb.max.x)/2, cy = (bb.min.y+bb.max.y)/2, cz = (bb.min.z+bb.max.z)/2;
  const sz = Math.max(bb.max.x-bb.min.x, bb.max.y-bb.min.y, bb.max.z-bb.min.z);

  const mat = new THREE.MeshStandardMaterial({color:0x4488ff, roughness:0.3, metalness:0.1});
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(-cx, -cy, -cz);
  scene.add(mesh);

  // Kamera: schräg von vorne
  camera.position.set(sz*0.6, sz*0.3, sz*1.1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  window._done = true;
  </script></body></html>`;

  await page.setContent(html);
  await page.waitForFunction(() => window._done === true, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshotPath });
  await browser.close();
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  SVG-Prägung End-to-End Test');
  console.log('═══════════════════════════════════════════════\n');

  // 1. Input STL
  console.log('── 1. Input STL ────────────────────────────────');
  const stlBBox = readSTLBBox(STL_FILE);
  console.log(`   Datei:  ${STL_FILE}`);
  console.log(`   Größe:  ${stlBBox.bytes} Bytes | ${stlBBox.nTri} Dreiecke`);
  console.log(`   BBox X: ${stlBBox.minX.toFixed(1)} → ${stlBBox.maxX.toFixed(1)} mm`);
  console.log(`   BBox Y: ${stlBBox.minY.toFixed(1)} → ${stlBBox.maxY.toFixed(1)} mm`);
  console.log(`   BBox Z: ${stlBBox.minZ.toFixed(1)} → ${stlBBox.maxZ.toFixed(1)} mm`);
  console.log(`   Zentrum: (${stlBBox.cx.toFixed(1)}, ${stlBBox.cy.toFixed(1)}, ${stlBBox.cz.toFixed(1)})`);
  console.log(`   Front-Fläche (max Z): ${stlBBox.maxZ.toFixed(2)} mm`);

  // 2. SVG parsen
  console.log('\n── 2. SVG parsen (Three.js SVGLoader) ──────────');
  console.log(`   Datei: ${SVG_FILE}`);
  const svgData = await parseSvgWithThreeJs(SVG_FILE);
  if (svgData.error) { console.error('SVG Fehler:', svgData.error); process.exit(1); }
  console.log(`   Shapes: ${svgData.shapeCount}`);
  console.log(`   SVG-BBox: ${svgData.svgW} × ${svgData.svgH} SVG-Einheiten`);
  console.log(`   scale: ${svgData.scale} | cx: ${svgData.cx} | cy: ${svgData.cy}`);
  console.log(`   normF: ${svgData.normF} | depthMM: ${svgData.depthMM} | targetMM: ${svgData.targetMM}`);
  console.log(`   _svgPathData: ${svgData.svgPathData.length} Pfade`);
  svgData.svgPathData.forEach((p,i) => {
    console.log(`     Pfad ${i}: ${p.pts.length} Punkte, ${p.holes.length} Holes`);
  });

  // 3. Matrix — Frontflächen-Zentroid berechnen
  console.log('\n── 3. Placement-Matrix (Frontfläche, mm) ───────');
  const frontFace = findFrontFaceCentroid(STL_FILE);
  const matrix = buildFrontFaceMatrix(stlBBox, svgData.targetMM, frontFace);
  const S = svgData.targetMM / 2;
  console.log(`   SVG-Breite: ${svgData.targetMM}mm | Skalierungsfaktor: ${S}`);
  console.log(`   Frontfläche-Zentroid: (${frontFace.cx?.toFixed(1)}, ${frontFace.cy?.toFixed(1)}) — übergebbare von BBox (${stlBBox.cx.toFixed(1)}, ${stlBBox.cy.toFixed(1)})`);
  const posX2 = frontFace?.cx ?? stlBBox.cx, posY2 = frontFace?.cy ?? stlBBox.cy;
  console.log(`   Position: (${posX2.toFixed(1)}, ${posY2.toFixed(1)}, ${stlBBox.maxZ.toFixed(2)})`);
  console.log(`   Matrix: col0=(${S},0,0) col1=(0,0,-${S}) col2=(0,${S},0) t=(${posX2.toFixed(1)},${posY2.toFixed(1)},${stlBBox.maxZ.toFixed(1)})`);

  // 4. POST
  console.log('\n── 4. Server-Anfrage ───────────────────────────');
  const t0   = Date.now();
  const data = await postToServer(STL_FILE, svgData, matrix);
  const dt   = Date.now() - t0;
  console.log(`   Antwortzeit: ${dt}ms`);

  if (data.error) {
    console.error(`   FEHLER: ${data.error}`);
    process.exit(1);
  }
  if (!data.resultStlBase64) {
    console.error('   FEHLER: kein resultStlBase64');
    console.error('   Antwort:', JSON.stringify(data).slice(0, 300));
    process.exit(1);
  }
  console.log(`   OK: resultStlBase64 Länge=${data.resultStlBase64.length}`);

  // Ergebnis speichern
  const resultBuf = Buffer.from(data.resultStlBase64, 'base64');
  fs.writeFileSync(OUT_FILE, resultBuf);
  console.log(`   Gespeichert: ${OUT_FILE}`);

  // 5. Vergleich
  console.log('\n── 5. STL-Vergleich ────────────────────────────');
  const inBBox  = readSTLBBox(STL_FILE);
  const outBBox = bboxFromBuf(resultBuf);

  console.log('   INPUT:');
  console.log(`     Größe:  ${inBBox.bytes} Bytes | ${inBBox.nTri} Dreiecke`);
  console.log(`     BBox X: ${inBBox.minX.toFixed(2)} → ${inBBox.maxX.toFixed(2)}`);
  console.log(`     BBox Y: ${inBBox.minY.toFixed(2)} → ${inBBox.maxY.toFixed(2)}`);
  console.log(`     BBox Z: ${inBBox.minZ.toFixed(2)} → ${inBBox.maxZ.toFixed(2)}`);

  console.log('   OUTPUT:');
  console.log(`     Größe:  ${outBBox.bytes} Bytes | ${outBBox.nTri} Dreiecke`);
  console.log(`     BBox X: ${outBBox.minX.toFixed(2)} → ${outBBox.maxX.toFixed(2)}`);
  console.log(`     BBox Y: ${outBBox.minY.toFixed(2)} → ${outBBox.maxY.toFixed(2)}`);
  console.log(`     BBox Z: ${outBBox.minZ.toFixed(2)} → ${outBBox.maxZ.toFixed(2)}`);

  const byteDiff = outBBox.bytes - inBBox.bytes;
  const triDiff  = outBBox.nTri - inBBox.nTri;
  console.log(`   DELTA: ${byteDiff > 0 ? '+' : ''}${byteDiff} Bytes | ${triDiff > 0 ? '+' : ''}${triDiff} Dreiecke`);

  if (Math.abs(byteDiff) < 100) {
    console.log('   → GLEICHE GRÖSSE: Kein Cut erkennbar');
  } else if (triDiff > 0) {
    console.log('   → MEHR DREIECKE: Cut hat neue Geometrie erzeugt ✓');
  } else {
    console.log('   → ANDERE GRÖSSE: Cut hat Geometrie verändert ✓');
  }

  // 6. Render
  console.log('\n── 6. Rendere Ergebnis-STL ─────────────────────');
  await renderSTL(OUT_FILE, '/tmp/result_stl.png');
  console.log('   Screenshot: /tmp/result_stl.png');

  // Auch Input rendern zum Vergleich
  await renderSTL(STL_FILE, '/tmp/input_stl.png');
  console.log('   Input-Screenshot: /tmp/input_stl.png');

  console.log('\n══ FERTIG ══════════════════════════════════════');
})().catch(err => {
  console.error('\nFEHLER:', err.message);
  console.error(err.stack);
  process.exit(1);
});
