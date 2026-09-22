import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
const PORT = 8869;
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd:'/home/v3da', stdio:'inherit' });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch();
const pg = await br.newPage({ viewport:{width:1400,height:900} });
pg.on('console', m => { const t=m.text(); if(/geoJSON|Riesen|Fehler|error/i.test(t)) console.log('[browser]', t); });
await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
await pg.waitForFunction(() => typeof objects !== 'undefined' && typeof _vkCreate === 'function' && typeof hideStarter === 'function', null, {timeout:30000});
await pg.evaluate(() => hideStarter());

// Schild-Foto nachbauen: heller Grund, dunkle Schrift
const RES = Number(process.argv[2]||400);
const info = await pg.evaluate(async (RES) => {
  const c = document.createElement('canvas'); c.width=1100; c.height=600;
  const x = c.getContext('2d');
  x.fillStyle='#e8e8e8'; x.fillRect(0,0,1100,600);
  x.fillStyle='#111'; x.font='bold 70px Arial';
  x.fillText('RUHRPUMPEN', 40, 110);
  x.font='40px Arial';
  for(let i=0;i<7;i++) x.fillText('Type TR 1000/1000x2   Ser. 101600277 F', 40, 200+i*55);
  const img = new Image();
  await new Promise(r => { img.onload=r; img.src=c.toDataURL('image/png'); });
  _vk.img = img;
  Object.assign(_vk.p, { photo:'voll', w:110, h:60, relief:0.6, plastik:60, res:RES, hohl:true });
  _vkCreate();
  const m = objects[objects.length-1];
  const g = m.geometry;
  return { objs: objects.length, name: m.userData.name,
           tris: (g.index?g.index.count:g.attributes.position.count)/3,
           indexed: !!g.index };
}, RES);
console.log('nach Erstellen:', info);

// Bemalen: MMU-Pinsel auf die Oberseite
const paint = await pg.evaluate(() => {
  const m = objects[objects.length-1];
  selectObjs([m]);
  openMmuPaintTool();
  const col = _mmuEnsure(m);
  const g = m.geometry;
  const tris = g.attributes.position.count/3;
  m.updateMatrixWorld(true);
  // Trefferpunkt oben mitte per Raycast von oben
  const rc = new THREE.Raycaster();
  rc.set(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0,-1,0));
  const hits = rc.intersectObject(m, true);
  if (!hits.length) return { err:'kein Treffer', tris };
  const hit = hits[0];
  _mmu.tool='brush'; _mmu.radiusMm=3;
  const before = Array.from(g.attributes.color.array);
  saveUndo();
  _mmuApplyAt(m, hit);
  const after = g.attributes.color.array;
  // gefärbte Dreiecke einsammeln + deren Ausdehnung messen
  const pos = g.attributes.position.array;
  let changed=0; const bb={minx:1e9,maxx:-1e9,minz:1e9,maxz:-1e9};
  for(let t=0;t<tris;t++){
    const i=t*9;
    if (after[i]!==before[i]||after[i+1]!==before[i+1]||after[i+2]!==before[i+2]){
      changed++;
      for(let k=0;k<3;k++){ const o=i+k*3;
        bb.minx=Math.min(bb.minx,pos[o]); bb.maxx=Math.max(bb.maxx,pos[o]);
        bb.minz=Math.min(bb.minz,pos[o+2]); bb.maxz=Math.max(bb.maxz,pos[o+2]); }
    }
  }
  return { tris, changed, hit:{x:hit.point.x.toFixed(3),y:hit.point.y.toFixed(3),z:hit.point.z.toFixed(3)},
           fleckX_mm:((bb.maxx-bb.minx)*10).toFixed(2), fleckZ_mm:((bb.maxz-bb.minz)*10).toFixed(2),
           radius_mm:_mmu.radiusMm };
});
console.log('nach Pinselstrich:', paint);

// Rückgängig
const vorher = await pg.evaluate(() => {
  const g = objects[objects.length-1].geometry, pos=g.attributes.position;
  let maxY=-1e9, minY=1e9; for(let i=0;i<pos.count;i++){ const y=pos.getY(i); if(y>maxY)maxY=y; if(y<minY)minY=y; }
  return { hoehe_mm:((maxY-minY)*10).toFixed(3), verts:pos.count };
});
console.log('vor Rückgängig:', vorher);
const undoInfo = await pg.evaluate(() => {
  const t0=performance.now();
  undo();
  const dt=Math.round(performance.now()-t0);
  const m = objects[objects.length-1];
  const g = m.geometry;
  const pos=g.attributes.position;
  let maxY=-1e9,minY=1e9; for(let i=0;i<pos.count;i++){ const y=pos.getY(i); if(y>maxY)maxY=y; if(y<minY)minY=y; }
  return { objs:objects.length, name:m.userData.name, undo_ms:dt,
           tris:(g.index?g.index.count:pos.count)/3,
           hoehe_mm:((maxY-minY)*10).toFixed(3),
           hatFarbe: !!g.getAttribute('color') };
});
console.log('nach Rückgängig:', undoInfo);
await pg.screenshot({ path:'/home/v3da/scratch_ralf_paint.png' });
await br.close(); srv.kill();
