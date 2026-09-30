import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT=8941;
const srv=spawn('python3',['volme3d_server.py',String(PORT),'--dev'],{stdio:'inherit'});
await new Promise(r=>setTimeout(r,1500));
const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1300,height:850}});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`); await pg.waitForFunction(()=>typeof enterRevolveMode==='function');
await pg.evaluate(()=>hideStarter());
await pg.evaluate(()=>enterRevolveMode());
// Profil in Weltkoordinaten → Bildschirm
const scr=async (r,h)=>pg.evaluate(([r,h])=>{const v=_revolveWorld(r,h).project(camera);const R=vpEl.getBoundingClientRect();return [R.left+(v.x+1)/2*R.width,R.top+(-v.y+1)/2*R.height];},[r,h]);
for (const [r,h] of [[0,0],[3,0],[4,3],[3,5],[0,5]]) { const [x,y]=await scr(r,h); await pg.mouse.click(x,y); await pg.waitForTimeout(50); }
console.log('pts', await pg.evaluate(()=>_revolvePoints.map(p=>[p.r,p.h])));
await pg.evaluate(()=>finishRevolve());
const before=await pg.evaluate(()=>{const o=getFirst();const s=getMeshBox(o).getSize(new THREE.Vector3());return {n:objects.length,w:s.x,h:s.y,pos:o.position.toArray()};});
console.log('before',before);
// Körper verschieben + Twist setzen → muss erhalten bleiben
await pg.evaluate(()=>{const o=getFirst();o.position.x=5;o.userData.revolveTwist=0.3;_rebuildRevolveGeo(o);updateFP();});
const hasBtn=await pg.evaluate(()=>!!document.querySelector('button[onclick="enterRevolveMode(getFirst())"]'));
console.log('button', hasBtn);
await pg.click('button[onclick="enterRevolveMode(getFirst())"]');
console.log('edit pts', await pg.evaluate(()=>[_revolveEditObj&&_revolveEditObj.visible, _revolvePoints.map(p=>[+p.r.toFixed(2),+p.h.toFixed(2)])]));
// Bodenpunkt (Index 1: r=3,h=0) auf r=5 ziehen
let [x0,y0]=await scr(3,0); let [x1,y1]=await scr(5,0);
await pg.mouse.move(x0,y0); await pg.mouse.down(); await pg.mouse.move((x0+x1)/2,y1,{steps:4}); await pg.mouse.move(x1,y1,{steps:4}); await pg.mouse.up();
console.log('after drag', await pg.evaluate(()=>_revolvePoints.map(p=>[+p.r.toFixed(2),+p.h.toFixed(2)])));
await pg.click('#revolve-bar button:has-text("Fertig")');
const after=await pg.evaluate(()=>{const o=getFirst();const s=getMeshBox(o).getSize(new THREE.Vector3());return {n:objects.length,vis:o.visible,w:s.x,h:s.y,pos:o.position.toArray(),tw:o.userData.revolveTwist,mode:_revolveMode};});
console.log('after',after);
// ESC-Pfad: bearbeiten + verwerfen
await pg.evaluate(()=>enterRevolveMode(getFirst())); await pg.keyboard.press('Escape');
console.log('esc', await pg.evaluate(()=>[_revolveMode,getFirst()&&getFirst().visible, objects[0].visible]));
await pg.evaluate(()=>undo()); 
console.log('undo', await pg.evaluate(()=>{const o=objects[0];const s=getMeshBox(o).getSize(new THREE.Vector3());return [objects.length,o.visible,s.x.toFixed(2)];}));
console.log('errs',errs);
await b.close(); srv.kill();
