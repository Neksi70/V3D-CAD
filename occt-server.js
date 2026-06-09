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

// Ray durch alle STL-Dreiecke (Möller–Trumbore) → sortierte, entduplizierte
// Liste positiver Treffer-Distanzen t entlang (dx,dy,dz) ab (ox,oy,oz).
function rayTriHits(tris, ox, oy, oz, dx, dy, dz) {
  const EPS = 1e-6;
  const hits = [];
  for (const [a, b, c] of tris) {
    const e1x=b[0]-a[0], e1y=b[1]-a[1], e1z=b[2]-a[2];
    const e2x=c[0]-a[0], e2y=c[1]-a[1], e2z=c[2]-a[2];
    const px=dy*e2z-dz*e2y, py=dz*e2x-dx*e2z, pz=dx*e2y-dy*e2x;
    const det=e1x*px+e1y*py+e1z*pz;
    if (det > -EPS && det < EPS) continue;
    const inv=1/det;
    const tx=ox-a[0], ty=oy-a[1], tz=oz-a[2];
    const u=(tx*px+ty*py+tz*pz)*inv;
    if (u < -1e-6 || u > 1+1e-6) continue;
    const qx=ty*e1z-tz*e1y, qy=tz*e1x-tx*e1z, qz=tx*e1y-ty*e1x;
    const v=(dx*qx+dy*qy+dz*qz)*inv;
    if (v < -1e-6 || u+v > 1+1e-6) continue;
    const t=(e2x*qx+e2y*qy+e2z*qz)*inv;
    if (t > EPS) hits.push(t);
  }
  if (!hits.length) return [];
  hits.sort((p,q)=>p-q);
  const uniq = [hits[0]];
  for (let i=1;i<hits.length;i++) if (hits[i]-uniq[uniq.length-1] > 0.05) uniq.push(hits[i]);
  return uniq;
}

// Wandstärke am Klickpunkt (Außenfläche → erste Innenfläche). Nur fürs Logging.
function measureWallThickness(tris, snapPoint, outwardNormal) {
  if (!snapPoint || !outwardNormal) return null;
  const nl = Math.hypot(outwardNormal.x, outwardNormal.y, outwardNormal.z);
  if (nl < 1e-9) return null;
  const nx = outwardNormal.x/nl, ny = outwardNormal.y/nl, nz = outwardNormal.z/nl;
  const START = 5.0;
  const hits = rayTriHits(tris,
    snapPoint.x + nx*START, snapPoint.y + ny*START, snapPoint.z + nz*START,
    -nx, -ny, -nz);
  return hits.length >= 2 ? hits[1] - hits[0] : null;
}

