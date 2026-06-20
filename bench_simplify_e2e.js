'use strict';
// A/B über den echten Endpunkt: dicht tessellierte Glyphen, einmal ohne (simplifyMM=0)
// und einmal mit Kontur-Vereinfachung. Vergleicht Ergebnis-Dreiecke + Bytes + Zeit.
const https = require('https');

function denseBoxSTL(W,H,D,N){
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
// dichte Glyphen: 200-Segment-Kreise (~ Font-Kurven-Tessellation)
function makePaths(n,seg){const paths=[];for(let i=0;i<n;i++){const ox=(i%6)*14,oy=Math.floor(i/6)*14,pts=[];for(let a=0;a<seg;a++){const t=(a/seg)*Math.PI*2;pts.push([ox+6+Math.cos(t)*6,oy+6+Math.sin(t)*6]);}paths.push({pts,holes:[]});}return paths;}
function countTris(b64){const buf=Buffer.from(b64,'base64');return buf.length>=84?buf.readUInt32LE(80):0;}

function runCut(stlB64, paths, simplifyMM){
  const W=155,H=127,D=8;
  const body=JSON.stringify({stlBase64:stlB64,svgPathData:paths,
    svgTransformM:{scale:1.0,cx:42,cy:28,svgSize:50,depthMM:3},
    snapNormal:{x:0,y:0,z:1},snapPoint:{x:W/2,y:H/2,z:D},wantInlay:false,simplifyMM});
  const opts={method:'POST',host:'127.0.0.1',port:3001,path:'/api/occt-subtract',rejectUnauthorized:false,
    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}};
  const t=Date.now();
  return new Promise((resolve,reject)=>{const req=https.request(opts,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({ms:Date.now()-t,data:d}));});req.on('error',reject);req.write(body);req.end();});
}

(async()=>{
  const stl=denseBoxSTL(155,127,8,18).toString('base64');
  const paths=makePaths(19,200);
  for (const simplifyMM of [0, 0.12]) {
    const {ms,data}=await runCut(stl,paths,simplifyMM);
    let j;try{j=JSON.parse(data);}catch{console.log('kein JSON:',data.slice(0,160));process.exit(1);}
    if(j.error){console.log(`[simplifyMM=${simplifyMM}] Fehler:`,j.error);continue;}
    const nt=countTris(j.resultStlBase64), by=Buffer.from(j.resultStlBase64,'base64').length;
    console.log(`[simplifyMM=${simplifyMM}] ${ms} ms — Ergebnis ${nt} Dreiecke, ${by} Bytes`);
  }
  process.exit(0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
