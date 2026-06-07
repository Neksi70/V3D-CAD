'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const Module  = require('module');

// opencascade.js@1.1.1 ist ein ESM/CJS-Hybrid. Das `export default`-Statement
// am Ende macht es für Node.js 22 zu einem ESM-Modul (kein __dirname).
// Fix: ESM-Export inline durch CJS-Export ersetzen und als CJS kompilieren.
function loadOpenCascade() {
  const distDir  = path.join(__dirname, 'node_modules/opencascade.js/dist');
  const jsFile   = path.join(distDir, 'opencascade.wasm.js');
  let src = fs.readFileSync(jsFile, 'utf8');
  src = src.replace(
    /^export default opencascade;$/m,
    'module.exports = opencascade; module.exports.default = opencascade;'
  );
  // Emscripten quit_ und noExitRuntime patchen — verhindert process.exit() + ABORT nach Init
  src = src.replace(
    /quit_=function\(status\)\{process\["exit"\]\(status\)\}/g,
    'quit_=function(status){if(status!==0)console.warn("[OCCT] quit:",status)}'
  );
  // noExitRuntime: true hardcoden damit ABORT nach WASM-Init nicht gesetzt wird
  src = src.replace('var noExitRuntime;', 'var noExitRuntime=true;');
  const m = new Module(jsFile);
  m.filename = jsFile;
  m.paths    = Module._nodeModulePaths(distDir);
  m._compile(src, jsFile);
  const initFn  = m.exports.default || m.exports;
  const wasmBuf = fs.readFileSync(path.join(distDir, 'opencascade.wasm.wasm'));
  return initFn({ wasmBinary: wasmBuf, noExitRuntime: true });
}

let _oc = null;
async function getOC() {
  if (!_oc) _oc = await loadOpenCascade();
  return _oc;
}

// ── STL Binary Parser ─────────────────────────────────────────────────────────
function parseSTLBinary(buf) {
  const view = new DataView(buf instanceof Buffer
    ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    : buf);
  const nTri = view.getUint32(80, true);
  const tris = [];
  for (let i = 0; i < nTri; i++) {
    const base = 84 + i * 50;
    const v = [];
    for (let j = 0; j < 3; j++) {
      const o = base + 12 + j * 12;
      v.push([view.getFloat32(o,true), view.getFloat32(o+4,true), view.getFloat32(o+8,true)]);
    }
    tris.push(v);
  }
  return tris;
}

