'use strict';
// End-to-End-Test: POSTet einen echten SVG-Cut an den laufenden occt-server und
// misst Antwortzeit + prüft, dass ein gültiges Ergebnis-STL zurückkommt.
// Dient als Regressions-/Sicherheitsnetz für die Cut-Pipeline.
const https = require('https');

// ── Binäres Box-STL erzeugen (0,0,0)…(W,H,D) ────────────────────────────────
function boxSTL(W, H, D) {
  const v = [[0,0,0],[W,0,0],[W,H,0],[0,H,0],[0,0,D],[W,0,D],[W,H,D],[0,H,D]];
  const q = [ // [a,b,c,d, nx,ny,nz]
    [0,3,2,1, 0,0,-1],[4,5,6,7, 0,0,1],
    [0,1,5,4, 0,-1,0],[3,7,6,2, 0,1,0],
    [0,4,7,3, -1,0,0],[1,2,6,5, 1,0,0],
  ];
  const tris = [];
  for (const [a,b,c,d,nx,ny,nz] of q) {
    tris.push([v[a],v[b],v[c],[nx,ny,nz]]);
    tris.push([v[a],v[c],v[d],[nx,ny,nz]]);
  }
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const [p0,p1,p2,n] of tris) {
    buf.writeFloatLE(n[0],o); buf.writeFloatLE(n[1],o+4); buf.writeFloatLE(n[2],o+8);
    let oo = o+12;
    for (const p of [p0,p1,p2]) { buf.writeFloatLE(p[0],oo); buf.writeFloatLE(p[1],oo+4); buf.writeFloatLE(p[2],oo+8); oo+=12; }
    o += 50;
  }
  return buf;
}

function makePaths(n) {
  const paths = [];
  for (let i = 0; i < n; i++) {
    const ox = (i % 6) * 14, oy = Math.floor(i / 6) * 14;
    if (i % 2 === 0) {
      const pts = [];
      for (let a = 0; a < 24; a++) { const t=(a/24)*Math.PI*2; pts.push([ox+6+Math.cos(t)*6, oy+6+Math.sin(t)*6]); }
      paths.push({ pts, holes: [] });
    } else {
      paths.push({ pts: [[ox,oy],[ox+11,oy],[ox+11,oy+11],[ox,oy+11]], holes: [] });
    }
  }
  return paths;
}

function countTris(b64) {
  const buf = Buffer.from(b64, 'base64');
  return buf.length >= 84 ? buf.readUInt32LE(80) : 0;
}

function runCut(wantInlay) {
  const W=140, H=120, D=8;                 // dünne Platte, Wand 8mm
  const stl = boxSTL(W, H, D);
  const body = JSON.stringify({
    stlBase64: stl.toString('base64'),
    svgPathData: makePaths(19),
    svgTransformM: { scale: 1.0, cx: 42, cy: 28, svgSize: 50, depthMM: 3 },
    snapNormal: { x: 0, y: 0, z: 1 },      // SVG auf Oberseite (+Z)
    snapPoint:  { x: W/2, y: H/2, z: D },
    wantInlay,
  });
  const opts = { method: 'POST', host: '127.0.0.1', port: 3001,
    path: '/api/occt-subtract', rejectUnauthorized: false,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
  const t = Date.now();
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => { let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>resolve({ ms: Date.now()-t, data: d })); });
    req.on('error', reject); req.write(body); req.end();
  });
}

(async () => {
  let fail = false;
  for (const wantInlay of [false, true]) {
    const { ms, data } = await runCut(wantInlay);
    let j; try { j = JSON.parse(data); } catch { console.log('Antwort kein JSON:', data.slice(0,200)); process.exit(1); }
    const tag = wantInlay ? 'mit Inlay ' : 'ohne Inlay';
    if (j.error) { console.log(`✗ [${tag}] Server-Fehler:`, j.error); fail = true; continue; }
    const nt = countTris(j.resultStlBase64);
    const inlay = j.inlayStlBase64 ? countTris(j.inlayStlBase64) : 0;
    console.log(`[${tag}] ${ms} ms — Ergebnis ${nt} Dreiecke, Inlay ${inlay ? inlay+' Dreiecke' : 'keins'}`);
    if (nt < 12) { console.log(`  ✗ Ergebnis zu klein`); fail = true; }
    // Erwartung: ohne Inlay -> keins; mit Inlay -> vorhanden
    if (!wantInlay && inlay) { console.log('  ✗ Inlay trotz opt-out erzeugt'); fail = true; }
    if (wantInlay && !inlay) { console.log('  ✗ Inlay angefordert aber nicht erzeugt'); fail = true; }
  }
  console.log(fail ? '\n✗ Test fehlgeschlagen' : '\n✓ Cut korrekt: Inlay ist opt-in, Ergebnis gültig');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
