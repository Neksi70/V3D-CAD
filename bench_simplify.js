'use strict';
// Misst Hebel: Glyph-Konturen per Douglas-Peucker vereinfachen → weniger
// Stützpunkte → weniger Dreiecke im Cut-Ergebnis. Vergleicht Ergebnis-Dreieckszahl
// voll vs. vereinfacht und die max. Kontur-Abweichung (mm).
const { getOC, buildSvgSolid, stlToOCCTSolid, solidToSTLBuffer, SVG_OVERLAP_MM } = require('./occt-server.js');

// ── Douglas-Peucker auf offener Punktliste [[x,y],...], eps in selber Einheit ──
function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const d2 = (p, a, b) => {            // Abstand^2 Punkt p zu Strecke a-b
    const dx=b[0]-a[0], dy=b[1]-a[1]; const L=dx*dx+dy*dy;
    if (L < 1e-12) { const ex=p[0]-a[0], ey=p[1]-a[1]; return ex*ex+ey*ey; }
    let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L; t=Math.max(0,Math.min(1,t));
    const cx=a[0]+t*dx, cy=a[1]+t*dy; const ex=p[0]-cx, ey=p[1]-cy; return ex*ex+ey*ey;
  };
  const e2 = eps*eps; const keep = new Array(pts.length).fill(false);
  keep[0]=keep[pts.length-1]=true;
  const stack=[[0,pts.length-1]];
  while (stack.length) {
    const [i,j]=stack.pop(); let max=-1, idx=-1;
    for (let k=i+1;k<j;k++){ const dd=d2(pts[k],pts[i],pts[j]); if(dd>max){max=dd;idx=k;} }
    if (max>e2 && idx>0){ keep[idx]=true; stack.push([i,idx],[idx,j]); }
  }
  return pts.filter((_,i)=>keep[i]);
}

// 19 Glyphen mit DICHTEN Konturen (200-Segment-Kreise ~ echte Font-Tessellation)
function makePaths(n, seg) {
  const paths=[];
  for (let i=0;i<n;i++){
    const ox=(i%6)*14, oy=Math.floor(i/6)*14;
    const pts=[]; for(let a=0;a<seg;a++){const t=(a/seg)*Math.PI*2;pts.push([ox+6+Math.cos(t)*6,oy+6+Math.sin(t)*6]);}
    paths.push({pts,holes:[]});
  }
  return paths;
}

function denseBoxSTL(W,H,D,N){ // wie bench_unify
  const tris=[]; const quad=(p,du,dv,nu,nv,n)=>{for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){
    const A=k=>[p[0]+du[0]*((k&1)?i+1:i)/nu+dv[0]*((k&2)?j+1:j)/nv, p[1]+du[1]*((k&1)?i+1:i)/nu+dv[1]*((k&2)?j+1:j)/nv, p[2]+du[2]*((k&1)?i+1:i)/nu+dv[2]*((k&2)?j+1:j)/nv];
    const v00=A(0),v10=A(1),v01=A(2),v11=A(3); tris.push([v00,v10,v11,n]);tris.push([v00,v11,v01,n]);}};
  quad([0,0,0],[W,0,0],[0,H,0],N,N,[0,0,-1]);quad([0,0,D],[W,0,0],[0,H,0],N,N,[0,0,1]);
  quad([0,0,0],[W,0,0],[0,0,D],N,N,[0,-1,0]);quad([0,H,0],[W,0,0],[0,0,D],N,N,[0,1,0]);
  quad([0,0,0],[0,H,0],[0,0,D],N,N,[-1,0,0]);quad([W,0,0],[0,H,0],[0,0,D],N,N,[1,0,0]);
  const buf=Buffer.alloc(84+tris.length*50);buf.writeUInt32LE(tris.length,80);let o=84;
  for(const[p0,p1,p2,n]of tris){buf.writeFloatLE(n[0],o);buf.writeFloatLE(n[1],o+4);buf.writeFloatLE(n[2],o+8);let oo=o+12;for(const p of[p0,p1,p2]){buf.writeFloatLE(p[0],oo);buf.writeFloatLE(p[1],oo+4);buf.writeFloatLE(p[2],oo+8);oo+=12;}o+=50;}
  return buf;
}

function fuseAll(oc, shapes){ const f=new oc.BRepAlgoAPI_Fuse_1();const a=new oc.TopTools_ListOfShape_1(),t=new oc.TopTools_ListOfShape_1();a.Append_1(shapes[0]);for(let k=1;k<shapes.length;k++)t.Append_1(shapes[k]);f.SetArguments(a);f.SetTools(t);f.Build();return f.Shape(); }
function place(oc,tool,W,H,D){const trsf=new oc.gp_Trsf_1();trsf.SetValues(1,0,0,W/2-42, 0,0,-1,D, 0,1,0,H/2-28);const xf=new oc.BRepBuilderAPI_Transform_2(tool,trsf,false);trsf.delete();return xf.IsDone()?xf.Shape():tool;}
function resultTris(oc, solid, paths, W,H,D){
  const shapes=paths.map(p=>buildSvgSolid(oc,p,1.0,0,0,1,-SVG_OVERLAP_MM,5)).filter(Boolean);
  const tool=place(oc,fuseAll(oc,shapes),W,H,D);
  const cut=new oc.BRepAlgoAPI_Cut_3(solid,tool);cut.Build();
  const stl=solidToSTLBuffer(oc,cut.Shape());
  return stl.readUInt32LE(80);
}

(async()=>{
  const oc=await getOC();
  const W=155,H=127,D=8;
  const solid=stlToOCCTSolid(oc,denseBoxSTL(W,H,D,18));
  const seg=200;
  const full=makePaths(19,seg);
  const eps=0.12;  // mm
  const simp=full.map(p=>({pts:douglasPeucker(p.pts,eps),holes:(p.holes||[]).map(h=>douglasPeucker(h,eps))}));

  const ptsFull=full.reduce((s,p)=>s+p.pts.length,0);
  const ptsSimp=simp.reduce((s,p)=>s+p.pts.length,0);
  // max Abweichung messen
  let maxDev=0; for(let i=0;i<full.length;i++){for(const q of full[i].pts){let m=1e9;const s=simp[i].pts;for(let k=0;k<s.length-1;k++){const dx=s[k+1][0]-s[k][0],dy=s[k+1][1]-s[k][1],L=dx*dx+dy*dy;let t=L<1e-9?0:((q[0]-s[k][0])*dx+(q[1]-s[k][1])*dy)/L;t=Math.max(0,Math.min(1,t));const cx=s[k][0]+t*dx,cy=s[k][1]+t*dy;m=Math.min(m,Math.hypot(q[0]-cx,q[1]-cy));}maxDev=Math.max(maxDev,m);}}

  console.log(`Konturpunkte gesamt: ${ptsFull} → ${ptsSimp} (eps=${eps}mm)`);
  console.log(`max. Kontur-Abweichung: ${maxDev.toFixed(3)} mm`);
  const tFull=resultTris(oc,solid,full,W,H,D);
  const tSimp=resultTris(oc,solid,simp,W,H,D);
  console.log(`Ergebnis-Dreiecke: ${tFull} → ${tSimp}  (${(100*(1-tSimp/tFull)).toFixed(0)}% weniger)`);
  process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