// Maximale Blind-Tiefe so, dass über die GANZE Gravurfläche immer ≥ margin mm
// Material stehen bleibt. Schräge/unebene Wände werden erfasst, weil an vielen
// Punkten der Footprint entlang der Schnittrichtung (colY) gemessen wird und das
// Minimum zählt. matrixE = 16er-Matrix (col-major), Footprint in (x,z) wie buildSvgSolid.
function computeMaxBlindDepth(tris, matrixE, svgPathData, scale, cx, cy, margin) {
  if (!(matrixE?.length === 16)) return null;
  const cX=[matrixE[0],matrixE[1],matrixE[2]];
  const cY=[matrixE[4],matrixE[5],matrixE[6]];   // Schnittrichtung (in Solid, Einheitsvektor)
  const cZ=[matrixE[8],matrixE[9],matrixE[10]];
  const O =[matrixE[12],matrixE[13],matrixE[14]];
  const BIG = 1000;  // weit außerhalb starten

  // Footprint-Punkte sammeln (alle Pfade), auf max ~120 Samples ausdünnen
  const pts = [];
  for (const pi of svgPathData) {
    if (pi?.pts) for (const p of pi.pts) pts.push(p);
    if (pi?.holes) for (const h of pi.holes) for (const p of h) pts.push(p);
  }
  if (!pts.length) return null;
  const stride = Math.max(1, Math.floor(pts.length / 120));

  let minAvail = Infinity, samples = 0;
  for (let i = 0; i < pts.length; i += stride) {
    const x = (pts[i][0] - cx) * scale;
    const z = (pts[i][1] - cy) * scale;
    // Punkt auf der Matrix-Ebene (y=0) in Weltkoordinaten
    const wx = O[0] + cX[0]*x + cZ[0]*z;
    const wy = O[1] + cX[1]*x + cZ[1]*z;
    const wz = O[2] + cX[2]*x + cZ[2]*z;
    // weit außerhalb starten, entlang colY (in Solid) schießen
    const ox = wx - cY[0]*BIG, oy = wy - cY[1]*BIG, oz = wz - cY[2]*BIG;
    const hits = rayTriHits(tris, ox, oy, oz, cY[0], cY[1], cY[2]);
    if (hits.length < 2) continue;            // Ray verfehlt Wand hier
    // hits[1] = Innenfläche der getroffenen Wand; Distanz ab Matrix-Ebene:
    const avail = hits[1] - BIG;
    if (avail < minAvail) minAvail = avail;
    samples++;
  }
  if (!samples || !isFinite(minAvail)) return null;
  return { minAvail, maxDepth: Math.max(0.2, minAvail - margin), samples };
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
    const sew = new oc.BRepBuilderAPI_Sewing(0.1, true, true, true, false);
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

// Uniformer Overlap (mm) im lokalen Normalen-Raum: jedes Glyph ragt um diesen
// Betrag aus der Eintrittsfläche heraus → keine (fast-)koplanaren Flächen, der
// Boolean-Cut bleibt stabil. Wert deckt die beobachtete Matrix/Fläche-Schräge
// (~1.4mm bei gedrafteten Flächen) ab. Liegt komplett auf der Außenseite →
// beeinflusst die Gravurtiefe NICHT.
const SVG_OVERLAP_MM = 2.0;

// 2D-Segmentschnitt (echte Kreuzung, keine geteilten Endpunkte)
function _segCross(a, b, c, d) {
  const o = (p,q,r) => Math.sign((q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]));
  const o1=o(a,b,c),o2=o(a,b,d),o3=o(c,d,a),o4=o(c,d,b);
  return o1!==o2 && o3!==o4 && o1!==0 && o2!==0 && o3!==0 && o4!==0;
}
// Kontur reinigen: aufeinanderfolgende Duplikate raus + Selbstüberschneidungen
// per 2-opt entkreuzen (verdrehten Abschnitt umkehren). Behebt die Kurven-
// Sampling-Artefakte bei runden Glyphen (o,e,3,d) → gültige OCCT-Faces.
function cleanContour(pts) {
  let p = pts.filter((pt, i) => {
    const q = pts[(i - 1 + pts.length) % pts.length];
    return Math.abs(pt[0]-q[0]) > 1e-6 || Math.abs(pt[1]-q[1]) > 1e-6;
  });
  if (p.length < 4) return p;
  for (let pass = 0; pass < 8; pass++) {
    const n = p.length; let fixed = false;
    for (let i = 0; i < n - 1 && !fixed; i++) {
      const a = p[i], b = p[i+1];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;   // erste & letzte teilen den Closing-Punkt
        if (_segCross(a, b, p[j], p[(j+1) % n])) {
          // verdrehten Abschnitt p[i+1..j] umkehren → Kreuzung weg
          const seg = p.slice(i+1, j+1).reverse();
          p = p.slice(0, i+1).concat(seg, p.slice(j+1));
          fixed = true; break;
        }
      }
    }
    if (!fixed) break;
  }
  return p;
}

