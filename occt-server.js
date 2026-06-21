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

// ── Mesh-Decimate (Vertex-Clustering, Rossignac–Borrel) ────────────────────
// Dichte Meshes (KI-Modelle, zehntausende Dreiecke) machen das Vernähen + die
// Booleans inhärent langsam (jedes Dreieck wird eine Face). Dieser Vorschritt
// rastert die Vertices auf ein Gitter (gridN Zellen entlang der längsten Achse)
// und verschmilzt sie auf den Zell-Mittelpunkt. Dreiecke, deren Ecken in
// dieselbe Zelle fallen, kollabieren und werden verworfen. Reduziert die
// Dreieckszahl deutlich bei akzeptablem Form-Verlust. Gibt die neue Liste zurück.
function decimateTrianglesGrid(tris, gridN) {
  if (!tris.length) return tris;
  let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
  for (const t of tris) for (const p of t) {
    if (p[0]<minx)minx=p[0]; if (p[1]<miny)miny=p[1]; if (p[2]<minz)minz=p[2];
    if (p[0]>maxx)maxx=p[0]; if (p[1]>maxy)maxy=p[1]; if (p[2]>maxz)maxz=p[2];
  }
  const ext = Math.max(maxx-minx, maxy-miny, maxz-minz) || 1;
  const inv = gridN / ext;                       // 1/Zellgröße
  const key = p => Math.floor((p[0]-minx)*inv) + '|' +
                   Math.floor((p[1]-miny)*inv) + '|' +
                   Math.floor((p[2]-minz)*inv);
  // Repräsentant je Zelle = Mittel aller einfallenden Vertices (glättet leicht)
  const rep = new Map();
  for (const t of tris) for (const p of t) {
    let r = rep.get(key(p));
    if (!r) { r = {x:0,y:0,z:0,n:0}; rep.set(key(p), r); }
    r.x+=p[0]; r.y+=p[1]; r.z+=p[2]; r.n++;
  }
  for (const r of rep.values()) { r.x/=r.n; r.y/=r.n; r.z/=r.n; }
  const out = [];
  for (const t of tris) {
    const ka=key(t[0]), kb=key(t[1]), kc=key(t[2]);
    if (ka===kb || kb===kc || ka===kc) continue;   // kollabiertes Dreieck → weg
    const a=rep.get(ka), b=rep.get(kb), c=rep.get(kc);
    out.push([[a.x,a.y,a.z],[b.x,b.y,b.z],[c.x,c.y,c.z]]);
  }
  return out;
}

// Dreiecksliste → binäres STL (Normale = 0, StlAPI_Reader ignoriert sie)
function trisToStlBuffer(tris) {
  const buf = Buffer.alloc(84 + tris.length*50);
  buf.write('decimated', 0, 'ascii');
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const [a,b,c] of tris) {
    off += 12;
    for (const v of [a,b,c]) { buf.writeFloatLE(v[0],off); buf.writeFloatLE(v[1],off+4); buf.writeFloatLE(v[2],off+8); off+=12; }
    buf.writeUInt16LE(0,off); off+=2;
  }
  return buf;
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

