// Ralfs Weg: SVG einfügen → Breite/Tiefe per Regler ändern → dann Höhe.
// Prüft: wird die Höhe wirklich größer, und bleibt der Körper senkrecht
// (keine Scherung: Deckfläche muss über der Grundfläche stehen)?
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8874;
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd:'/home/v3da', stdio:'inherit' });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch();
const pg = await br.newPage({ viewport:{width:1200,height:800} });
pg.on('console', m => { if(/Fehler|error/i.test(m.text())) console.log('[browser]', m.text()); });
await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
await pg.waitForFunction(() => typeof objects !== 'undefined' && typeof _importSvgConfirm === 'function' && typeof hideStarter === 'function', null, {timeout:30000});
await pg.evaluate(() => hideStarter());

const out = await pg.evaluate(() => {
  const log = [];
  // Zwei „Buchstaben" (Rechteck + L-Form) — Form egal, es geht um Scherung
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60">
    <path d="M10 10 h30 v40 h-30 z"/>
    <path d="M60 10 h15 v25 h25 v15 h-40 z"/>
    <path d="M120 10 h50 v12 h-19 v28 h-12 v-28 h-19 z"/></svg>`;
  _importSvgConfirm({ svgText: svg, mode:'extrude', depthMM: 3, targetMM: 100 });
  const o = objects[objects.length-1];
  const mess = (tag) => {
    o.updateMatrixWorld(true);
    const g = o.geometry, pos = g.attributes.position;
    const v = new THREE.Vector3();
    let minY=1e9, maxY=-1e9;
    for (let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
      minY=Math.min(minY,v.y); maxY=Math.max(maxY,v.y); }
    // Schwerpunkt der untersten und der obersten Punktlage vergleichen
    const eps=(maxY-minY)*0.02+1e-6;
    let bx=0,bz=0,bn=0, tx=0,tz=0,tn=0;
    for (let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
      if (v.y<minY+eps){ bx+=v.x; bz+=v.z; bn++; }
      if (v.y>maxY-eps){ tx+=v.x; tz+=v.z; tn++; } }
    const versatz = (bn&&tn) ? Math.hypot(tx/tn-bx/bn, tz/tn-bz/bn)*10 : null;   // mm
    const b = getMeshBox(o), s = b.getSize(new THREE.Vector3());
    const m = o.matrixWorld.elements;
    // Scherung in der Matrix: Spalten müssen zueinander senkrecht stehen
    const c0=new THREE.Vector3(m[0],m[1],m[2]).normalize();
    const c1=new THREE.Vector3(m[4],m[5],m[6]).normalize();
    const c2=new THREE.Vector3(m[8],m[9],m[10]).normalize();
    const schief = Math.max(Math.abs(c0.dot(c1)), Math.abs(c1.dot(c2)), Math.abs(c0.dot(c2)));
    return { tag, breite_mm:+(s.x*10).toFixed(2), tiefe_mm:+(s.z*10).toFixed(2), hoehe_mm:+(s.y*10).toFixed(2),
             versatz_oben_mm:+(versatz||0).toFixed(3), matrix_schief:+schief.toFixed(4),
             scale:[+o.scale.x.toFixed(3),+o.scale.y.toFixed(3),+o.scale.z.toFixed(3)],
             rot_grad:[o.rotation.x,o.rotation.y,o.rotation.z].map(r=>+(r*180/Math.PI).toFixed(1)) };
  };
  selectObjs([o]); updateFP();
  log.push(mess('nach Import'));
  scaleLocked = false;
  fpApplyDim('w', 160); log.push(mess('Breite X → 160'));
  fpApplyDim('d', 50);  log.push(mess('Tiefe Y → 50'));
  fpApplyDim('h', 8);   log.push(mess('Höhe Z → 8'));
  fpApplyDim('h', 15);  log.push(mess('Höhe Z → 15'));
  return log;
});
console.log(JSON.stringify(out, null, 1));
await br.close(); srv.kill();
