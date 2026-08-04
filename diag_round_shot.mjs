// Sichtprüfung „Alles abrunden": Winkelstück mit Loch und Steg, vorher/nachher.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const PORT = 8784;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1200,height:800} });
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,200)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

const shot = async (name) => {
  const url = await page.evaluate(() => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); });
  writeFileSync(`/tmp/round-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
};

// Testteil: 40×25×8-Platte mit Ø10-Loch und aufgesetztem Steg 4×20×6
await page.evaluate(async () => {
  const sh = new THREE.Shape();
  sh.moveTo(-2,-1.25); sh.lineTo(2,-1.25); sh.lineTo(2,1.25); sh.lineTo(-2,1.25); sh.closePath();
  const h = new THREE.Path(); h.absarc(1.0,0,0.5,0,Math.PI*2,false); sh.holes.push(h);
  const plate = new THREE.ExtrudeGeometry(sh, {depth:0.8, bevelEnabled:false, curveSegments:48}).toNonIndexed();
  plate.rotateX(-Math.PI/2);
  const rib = new THREE.BoxGeometry(0.4, 0.6, 2).toNonIndexed();
  rib.translate(-1.2, 0.3+0.8/2-0.4, 0);
  const parts = [plate, rib];
  let n = 0; parts.forEach(g => n += g.attributes.position.count/3);
  const buf = new ArrayBuffer(84 + n*50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let t = 0;
  for (const g of parts) {
    const p = g.attributes.position.array;
    for (let i=0;i<p.length/9;i++,t++){ const o = 84 + t*50;
      for (let k=0;k<3;k++){ dv.setFloat32(o+12+k*12,   p[i*9+k*3]*10,   true);
                             dv.setFloat32(o+12+k*12+4, p[i*9+k*3+1]*10, true);
                             dv.setFloat32(o+12+k*12+8, p[i*9+k*3+2]*10, true); } }
  }
  _addImportedGeo(parseSTL(buf), 'winkel.stl', false, buf, false);
  await new Promise(r=>setTimeout(r,500));
  const o = objects[objects.length-1];
  selectObjs([o]); fitToObjects([o]);
  camera.position.set(3.5, 3.2, 4.2); camera.lookAt(0,0.2,0);
  deselect();
  renderer.render(scene, camera);
  window.__before = o;
});
await page.waitForTimeout(500);
await shot('before');

const info = await page.evaluate(async () => {
  const o = objects[objects.length-1];
  const t0 = performance.now();
  selectObjs([o]); _openRoundModal();
  document.getElementById('round-r').value = 0.8;
  await _roundApply();
  await new Promise(r=>setTimeout(r,400));
  const n = objects[objects.length-1];
  deselect();
  camera.position.set(3.5, 3.2, 4.2); camera.lookAt(0,0.2,0);
  renderer.render(scene, camera);
  const sz = new THREE.Box3().setFromObject(n).getSize(new THREE.Vector3()).multiplyScalar(10);
  // Volumen + Euler-Charakteristik: verrät, ob das Loch noch da ist
  const stat = mesh => { mesh.updateMatrixWorld(true);
    const g = mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld);
    const p = g.attributes.position.array, idx = g.index ? g.index.array : null;
    const nT = idx ? idx.length/3 : p.length/9; let V=0;
    const vk = new Set(), ek = new Set();
    const key = i => Math.round(p[i*3]*1e3)+'_'+Math.round(p[i*3+1]*1e3)+'_'+Math.round(p[i*3+2]*1e3);
    for (let t=0;t<nT;t++){ const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
      const ax=p[i0*3],ay=p[i0*3+1],az=p[i0*3+2],bx=p[i1*3],by=p[i1*3+1],bz=p[i1*3+2],cx=p[i2*3],cy=p[i2*3+1],cz=p[i2*3+2];
      V += (ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6;
      const v=[i0,i1,i2].map(key); v.forEach(x=>vk.add(x));
      for (let k=0;k<3;k++){ const a=v[k], b=v[(k+1)%3]; if(a!==b) ek.add(a<b?a+'|'+b:b+'|'+a); } }
    const euler = vk.size - ek.size + nT;
    return { vol:+(Math.abs(V)*1000).toFixed(0), euler, hasNormals: !!g.attributes.normal, tris:nT };
  };
  return { ms: Math.round(performance.now()-t0), tris: n.geometry.index ? n.geometry.index.count/3 : n.geometry.attributes.position.count/3,
           size: [ +sz.x.toFixed(2), +sz.y.toFixed(2), +sz.z.toFixed(2) ], after: stat(n) };
});
await page.waitForTimeout(400);
await shot('after');
console.log(JSON.stringify(info));
await browser.close(); srv.kill();