// ── STL via OCCT-FS lesen → Solid (mit Sewing, Tolerance 1mm) ────────────────
function stlToOCCTSolid(oc, stlBuf) {
  try {
    const tmpPath = '/s.stl';
    oc.FS.writeFile(tmpPath, new Uint8Array(stlBuf));
    const written = oc.FS.stat(tmpPath).size;
    console.log('[stl2occt] FS write:', written, '/', stlBuf.length, 'bytes');

    const shape  = new oc.TopoDS_Shape();
    const reader = new oc.StlAPI_Reader();
    const ok     = reader.Read(shape, tmpPath);
    try { oc.FS.unlink(tmpPath); } catch(_) {}
    console.log('[stl2occt] StlAPI_Reader.Read:', ok);
    if (!ok) return null;

    // Sewing (1mm Tolerance) verbindet die losen Dreiecke zu einem echten Solid.
    // Größere Tolerance als Default (1e-6) → deutlich schneller auf großen Meshes.
    const t0 = Date.now();
    const sew = new oc.BRepBuilderAPI_Sewing(1.0, true, true, true, false);
    sew.Add(shape);
    const prog = new oc.Handle_Message_ProgressIndicator_1();
    sew.Perform(prog);
    prog.delete();
    const sewn = sew.SewedShape();
    sew.delete();
    console.log('[stl2occt] Sewing done in', Date.now()-t0, 'ms');

    // Versuch 1: BRepBuilderAPI_MakeSolid aus Shells
    try {
      const mkSolid = new oc.BRepBuilderAPI_MakeSolid_1();
      const exp = new oc.TopExp_Explorer_2(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      let shellCount = 0;
      while (exp.More()) {
        const shell = oc.TopoDS.Shell_1(exp.Current());
        mkSolid.Add(shell);
        shellCount++;
        exp.Next();
      }
      exp.delete();
      if (shellCount > 0 && mkSolid.IsDone()) {
        const solid = mkSolid.Solid(); mkSolid.delete();
        console.log('[stl2occt] Solid aus', shellCount, 'Shells (MakeSolid)');
        return solid;
      }
      console.log('[stl2occt] MakeSolid IsDone=false, shellCount=', shellCount);
      mkSolid.delete();
    } catch(e1) { console.log('[stl2occt] MakeSolid failed:', e1.message); }

    // Versuch 2: ShapeFix_Solid repariert Shell → Solid
    try {
      const sfs = new oc.ShapeFix_Solid_1();
      const exp2 = new oc.TopExp_Explorer_2(sewn, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      if (exp2.More()) {
        const shell = oc.TopoDS.Shell_1(exp2.Current());
        exp2.delete();
        const solid = sfs.SolidFromShell(shell);
        sfs.delete();
        if (solid && solid.ShapeType().value === 2) {
          console.log('[stl2occt] Solid via ShapeFix_Solid OK');
          return solid;
        }
        console.log('[stl2occt] ShapeFix_Solid kein Solid (type=', solid && solid.ShapeType().value, ')');
      } else {
        exp2.delete();
        sfs.delete();
      }
    } catch(e2) { console.log('[stl2occt] ShapeFix_Solid failed:', e2.message); }

    // Fallback: genähtes Compound direkt (Boolean-Op kann damit umgehen)
    console.log('[stl2occt] Fallback: genähtes Compound, ShapeType=', sewn.ShapeType().value);
    return sewn;
  } catch(e) {
    console.error('[stl2occt] Fehler:', e.message);
    return null;
  }
}

// ── Wire aus 2D-Punkten (XZ-Ebene, exakt wie volme3d.html) ───────────────────
function buildWireXZ(oc, pts2d) {
  if (!pts2d || pts2d.length < 3) return null;
  const pts = [];
  for (const p of pts2d) {
    const prev = pts[pts.length-1];
    if (prev && Math.abs(p[0]-prev[0]) < 1e-7 && Math.abs(p[1]-prev[1]) < 1e-7) continue;
    pts.push(p);
  }
  while (pts.length > 3 &&
    Math.abs(pts[0][0]-pts[pts.length-1][0]) < 1e-7 &&
    Math.abs(pts[0][1]-pts[pts.length-1][1]) < 1e-7) pts.pop();
  if (pts.length < 3) return null;
  try {
    const poly = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const [x, z] of pts) {
      const p = new oc.gp_Pnt_3(x, 0, z); poly.Add_1(p); p.delete();
    }
    poly.Close();
    if (!poly.IsDone()) { poly.delete(); return null; }
    const wire = poly.Wire(); poly.delete();
    return wire;
  } catch(_) { return null; }
}

// ── SVG-Pfad → OCCT Prism ────────────────────────────────────────────────────
// normF=1: Koordinaten direkt in mm (scale bereits px→mm).
// matrixWorld enthält den vollständigen World-Transform inkl. Scale.
function buildSvgSolid(oc, pathInfo, scale, cx, cy, normF, depthMM) {
  const outerXZ = pathInfo.pts.map(p => [
    (p[0] - cx) * scale,
    (p[1] - cy) * scale
  ]);
  const outerWire = buildWireXZ(oc, outerXZ);
  if (!outerWire) return null;

  const mkFace = new oc.BRepBuilderAPI_MakeFace_15(outerWire, false);
  if (!mkFace.IsDone()) { mkFace.delete(); return null; }

  if (pathInfo.holes?.length) {
    for (const holePts of pathInfo.holes) {
      const hXZ = holePts.map(p => [
        (p[0] - cx) * scale,
        (p[1] - cy) * scale
      ]);
      const hWire = buildWireXZ(oc, hXZ);
      if (hWire) try { mkFace.Add(hWire); } catch(_) {}
    }
  }

  const face       = mkFace.Face(); mkFace.delete();
  const depthLocal = depthMM;  // normF=1, direkt in mm
  const vec        = new oc.gp_Vec_4(0, depthLocal, 0);
  let   prism;
  try   { prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true); }
  catch  (_) { vec.delete(); return null; }
  vec.delete();
  if (!prism.IsDone()) { prism.delete(); return null; }
  const shape = prism.Shape(); prism.delete();

  // Zentrieren: Prism ragt symmetrisch in Solid (depthLocal/2 nach -Y)
  const trsf = new oc.gp_Trsf_1();
  const tv   = new oc.gp_Vec_4(0, -depthLocal/2, 0);
  trsf.SetTranslation_1(tv); tv.delete();
  const xf = new oc.BRepBuilderAPI_Transform_2(shape, trsf, false); trsf.delete();
  if (!xf.IsDone()) { xf.delete(); return shape; }
  const moved = xf.Shape(); xf.delete();
  return moved;
}

