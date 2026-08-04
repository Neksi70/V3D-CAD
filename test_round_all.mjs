// Test für „⬤ Alles abrunden" (_roundApply): Schrumpfen + Aufblasen über das
// Distanzfeld. Geprüft an einem IMPORTIERTEN Würfel — genau Ralfs Fall:
//  · sind die Ecken/Kanten danach wirklich weg (Radius messbar)?
//  · bleiben die Flächen und damit die Maße stehen?
//  · ist das Ergebnis wasserdicht?
//  · greift die Bremse, wenn der Radius für ein dünnes Teil zu groß ist?
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8786;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  const out = { notes: [] };
  const _n = window.notify; window.notify = (m,k)=>{ out.notes.push((k||'ok')+': '+m); return _n(m,k); };

  // ── Hilfen ────────────────────────────────────────────────────────────────
  const stlFromGeo = g => {                       // App-Einheiten → STL in mm
    const p = g.toNonIndexed().attributes.position.array, n = p.length/9;
    const buf = new ArrayBuffer(84 + n*50), dv = new DataView(buf);
    dv.setUint32(80, n, true);
    for (let t=0;t<n;t++){ const o = 84 + t*50;
      for (let k=0;k<3;k++){ dv.setFloat32(o+12+k*12,   p[t*9+k*3]*10,   true);
                             dv.setFloat32(o+12+k*12+4, p[t*9+k*3+1]*10, true);
                             dv.setFloat32(o+12+k*12+8, p[t*9+k*3+2]*10, true); } }
    return buf;
  };
  const imp = (geo, name) => { const b = stlFromGeo(geo); _addImportedGeo(parseSTL(b), name, false, b, false);
                               return objects[objects.length-1]; };
  const topo = mesh => {
    const g = mesh.geometry, p = g.attributes.position.array, idx = g.index ? g.index.array : null;
    const nTri = idx ? idx.length/3 : p.length/9, em = new Map();
    const key = i => Math.round(p[i*3]*1e6)+'_'+Math.round(p[i*3+1]*1e6)+'_'+Math.round(p[i*3+2]*1e6);
    for (let t=0;t<nTri;t++){ const v=[0,1,2].map(k=>key(idx?idx[t*3+k]:t*3+k));
      for (let k=0;k<3;k++){ const a=v[k], b=v[(k+1)%3]; if(a===b) continue;
        const kk=a<b?a+'|'+b:b+'|'+a; em.set(kk,(em.get(kk)||0)+1); } }
    let open=0, nonman=0;
    for (const c of em.values()){ if(c===1) open++; else if(c>2) nonman++; }
    return { open, nonman, tris:nTri };
  };
  const sizeMM = mesh => { mesh.updateMatrixWorld(true);
    const s = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).multiplyScalar(10);
    return [+s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2)]; };
  // Wie viel Material fehlt in der Ecke? Für einen Würfel mit Radius r an allen
  // 12 Kanten + 8 Ecken ist das analytisch bekannt.
  const volMM3 = mesh => { mesh.updateMatrixWorld(true);
    const g = mesh.geometry.clone(); g.applyMatrix4(mesh.matrixWorld);
    const p = g.attributes.position.array, idx = g.index ? g.index.array : null;
    const nT = idx ? idx.length/3 : p.length/9; let V=0;
    for (let t=0;t<nT;t++){ const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
      const ax=p[i0*3],ay=p[i0*3+1],az=p[i0*3+2],bx=p[i1*3],by=p[i1*3+1],bz=p[i1*3+2],cx=p[i2*3],cy=p[i2*3+1],cz=p[i2*3+2];
      V += (ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6; }
    return Math.abs(V)*1000;   // App-Einheiten³ → mm³
  };
  // Schärfste Kante messen: größter Winkel zwischen benachbarten Dreiecken
  const maxDihedral = mesh => {
    const g = mesh.geometry, p = g.attributes.position.array, idx = g.index ? g.index.array : null;
    const nT = idx ? idx.length/3 : p.length/9;
    const key = i => Math.round(p[i*3]*1e3)+'_'+Math.round(p[i*3+1]*1e3)+'_'+Math.round(p[i*3+2]*1e3);
    const nrm = new Float32Array(nT*3), em = new Map();
    for (let t=0;t<nT;t++){
      const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
      const ux=p[i1*3]-p[i0*3],uy=p[i1*3+1]-p[i0*3+1],uz=p[i1*3+2]-p[i0*3+2];
      const vx=p[i2*3]-p[i0*3],vy=p[i2*3+1]-p[i0*3+1],vz=p[i2*3+2]-p[i0*3+2];
      let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      const l=Math.hypot(nx,ny,nz)||1; nrm[t*3]=nx/l; nrm[t*3+1]=ny/l; nrm[t*3+2]=nz/l;
      const v=[i0,i1,i2].map(key);
      for (let k=0;k<3;k++){ const a=v[k], b=v[(k+1)%3]; if(a===b) continue;
        const kk=a<b?a+'|'+b:b+'|'+a; const e=em.get(kk); if(e) e.push(t); else em.set(kk,[t]); }
    }
    let worst=0;
    for (const f of em.values()){ if (f.length!==2) continue;
      const d = nrm[f[0]*3]*nrm[f[1]*3]+nrm[f[0]*3+1]*nrm[f[1]*3+1]+nrm[f[0]*3+2]*nrm[f[1]*3+2];
      const a = Math.acos(Math.max(-1,Math.min(1,d)))*180/Math.PI;
      if (a>worst) worst=a; }
    return +worst.toFixed(1);
  };
  const run = async (obj, r) => {
    selectObjs([obj]);
    _openRoundModal();
    document.getElementById('round-r').value = r;
    await _roundApply();                    // läuft komplett durch, inkl. beider Offset-Läufe
    await new Promise(x=>setTimeout(x,300));
    return objects[objects.length-1];
  };

  // ── 1) Würfel 20 mm, importiert, 1 mm Radius ─────────────────────────────
  const cube = imp(new THREE.BoxGeometry(2,2,2), 'wuerfel.stl');
  await new Promise(r=>setTimeout(r,400));
  out.cubeBefore = { size:sizeMM(cube), vol:+volMM3(cube).toFixed(0), sharp:maxDihedral(cube), ...topo(cube) };
  const r1 = 1.0;
  const t0 = performance.now();
  const rounded = await run(cube, r1);
  out.ms = Math.round(performance.now()-t0);
  out.cubeAfter = { size:sizeMM(rounded), vol:+volMM3(rounded).toFixed(0), sharp:maxDihedral(rounded), ...topo(rounded) };
  // Sollvolumen: Würfel a=20 mit Radius r an allen Kanten
  //   V = a³ − 12·(1−π/4)r²·(a−2r) − 8·(1−π/6)r³ ... (Kanten- und Eckenabzug)
  const a = 20, r = r1;
  out.cubeSoll = +(a**3 - 12*(1-Math.PI/4)*r*r*(a-2*r) - 8*(1 - Math.PI/6)*r**3).toFixed(0);
  out.replaced = !objects.includes(cube);

  // ── 1b) Zwei ineinandersteckende Hüllen (Klotz + herausragender Steg) ────
  // Genau der Fall, an dem reine Paritäts-Vorzeichen den Überlappbereich zum
  // Hohlraum machen: Ergebnis muss dem VEREINIGTEN Volumen entsprechen.
  for (const o2 of objects.slice()) scene.remove(o2);
  objects.length = 0;
  {
    const a = new THREE.BoxGeometry(2,1,2).toNonIndexed();                 // 20×10×20
    const b = new THREE.BoxGeometry(0.6,1,0.6).toNonIndexed(); b.translate(0,0.7,0); // 6×10×6, ragt 6 mm heraus
    const geos = [a,b]; let n=0; geos.forEach(g=>n+=g.attributes.position.count/3);
    const buf = new ArrayBuffer(84+n*50), dv = new DataView(buf); dv.setUint32(80,n,true);
    let t=0;
    for (const g of geos){ const p=g.attributes.position.array;
      for (let i=0;i<p.length/9;i++,t++){ const o3=84+t*50;
        for (let k=0;k<3;k++){ dv.setFloat32(o3+12+k*12,   p[i*9+k*3]*10,   true);
                               dv.setFloat32(o3+12+k*12+4, p[i*9+k*3+1]*10, true);
                               dv.setFloat32(o3+12+k*12+8, p[i*9+k*3+2]*10, true); } } }
    _addImportedGeo(parseSTL(buf), 'zwei-huellen.stl', false, buf, false);
  }
  await new Promise(r2=>setTimeout(r2,400));
  const two = objects[objects.length-1];
  const twoRound = await run(two, 0.6);
  out.twoShell = { vol:+volMM3(twoRound).toFixed(0), ...topo(twoRound) };
  out.twoShellSoll = 20*10*20 + 6*6*6;      // Klotz + herausragender Teil des Stegs

  // ── 1c) Ralfs Fall: ineinandergesteckte „Buchstaben" mit dünner Fahne ────
  // Drei Klötze, die sich überlappen, plus ein hauchdünner Anstrich (0,6 mm).
  // Einzeln gerundet muss ALLES erhalten bleiben (der dünne bleibt unverändert),
  // am Stück gerundet fällt der dünne weg — genau der Unterschied, um den es geht.
  const letters = () => {
    const gs = [];
    for (const x of [-0.6, 0, 0.6]) { const g = new THREE.BoxGeometry(0.8,0.8,0.4).toNonIndexed(); g.translate(x,0.4,0); gs.push(g); }
    const thin = new THREE.BoxGeometry(0.9,0.06,0.3).toNonIndexed(); thin.translate(1.2,0.4,0); gs.push(thin);  // 0,6 mm dünn
    let n=0; gs.forEach(g=>n+=g.attributes.position.count/3);
    const buf = new ArrayBuffer(84+n*50), dv = new DataView(buf); dv.setUint32(80,n,true);
    let t=0;
    for (const g of gs){ const p=g.attributes.position.array;
      for (let i=0;i<p.length/9;i++,t++){ const o3=84+t*50;
        for (let k=0;k<3;k++){ dv.setFloat32(o3+12+k*12,   p[i*9+k*3]*10,   true);
                               dv.setFloat32(o3+12+k*12+4, p[i*9+k*3+1]*10, true);
                               dv.setFloat32(o3+12+k*12+8, p[i*9+k*3+2]*10, true); } } }
    _addImportedGeo(parseSTL(buf), 'buchstaben.stl', false, buf, false);
    return objects[objects.length-1];
  };
  const bboxMM = m => { m.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(m); return [+(b.max.x*10).toFixed(1), +(b.min.x*10).toFixed(1)]; };
  for (const o2 of objects.slice()) scene.remove(o2);
  objects.length = 0;
  const L1 = letters(); await new Promise(r2=>setTimeout(r2,400));
  out.lettersBefore = { vol:+volMM3(L1).toFixed(0), xmax:bboxMM(L1)[0] };
  out.notes = [];
  const Lr = await run(L1, 0.4);
  out.lettersParts = { vol:+volMM3(Lr).toFixed(0), xmax:bboxMM(Lr)[0], ...topo(Lr), notes:out.notes.slice() };

  // Gegenprobe auf dem alten Weg (alles in EINEM Distanzfeld). Den gibt es als
  // Bedienoption nicht mehr, weil die im Material versteckten Flächen der
  // Überlappungen mitgeschnitten werden — hier belegt, damit das dokumentiert ist.
  for (const o2 of objects.slice()) scene.remove(o2);
  objects.length = 0;
  const L2 = letters(); await new Promise(r2=>setTimeout(r2,400));
  {
    const w = await _mfInit();
    const whole = _moldCollectTris(L2);
    const mf = await _roundOnePart(w, whole, 0.4, { voxTarget: 0.4/2.5, maxCells: 16e6 }, ()=>{});
    if (!mf) out.lettersWhole = { vol:0, xmax:0 };
    else {
      const g = _mfToGeo(mf);
      g.computeBoundingBox();
      const p = g.attributes.position.array, idx = g.index.array; let V=0;
      for (let t=0;t<idx.length/3;t++){ const i0=idx[t*3],i1=idx[t*3+1],i2=idx[t*3+2];
        const ax=p[i0*3],ay=p[i0*3+1],az=p[i0*3+2],bx=p[i1*3],by=p[i1*3+1],bz=p[i1*3+2],cx=p[i2*3],cy=p[i2*3+1],cz=p[i2*3+2];
        V += (ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6; }
      out.lettersWhole = { vol:+Math.abs(V).toFixed(0), xmax:+g.boundingBox.max.x.toFixed(1) };   // schon in mm
      mf.delete();
    }
  }

  // ── 2) Bremse: 1 mm dünne Platte, 1,5 mm Radius → muss abgelehnt werden ──
  for (const o2 of objects.slice()) { scene.remove(o2); }
  objects.length = 0;
  const plate = imp(new THREE.BoxGeometry(3, 0.1, 3), 'platte.stl');   // 30 × 1 × 30 mm
  await new Promise(r2=>setTimeout(r2,400));
  out.notes = [];
  const after2 = await run(plate, 1.5);
  out.thinKept = after2 === plate;                 // Original muss stehen bleiben
  out.thinNotes = out.notes.slice();
  return out;
});

