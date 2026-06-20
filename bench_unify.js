'use strict';
// Misst Hebel 1: Solid vor dem Boolean-Cut mit ShapeUpgrade_UnifySameDomain
// vereinfachen (koplanare Flächen zusammenfassen). Vergleicht Flächenzahl, Cut-Zeit
// und Volumen ohne vs. mit Unify auf einem dicht triangulierten (flachwandigen) STL.
const { getOC, buildSvgSolid, stlToOCCTSolid, SVG_OVERLAP_MM } = require('./occt-server.js');

// Box (W,H,D) mit jeder Seite in N×N Zellen unterteilt → viele koplanare Dreiecke
function denseBoxSTL(W, H, D, N) {
  const tris = [];
  const quad = (p, du, dv, nu, nv, n) => {
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = [p[0]+du[0]*i/nu+0,       p[1]+du[1]*i/nu,       p[2]+du[2]*i/nu];
      const A = k => [p[0]+du[0]*( (k>>0&1)? (i+1):i )/nu + dv[0]*((k>>1&1)?(j+1):j)/nv,
                      p[1]+du[1]*( (k>>0&1)? (i+1):i )/nu + dv[1]*((k>>1&1)?(j+1):j)/nv,
                      p[2]+du[2]*( (k>>0&1)? (i+1):i )/nu + dv[2]*((k>>1&1)?(j+1):j)/nv];
      const v00=A(0), v10=A(1), v01=A(2), v11=A(3);
      tris.push([v00,v10,v11,n]); tris.push([v00,v11,v01,n]);
    }
  };
  // 6 Seiten
  quad([0,0,0],[W,0,0],[0,H,0],N,N,[0,0,-1]);
  quad([0,0,D],[W,0,0],[0,H,0],N,N,[0,0,1]);
  quad([0,0,0],[W,0,0],[0,0,D],N,N,[0,-1,0]);
  quad([0,H,0],[W,0,0],[0,0,D],N,N,[0,1,0]);
  quad([0,0,0],[0,H,0],[0,0,D],N,N,[-1,0,0]);
  quad([W,0,0],[0,H,0],[0,0,D],N,N,[1,0,0]);

  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const [p0,p1,p2,n] of tris) {
    buf.writeFloatLE(n[0],o); buf.writeFloatLE(n[1],o+4); buf.writeFloatLE(n[2],o+8);
    let oo=o+12; for (const p of [p0,p1,p2]) { buf.writeFloatLE(p[0],oo); buf.writeFloatLE(p[1],oo+4); buf.writeFloatLE(p[2],oo+8); oo+=12; }
    o += 50;
  }
  return buf;
}

function makePaths(n) {
  const paths = [];
  for (let i = 0; i < n; i++) {
    const ox=(i%6)*14, oy=Math.floor(i/6)*14;
    if (i%2===0){ const pts=[]; for(let a=0;a<24;a++){const t=(a/24)*Math.PI*2;pts.push([ox+6+Math.cos(t)*6,oy+6+Math.sin(t)*6]);} paths.push({pts,holes:[]}); }
    else paths.push({ pts:[[ox,oy],[ox+11,oy],[ox+11,oy+11],[ox,oy+11]], holes:[] });
  }
  return paths;
}

function countFaces(oc, shape) {
  let n=0; const e=new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while(e.More()){n++;e.Next();} e.delete(); return n;
}
function volume(oc, shape){ try{ const p=new oc.GProp_GProps_1(); oc.BRepGProp.VolumeProperties_1(shape,p,false,false,false); const v=p.Mass(); p.delete(); return v; }catch(e){return NaN;} }

function buildTool(oc) {
  const shapes = makePaths(19).map(p => buildSvgSolid(oc,p,1.0,0,0,1,-SVG_OVERLAP_MM,5)).filter(Boolean);
  const fuse=new oc.BRepAlgoAPI_Fuse_1(); const a=new oc.TopTools_ListOfShape_1(), t=new oc.TopTools_ListOfShape_1();
  a.Append_1(shapes[0]); for(let k=1;k<shapes.length;k++)t.Append_1(shapes[k]);
  fuse.SetArguments(a); fuse.SetTools(t); fuse.Build(); return fuse.Shape();
}
// Werkzeug auf die Oberseite (z=D) transformieren, mittig
function placeTool(oc, tool, W, H, D) {
  const trsf=new oc.gp_Trsf_1();
  // lokal: Glyphen in XY, Extrusion +Y. Wir kippen +Y→+Z (auf Oberseite) grob:
  trsf.SetValues(1,0,0, W/2-42,  0,0,-1, D,  0,1,0, H/2-28);
  const xf=new oc.BRepBuilderAPI_Transform_2(tool,trsf,false); trsf.delete();
  return xf.IsDone()?xf.Shape():tool;
}

function timedCut(oc, solid, tool) {
  const t=Date.now(); const cut=new oc.BRepAlgoAPI_Cut_3(solid,tool); cut.Build();
  const ok=cut.IsDone(); const sh=ok?cut.Shape():null; return { ms:Date.now()-t, ok, shape:sh };
}

(async () => {
  const oc = await getOC();
  console.log('OCCT geladen.');
  for (const n of ['ShapeUpgrade_UnifySameDomain_1','ShapeUpgrade_UnifySameDomain_3'])
    console.log(`  ${typeof oc[n]!=='undefined'?'✓':'✗'} ${n}`);

  const W=155, H=127, D=8, N=18;
  const stl = denseBoxSTL(W,H,D,N);
  console.log(`\nTest-STL: ${stl.readUInt32LE(80)} Dreiecke`);
  const solid = stlToOCCTSolid(oc, stl);
  if (!solid) { console.log('✗ Solid-Aufbau fehlgeschlagen'); process.exit(1); }
  console.log(`Solid-Flächen (roh): ${countFaces(oc, solid)}`);

  // Ohne Unify
  let tool = placeTool(oc, buildTool(oc), W,H,D);
  const r1 = timedCut(oc, solid, tool);
  console.log(`\n[ohne Unify] Cut ${r1.ms} ms, IsDone=${r1.ok}, Volumen=${volume(oc,r1.shape).toFixed(1)}`);

  // Mit Unify
  const tU=Date.now();
  const up = new oc.ShapeUpgrade_UnifySameDomain_1();
  const init = up.Initialize_1 || up.Initialize;
  init.call(up, solid, true, true, false);
  up.Build(); const solidU = up.Shape();
  const unifyMs = Date.now()-tU;
  console.log(`[Unify] ${unifyMs} ms, Flächen ${countFaces(oc,solid)} → ${countFaces(oc,solidU)}`);
  let tool2 = placeTool(oc, buildTool(oc), W,H,D);
  const r2 = timedCut(oc, solidU, tool2);
  console.log(`[mit Unify]  Cut ${r2.ms} ms, IsDone=${r2.ok}, Volumen=${volume(oc,r2.shape).toFixed(1)}`);

  const v1=volume(oc,r1.shape), v2=volume(oc,r2.shape);
  const dv=Math.abs(v1-v2)/Math.max(v1,1);
  const total1=r1.ms, total2=unifyMs+r2.ms;
  console.log(`\nVolumen-Abweichung: ${(dv*100).toFixed(3)} %`);
  console.log(`Gesamt ohne Unify: ${total1} ms   mit Unify (inkl. Unify-Zeit): ${total2} ms`);
  console.log(`Netto-Speedup: ${(total1/Math.max(total2,1)).toFixed(1)}×`);
  process.exit(dv>0.01 ? 3 : 0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
