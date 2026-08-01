'use strict';
// Wie skaliert der Fuse mit der Dreieckszahl? Kugeln wachsender Auflösung
// (wasserdicht) je einmal mit einer überlappenden Box fusen.
const { getOC, stlToOCCTSolid, bop, trisToStlBuffer } = require('./occt-server.js');

function sphere(seg, r, cx){                       // wasserdichte UV-Kugel
  const tris=[], P=(i,j)=>{
    const th=Math.PI*i/seg, ph=2*Math.PI*j/seg;
    return [cx+r*Math.sin(th)*Math.cos(ph), r*Math.sin(th)*Math.sin(ph), r*Math.cos(th)];
  };
  for(let i=0;i<seg;i++) for(let j=0;j<seg;j++){
    const a=P(i,j), b=P(i+1,j), c=P(i+1,j+1), d=P(i,j+1);
    tris.push([a,b,c],[a,c,d]);
  }
  return tris;
}
function box(x0,x1,y0,y1,z0,z1){
  const V=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const F=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return F.map(f=>f.map(i=>V[i]));
}
(async()=>{
  const oc=await getOC(), keep=[], warn=[];
  for(const seg of [10,18,26,40,56]){
    const tris=sphere(seg,10,0), n=tris.length;
    const a=stlToOCCTSolid(oc, trisToStlBuffer(tris), keep, warn);
    const b=stlToOCCTSolid(oc, trisToStlBuffer(box(5,15,-2,2,-2,2)), keep, warn);
    if(!a||!b){ console.log(n,'kein Solid'); continue; }
    const t=Date.now();
    try{ bop(oc,'BRepAlgoAPI_Fuse_3',a,b,keep,'cap'); console.log(`${String(n).padStart(6)} Dreiecke → Fuse ${Date.now()-t} ms`); }
    catch(e){ console.log(`${n} Dreiecke: FEHLER ${e.message}`); }
  }
})().catch(e=>{console.error('FEHLER:',e.message||e);process.exit(1);});