// ── SVG-Pfad → OCCT Prism ────────────────────────────────────────────────────
// normF=1: Koordinaten direkt in mm (scale bereits px→mm).
// matrixWorld enthält den vollständigen World-Transform inkl. Scale.
function buildSvgSolid(oc, pathInfo, scale, cx, cy, normF, depthMM) {
  const outerXZ = cleanContour(pathInfo.pts).map(p => [
    (p[0] - cx) * scale,
    (p[1] - cy) * scale
  ]);
  const outerWire = buildWireXZ(oc, outerXZ);
  if (!outerWire) return null;

  const mkFace = new oc.BRepBuilderAPI_MakeFace_15(outerWire, false);
  if (!mkFace.IsDone()) { mkFace.delete(); return null; }

  if (pathInfo.holes?.length) {
    for (const holePts of pathInfo.holes) {
      const hXZ = cleanContour(holePts).map(p => [
        (p[0] - cx) * scale,
        (p[1] - cy) * scale
      ]);
      const hWire = buildWireXZ(oc, hXZ);
      if (hWire) try { mkFace.Add(hWire); } catch(_) {}
    }
  }

  let   face       = mkFace.Face(); mkFace.delete();
  // Face um -OVERLAP entlang lokaler Y verschieben → Prisma startet außerhalb
  // der Fläche und ragt für JEDES Glyph gleich weit heraus.
  if (SVG_OVERLAP_MM > 0) {
    const t = new oc.gp_Trsf_1();
    t.SetTranslation_1(new oc.gp_Vec_4(0, -SVG_OVERLAP_MM, 0));
    const xf = new oc.BRepBuilderAPI_Transform_2(face, t, false); t.delete();
    if (xf.IsDone()) face = xf.Shape();
    xf.delete();
  }
  const depthLocal = depthMM + SVG_OVERLAP_MM;  // normF=1, direkt in mm
  const vec        = new oc.gp_Vec_4(0, depthLocal, 0);
  let   prism;
  try   { prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true); }
  catch  (_) { vec.delete(); return null; }
  vec.delete();
  if (!prism.IsDone()) { prism.delete(); return null; }
  const shape = prism.Shape(); prism.delete();
  return shape;
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
      // WICHTIG: Face-Location auf die Knoten anwenden. Nach Boolean-Cuts haben
      // manche Faces eine Nicht-Identitäts-Location → Knoten liegen im lokalen
      // Frame. Ohne Transform landen die Dreiecke falsch (verschmiert/schwarz).
      const useTrsf = !loc.IsIdentity();
      const trsf = useTrsf ? loc.Transformation() : null;
      const nodes = [];
      for (let i = 1; i <= poly.NbNodes(); i++) {
        const nd = poly.Node(i);
        if (useTrsf) {
          const p = new oc.gp_Pnt_3(nd.X(), nd.Y(), nd.Z());
          p.Transform(trsf);
          nodes.push([p.X(), p.Y(), p.Z()]);
          p.delete();
        } else {
          nodes.push([nd.X(), nd.Y(), nd.Z()]);
        }
      }
      if (trsf) trsf.delete();
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

function getBBoxNum(oc, shape) {
  const box = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(shape, box, false);
  if (box.IsVoid()) { box.delete(); return null; }
  const mn = box.CornerMin(); const mx = box.CornerMax();
  const r = { xMin: mn.X(), yMin: mn.Y(), zMin: mn.Z(),
               xMax: mx.X(), yMax: mx.Y(), zMax: mx.Z() };
  mn.delete(); mx.delete(); box.delete();
  return r;
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
 *   stlBase64:    string  — STL-Datei als Base64
 *   svgPathData:  array   — [{pts:[[x,y],...], holes:[...]}, ...]
 *   svgTransformM: object — {scale, cx, cy, depthMM, svgSize?}
 *   snapNormal:   object  — {x,y,z} Geometry-local Normale der Snap-Fläche (STL-Raum)
 * }
 * Response: { resultStlBase64: string } | { error: string }
 */
