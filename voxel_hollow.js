// ── Voxel-basierte Aushöhlung mit abnehmbarem Deckel ────────────────────────
// Funktioniert auf BELIEBIGEN Meshes (konkav, mehrteilig, KI-generiert), wo die
// Boolean-/Scale-Methode versagt. Ablauf:
//   1. Mesh in ein 3D-Raster voxelisieren (Oberfläche markieren → Außen-Flutfüllung
//      → Innen = nicht außen). Robust gegen Konkavität & mehrere Schalen.
//   2. Distanz-Transform: Tiefe jedes Innen-Voxels bis zur Oberfläche.
//   3. Wand = Innen-Voxel mit Tiefe ≤ Wandstärke (konstante Wand überall).
//   4. Bei zCut in Body (unten) / Deckel (oben) trennen; Zentrier-Falz als
//      Ring innerhalb der Wand an den Deckel hängen; optionale Bohrung im Body.
//   5. Surface-Nets-Meshing der Body- und Deckel-Voxel → STL.
// Reines JS, kein OpenCASCADE. Exportiert hollowLidFromStl(stlBuffer, opts).

function parseSTLBinary(buf) {
  const view = new DataView(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  const nTri = view.getUint32(80, true);
  const t = new Float32Array(nTri * 9);
  for (let i = 0; i < nTri; i++) {
    const o = 84 + i * 50 + 12;
    for (let j = 0; j < 9; j++) t[i*9+j] = view.getFloat32(o + j*4, true);
  }
  return t;
}

function trisToStlBuffer(tris) {              // tris: Float-Array, 9/Dreieck
  const n = tris.length / 9, buf = Buffer.alloc(84 + n * 50);
  buf.write('voxel-hollow', 0, 'ascii');
  buf.writeUInt32LE(n, 80);
  let off = 84;
  for (let i = 0; i < n; i++) {
    off += 12;
    for (let k = 0; k < 9; k++) { buf.writeFloatLE(tris[i*9+k], off); off += 4; }
    buf.writeUInt16LE(0, off); off += 2;
  }
  return buf;
}

// ── Surface Nets (naiv, dual) — glatte, wasserdichte Hülle ohne MC-Tabellen ──
// field: Uint8 Belegung an Gitter-PUNKTEN (1=innen), Index i + nx*(j + ny*k).
function surfaceNets(field, nx, ny, nz, ox, oy, oz, vox) {
  const idx = (i,j,k) => i + nx*(j + ny*k);
  const ncx = nx-1, ncy = ny-1, ncz = nz-1;
  const cellVert = new Int32Array(ncx*ncy*ncz).fill(-1);
  const cidx = (x,y,z) => x + ncx*(y + ncy*z);
  const CO = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const EDGES = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const pos = [];
  for (let z = 0; z < ncz; z++) for (let y = 0; y < ncy; y++) for (let x = 0; x < ncx; x++) {
    let mask = 0; const oc = [];
    for (let n = 0; n < 8; n++) { const v = field[idx(x+CO[n][0], y+CO[n][1], z+CO[n][2])]; oc[n] = v; if (v) mask |= (1<<n); }
    if (mask === 0 || mask === 255) continue;
    let vx=0, vy=0, vz=0, cnt=0;
    for (const [a,b] of EDGES) if (oc[a] !== oc[b]) {
      vx += (CO[a][0]+CO[b][0])*0.5; vy += (CO[a][1]+CO[b][1])*0.5; vz += (CO[a][2]+CO[b][2])*0.5; cnt++;
    }
    vx/=cnt; vy/=cnt; vz/=cnt;
    cellVert[cidx(x,y,z)] = pos.length/3;
    pos.push(ox + (x+vx)*vox, oy + (y+vy)*vox, oz + (z+vz)*vox);
  }
  const tris = [];
  const quad = (c0,c1,c2,c3, flip) => {
    const v0=cellVert[c0], v1=cellVert[c1], v2=cellVert[c2], v3=cellVert[c3];
    if (v0<0||v1<0||v2<0||v3<0) return;
    const P = (a,b,c) => tris.push(pos[a*3],pos[a*3+1],pos[a*3+2], pos[b*3],pos[b*3+1],pos[b*3+2], pos[c*3],pos[c*3+1],pos[c*3+2]);
    if (flip) { P(v0,v1,v2); P(v0,v2,v3); } else { P(v0,v2,v1); P(v0,v3,v2); }
  };
  // Für jede Punkt-Kante in +X/+Y/+Z: bei Vorzeichenwechsel Quad der 4 anliegenden Zellen.
  for (let z = 1; z < nz-1; z++) for (let y = 1; y < ny-1; y++) for (let x = 1; x < nx-1; x++) {
    const a = field[idx(x,y,z)];
    const ex = field[idx(x+1,y,z)], ey = field[idx(x,y+1,z)], ez = field[idx(x,y,z+1)];
    if (a !== ex) quad(cidx(x,y-1,z-1), cidx(x,y,z-1), cidx(x,y,z), cidx(x,y-1,z), a !== 0);
    if (a !== ey) quad(cidx(x-1,y,z-1), cidx(x,y,z-1), cidx(x,y,z), cidx(x-1,y,z), a === 0);
    if (a !== ez) quad(cidx(x-1,y-1,z), cidx(x,y-1,z), cidx(x,y,z), cidx(x-1,y,z), a !== 0);
  }
  return tris;
}

function hollowLidFromStl(stlBuffer, opts) {
  const o = opts || {};
  const num = (v,d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const wall = num(o.wall, 2), cutAt = num(o.cutAt, 0.5), lipDepth = num(o.lipDepth, 5),
        clear = num(o.clear, 0.25), boreDia = num(o.boreDia, 0);
  const RES = Math.max(48, Math.min(320, num(o.res, 128)));

  const T = parseSTLBinary(stlBuffer);
  const nTri = T.length / 9;
  if (nTri < 4) return { error: 'Mesh leer/zu klein' };

  let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
  for (let i = 0; i < T.length; i += 3) {
    if (T[i]<minx)minx=T[i]; if (T[i]>maxx)maxx=T[i];
    if (T[i+1]<miny)miny=T[i+1]; if (T[i+1]>maxy)maxy=T[i+1];
    if (T[i+2]<minz)minz=T[i+2]; if (T[i+2]>maxz)maxz=T[i+2];
  }
  const ext = Math.max(maxx-minx, maxy-miny, maxz-minz) || 1;
  const vox = ext / RES;
  const PAD = 3;
  const ox = minx - PAD*vox, oy = miny - PAD*vox, oz = minz - PAD*vox;
  const nx = Math.ceil((maxx-minx)/vox) + 2*PAD + 1;
  const ny = Math.ceil((maxy-miny)/vox) + 2*PAD + 1;
  const nz = Math.ceil((maxz-minz)/vox) + 2*PAD + 1;
  const NP = nx*ny*nz;
  if (NP > 40e6) return { error: 'Modell zu groß für Voxel-Auflösung — Auflösung senken' };
  const idx = (i,j,k) => i + nx*(j + ny*k);

  // 1a. Oberfläche markieren (dichte Abtastung jedes Dreiecks → kein Leck)
  const surf = new Uint8Array(NP);
  const invv = 1/vox, step = 0.45*vox;
  for (let t = 0; t < nTri; t++) {
    const ax=T[t*9],ay=T[t*9+1],az=T[t*9+2], bx=T[t*9+3],by=T[t*9+4],bz=T[t*9+5], cx=T[t*9+6],cy=T[t*9+7],cz=T[t*9+8];
    const e1x=bx-ax,e1y=by-ay,e1z=bz-az, e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
    const l1=Math.hypot(e1x,e1y,e1z), l2=Math.hypot(e2x,e2y,e2z);
    const ns = Math.min(600, Math.max(1, Math.ceil(Math.max(l1,l2)/step)));
    for (let u = 0; u <= ns; u++) for (let w = 0; w <= ns-u; w++) {
      const fu = u/ns, fw = w/ns;
      const px = ax + fu*e1x + fw*e2x, py = ay + fu*e1y + fw*e2y, pz = az + fu*e1z + fw*e2z;
      const i = Math.round((px-ox)*invv), j = Math.round((py-oy)*invv), k = Math.round((pz-oz)*invv);
      if (i>=0&&i<nx&&j>=0&&j<ny&&k>=0&&k<nz) surf[idx(i,j,k)] = 1;
    }
  }

  // 1b. Außen-Flutfüllung ab Rand über nicht-Oberflächen-Punkte (6-Nachbarn)
  const outside = new Uint8Array(NP);
  const stack = [];
  const pushIf = (i,j,k) => { const p = idx(i,j,k); if (!surf[p] && !outside[p]) { outside[p]=1; stack.push(p); } };
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) { pushIf(0,j,k); pushIf(nx-1,j,k); }
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { pushIf(i,0,k); pushIf(i,ny-1,k); }
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { pushIf(i,j,0); pushIf(i,j,nz-1); }
  while (stack.length) {
    const p = stack.pop();
    const i = p % nx, j = ((p/nx)|0) % ny, k = (p/(nx*ny))|0;
    if (i>0)    pushIf(i-1,j,k); if (i<nx-1) pushIf(i+1,j,k);
    if (j>0)    pushIf(i,j-1,k); if (j<ny-1) pushIf(i,j+1,k);
    if (k>0)    pushIf(i,j,k-1); if (k<nz-1) pushIf(i,j,k+1);
  }

  // 1c. Innen = nicht außen (inkl. Oberflächenband)
  const inside = new Uint8Array(NP);
  let insideCount = 0;
  for (let p = 0; p < NP; p++) if (!outside[p]) { inside[p] = 1; insideCount++; }
  if (insideCount < 8 || insideCount > NP*0.98) return { error: 'Voxelisierung fehlgeschlagen — Mesh nicht füllbar (zu offen?)' };

  // 2. Distanz-Transform: Tiefe (in Voxeln) jedes Innen-Punkts bis zum Rand (6-Nachbarn BFS)
  const depth = new Int32Array(NP).fill(0);
  let frontier = [];
  for (let p = 0; p < NP; p++) if (inside[p]) {
    const i = p % nx, j = ((p/nx)|0) % ny, k = (p/(nx*ny))|0;
    if ((i>0&&!inside[idx(i-1,j,k)])||(i<nx-1&&!inside[idx(i+1,j,k)])||
        (j>0&&!inside[idx(i,j-1,k)])||(j<ny-1&&!inside[idx(i,j+1,k)])||
        (k>0&&!inside[idx(i,j,k-1)])||(k<nz-1&&!inside[idx(i,j,k+1)])) { depth[p]=1; frontier.push(p); }
  }
  let d = 1;
  while (frontier.length) {
    const next = [];
    for (const p of frontier) {
      const i = p % nx, j = ((p/nx)|0) % ny, k = (p/(nx*ny))|0;
      const nb = [];
      if (i>0)nb.push(idx(i-1,j,k)); if (i<nx-1)nb.push(idx(i+1,j,k));
      if (j>0)nb.push(idx(i,j-1,k)); if (j<ny-1)nb.push(idx(i,j+1,k));
      if (k>0)nb.push(idx(i,j,k-1)); if (k<nz-1)nb.push(idx(i,j,k+1));
      for (const q of nb) if (inside[q] && depth[q]===0) { depth[q] = d+1; next.push(q); }
    }
    frontier = next; d++;
  }

  // 3.–4. Body/Deckel/Falz/Bohrung als Punkt-Felder
  const wallV  = Math.max(1, Math.round(wall/vox));
  const clearV = Math.max(0, Math.round(clear/vox));
  const lipWallV = Math.max(1, Math.round(wall/vox));
  const zCut = minz + cutAt*(maxz-minz);
  const lipZmin = zCut - lipDepth;
  const cxw = (minx+maxx)/2, cyw = (miny+maxy)/2, boreR = boreDia/2;

  const body = new Uint8Array(NP), lid = new Uint8Array(NP);
  for (let p = 0; p < NP; p++) {
    if (!inside[p]) continue;
    const dep = depth[p];
    const k = (p/(nx*ny))|0;
    const zw = oz + k*vox;
    const isWall = dep <= wallV;
    if (isWall) {
      if (zw <= zCut) body[p] = 1; else lid[p] = 1;
    }
    // Zentrier-Falz: schmaler Ring INNERHALB der Wand (mit Spaltmaß), an den Deckel
    if (zw >= lipZmin && zw <= zCut + vox &&
        dep > wallV + clearV && dep <= wallV + clearV + lipWallV) lid[p] = 1;
  }
  // Bohrung: zentrale Säule aus dem Body entfernen
  if (boreR > 0) {
    for (let p = 0; p < NP; p++) {
      if (!body[p]) continue;
      const i = p % nx, j = ((p/nx)|0) % ny;
      const xw = ox + i*vox, yw = oy + j*vox;
      if (Math.hypot(xw-cxw, yw-cyw) <= boreR) body[p] = 0;
    }
  }

  // 5. Meshing
  const bodyTris = surfaceNets(body, nx, ny, nz, ox, oy, oz, vox);
  const lidTris  = surfaceNets(lid,  nx, ny, nz, ox, oy, oz, vox);
  if (!bodyTris.length) return { error: 'Body leer — cutAt/Wandstärke prüfen' };
  if (!lidTris.length)  return { error: 'Deckel leer — cutAt/Wandstärke prüfen' };

  return {
    bodyStlBase64: trisToStlBuffer(Float32Array.from(bodyTris)).toString('base64'),
    lidStlBase64:  trisToStlBuffer(Float32Array.from(lidTris)).toString('base64'),
    meta: { res: RES, vox: +vox.toFixed(3), grid: `${nx}x${ny}x${nz}`, bodyTris: bodyTris.length/9, lidTris: lidTris.length/9 }
  };
}

module.exports = { hollowLidFromStl, parseSTLBinary, trisToStlBuffer, surfaceNets };
