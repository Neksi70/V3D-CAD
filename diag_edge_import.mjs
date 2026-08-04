// Frage von Ralf: Gibt es "Kanten runden" auch für IMPORTIERTE Teile?
// Prüft den echten Weg: Import → ⬡ Kanten bearbeiten → ☑ Alle Kanten → Handle ziehen.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8790;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  const out = {};
  const tris = g => { const p=g.attributes.position; return g.index ? g.index.count/3 : p.count/3; };
  // Würfel 20 mm als STL-Puffer bauen und über den echten Import-Weg einfügen
  const box = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const pos = box.attributes.position.array, n = pos.length/9;
  const buf = new ArrayBuffer(84 + n*50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t=0;t<n;t++){
    const o = 84 + t*50;
    for (let k=0;k<3;k++) dv.setFloat32(o+12+k*12,   pos[t*9+k*3]*10,   true);
    for (let k=0;k<3;k++) dv.setFloat32(o+12+k*12+4, pos[t*9+k*3+1]*10, true);
    for (let k=0;k<3;k++) dv.setFloat32(o+12+k*12+8, pos[t*9+k*3+2]*10, true);
  }
  const geo = parseSTL(buf);
  _addImportedGeo(geo, 'wuerfel.stl', false, buf, false);
  await new Promise(r=>setTimeout(r,600));
  const obj = objects[objects.length-1];
  out.imported = { type: obj.userData.type, shapeType: obj.userData.shapeType, tris: tris(obj.geometry) };

  selectObjs([obj]);
  // Steht der Knopf überhaupt im Eigenschaften-Panel?
  out.panelHasEdgeBtn = !!document.body.innerHTML.match(/Kanten bearbeiten/);
  enterEdgeMode(true);
  out.edgeMode = !!window._edgeMode;
  out.edgesFound = (obj.userData._dynamicEdges||[]).length;
  _edgeSelectAll();
  out.selected = _edgeSel.size;

  // Meldungen mitschneiden
  out.notes = [];
  const _n = window.notify; window.notify = (m,k)=>{ out.notes.push((k||'')+': '+m); return _n(m,k); };
  const _w = console.warn; console.warn = (...a)=>{ out.notes.push('warn: '+a.map(String).join(' ')); _w(...a); };
  // Handle nach rechts = laut Panel "Rundung"
  const before = objects.length;
  const t0 = performance.now();
  try { await _applyEdgeHandleValue(0.05); } catch(e){ out.notes.push('throw: '+e); }
  out.ms = Math.round(performance.now()-t0);
  await new Promise(r=>setTimeout(r,3000));
  const after = objects[objects.length-1];
  out.afterTris = tris(after.geometry);
  out.sameObject = after === obj;
  out.objCount = objects.length - before;
  // Ist überhaupt Material an den Kanten weg? (Volumen des Würfels: 8 Units³)
  const vol = g => { const p=g.attributes.position.array, idx=g.index?g.index.array:null;
    const nT=idx?idx.length/3:p.length/9; let V=0;
    for(let t=0;t<nT;t++){ const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
      const ax=p[i0*3],ay=p[i0*3+1],az=p[i0*3+2],bx=p[i1*3],by=p[i1*3+1],bz=p[i1*3+2],cx=p[i2*3],cy=p[i2*3+1],cz=p[i2*3+2];
      V += (ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6; } return Math.abs(V); };
  const m = new THREE.Matrix4().copy(after.matrixWorld);
  const gw = after.geometry.clone(); gw.applyMatrix4(m);
  out.volAfter = +vol(gw).toFixed(4);
  out.volBefore = 8;
  // Gegenprobe: andere Zugrichtung (laut Panel "Fase")
  selectObjs([after]); enterEdgeMode(true); _edgeSelectAll();
  out.sel2 = _edgeSel.size;
  try { await _applyEdgeHandleValue(-0.05); } catch(e){ out.notes.push('throw2: '+e); }
  await new Promise(r=>setTimeout(r,3000));
  const after2 = objects[objects.length-1];
  const gw2 = after2.geometry.clone(); gw2.applyMatrix4(after2.matrixWorld);
  out.volAfter2 = +vol(gw2).toFixed(4);
  out.trisAfter2 = tris(after2.geometry);
  return out;
});

console.log(JSON.stringify(res, null, 1));
console.log('errs:', errs.slice(0,5));
await browser.close(); srv.kill();