function buildMatrixFromSnapNormal(stlBuf, snapNormal, snapPoint, svgSize) {
  const tris = parseSTLBinary(stlBuf);
  const sn = [snapNormal.x, snapNormal.y, snapNormal.z];
  const snLen = Math.sqrt(sn[0]**2 + sn[1]**2 + sn[2]**2);
  const n = sn.map(v => v / snLen);

  const matched = [];
  for (const [A, B, C] of tris) {
    const ex=B[0]-A[0], ey=B[1]-A[1], ez=B[2]-A[2];
    const fx=C[0]-A[0], fy=C[1]-A[1], fz=C[2]-A[2];
    let nx=ey*fz-ez*fy, ny=ez*fx-ex*fz, nz=ex*fy-ey*fx;
    const nl=Math.sqrt(nx*nx+ny*ny+nz*nz);
    if (nl < 1e-10) continue;
    nx/=nl; ny/=nl; nz/=nl;
    if (nx*n[0] + ny*n[1] + nz*n[2] > 0.9) matched.push([A, B, C]);
  }
  if (!matched.length) {
    console.log('[snapNormal] Keine passenden Dreiecke (dot > 0.9)');
    return null;
  }

  // Position: snapPoint (Klickpunkt in STL-mm) direkt nutzen
  const pcx = snapPoint.x, pcy = snapPoint.y, pcz = snapPoint.z;
  console.log(`[snapNormal] ${matched.length} Dreiecke, snapPoint=(${pcx.toFixed(1)},${pcy.toFixed(1)},${pcz.toFixed(1)})`);

  // S=1: buildSvgSolid liefert Geometrie bereits in mm — Matrix nur rotieren+übersetzen
  const colY = [-n[0], -n[1], -n[2]];  // SVG lokal +Y → -normal (ins Solid)
  // worldUp wie Browser: |n.y|>0.85 → (0,0,-1), sonst (0,1,0)
  const worldUp = (Math.abs(n[1]) < 0.85) ? [0,1,0] : [0,0,-1];
  const dotUp = worldUp[0]*n[0]+worldUp[1]*n[1]+worldUp[2]*n[2];
  let colZ = [worldUp[0]-dotUp*n[0], worldUp[1]-dotUp*n[1], worldUp[2]-dotUp*n[2]];
  const lenZ = Math.sqrt(colZ[0]**2+colZ[1]**2+colZ[2]**2);
  colZ = colZ.map(v => v/lenZ);
  // cross(colZ, colY) statt cross(colY, colZ) → gleiche Händigkeit wie Browser
  const colX = [colZ[1]*colY[2]-colZ[2]*colY[1], colZ[2]*colY[0]-colZ[0]*colY[2], colZ[0]*colY[1]-colZ[1]*colY[0]];

  return [
    colX[0], colX[1], colX[2], 0,
    colY[0], colY[1], colY[2], 0,
    colZ[0], colZ[1], colZ[2], 0,
    pcx, pcy, pcz, 1
  ];
}

