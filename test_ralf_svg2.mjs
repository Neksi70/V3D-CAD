import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8875;
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd:'/home/v3da', stdio:'inherit' });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch();
const pg = await br.newPage({ viewport:{width:1200,height:800} });
await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
await pg.waitForFunction(() => typeof objects !== 'undefined' && typeof _importSvgConfirm === 'function' && typeof hideStarter === 'function', null, {timeout:30000});
await pg.evaluate(() => hideStarter());

const out = await pg.evaluate(() => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">
    <path d="M10 10 h30 v40 h-30 z"/><path d="M60 10 h15 v25 h25 v15 h-40 z"/>
    <path d="M120 10 h50 v12 h-19 v28 h-12 v-28 h-19 z"/></svg>`;
  const mess = (o, tag) => {
    o.updateMatrixWorld(true);
    const pos = o.geometry.attributes.position, v = new THREE.Vector3();
    let minY=1e9,maxY=-1e9;
    for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld); minY=Math.min(minY,v.y); maxY=Math.max(maxY,v.y); }
    const eps=(maxY-minY)*0.02+1e-6; let bx=0,bz=0,bn=0,tx=0,tz=0,tn=0;
    for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
      if(v.y<minY+eps){bx+=v.x;bz+=v.z;bn++;} if(v.y>maxY-eps){tx+=v.x;tz+=v.z;tn++;} }
    const versatz=(bn&&tn)?Math.hypot(tx/tn-bx/bn,tz/tn-bz/bn)*10:0;
    const b=getMeshBox(o), s=b.getSize(new THREE.Vector3());
    const hoehe=(maxY-minY)*10;
    const neigung = hoehe>0.01 ? Math.atan2(versatz, hoehe)*180/Math.PI : 0;
    return { tag, breite_mm:+(s.x*10).toFixed(1), tiefe_mm:+(s.z*10).toFixed(1), hoehe_mm:+hoehe.toFixed(2),
             versatz_oben_mm:+versatz.toFixed(2), neigung_grad:+neigung.toFixed(1),
             scale:[+o.scale.x.toFixed(2),+o.scale.y.toFixed(2),+o.scale.z.toFixed(2)] };
  };
  const log = [];

  // A) SVG FLACH (ohne Tiefe) — dann Höhe verstellen
  _importSvgConfirm({ svgText:SVG, mode:'flat', depthMM:3, targetMM:100 });
  let o = objects[objects.length-1];
  selectObjs([o]); updateFP(); scaleLocked = false;
  log.push(mess(o,'A flach: nach Import'));
  fpApplyDim('w', 160); log.push(mess(o,'A flach: Breite 160'));
  fpApplyDim('h', 8);   log.push(mess(o,'A flach: Höhe 8'));
  fpApplyDim('h', 15);  log.push(mess(o,'A flach: Höhe 15'));
  fpApplyDim('h', 4);   log.push(mess(o,'A flach: Höhe 4 (danach)'));
  // überlebt es Undo/Speichern? (SVG wird aus Pfaddaten neu gebaut)
  const d = objectToData(o);
  const o2 = buildObjectFromData(d); o2.updateMatrixWorld(true);
  log.push(mess(o2,'A: nach Speichern/Laden'));

  // B) extrudiert, vorher gedreht (wie nach Ausrichten/Kippen)
  _newCreate(false);
  _importSvgConfirm({ svgText:SVG, mode:'extrude', depthMM:3, targetMM:100 });
  o = objects[objects.length-1];
  o.rotation.set(0, 0, 25*Math.PI/180); o.updateMatrixWorld(true);
  selectObjs([o]); updateFP(); scaleLocked = false;
  log.push(mess(o,'B gedreht 25°: Start'));
  fpApplyDim('w', 160); log.push(mess(o,'B gedreht: Breite 160'));
  fpApplyDim('h', 8);   log.push(mess(o,'B gedreht: Höhe 8'));
  fpApplyDim('h', 15);  log.push(mess(o,'B gedreht: Höhe 15'));
  return log;
});
console.log(JSON.stringify(out,null,0).replace(/\},/g,'},\n'));
await br.close(); srv.kill();