// Douglas-Peucker auf offener Punktliste (eps in mm). Reduziert die Stützpunkte
// dicht tessellierter Font-Konturen drastisch → der Gravur-Boden/-Rand wird mit
// weit weniger Dreiecken vernetzt (kleinere Ergebnis-Datei). eps<=0 = aus.
function simplifyDP(pts, eps) {
  if (eps <= 0 || pts.length < 3) return pts;
  const e2 = eps * eps;
  const d2 = (p, a, b) => {
    const dx = b[0]-a[0], dy = b[1]-a[1], L = dx*dx + dy*dy;
    if (L < 1e-12) { const ex=p[0]-a[0], ey=p[1]-a[1]; return ex*ex+ey*ey; }
    let t = ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / L; t = t<0?0:t>1?1:t;
    const cx = a[0]+t*dx, cy = a[1]+t*dy, ex = p[0]-cx, ey = p[1]-cy; return ex*ex+ey*ey;
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length-1] = true;
  const stack = [[0, pts.length-1]];
  while (stack.length) {
    const [i, j] = stack.pop(); let max = -1, idx = -1;
    for (let k = i+1; k < j; k++) { const dd = d2(pts[k], pts[i], pts[j]); if (dd > max) { max = dd; idx = k; } }
    if (max > e2 && idx > 0) { keep[idx] = true; stack.push([i, idx], [idx, j]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

// ── SVG-Pfad → OCCT Prism ────────────────────────────────────────────────────
// normF=1: Koordinaten direkt in mm (scale bereits px→mm).
// Prisma reicht lokal von yStart bis yEnd entlang +Y (= in den Solid hinein).
//   Vertieft (Cut):   yStart = -OVERLAP,  yEnd = depth   (ragt außen raus, schneidet rein)
//   Erhaben (Fuse):   yStart = -height,   yEnd = +bond   (steht außen raus, bondet innen)
function buildSvgSolid(oc, pathInfo, scale, cx, cy, normF, yStart, yEnd, simplifyMM = 0) {
  const outerXZ = simplifyDP(cleanContour(pathInfo.pts).map(p => [
    (p[0] - cx) * scale,
    (p[1] - cy) * scale
  ]), simplifyMM);
  const outerWire = buildWireXZ(oc, outerXZ);
  if (!outerWire) return null;

  const mkFace = new oc.BRepBuilderAPI_MakeFace_15(outerWire, false);
  if (!mkFace.IsDone()) { mkFace.delete(); return null; }

  if (pathInfo.holes?.length) {
    for (const holePts of pathInfo.holes) {
      const hXZ = simplifyDP(cleanContour(holePts).map(p => [
        (p[0] - cx) * scale,
        (p[1] - cy) * scale
      ]), simplifyMM);
      const hWire = buildWireXZ(oc, hXZ);
      if (hWire) try { mkFace.Add(hWire); } catch(_) {}
    }
  }

  let   face       = mkFace.Face(); mkFace.delete();
  // Face an den Start (yStart) verschieben, dann (yEnd - yStart) extrudieren.
  if (yStart !== 0) {
    const t = new oc.gp_Trsf_1();
    t.SetTranslation_1(new oc.gp_Vec_4(0, yStart, 0));
    const xf = new oc.BRepBuilderAPI_Transform_2(face, t, false); t.delete();
    if (xf.IsDone()) face = xf.Shape();
    xf.delete();
  }
  const depthLocal = yEnd - yStart;
  if (depthLocal <= 0) return null;
  const vec        = new oc.gp_Vec_4(0, depthLocal, 0);
  let   prism;
  try   { prism = new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true); }
  catch  (_) { vec.delete(); return null; }
  vec.delete();
  if (!prism.IsDone()) { prism.delete(); return null; }
  const shape = prism.Shape(); prism.delete();
  return shape;
}

// Vernetzungs-Auflösung des Ergebnis-STL (mm). 0.2 statt 0.1: ~halb so viele
// Dreiecke/Bytes (passt wieder in die Firestore-Cloud), schneller zu vernetzen,
// fürs FDM-Drucken (Düse/Schicht 0.2–0.4 mm) praktisch unsichtbar.
const MESH_DEFLECTION_MM = 0.2;
// ── OCCT Shape → binäres STL (manuell aus Triangulierung) ────────────────────
function solidToSTLBuffer(oc, shape) {
  new oc.BRepMesh_IncrementalMesh_2(shape, MESH_DEFLECTION_MM, false, 0.5, false);
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
  if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|.*\.ts\.net)(:\d+)?$/.test(origin))
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

// Solid vor dem Boolean-Cut vereinfachen: koplanare Flächen (eine flache Wand aus
// hunderten STL-Dreiecken) zu großen Flächen zusammenfassen → Cut massiv schneller
// (Bench bench_unify.js: 3888→6 Flächen, Cut 6.2s→1.2s) bei identischem Volumen.
// Bei Fehler oder unplausiblem Ergebnis: Original-Solid zurückgeben.
function unifySolid(oc, solid) {
  const vol = s => { try { const p=new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(s,p,false,false,false); const v=Math.abs(p.Mass()); p.delete(); return v;
  } catch(_) { return NaN; } };
  try {
    const t0 = Date.now();
    const up = new oc.ShapeUpgrade_UnifySameDomain_1();
    (up.Initialize_1 || up.Initialize).call(up, solid, true, true, false);
    up.Build();
    const out = up.Shape();
    const v0 = vol(solid), v1 = vol(out);
    if (!out || !isFinite(v1) || v1 < 1e-6 || Math.abs(v1 - v0) / Math.max(v0, 1) > 0.01) {
      console.log('[unify] verworfen (Volumen/Validität) → Original');
      return solid;
    }
    console.log(`[unify] OK in ${Date.now()-t0} ms, Volumen-Δ ${(Math.abs(v1-v0)/Math.max(v0,1)*100).toFixed(3)}%`);
    return out;
  } catch (e) {
    console.log('[unify] Ausnahme:', e.message, '→ Original');
    return solid;
  }
}

// ── Skalierung um einen MITTELPUNKT (nicht den Ursprung!) ───────────────────
// gp_Trsf.SetScale(center, factor) + BRepBuilderAPI_Transform. Gibt das Shape
// zurück (oder null, falls Transform fehlschlägt). Transform-Ergebnis sofort
// freizugeben ist hier sicher (gleiches Muster wie buildAndTransform).
function scaleAbout(oc, shape, factor, cx, cy, cz) {
  const trsf = new oc.gp_Trsf_1();
  const c    = new oc.gp_Pnt_3(cx, cy, cz);
  trsf.SetScale(c, factor);
  const xf   = new oc.BRepBuilderAPI_Transform_2(shape, trsf, false);
  const out  = xf.IsDone() ? xf.Shape() : null;
  c.delete(); trsf.delete(); xf.delete();
  return out;
}

// ── Achsparallele Box aus Eckpunkt (x,y,z) + Größen (dx,dy,dz) ──────────────
function makeBox(oc, x, y, z, dx, dy, dz) {
  const p  = new oc.gp_Pnt_3(x, y, z);
  const mk = new oc.BRepPrimAPI_MakeBox_2(p, dx, dy, dz);
  const s  = mk.Shape();
  p.delete(); mk.delete();
  return s;
}

// ── Boolean-Op (Cut_3/Common_3/Fuse_3). Das BOP-Objekt besitzt das Ergebnis-
// Shape, darf also erst NACH der Vernetzung gelöscht werden → in `keep` sammeln
// (gleiches Muster wie der Subtract-Endpoint). Wirft bei !IsDone.
function bop(oc, ctorName, a, b, keep, label) {
  const op = new oc[ctorName](a, b);
  op.Build();
  keep.push(op);
  if (!op.IsDone()) throw new Error((label || ctorName) + ' nicht IsDone');
  return op.Shape();
}

app.post('/api/occt-subtract', async (req, res) => {
  const { stlBase64, svgPathData, svgTransformM, snapNormal, snapPoint } = req.body;
  // Inlay (farbiger Boden-Slab für Zweifarb-Druck) ist opt-in: kostet einen
  // zweiten Boolean + große Vernetzung (~2,5 Min). Standard aus → schneller.
  // Gilt nur für VERTIEFT; bei ERHABEN ist das "Inlay" die Schrift selbst (immer).
  const wantInlay = req.body.wantInlay === true;
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

    let solidOCCT = stlToOCCTSolid(oc, stlBuf);
    console.log('[debug] solidOCCT:', solidOCCT ? 'vorhanden' : 'NULL');
    if (!solidOCCT) return res.json({ error: 'STL → OCCT Solid fehlgeschlagen' });
    console.log('[stl2occt] ShapeType value:', solidOCCT.ShapeType().value);
    solidOCCT = unifySolid(oc, solidOCCT);   // Hebel 1: Flächen vereinfachen → schnellerer Cut

    // 2. SVG-Extrusion(en) aufbauen und Boolean Cut durchführen
    const { scale, cx, cy } = svgTransformM;
    let depthMM = svgTransformM.depthMM;
    const emboss = depthMM < 0;            // negativ = erhaben (Schrift steht raus)
    const EMBOSS_BOND = 0.6;               // mm, wie tief die erhabene Schrift ins Teil bondet
    console.log('[debug] depthMM:', depthMM, emboss ? '(ERHABEN)' : '(vertieft)', 'svgSize:', svgTransformM.svgSize, 'scale:', scale, 'cx:', cx?.toFixed(2), 'cy:', cy?.toFixed(2));
    const normF = 2 / (svgTransformM.svgSize || 50);  // unused: normF=1 in buildSvgSolid
    // Hebel: Glyph-Konturen vereinfachen (mm). Standard 0.12 (unter Druckauflösung);
    // per Request überschreibbar, 0 = aus (für A/B-Messung).
    const simplifyMM = (typeof req.body.simplifyMM === 'number') ? req.body.simplifyMM : 0.12;

    // Material immer ≥ FLOOR_MM stehen lassen → immer eine Prägung, nie ein
    // Durchbruch (nur bei VERTIEFT relevant; erhaben fügt Material hinzu).
    const FLOOR_MM = 0.7;  // Restboden: dünner (0.3) → OCCT vernetzt den Boden mit
                           // Splittern (degenerierter Boolean). 0.7 mm bleibt sauber.
    if (!emboss && snapNormal && snapPoint) {
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

    // Prisma-Bereich (lokal Y) je nach Modus:
    //   vertieft: -OVERLAP … depth   (ragt außen raus, schneidet rein)
    //   erhaben:  depth(<0) … +BOND  (steht außen raus, bondet innen ins Teil)
    function buildAndTransform(pathInfo) {
      const yStart = emboss ? depthMM : -SVG_OVERLAP_MM;
      const yEnd   = emboss ? EMBOSS_BOND : depthMM;
      const s = buildSvgSolid(oc, pathInfo, scale, cx, cy, normF, yStart, yEnd, simplifyMM);
      if (!s) return null;
      if (!(svgHoleMatrixElements?.length === 16)) return s;
      const e = svgHoleMatrixElements;
      const trsf = new oc.gp_Trsf_1();
      trsf.SetValues(e[0],e[4],e[8],e[12], e[1],e[5],e[9],e[13], e[2],e[6],e[10],e[14]);
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
      const s = buildAndTransform(svgPathData[i]);
      if (s) tools.push({i, s});
      else   console.log(`[path-${i}] kein Shape`);
    }
    if (!tools.length) return res.json({ error: 'Keine SVG-Formen aufgebaut' });

    const keep = [];
    let tool;
    if (tools.length === 1) {
      tool = tools[0].s;
    } else {
      // Einmal-Fuse: alle Prismen in EINEM BOP verschmelzen statt 18× sequenziell.
      // ~20× schneller bei identischem Ergebnis (verifiziert in bench_fuse.js).
      // Bei Fehler Fallback auf das alte sequenzielle Verfahren.
      try {
        const fuse = new oc.BRepAlgoAPI_Fuse_1();
        const args = new oc.TopTools_ListOfShape_1();
        const tl   = new oc.TopTools_ListOfShape_1();
        args.Append_1(tools[0].s);
        for (let k = 1; k < tools.length; k++) tl.Append_1(tools[k].s);
        fuse.SetArguments(args);
        fuse.SetTools(tl);
        fuse.Build();
        if (!fuse.IsDone()) throw new Error('Fuse nicht IsDone');
        tool = fuse.Shape();
        keep.push(fuse);
        console.log(`[cut] ${tools.length} Prismen in 1 BOP gefust`);
      } catch (e) {
        console.log(`[fuse] Einmal-Fuse fehlgeschlagen (${e.message}) → sequenzieller Fallback`);
        tool = tools[0].s;
        for (let k = 1; k < tools.length; k++) {
          try {
            const f = new oc.BRepAlgoAPI_Fuse_3(tool, tools[k].s); f.Build();
            if (f.IsDone()) { tool = f.Shape(); keep.push(f); }
            else { f.delete(); console.log(`[fuse path-${tools[k].i}] FAIL — Glyph fällt raus`); }
          } catch(e2) { console.log(`[fuse path-${tools[k].i}] EXCEPTION ${e2.message}`); }
        }
      }
    }
    console.log(`[cut] ${tools.length} Prismen gefust → 1 Werkzeug`);

    let result, inlayB64 = null, cut = null;
    if (emboss) {
      // ERHABEN: Teil bleibt unverändert; die erhabene Schrift (Werkzeug) ist der
      // farbige Körper, der außen auf der Wand steht und innen ins Teil bondet.
      result = solidOCCT;
      try {
        const inlayBuf = solidToSTLBuffer(oc, tool);
        inlayB64 = inlayBuf.toString('base64');
        console.log(`[emboss] erhabene Schrift ${inlayBuf.length} Bytes`);
      } catch(e) { console.log('[emboss] fehlgeschlagen:', e.message); }
    } else {
      // VERTIEFT: Teil = solid − Werkzeug; farbiger Boden-Slab als Inlay.
      cut = new oc.BRepAlgoAPI_Cut_3(solidOCCT, tool); cut.Build();
      console.log('[cut] IsDone:', cut.IsDone());
      if (!cut.IsDone()) { cut.delete(); return res.json({ error: 'Boolean Cut fehlgeschlagen' }); }
      result = cut.Shape();
      if (wantInlay) try {
        const com = new oc.BRepAlgoAPI_Common_3(solidOCCT, tool); com.Build();
        if (com.IsDone()) {
          let inlayShape = com.Shape();
          if (svgHoleMatrixElements?.length === 16) {
            const ft = Math.max(0.2, depthMM * 0.5);  // Boden-Dicke, Rest bleibt offen
            const box = new oc.BRepPrimAPI_MakeBox_2(
              new oc.gp_Pnt_3(-300, depthMM - ft, -300), 600, ft + 1.0, 600).Shape();
            const e = svgHoleMatrixElements;
            const trsf = new oc.gp_Trsf_1();
            trsf.SetValues(e[0],e[4],e[8],e[12], e[1],e[5],e[9],e[13], e[2],e[6],e[10],e[14]);
            const xf = new oc.BRepBuilderAPI_Transform_2(box, trsf, false); trsf.delete();
            const slab = xf.IsDone() ? xf.Shape() : null; xf.delete();
            if (slab) {
              const com2 = new oc.BRepAlgoAPI_Common_3(inlayShape, slab); com2.Build();
              if (com2.IsDone()) inlayShape = com2.Shape();
              com2.delete();
            }
          }
          const inlayBuf = solidToSTLBuffer(oc, inlayShape);
          inlayB64 = inlayBuf.toString('base64');
          console.log(`[inlay] Boden-Slab ${inlayBuf.length} Bytes`);
        } else console.log('[inlay] Common nicht fertig');
        com.delete();
      } catch(e) { console.log('[inlay] fehlgeschlagen:', e.message); }
    }

    // 3. Ergebnis → STL
    const outBuf = solidToSTLBuffer(oc, result);
    if (cut) cut.delete();
    for (const f of keep) { try { f.delete(); } catch(_) {} }
    console.log(`[occt-subtract] OK — ${tools.length} Pfade, ${emboss ? 'ERHABEN' : 'vertieft'}, ${outBuf.length} Bytes`);
    res.json({ resultStlBase64: outBuf.toString('base64'), inlayStlBase64: inlayB64 });

  } catch (e) {
    console.error('[occt-subtract] Fehler:', e);
    res.json({ error: e.message || String(e) });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', occtReady: !!_oc }));

// ── Ein-Klick: Hohlkörper mit abnehmbarem, selbstzentrierendem Deckel ───────
// In:  { stlBase64, wall=2, cutAt=0.5, lipDepth=5, clear=0.25, boreDia=0,
//        ringLip=true }
// Out: { bodyStlBase64, lidStlBase64 } | { error }
// Reine Hohlkörper-Pipeline (ohne HTTP). Gibt { bodyStlBase64, lidStlBase64 }
// oder { error } zurück. Wird vom Worker-Prozess (occt-hollow-worker.js)
// aufgerufen, damit ein hängender Boolean (z. B. bei konkaven/mehrteiligen
// Meshes wie einem Auto) per Timeout killbar ist und NICHT den Hauptserver
// blockiert (der sonst auch den SVG-Abzug für alle lahmlegt).
async function computeHollowLid(oc, opts) {
  const b = opts || {};
  if (!b.stlBase64) return { error: 'stlBase64 fehlt' };
  const num      = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const wall     = num(b.wall, 2);
  const cutAt    = num(b.cutAt, 0.5);
  const lipDepth = num(b.lipDepth, 5);
  const clear    = num(b.clear, 0.25);
  const boreDia  = num(b.boreDia, 0);
  const ringLip  = b.ringLip !== false;   // Default: Ring (Material/Druckzeit sparen)

  const keep = [];   // BOP-Objekte am Leben halten bis nach der Vernetzung
  try {
    const rawBuf = Buffer.from(b.stlBase64, 'base64');
    console.log(`[hollow-lid] STL ${rawBuf.length} B, wall=${wall} cutAt=${cutAt} ` +
                `lip=${lipDepth} clear=${clear} bore=${boreDia} ring=${ringLip}`);

    // Vorschritt — Mesh-Decimate für dichte Meshes (KI-Modelle). Über DENSE
    // Dreiecken werden die Vertices geclustert → Vernähen + Booleans deutlich
    // schneller. Opt-out via decimate:false, Gitterauflösung via decimateGrid.
    const DENSE = 20000;
    const allTris = parseSTLBinary(rawBuf);
    let stlBuf = rawBuf, decimated = false;
    if (b.decimate !== false && allTris.length > DENSE) {
      const gridN = num(b.decimateGrid, 96);
      const dec = decimateTrianglesGrid(allTris, gridN);
      console.log(`[hollow-lid] decimate ${allTris.length} → ${dec.length} Dreiecke (grid ${gridN})`);
      if (dec.length >= 100 && dec.length < allTris.length) { stlBuf = trisToStlBuffer(dec); decimated = true; }
    }

    // Schritt 0 — Repair (Sew → MakeSolid → ShapeFix, in stlToOCCTSolid gekapselt)
    let original = stlToOCCTSolid(oc, stlBuf);
    // Decimation kann ein dünnwandiges/nicht-mehr-wasserdichtes Mesh erzeugen →
    // wenn dann kein gültiger Solid: einmal mit dem Originalmesh wiederholen.
    if (decimated && (!original || original.ShapeType().value !== 2)) {
      console.log('[hollow-lid] Decimat-Solid ungültig → Fallback auf Originalmesh');
      original = stlToOCCTSolid(oc, rawBuf);
    }
    if (!original) return { error: 'Repair fehlgeschlagen: STL → OCCT Solid nicht möglich' };
    if (original.ShapeType().value !== 2)   // 2 = TopAbs_SOLID
      return { error: 'Kein gültiger Solid nach Repair — Mesh nicht wasserdicht (Self-Intersections/Löcher)' };
    original = unifySolid(oc, original);     // koplanare Faces vereinen → schnellere Booleans

    // Schritt 1 — Bounding Box + Skalierfaktor
    const bb = getBBoxNum(oc, original);
    if (!bb) return { error: 'Bounding Box leer' };
    const dx = bb.xMax - bb.xMin, dy = bb.yMax - bb.yMin, dz = bb.zMax - bb.zMin;
    const cx = (bb.xMin + bb.xMax) / 2, cy = (bb.yMin + bb.yMax) / 2, cz = (bb.zMin + bb.zMax) / 2;
    const minDim = Math.min(dx, dy, dz);
    const EPS = 1e-4;
    if (minDim <= 2 * wall + EPS)
      return { error: `Modell zu klein/flach: kleinste Abmessung ${minDim.toFixed(2)}mm ≤ 2×Wandstärke ${(2*wall).toFixed(2)}mm` };
    const s = (minDim - 2 * wall) / minDim;
    console.log(`[hollow-lid] bbox dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} dz=${dz.toFixed(1)} minDim=${minDim.toFixed(1)} s=${s.toFixed(4)}`);

    // großzügige X/Y-Ausdehnung + Z-Padding für die Schnitt-/Falz-Boxen
    const bigXY = 4 * Math.max(dx, dy) + 10;
    const x0 = cx - bigXY / 2, y0 = cy - bigXY / 2;
    const pad = Math.max(dx, dy, dz) + 10;
    const zCut = bb.zMin + cutAt * dz;

    // Schritt 2 — Aushöhlen: inner um den MITTELPUNKT skaliert, dann original − inner
    const inner = scaleAbout(oc, original, s, cx, cy, cz);
    if (!inner) return { error: 'Aushöhlen: Innenkörper-Skalierung fehlgeschlagen' };
    const hollow = bop(oc, 'BRepAlgoAPI_Cut_3', original, inner, keep, 'Aushöhlen-Cut');

    // Schritt 3 — Deckel abtrennen (öffnet zugleich den Hohlraum)
    const boxBody = makeBox(oc, x0, y0, bb.zMin - pad, bigXY, bigXY, (zCut - (bb.zMin - pad)));
    const boxLid  = makeBox(oc, x0, y0, zCut,          bigXY, bigXY, (bb.zMax + pad - zCut));
    const body0   = bop(oc, 'BRepAlgoAPI_Common_3', hollow, boxBody, keep, 'Body-Common');
    const lidCap  = bop(oc, 'BRepAlgoAPI_Common_3', hollow, boxLid,  keep, 'Lid-Common');

    // Schritt 4 — Selbstzentrierender Innen-Falz
    const minDimS = minDim * s;                       // Innenmaß
    const sClear  = (minDimS - 2 * clear) / minDimS;  // Falz minimal kleiner als Hohlraum
    const plug    = scaleAbout(oc, inner, sClear, cx, cy, cz);
    if (!plug) return { error: 'Falz: Plug-Skalierung fehlgeschlagen' };
    // Box von zCut-lipDepth bis zCut+0.5 (0.5mm Überlapp mit lidCap = sauberer Fuse)
    const lipBox  = makeBox(oc, x0, y0, zCut - lipDepth, bigXY, bigXY, lipDepth + 0.5);
    let lip = bop(oc, 'BRepAlgoAPI_Common_3', plug, lipBox, keep, 'Falz-Common');
    if (ringLip) {
      // Vollpfropfen vermeiden: Ring = lipSolid − (innerer 85%-Plug ∩ gleiche Box)
      const plugHollow = scaleAbout(oc, plug, 0.85, cx, cy, cz);
      if (plugHollow) {
        const lipBox2 = makeBox(oc, x0, y0, zCut - lipDepth, bigXY, bigXY, lipDepth + 0.5);
        const innerCore = bop(oc, 'BRepAlgoAPI_Common_3', plugHollow, lipBox2, keep, 'Ring-Innen-Common');
        lip = bop(oc, 'BRepAlgoAPI_Cut_3', lip, innerCore, keep, 'Ring-Cut');
      } else {
        console.log('[hollow-lid] Ring-Innenskalierung fehlgeschlagen → Vollpfropfen-Falz');
      }
    }
    const lid = bop(oc, 'BRepAlgoAPI_Fuse_3', lidCap, lip, keep, 'Lid-Fuse');

    // Schritt 5 — Bohrung (nur body, nur wenn boreDia > 0)
    let body = body0;
    if (boreDia > 0) {
      const ap  = new oc.gp_Pnt_3(cx, cy, bb.zMin - pad);
      const ad  = new oc.gp_Dir_4(0, 0, 1);
      const ax  = new oc.gp_Ax2_3(ap, ad);
      const cyl = new oc.BRepPrimAPI_MakeCylinder_3(ax, boreDia / 2, dz + 2 * pad);
      const bore = cyl.Shape();
      ap.delete(); ad.delete(); ax.delete(); cyl.delete();
      body = bop(oc, 'BRepAlgoAPI_Cut_3', body0, bore, keep, 'Bohrung-Cut');
    }

    // Output: zwei binäre STL → base64
    const bodyBuf = solidToSTLBuffer(oc, body);
    const lidBuf  = solidToSTLBuffer(oc, lid);
    console.log(`[hollow-lid] OK — body ${bodyBuf.length} B, lid ${lidBuf.length} B`);
    return { bodyStlBase64: bodyBuf.toString('base64'), lidStlBase64: lidBuf.toString('base64') };
  } catch (e) {
    console.error('[hollow-lid] Fehler:', e);
    return { error: e.message || String(e) };
  } finally {
    for (const op of keep) { try { op.delete(); } catch (_) {} }
  }
}

// Endpoint: Berechnung in EINEM Worker-Prozess mit hartem Timeout. Ein hängender
// Boolean kann so gekillt werden (synchroner WASM-Code ist im selben Prozess
// nicht unterbrechbar) und blockiert den Hauptserver nicht.
const HOLLOW_TIMEOUT_MS = parseInt(process.env.HOLLOW_TIMEOUT_MS, 10) || 75000;
app.post('/api/occt-hollow-lid', (req, res) => {
  const b = req.body || {};
  if (!b.stlBase64) return res.json({ error: 'stlBase64 fehlt' });
  const { spawn } = require('child_process');
  const os = require('os');
  const stamp   = Date.now() + '-' + Math.random().toString(36).slice(2);
  const inFile  = path.join(os.tmpdir(), `hl-in-${stamp}.json`);
  const outFile = path.join(os.tmpdir(), `hl-out-${stamp}.json`);
  try { fs.writeFileSync(inFile, JSON.stringify(b)); }
  catch (e) { return res.json({ error: 'Tempdatei: ' + e.message }); }

  const worker = spawn(process.execPath,
    [path.join(__dirname, 'occt-hollow-worker.js'), inFile, outFile],
    { stdio: ['ignore', 'inherit', 'inherit'] });

  let done = false;
  const cleanup = () => { for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch (_) {} } };
  const finish  = (obj) => { if (done) return; done = true; clearTimeout(timer); cleanup(); res.json(obj); };

  const timer = setTimeout(() => {
    if (done) return;
    console.log('[hollow-lid] Timeout — Worker gekillt');
    try { worker.kill('SIGKILL'); } catch (_) {}
    finish({ error: 'Berechnung nach 75 s abgebrochen — Modell ungeeignet (zu komplex, konkav oder mehrteilig). Für den Hohlkörper eine geschlossene, container-artige Form verwenden.' });
  }, HOLLOW_TIMEOUT_MS);

  worker.on('exit', (code) => {
    if (done) return;
    let result;
    try { result = JSON.parse(fs.readFileSync(outFile, 'utf8')); }
    catch (e) { result = { error: code === 0 ? ('Ergebnis nicht lesbar: ' + e.message) : ('Worker-Absturz (Code ' + code + ')') }; }
    finish(result);
  });
  worker.on('error', (e) => finish({ error: 'Worker-Start fehlgeschlagen: ' + e.message }));
});

// ── Echter Boolean-Union: mehrere Körper (je STL) → EIN wasserdichtes Solid ──
// Behebt das "schwebende Regionen"-Problem im Slicer: getrennte, sich
// durchdringende Hüllen (wie sie die reine Gruppierung ∪ erzeugt) werden per
// BRepAlgoAPI_Fuse zu einem manifolden Volumen verschmolzen.
// Ablauf je Körper: Sew → MakeSolid (in stlToOCCTSolid), dann sequenzielles
// Fuse aller Körper, dann UnifySameDomain (koplanare Flächen verschmelzen).
app.post('/api/occt-union', async (req, res) => {
  const b = req.body || {};
  const list = Array.isArray(b.stlsBase64) ? b.stlsBase64 : null;
  if (!list || !list.length) return res.json({ error: 'stlsBase64 (Array) fehlt' });

  const keep = [];   // BOP-Objekte am Leben halten bis nach der Vernetzung
  try {
    const oc = await getOC();

    // Jeder Körper → eigenes Solid. Durchdringungen löst erst das Fuse, daher
    // bewusst NICHT vorher zu einer einzigen Triangle-Soup zusammenführen.
    const solids = [];
    for (let i = 0; i < list.length; i++) {
      try {
        const buf = Buffer.from(list[i], 'base64');
        const s = stlToOCCTSolid(oc, buf);
        if (!s) { console.log(`[union] Körper ${i}: STL → Solid fehlgeschlagen, übersprungen`); continue; }
        solids.push(s);
      } catch (e) { console.log(`[union] Körper ${i}: ${e.message}`); }
    }
    if (!solids.length) return res.json({ error: 'Kein Körper ergab ein gültiges Solid' });

    let result = solids[0];
    for (let i = 1; i < solids.length; i++)
      result = bop(oc, 'BRepAlgoAPI_Fuse_3', result, solids[i], keep, `Union-Fuse ${i}`);

    result = unifySolid(oc, result);   // koplanare Flächen verschmelzen → sauberes Mesh
    const outBuf = solidToSTLBuffer(oc, result);
    console.log(`[union] OK — ${solids.length}/${list.length} Körper → ${outBuf.length} B STL`);
    res.json({ stlBase64: outBuf.toString('base64'), bodies: solids.length });
  } catch (e) {
    console.error('[union] Fehler:', e);
    res.json({ error: e.message || String(e) });
  } finally {
    for (const op of keep) { try { op.delete(); } catch (_) {} }
  }
});

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
// Nur als eigenständiger Prozess den Server starten. Beim `require()` (z. B. aus
// dem Bench-/Test-Skript) bleibt der Listener aus, damit Port 3001 frei bleibt.
if (require.main === module) {
  https.createServer(creds, app).listen(PORT, '0.0.0.0', () => {
    console.log(`OCCT-Server läuft auf https://v3da.tailf05fe9.ts.net:${PORT}`);
    getOC()
      .then(() => console.log('OCCT bereit'))
      .catch(e  => console.error('OCCT Init Fehler:', e.message));
  });
}

module.exports = { getOC, buildSvgSolid, stlToOCCTSolid, solidToSTLBuffer,
                   buildMatrixFromSnapNormal, parseSTLBinary, simplifyDP,
                   unifySolid, getBBoxNum, scaleAbout, makeBox, bop,
                   decimateTrianglesGrid, trisToStlBuffer, computeHollowLid,
                   app, SVG_OVERLAP_MM };