app.post('/api/occt-subtract', async (req, res) => {
  const { stlBase64, svgPathData, svgTransformM, snapNormal, snapPoint } = req.body;
  let svgHoleMatrixElements = req.body.svgHoleMatrixElements || null;
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

    // snapNormal → Matrix berechnen (wenn kein svgHoleMatrixElements)
    if (snapNormal && snapPoint && !svgHoleMatrixElements) {
      svgHoleMatrixElements = buildMatrixFromSnapNormal(stlBuf, snapNormal, snapPoint, svgTransformM.svgSize || 50);
      if (svgHoleMatrixElements) console.log('[snapNormal] Matrix berechnet OK');
      else console.log('[snapNormal] Matrix-Berechnung fehlgeschlagen, kein Fallback');
    }

    const solidOCCT = stlToOCCTSolid(oc, stlBuf);
    console.log('[debug] solidOCCT:', solidOCCT ? 'vorhanden' : 'NULL');
    if (!solidOCCT) return res.json({ error: 'STL → OCCT Solid fehlgeschlagen' });
    console.log('[stl2occt] ShapeType value:', solidOCCT.ShapeType().value);

    // 2. SVG-Extrusion(en) aufbauen und Boolean Cut durchführen
    const { scale, cx, cy } = svgTransformM;
    let depthMM = svgTransformM.depthMM;
    console.log('[debug] depthMM:', depthMM, 'svgSize:', svgTransformM.svgSize, 'scale:', scale, 'cx:', cx?.toFixed(2), 'cy:', cy?.toFixed(2));
    const normF = 2 / (svgTransformM.svgSize || 50);  // unused: normF=1 in buildSvgSolid

    // Material immer ≥ FLOOR_MM stehen lassen → immer eine Prägung, nie ein
    // Durchbruch. Es wird über die GANZE Gravurfläche gemessen (nicht nur am
    // Klickpunkt), damit auch schräge/unebene Wände korrekt erfasst werden.
    const FLOOR_MM = 0.7;  // Restboden: dünner (0.3) → OCCT vernetzt den Boden mit
                           // Splittern (degenerierter Boolean). 0.7 mm bleibt sauber.
    if (snapNormal && snapPoint) {
      const wallAtClick = measureWallThickness(tris, snapPoint, snapNormal);
      const fp = computeMaxBlindDepth(tris, svgHoleMatrixElements, svgPathData, scale, cx, cy, FLOOR_MM);
      if (fp) {
        console.log(`[wall] Klickpunkt-Wand=${wallAtClick != null ? wallAtClick.toFixed(2) : '?'}mm, ` +
                    `min.Material über Fläche=${fp.minAvail.toFixed(2)}mm (${fp.samples} Samples), ` +
                    `maxTiefe=${fp.maxDepth.toFixed(2)}mm, angefragt=${depthMM}mm`);
        if (depthMM > fp.maxDepth) {
          console.log(`[wall] Tiefe geklemmt: ${depthMM} → ${fp.maxDepth.toFixed(2)}mm (Restboden ≥${FLOOR_MM}mm)`);
          depthMM = fp.maxDepth;
        }
      } else {
        console.log('[wall] Material nicht messbar (Ray verfehlt/massiv) — keine Klemmung');
      }
    }

    const solidBBoxNum = getBBoxNum(oc, solidOCCT);
    console.log('[cut-debug] solidBBox:', getBBox(oc, solidOCCT));

    // Transformation mit optionalem Y-Versatz (Welt-Y) um Compound-Exit sicherzustellen
    function buildAndTransform(pathInfo, depth, yShift = 0) {
      const s = buildSvgSolid(oc, pathInfo, scale, cx, cy, normF, depth);
      if (!s) return null;
      if (!(svgHoleMatrixElements?.length === 16)) return s;
      const e = svgHoleMatrixElements;
      const trsf = new oc.gp_Trsf_1();
      trsf.SetValues(e[0],e[4],e[8],e[12], e[1],e[5],e[9],e[13]+yShift, e[2],e[6],e[10],e[14]);
      const xf = new oc.BRepBuilderAPI_Transform_2(s, trsf, false); trsf.delete();
      const result = xf.IsDone() ? xf.Shape() : s;
      xf.delete();
      return result;
    }

    // Prismen erst zu EINEM Werkzeug verschmelzen (Fuse), dann EINMAL schneiden.
    // Überlappende Logo-Striche werden so zu sauberer Geometrie vereint → der
    // anschließende Cut bleibt manifold (statt non-manifold beim Compound-Cut).
    const tools = [];
    for (let i = 0; i < svgPathData.length; i++) {
      const s = buildAndTransform(svgPathData[i], depthMM);
      if (s) tools.push({i, s});
      else   console.log(`[path-${i}] kein Shape`);
    }
    if (!tools.length) return res.json({ error: 'Keine SVG-Formen aufgebaut' });

    const keep = [];
    let tool = tools[0].s;
    for (let k = 1; k < tools.length; k++) {
      try {
        const f = new oc.BRepAlgoAPI_Fuse_3(tool, tools[k].s); f.Build();
        if (f.IsDone()) { tool = f.Shape(); keep.push(f); }
        else { f.delete(); console.log(`[fuse path-${tools[k].i}] FAIL — Glyph fällt raus`); }
      } catch(e) { console.log(`[fuse path-${tools[k].i}] EXCEPTION ${e.message}`); }
    }
    console.log(`[cut] ${tools.length} Prismen gefust → 1 Werkzeug`);

    const cut = new oc.BRepAlgoAPI_Cut_3(solidOCCT, tool); cut.Build();
    console.log('[cut] IsDone:', cut.IsDone());
    if (!cut.IsDone()) { cut.delete(); return res.json({ error: 'Boolean Cut fehlgeschlagen' }); }
    const result = cut.Shape();

    // 3. Ergebnis → STL
    const outBuf = solidToSTLBuffer(oc, result);
    cut.delete(); for (const f of keep) { try { f.delete(); } catch(_) {} }
    console.log(`[occt-subtract] OK — ${tools.length} Pfade, ${outBuf.length} Bytes`);
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
    const sew = new oc.BRepBuilderAPI_Sewing(0.1, true, true, true, false);
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
