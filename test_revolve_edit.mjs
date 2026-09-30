import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT=8941;
const srv=spawn('python3',['volme3d_server.py',String(PORT),'--dev'],{stdio:'ignore'});
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
// Anfasser anklicken → Maßfeld, Ø tippen
[x0,y0]=await scr(5,0); await pg.mouse.click(x0,y0);
console.log('dimbox', await pg.evaluate(()=>[_revolveSel, getComputedStyle(document.getElementById('rev-dim')).display, document.getElementById('rev-dim-d').value, document.getElementById('rev-dim-h').value, selectedObjs.length]));
await pg.fill('#rev-dim-d','120'); await pg.press('#rev-dim-d','Enter');
console.log('typed', await pg.evaluate(()=>_revolvePoints[1].r));
// Klick auf Linie zwischen P2 (4,3) und P3 (3,5) → Einfügen
let [xa,ya]=await scr(4,3), [xb,yb]=await scr(3,5); await pg.mouse.click((xa+xb)/2,(ya+yb)/2);
console.log('insert', await pg.evaluate(()=>_revolvePoints.length));
await pg.keyboard.press('Delete');
console.log('delete', await pg.evaluate(()=>_revolvePoints.length));
// Klick ins Leere hängt nichts an
await pg.mouse.click(1200,120); console.log('empty', await pg.evaluate(()=>_revolvePoints.length));
await pg.click('#revolve-bar button:has-text("Zurück")'); console.log('undo1', await pg.evaluate(()=>_revolvePoints.length));
await pg.click('#revolve-bar button:has-text("Zurück")'); console.log('undo2 (5 Punkte, r=6)', await pg.evaluate(()=>[_revolvePoints.length,_revolvePoints[1].r]));
await pg.click('#revolve-bar button:has-text("Zurück")'); console.log('undo3 r=5', await pg.evaluate(()=>_revolvePoints[1].r));
[x0,y0]=await scr(5,0); await pg.mouse.click(x0,y0);
await pg.fill('#rev-dim-d','120'); await pg.press('#rev-dim-d','Enter');
await pg.screenshot({path:'/tmp/claude-1000/-home-v3da-orca-wasm/4c66e8c5-f0c9-5ffe-a383-511e9eab8f4c/scratchpad/edit.png'});
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
