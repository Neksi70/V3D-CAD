// Funktionstest Bilderrahmen-Generator: _bfrCreate → Wasserdichtheit, Volumen,
// Maße, Schlüsselloch (Aufhängen) und Standfuß (Aufstellen).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8793;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(3000);

const res = await page.evaluate(async () => {
  const out = {};
  hideStarter();
  function meshStats(geo){
    const pos = geo.attributes.position;
    const n = pos.count;
    const q = 1e-3, keyOf = i => Math.round(pos.getX(i)/q)+','+Math.round(pos.getY(i)/q)+','+Math.round(pos.getZ(i)/q);
    const ecnt = new Map();
    let vol = 0;
    for (let t = 0; t < n; t += 3){
      const a = t, b = t+1, c = t+2;
      for (const [i,j] of [[a,b],[b,c],[c,a]]){
        const ki = keyOf(i), kj = keyOf(j), k = ki < kj ? ki+'|'+kj : kj+'|'+ki;
        ecnt.set(k, (ecnt.get(k)||0)+1);
      }
      const ax=pos.getX(a),ay=pos.getY(a),az=pos.getZ(a);
      const bx=pos.getX(b),by=pos.getY(b),bz=pos.getZ(b);
      const cx=pos.getX(c),cy=pos.getY(c),cz=pos.getZ(c);
      vol += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx);
    }
    let open = 0, over = 0;
    for (const v of ecnt.values()){ if (v === 1) open++; else if (v > 2) over++; }
    return { open, over, vol: vol/6, tris: n/3 };
  }
  const bboxMM = geo => { geo.computeBoundingBox(); const s = new THREE.Vector3(); geo.boundingBox.getSize(s); return [s.x*10, s.y*10, s.z*10]; };

  // ── Lauf 1: „beides" → Gruppe aus Rahmen + Standfuß, Schlüsselloch drin ──
  Object.assign(_bfrP, { iB:102, iH:152, aB:146, aH:196, tiefe:10, eTiefe:4, lippe:3, spiel:0.3, typ:'beides' });
  let nBefore = objects.length;
  await _bfrCreate();
  out.run1created = objects.length === nBefore + 1;
  const grp = objects[objects.length-1];
  out.run1isGroup = !!grp.userData.isGroup;
  const kids = grp.children.filter(o => o.isMesh);
  out.run1parts = kids.length;
  const frame = kids.find(k => /Bilderrahmen/.test(k.userData.name));
  const foot  = kids.find(k => /Standfuß/.test(k.userData.name));
  out.frameStats = frame && meshStats(frame.geometry);
  out.footStats  = foot  && meshStats(foot.geometry);
  out.frameBox = frame && bboxMM(frame.geometry).map(v => Math.round(v*10)/10);
  out.footBox  = foot  && bboxMM(foot.geometry).map(v => Math.round(v*10)/10);
  // Erwartung Rahmen-Volumen (mm³): Außen − Sichtfenster − Falzring − Schlüsselloch (~700)
  const d = _bfrDims(_bfrP);
  out.expFrameVol = (d.aB*d.aH*d.T - d.sW*d.sH*d.T - (d.fW*d.fH - d.sW*d.sH)*d.eT) / 1000; // in App-Einheiten³ (×0.1³)
  out.keyholeOk = !!_bfrKeyhole(_bfrP);

  // ── Lauf 2: „haengen" → Einzelmesh; schmaler Steg → Schlüsselloch entfällt ──
  Object.assign(_bfrP, { iB:102, iH:152, aB:120, aH:170, tiefe:10, eTiefe:4, lippe:3, spiel:0.3, typ:'haengen' });
  out.keyholeNarrow = _bfrKeyhole(_bfrP);            // erwartet: null (Steg 9 mm)
  nBefore = objects.length;
  await _bfrCreate();
  out.run2created = objects.length === nBefore + 1;
  const single = objects[objects.length-1];
  out.run2isMesh = !!single.isMesh;
  out.run2stats = single.isMesh && meshStats(single.geometry);

  return out;
});

console.log(JSON.stringify(res, null, 2));
console.log('pageErrors:', errs.length, errs.slice(0,3));

let fail = 0;
const check = (name, ok) => { console.log((ok?'✓ ':'✗ ')+name); if(!ok) fail++; };
check('Lauf1: Gruppe mit 2 Teilen', res.run1created && res.run1isGroup && res.run1parts === 2);
check('Rahmen wasserdicht (open=0, over=0)', res.frameStats && res.frameStats.open===0 && res.frameStats.over===0);
check('Rahmen Volumen > 0', res.frameStats && res.frameStats.vol > 0);
check('Rahmen Volumen ≈ Erwartung (−Schlüsselloch)', res.frameStats && res.frameStats.vol < res.expFrameVol && res.frameStats.vol > res.expFrameVol*0.97);
check('Rahmen-BBox ≈ 146×10×196 mm', res.frameBox && Math.abs(res.frameBox[0]-146)<0.5 && Math.abs(res.frameBox[1]-10)<0.5 && Math.abs(res.frameBox[2]-196)<0.5);
check('Schlüsselloch passt bei Standardmaßen', res.keyholeOk === true);
check('Standfuß wasserdicht', res.footStats && res.footStats.open===0 && res.footStats.over===0 && res.footStats.vol>0);
check('Standfuß-BBox plausibel (~65.7×13×47 mm)', res.footBox && Math.abs(res.footBox[0]-65.7)<1 && Math.abs(res.footBox[1]-13)<0.5 && Math.abs(res.footBox[2]-47)<1);
check('Lauf2: schmaler Steg → kein Schlüsselloch', res.keyholeNarrow === null);
check('Lauf2: Einzelmesh, wasserdicht', res.run2created && res.run2isMesh && res.run2stats.open===0 && res.run2stats.over===0);
check('keine pageErrors', errs.length === 0);

await browser.close();
srv.kill();
process.exit(fail ? 1 : 0);