console.log(JSON.stringify(res, null, 1));
console.log('pageerrors:', errs.slice(0,4));

const fails = [];
const ok = (c,m) => { if(!c) fails.push(m); };
const A = res.cubeAfter || {}, B = res.cubeBefore || {};
ok(res.replaced, 'Das abgerundete Teil hat das Original nicht ersetzt');
ok(A.open === 0 && A.nonman === 0, 'Ergebnis nicht wasserdicht: offen ' + A.open + ', non-manifold ' + A.nonman);
ok(B.sharp > 85, 'Testaufbau: der Würfel war vorher gar nicht scharfkantig (' + B.sharp + '°)');
ok(A.sharp < 50, 'Kanten sind noch scharf: größter Knickwinkel ' + A.sharp + '° (vorher ' + B.sharp + '°)');
ok(A.size.every((v,i) => Math.abs(v - B.size[i]) < 0.35),
   'Maße haben sich verschoben: ' + JSON.stringify(B.size) + ' → ' + JSON.stringify(A.size));
ok(Math.abs(A.vol - res.cubeSoll) < res.cubeSoll*0.02,
   'Volumen ' + A.vol + ' mm³, erwartet ' + res.cubeSoll + ' mm³ (±2 %)');
ok(res.thinKept, 'Zu großer Radius an dünner Platte: Original wurde trotzdem ersetzt');
ok((res.thinNotes||[]).some(n => /bleibt vom Teil nichts|dünner als/i.test(n)),
   'Zu großer Radius: keine verständliche Meldung — ' + JSON.stringify(res.thinNotes));
