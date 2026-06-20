// E2E: Box bündig auf Pyramiden-Schräge. Ruft die echten Snap-Funktionen
// (_solidSnapDetect mit projizierten Cursor-Koordinaten, dann _applySolidConform)
// und prüft: Box-Oberseite (lokal +Y) == Flächennormale; Box sitzt auf der Fläche.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8794;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs=[]; page.on('pageerror', e=>errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);

const res = await page.evaluate(async () => {
  addShape('pyramid'); await new Promise(r=>setTimeout(r,150));
  const pyr = objects[objects.length-1];
  pyr.scale.set(4,4,4); pyr.position.set(0,0,0); pyr.updateMatrixWorld(true);
  addShape('box'); await new Promise(r=>setTimeout(r,150));
  const box = objects[objects.length-1];
  box.scale.set(0.5,0.5,0.5); box.updateMatrixWorld(true);
  selectObjs([box]);

  // Punkt mitten auf einer +X/+Z-Schräge der Pyramide → auf Bildschirm projizieren
  const pb = new THREE.Box3().setFromObject(pyr);
  const c = pb.getCenter(new THREE.Vector3()), s = pb.getSize(new THREE.Vector3());
  const surf = new THREE.Vector3(c.x + s.x*0.22, c.y - s.y*0.1, c.z + s.z*0.22);
  const v = surf.clone().project(camera);
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + (v.x+1)/2*rect.width;
  const clientY = rect.top + (-v.y+1)/2*rect.height;

  // Detect (setzt modul-lokales _solidSnapHit; Hinweis-DOM zeigt Treffer an)
  _solidSnapDetect(box, { clientX, clientY });
  const hintShown = document.getElementById('text-snap-hint').style.display === 'block';
  if (!hintShown) return { err:'kein Snap erkannt (Cursor nicht auf Pyramide?)', clientX:+clientX.toFixed(0), clientY:+clientY.toFixed(0) };

  // Raycaster bewusst verfälschen (simuliert veralteten Zustand beim Loslassen)
  raycaster.set(new THREE.Vector3(0,-100,0), new THREE.Vector3(0,1,0));
  // Apply
  _applySolidConform(box);
  box.updateMatrixWorld(true);

  // Prüfen: Box-Oberseite (lokal +Y) sollte der Flächennormale entsprechen
  const up = new THREE.Vector3(0,1,0).applyQuaternion(box.getWorldQuaternion(new THREE.Quaternion())).normalize();
  // erwartete Normale: aus erneutem Raycast
  raycaster.setFromCamera(new THREE.Vector2(v.x,v.y), camera);
  const h = raycaster.intersectObject(pyr,true).filter(x=>x.face)[0];
  const nW = h.face.normal.clone().transformDirection(pyr.matrixWorld).normalize();
  if (nW.dot(raycaster.ray.direction) > 0) nW.negate();
  const align = up.dot(nW);   // ~1 = bündig

  // sitzt die Box auf der Fläche? tiefste Box-Ecke entlang nW ~ Trefferebene
  const bb = new THREE.Box3().setFromObject(box);
  const corners=[[bb.min.x,bb.min.y,bb.min.z],[bb.max.x,bb.min.y,bb.min.z],[bb.min.x,bb.max.y,bb.min.z],[bb.max.x,bb.max.y,bb.min.z],[bb.min.x,bb.min.y,bb.max.z],[bb.max.x,bb.min.y,bb.max.z],[bb.min.x,bb.max.y,bb.max.z],[bb.max.x,bb.max.y,bb.max.z]];
  let minD=Infinity; for(const p of corners){ minD=Math.min(minD, p[0]*nW.x+p[1]*nW.y+p[2]*nW.z); }
  const gap = Math.abs(minD - h.point.dot(nW));

  const slope = Math.acos(Math.min(1,Math.abs(nW.y)))*180/Math.PI;  // Neigung der Fläche
  return { align:+align.toFixed(3), gap:+gap.toFixed(3), slopeDeg:+slope.toFixed(1), normal:[nW.x,nW.y,nW.z].map(x=>+x.toFixed(2)) };
});
await browser.close(); srv.kill();
console.log(JSON.stringify(res,null,2));
for (const e of errs.slice(0,5)) console.log('pageerror:', e.slice(0,140));
const ok = res.align>0.999 && res.gap<0.05 && res.slopeDeg>5;
console.log(ok ? '\n✓ Box liegt bündig auf der Schräge (gedreht + aufgesetzt)' : '\n✗ Snap nicht korrekt');
process.exit(0);
