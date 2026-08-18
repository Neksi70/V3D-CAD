// Prüft: Mess-Werkzeug erkennt Kreiskanten und liefert den Durchmesser.
// (Ralf wollte den Ø einer Bohrung messen und bekam mit 2-Punkt-Klicks nur Sehnen.)
// 1. Zylinder-Deckelkante → _measureDetectCircle liefert Radius/Zentrum des Deckels
// 2. Klick mitten auf die Mantelfläche → null (dort weiter normale Punkt-Messung)
// 3. Skalierter Zylinder → Ø skaliert mit (Welt-Transform wird berücksichtigt)
// 4. Label zeigt 'Ø … mm'
// 5. Bohrungsrand in gewölbter Wand (Sattelkurve) → Ø trotzdem korrekt
// 6. Kompletter Klickpfad: echter Mausklick → pickObjects → Ø-Label
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8797;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil:'load', timeout:30000 });
await page.waitForFunction(() => window._isReady === true, { timeout:20000 }).catch(()=>{});
await page.waitForTimeout(1200);

const res = await page.evaluate(() => {
  addShape('cylinder'); const cyl=objects[objects.length-1]; cyl.updateMatrixWorld(true);
  const bb=new THREE.Box3().setFromObject(cyl);
  const c=bb.getCenter(new THREE.Vector3()), sz=bb.getSize(new THREE.Vector3());
  const r=sz.x/2, ytop=bb.max.y;

  const E=_measureBuildEdges(cyl);
  const segCount=E?E.segs.length:0;

  // 1) Klick auf die Deckelkante
  const hitRim={object:cyl, point:new THREE.Vector3(c.x+r, ytop, c.z)};
  const circ=_measureDetectCircle(hitRim);
  const rimOk = !!circ
    && Math.abs(circ.radius-r)<r*0.02
    && circ.center.distanceTo(new THREE.Vector3(c.x,ytop,c.z))<r*0.02
    && Math.abs(Math.abs(circ.normal.y)-1)<0.02;

  // 2) Klick mitten auf den Mantel → keine Kreiskante in Reichweite
  const hitWall={object:cyl, point:new THREE.Vector3(c.x+r, c.y, c.z)};
  const wallNull = _measureDetectCircle(hitWall)===null;

  // 3) Skaliert (Welt-Transform): Radius muss mitwachsen
  cyl.scale.set(1.5,1.5,1.5); cyl.updateMatrixWorld(true);
  const bb2=new THREE.Box3().setFromObject(cyl);
  const c2=bb2.getCenter(new THREE.Vector3()), r2=bb2.getSize(new THREE.Vector3()).x/2, ytop2=bb2.max.y;
  const circ2=_measureDetectCircle({object:cyl, point:new THREE.Vector3(c2.x+r2, ytop2, c2.z)});
  const scaleOk = !!circ2 && Math.abs(circ2.radius-r2)<r2*0.02;

  // 4) Label
  _measureMode=true; _measureCircle=circ2; _measureA=_measureB=null;
  _measureDraw();
  const label=document.getElementById('measure-label');
  const labelText=label?label.textContent:'';
  const labelOk = /^Ø \d+([.,]\d)? mm$/.test(labelText)
    && Math.abs(parseFloat(labelText.replace('Ø ','').replace(',','.'))-r2*2*10)<r2*2*10*0.02;
  _measureExit();

  // Ralfs Fall: Bohrungsrand in GEWÖLBTER Wand = Sattelkurve (nicht eben).
  // Nachgebaut als Fächer, dessen Rand auf einem Zylinder R=2 liegt: z = u²/(2R).
  // Radial exakt Kreis r=0.79 (Ø 15.8 mm) — muss trotz Welligkeit erkannt werden.
  const rh=0.79, Rw=2, N=48, tris=[];
  const rim=i=>{ const a=i/N*2*Math.PI, u=rh*Math.cos(a), v=rh*Math.sin(a);
    return [u, v, (u*u)/(2*Rw)]; };
  for(let i=0;i<N;i++){ const p1=rim(i), p2=rim(i+1); tris.push(0,0,0, ...p1, ...p2); }
  const hg=new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(tris,3));
  const hole=new THREE.Mesh(hg, new THREE.MeshBasicMaterial());
  hole.updateMatrixWorld(true);
  const circ3=_measureDetectCircle({object:hole, point:new THREE.Vector3(rh,0,rh*rh/(2*Rw))});
  const saddleOk = !!circ3 && Math.abs(circ3.radius-rh)<rh*0.02;

  return { segCount, rimOk, circRadius:circ&&+circ.radius.toFixed(3), expectR:+r.toFixed(3),
           wallNull, scaleOk, labelText, labelOk,
           saddleOk, saddleDia:circ3&&+(circ3.radius*2*10).toFixed(1) };
});
// Kompletter Klickpfad: echter Mausklick auf die Deckelkante → Ø-Label
await page.evaluate(() => { fitToObjects([objects[objects.length-1]]); });
await page.waitForTimeout(900); // Kamerafahrt ausklingen lassen
const prep = await page.evaluate(() => {
  const cyl=objects[objects.length-1];
  const bb=new THREE.Box3().setFromObject(cyl);
  const c=bb.getCenter(new THREE.Vector3()), r=bb.getSize(new THREE.Vector3()).x/2, ytop=bb.max.y;
  // Rim-Punkt auf der kamerazugewandten Seite, minimal nach innen (Raycast sicher treffen)
  const d=camera.position.clone().sub(c); d.y=0; d.normalize();
  const p=c.clone().addScaledVector(d,r*0.98); p.y=ytop;
  if(!_measureMode) measureTool();
  const s=_worldToScreen(p.x,p.y,p.z); const vr=vpEl.getBoundingClientRect();
  return s?{x:vr.left+s.x, y:vr.top+s.y}:null;
});
let e2e={clickCircle:false, clickLabel:''};
if(prep){
  await page.mouse.click(prep.x, prep.y);
  await page.waitForTimeout(250);
  e2e = await page.evaluate(() => {
    const label=document.getElementById('measure-label');
    const r={clickCircle:!!_measureCircle, clickLabel:label?label.textContent:''};
    _measureExit(); return r;
  });
}
await browser.close(); srv.kill();
console.log(JSON.stringify({...res, ...e2e},null,2));
const ok = res.segCount>0 && res.rimOk && res.wallNull && res.scaleOk && res.labelOk
  && res.saddleOk && e2e.clickCircle && e2e.clickLabel.startsWith('Ø ');
console.log(ok ? '\n✓ Kreiskante → Durchmesser erkannt (auch per echtem Klick), Mantel bleibt Punkt-Messung' : '\n✗ Kreiserkennung fehlerhaft');
process.exit(ok?0:1);