ok(A.tris < 5000, 'Ergebnis zu dreiecksreich: ' + A.tris + ' Dreiecke für einen Würfel');
ok(A.tris > 200, 'Ergebnis zu stark vereinfacht: nur ' + A.tris + ' Dreiecke — Rundung dürfte weg sein');
ok(res.twoShell && Math.abs(res.twoShell.vol - res.twoShellSoll) < res.twoShellSoll*0.05,
   'Ineinandersteckende Teile: ' + (res.twoShell||{}).vol + ' mm³, erwartet ≈ ' + res.twoShellSoll
   + ' mm³ — Überlappung wurde vermutlich zum Hohlraum');
// Dicht heißt: keine OFFENE Kante. An der Innenecke, wo der Steg aus dem Klotz
// tritt, berührt sich die Iso-Fläche selbst — Manifold liefert das indexseitig
// sauber, positionsgleiche Punkte zählt der Test aber als „non-manifold".
// Gemessen: schon vor dem Vereinfachen 5 solcher Stellen, also kein Folgefehler.
ok(res.twoShell && res.twoShell.open === 0, 'Zwei-Hüllen-Ergebnis hat offene Kanten: ' + (res.twoShell||{}).open);
ok(res.twoShell && res.twoShell.nonman <= 8, 'Auffällig viele Selbstberührungen: ' + (res.twoShell||{}).nonman);
// Ralfs Fall: einzeln gerundet bleibt die dünne Fahne erhalten (Ausdehnung in x),
// am Stück gerundet fällt sie weg. Genau dafür ist die Option da.
const LP = res.lettersParts || {}, LW = res.lettersWhole || {}, LB = res.lettersBefore || {};
ok(Math.abs(LP.xmax - LB.xmax) < 0.6, 'Teile einzeln: dünne Fahne verschwunden (x-Ende ' + LP.xmax + ' statt ' + LB.xmax + ')');
ok(LW.xmax < LP.xmax - 1, 'Gegenprobe am Stück: dort MUSS die dünne Fahne wegfallen (x-Ende ' + LW.xmax + ')');
ok(LP.vol > LW.vol, 'Teile einzeln muss mehr Material behalten als am Stück (' + LP.vol + ' vs ' + LW.vol + ')');
ok(LP.open === 0, 'Buchstaben-Verbund hat offene Kanten: ' + LP.open);
ok((LP.notes||[]).some(n => /Teile einzeln gerundet/.test(n)), 'Meldung nennt die Teile nicht: ' + JSON.stringify(LP.notes));
ok((LP.notes||[]).some(n => /zu fein|unverändert/.test(n)), 'Meldung verschweigt das übersprungene dünne Teil: ' + JSON.stringify(LP.notes));
ok(errs.length === 0, 'Page-Errors: ' + errs.join(' | '));

console.log(fails.length ? '❌ FAIL\n' + fails.map(f=>' - '+f).join('\n') : '✅ alle Prüfungen bestanden');
await browser.close(); srv.kill();
process.exit(fails.length ? 1 : 0);