// ── OCCT Shape → binäres STL (manuell aus Triangulierung) ────────────────────
function solidToSTLBuffer(oc, shape) {
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
  const FACE  = oc.TopAbs_ShapeEnum.TopAbs_FACE;
  const SHAPE = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const REV   = oc.TopAbs_Orientation.TopAbs_REVERSED;
  const tris  = [];  // [[v0,v1,v2], ...]  jedes vi = [x,y,z]
  const exp   = new oc.TopExp_Explorer_2(shape, FACE, SHAPE);
  while (exp.More()) {
    const face = oc.TopoDS.Face_1(exp.Current());
    const loc  = new oc.TopLoc_Location_1();
    const tri  = oc.BRep_Tool.Triangulation(face, loc);
    if (!tri.IsNull()) {
      const isRev = face.Orientation_1().value === REV.value;
      const poly  = tri.get();
      const trsf  = !loc.IsIdentity() ? loc.IsIdentity() : null; // unused, coords are local
      const nodes = [];
      for (let i = 1; i <= poly.NbNodes(); i++) {
        const n = poly.Node(i); nodes.push([n.X(), n.Y(), n.Z()]);
      }
      for (let i = 1; i <= poly.NbTriangles(); i++) {
        const t = poly.Triangle(i);
        const a = t.Value(1)-1, b = t.Value(2)-1, c = t.Value(3)-1;
        tris.push(isRev ? [nodes[a],nodes[c],nodes[b]] : [nodes[a],nodes[b],nodes[c]]);
      }
    }
    loc.delete(); face.delete();
    exp.Next();
  }
  exp.delete();

  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write('OCCT Server Result', 0, 'ascii');
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const [v0,v1,v2] of tris) {
    buf.writeFloatLE(0, off); buf.writeFloatLE(0, off+4); buf.writeFloatLE(0, off+8);
    for (const [i, v] of [[0,v0],[1,v1],[2,v2]]) {
      buf.writeFloatLE(v[0], off+12+i*12); buf.writeFloatLE(v[1], off+16+i*12); buf.writeFloatLE(v[2], off+20+i*12);
    }
    buf.writeUInt16LE(0, off+48);
    off += 50;
  }
  return buf;
}

// ── BBox eines Shapes (min/max XYZ via Bnd_Box CornerMin/CornerMax) ──────────
function getBBox(oc, shape) {
  try {
    const box = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(shape, box, false);
    if (box.IsVoid()) { box.delete(); return 'VOID'; }
    const mn = box.CornerMin(); const mx = box.CornerMax();
    box.delete();
    const f = v => v.toFixed(3);
    const r = `x[${f(mn.X())},${f(mx.X())}] y[${f(mn.Y())},${f(mx.Y())}] z[${f(mn.Z())},${f(mx.Z())}]`;
    mn.delete(); mx.delete();
    return r;
  } catch(e) { return 'ERR:' + e.message; }
}

// ── Containment-Analyse (Kinder-Pfade für Ring-Buchstaben) ───────────────────
function buildChildrenMap(pathData) {
  function area(pts) {
    let a=0; for(let i=0,j=pts.length-1;i<pts.length;j=i++)
      a+=pts[j][0]*pts[i][1]-pts[i][0]*pts[j][1];
    return Math.abs(a/2);
  }
  function ptIn(px,py,pts) {
    let r=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++) {
      const xi=pts[i][0],yi=pts[i][1],xj=pts[j][0],yj=pts[j][1];
      if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi)) r=!r;
    }
    return r;
  }
  const areas    = pathData.map(p => area(p.pts));
  const parentOf = new Array(pathData.length).fill(-1);
  for (let i=0; i<pathData.length; i++) {
    const c0 = pathData[i].pts.reduce((s,p)=>s+p[0],0)/pathData[i].pts.length;
    const c1 = pathData[i].pts.reduce((s,p)=>s+p[1],0)/pathData[i].pts.length;
    let best=-1, bestA=Infinity;
    for (let j=0; j<pathData.length; j++) {
      if (i===j||areas[j]<=areas[i]) continue;
      if (ptIn(c0,c1,pathData[j].pts)&&areas[j]<bestA) { bestA=areas[j]; best=j; }
    }
    parentOf[i] = best;
  }
  const map = {};
  for (let i=0; i<pathData.length; i++)
    if (parentOf[i]>=0) (map[parentOf[i]] = map[parentOf[i]]||[]).push(i);
  return map;
}

