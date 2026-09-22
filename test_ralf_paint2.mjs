// Prüft: Bemalen auf Riesen-Netz — Rückgängig muss Geometrie UND Farben exakt
// zurückgeben, Speicherverbrauch darf über viele Striche nicht explodieren,
// und die gespeicherte Fassung muss weiter ladbar sein.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const PORT = 8871;
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd:'/home/v3da', stdio:'inherit' });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch({ args:['--js-flags=--expose-gc'] });
const pg = await br.newPage({ viewport:{width:1200,height:800} });
pg.on('console', m => { const t=m.text(); if(/geoJSON|Fehler/i.test(t)) console.log('[browser]', t); });
await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
await pg.waitForFunction(() => typeof objects !== 'undefined' && typeof _vkCreate === 'function' && typeof hideStarter === 'function', null, {timeout:30000});
await pg.evaluate(() => hideStarter());

const res = await pg.evaluate(async () => {
  const out = {};
  const c = document.createElement('canvas'); c.width=1100; c.height=600;
  const x = c.getContext('2d');
  x.fillStyle='#e8e8e8'; x.fillRect(0,0,1100,600);
  x.fillStyle='#111'; x.font='bold 70px Arial'; x.fillText('RUHRPUMPEN', 40, 110);
  x.font='40px Arial';
  for(let i=0;i<7;i++) x.fillText('Type TR 1000/1000x2   Ser. 101600277 F', 40, 200+i*55);
  const img = new Image(); await new Promise(r => { img.onload=r; img.src=c.toDataURL('image/png'); });
  _vk.img = img;
  Object.assign(_vk.p, { photo:'voll', w:110, h:60, relief:0.6, plastik:60, res:550, hohl:true });
  _vkCreate();
  let m = objects[objects.length-1];
  out.tris0 = m.geometry.index ? m.geometry.index.count/3 : m.geometry.attributes.position.count/3;

  selectObjs([m]); openMmuPaintTool(); _mmuEnsure(m); m.updateMatrixWorld(true);
  const g0 = m.geometry;
  const farbe0 = Float32Array.from(g0.attributes.color.array);   // Referenz VOR allen Strichen
  const pos0   = Float32Array.from(g0.attributes.position.array);

  const treffer = (dx,dz) => {
    const rc = new THREE.Raycaster();
    rc.set(new THREE.Vector3(dx, 50, dz), new THREE.Vector3(0,-1,0));
    return rc.intersectObject(m, true)[0];
  };
  _mmu.tool='brush'; _mmu.radiusMm=3;
  const t0 = performance.now();
  for (let i=0;i<8;i++){
    const h = treffer(-2+i*0.5, 0);
    if (!h) { out.fehler='kein Treffer bei Strich '+i; break; }
    saveUndo();
    _mmuApplyAt(m, h);
  }
  out.strich_ms = Math.round((performance.now()-t0)/8);
  out.undoTiefe = undoStack.length;
  out.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null;

  // ganz zurück
  const tu = performance.now();
  for (let i=0;i<8;i++) undo();
  out.undo_ms = Math.round((performance.now()-tu)/8);
  m = objects[objects.length-1];
  const g = m.geometry;
  out.trisNachUndo = g.index ? g.index.count/3 : g.attributes.position.count/3;
  const pos = g.attributes.position.array, col = g.attributes.color ? g.attributes.color.array : null;
  let maxDPos = 0, maxDCol = 0;
  if (pos.length === pos0.length) for (let i=0;i<pos.length;i++) maxDPos = Math.max(maxDPos, Math.abs(pos[i]-pos0[i]));
  else out.fehler = (out.fehler||'') + ' Vertexzahl weicht ab';
  if (col && col.length === farbe0.length) for (let i=0;i<col.length;i++) maxDCol = Math.max(maxDCol, Math.abs(col[i]-farbe0[i]));
  else out.fehler = (out.fehler||'') + ' Farb-Attribut fehlt';
  out.maxAbweichungPos_mm = +(maxDPos*10).toFixed(5);
  out.maxAbweichungFarbe = +maxDCol.toFixed(5);

  // gespeicherte Fassung muss weiter durch den normalen Weg gehen
  const st = { version:1, objects: objects.map(o => objectToData(o)) };
  const js = JSON.stringify(st);
  out.speicherMB = +(js.length/1048576).toFixed(1);
  out.speicherHatSnap = js.includes('__snap');
  return out;
});
console.log(res);
await br.close(); srv.kill();
