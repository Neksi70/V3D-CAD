// Prüft: _objectPlanarFaces liefert für Pyramiden-Schrägen AUSSEN-Normalen (ny>0),
// und _centerSnapDetect dockt eine Box AUSSEN an (nicht innen).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8796;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);

const res = await page.evaluate(() => {
  addShape('pyramid'); const pyr=objects[objects.length-1]; pyr.scale.set(4,4,4); pyr.position.set(0,0,0); pyr.updateMatrixWorld(true);
  const faces=_objectPlanarFaces(pyr);
  // Schrägen = nicht (fast) waagerecht
  const slopes=faces.filter(f=>Math.abs(f.ny)<0.9);
  const slopeNy=slopes.map(f=>+f.ny.toFixed(2));
  const allOutwardUp = slopes.every(f=>f.ny>0);  // Schräge einer aufrechten Pyramide → Normale nach oben-außen

  // _centerSnapDetect: Box nahe einer KAMERAZUGEWANDTEN Schrägflächen-Mitte platzieren
  const camP=new THREE.Vector3(); camera.getWorldPosition(camP);
  const f=slopes.find(f=> f.nx*(camP.x-f.cx)+f.ny*(camP.y-f.cy)+f.nz*(camP.z-f.cz)>0) || slopes[0];
  addShape('box'); const box=objects[objects.length-1]; box.scale.set(0.5,0.5,0.5);
  box.position.set(f.cx, f.cy, f.cz); box.updateMatrixWorld(true);
  selectObjs([box]);
  const tgt=_centerSnapDetect(box);
  let dockOutward=null, tgtNy=null;
  if (tgt) {
    tgtNy=+tgt.ny.toFixed(2);
    // Dockpunkt = Flächenmitte + Normale*halfN  → muss AUSSEN (weg vom Pyramidenzentrum) liegen
    const pc=new THREE.Box3().setFromObject(pyr).getCenter(new THREE.Vector3());
    const dock=new THREE.Vector3(f.cx,f.cy,f.cz).add(new THREE.Vector3(tgt.nx,tgt.ny,tgt.nz));
    dockOutward = dock.distanceTo(pc) > new THREE.Vector3(f.cx,f.cy,f.cz).distanceTo(pc);
  }
  return { slopeNy, allOutwardUp, snapTriggered: !!tgt, tgtNy, dockOutward };
});
await browser.close(); srv.kill();
console.log(JSON.stringify(res,null,2));
const ok = res.allOutwardUp && (!res.snapTriggered || res.dockOutward);
console.log(ok ? '\n✓ Schrägen-Normalen außen; Snap dockt außen an' : '\n✗ Normale/Dock noch innen');
process.exit(0);