// ── Express-App ───────────────────────────────────────────────────────────────
const app = express();
// CORS: nur localhost + Tailscale erlauben
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|.*\.ts\.net)(:\d+)?$/.test(origin))
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '100mb' }));

/*
 * POST /api/occt-subtract
 * Body: {
 *   stlBase64:          string   — STL-Datei als Base64
 *   svgPathData:        array    — [{pts:[[x,y],...], holes:[...]}, ...]
 *   svgTransformM:      object   — {scale, cx, cy, depthMM, svgSize?}
 *   svgHoleMatrixElements: array — (optional) 16 Floats der 4×4 svgHole.matrixWorld
 * }
 * Response: { resultStlBase64: string } | { error: string }
 */
app.post('/api/occt-subtract', async (req, res) => {
  const { stlBase64, svgPathData, svgTransformM, svgHoleMatrixElements } = req.body;
  if (!stlBase64)          return res.json({ error: 'stlBase64 fehlt' });
  if (!svgPathData?.length) return res.json({ error: 'svgPathData fehlt' });
  if (!svgTransformM)       return res.json({ error: 'svgTransformM fehlt' });

  try {
    const oc = await getOC();

    // 1. STL → OCCT Solid
    const stlBuf    = Buffer.from(stlBase64, 'base64');
    console.log('[debug] Request empfangen, STL bytes:', stlBuf.length);
    const tris      = parseSTLBinary(stlBuf);
    console.log(`[occt-subtract] STL: ${tris.length} Dreiecke`);

    const solidOCCT = stlToOCCTSolid(oc, stlBuf);
    console.log('[debug] solidOCCT:', solidOCCT ? 'vorhanden' : 'NULL');
    if (!solidOCCT) return res.json({ error: 'STL → OCCT Solid fehlgeschlagen' });
    console.log('[stl2occt] ShapeType value:', solidOCCT.ShapeType().value);

    // 2. SVG-Extrusion(en) aufbauen und Boolean Cut durchführen
    const { scale, cx, cy, depthMM } = svgTransformM;
    const normF      = 2 / (svgTransformM.svgSize || 50);  // unused: normF=1 in buildSvgSolid
    const childrenOf = buildChildrenMap(svgPathData);
    const done       = new Set();
    let   result     = solidOCCT;
    let   cutCount   = 0;

    for (let i=0; i<svgPathData.length; i++) {
      if (done.has(i)) continue;
      let shape = buildSvgSolid(oc, svgPathData[i], scale, cx, cy, normF, depthMM);
      if (!shape) continue;

      // Kinder subtrahieren → Ring-Form (für Buchstaben wie O, D, B)
      for (const ci of (childrenOf[i]||[])) {
        const cs = buildSvgSolid(oc, svgPathData[ci], scale, cx, cy, normF, depthMM);
        if (cs) {
          const c = new oc.BRepAlgoAPI_Cut_3(shape, cs); c.Build();
          if (c.IsDone()) shape = c.Shape();
          c.delete(); done.add(ci);
        }
      }

      // SVG lokal → Weltkoordinaten (wenn matrixWorld übergeben)
      let svgWorld = shape;
      if (svgHoleMatrixElements?.length === 16) {
        const e    = svgHoleMatrixElements;
        const trsf = new oc.gp_Trsf_1();
        // Three.js Matrix4 column-major → gp_Trsf row-major 3×4
        trsf.SetValues(e[0],e[4],e[8],e[12], e[1],e[5],e[9],e[13], e[2],e[6],e[10],e[14]);
        const xf = new oc.BRepBuilderAPI_Transform_2(shape, trsf, false); trsf.delete();
        if (xf.IsDone()) svgWorld = xf.Shape();
        xf.delete();
      }

      // BBox-Logging (temporär — Diagnose SVG-Überschneidung)
      if (i === 0) {
        console.log('[cut-debug] solidBBox:', getBBox(oc, result));
        console.log('[cut-debug] svgBBox:  ', getBBox(oc, svgWorld));
      }

      // Boolean Subtract
      const cut = new oc.BRepAlgoAPI_Cut_3(result, svgWorld); cut.Build();
      console.log('[cut] IsDone:', cut.IsDone());
      if (cut.IsDone()) {
        result = cut.Shape();
        console.log('[cut] result ShapeType value:', result.ShapeType().value);
        cutCount++;
      }
      cut.delete();
    }

    if (cutCount === 0) return res.json({ error: 'Kein Boolean Cut erfolgreich' });

    // 3. Ergebnis → STL
    const outBuf = solidToSTLBuffer(oc, result);
    console.log(`[occt-subtract] OK — ${cutCount} Pfade, ${outBuf.length} Bytes`);
    res.json({ resultStlBase64: outBuf.toString('base64') });

  } catch (e) {
    console.error('[occt-subtract] Fehler:', e);
    res.json({ error: e.message || String(e) });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', occtReady: !!_oc }));

// Debug: Schneidet einen OCCT-Box (kein STL) mit einem SVG-Prism
app.get('/debug-box-cut', async (_, res) => {
  try {
    const oc = await getOC();
    // 100×100×50mm Box
    const box = new oc.BRepPrimAPI_MakeBox_2(
      new oc.gp_Pnt_3(0, 0, 0), 100, 100, 50
    );
    let solid = box.Shape(); box.delete();

    // Kleines 20×20mm Quadrat als SVG-Prism (in XZ, extrudiert 10mm in Y)
    const poly = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const [x,z] of [[-10,0],[10,0],[10,20],[-10,20]]) {
      const p = new oc.gp_Pnt_3(x, 0, z); poly.Add_1(p); p.delete();
    }
    poly.Close();
    const wire = poly.Wire(); poly.delete();
    const face = new oc.BRepBuilderAPI_MakeFace_15(wire, false).Face();
    const vec  = new oc.gp_Vec_4(0, 10, 0);
    const prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true);
    let tool = prism.Shape(); prism.delete(); vec.delete();

    // Tool auf Box-Frontfläche (z=50) positionieren: y+5 damit es 5mm ins Solid geht
    const trsf = new oc.gp_Trsf_1();
    trsf.SetTranslation_1(new oc.gp_Vec_4(50, -5, 30)); // zentriert auf Box
    const xf = new oc.BRepBuilderAPI_Transform_2(tool, trsf, false); trsf.delete();
    tool = xf.Shape(); xf.delete();

    const bboxBefore = getBBox(oc, solid);
    const cut = new oc.BRepAlgoAPI_Cut_3(solid, tool); cut.Build();
    const done = cut.IsDone();
    const result = done ? cut.Shape() : solid;
    cut.delete();

    const outBuf = solidToSTLBuffer(oc, result);
    const trisOut = (outBuf.length - 84) / 50;
    res.json({
      boxBBox: bboxBefore,
      cutDone: done,
      inputTris: 12,  // box hat 12 triangles
      outputTris: trisOut,
      different: trisOut !== 12,
      resultStlBase64: outBuf.toString('base64'),
    });
  } catch(e) {
    res.json({ error: e.message || String(e) });
  }
});

app.post('/debug-occt', async (req, res) => {
  const oc = await getOC();
  const stlBuf = Buffer.from(req.body.stlBase64, 'base64');
  const result = {};
  result.ocReady = !!oc;
  result.stlBufLen = stlBuf.length;
  result.sewingType = typeof oc.BRepBuilderAPI_Sewing;
  try {
    const sew = new oc.BRepBuilderAPI_Sewing(1.0, true, true, true, false);
    result.sewingMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(sew))
      .filter(m => /perform/i.test(m));
    result.progressKeys = Object.getOwnPropertyNames(oc)
      .filter(k => /Progress|Message_P/i.test(k)).slice(0, 15);
    sew.delete();
  } catch(e) { result.sewingErr = e.message; }
  // Gleiche Datei, 3x lesen
  oc.FS.writeFile('/test.stl', new Uint8Array(stlBuf));
  result.fileSize = oc.FS.stat('/test.stl').size;
  for (let i = 1; i <= 3; i++) {
    try {
      const s = new oc.TopoDS_Shape();
      const rdr = new oc.StlAPI_Reader();
      const ok = rdr.Read(s, '/test.stl');
      result['read'+i] = ok ? 'OK' : 'FALSE';
      s.delete();
    } catch(e) { result['read'+i] = 'ERR:'+e.message?.slice(0,40); }
  }
  res.json(result);
});

const PORT = 3001;
const https = require('https');
const fs2   = require('fs');
const creds = {
  cert: fs2.readFileSync('/home/v3da/v3da.tailf05fe9.ts.net.crt'),
  key:  fs2.readFileSync('/home/v3da/v3da.tailf05fe9.ts.net.key')
};
https.createServer(creds, app).listen(PORT, '0.0.0.0', () => {
  console.log(`OCCT-Server läuft auf https://v3da.tailf05fe9.ts.net:${PORT}`);
  getOC()
    .then(() => console.log('OCCT bereit'))
    .catch(e  => console.error('OCCT Init Fehler:', e.message));
});
