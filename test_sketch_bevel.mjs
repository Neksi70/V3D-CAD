// Regression für die Skizzen-Körper: _skBuildGeoFromProfiles/_skRoundExtrude wird
// auch vom Tortentopper benutzt und wurde dafür umgebaut (Umlaufsinn pro Schleife
// statt pro Dreieck, Deckel auf der unversetzten Kontur trianguliert).
// Geprüft: Kreis / Rechteck / Ring, jeweils scharf, gerundet und gefast —
// wasserdicht, richtig herum (Volumen positiv) und in plausibler Größe.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8792;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(1500);

const res = await page.evaluate(() => {
  if (typeof _skBuildGeoFromProfiles !== 'function') return { err: '_skBuildGeoFromProfiles fehlt' };
  const key = (p,i) => Math.round(p[i*3]*1e4)+'_'+Math.round(p[i*3+1]*1e4)+'_'+Math.round(p[i*3+2]*1e4);
  const topo = geo => {
    const p = geo.attributes.position.array, idx = geo.index ? geo.index.array : null;
    const nTri = idx ? idx.length/3 : p.length/9, em = new Map();
    for (let t=0;t<nTri;t++){
      const v=[0,1,2].map(k=>key(p, idx?idx[t*3+k]:t*3+k));
      for (let k=0;k<3;k++){ const a=v[k], b=v[(k+1)%3]; if(a===b) continue;
        const kk=a<b?a+'|'+b:b+'|'+a; em.set(kk,(em.get(kk)||0)+1); }
    }
    let open=0, nonman=0;
    for (const c of em.values()){ if(c===1) open++; else if(c>2) nonman++; }
    return { open, nonman };
  };
  const vol = geo => {
    const p = geo.attributes.position.array, idx = geo.index ? geo.index.array : null;
    const nTri = idx ? idx.length/3 : p.length/9; let V=0;
    for (let t=0;t<nTri;t++){
      const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
      const ax=p[i0*3],ay=p[i0*3+1],az=p[i0*3+2],bx=p[i1*3],by=p[i1*3+1],bz=p[i1*3+2],cx=p[i2*3],cy=p[i2*3+1],cz=p[i2*3+2];
      V += (ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6;
    }
    return V;
  };
  // Profile in (u,v), wie sie _skBuildShapes liefert. Beide Umlaufrichtungen testen —
  // im Topper kommen die Konturen genau andersherum an als aus der Skizze.
  const circle = (r, n, cw) => { const p=[]; for(let i=0;i<n;i++){ const a=(cw?-1:1)*2*Math.PI*i/n; p.push({u:r*Math.cos(a), v:r*Math.sin(a)}); } return p; };
  const rect = (w,h,cw) => { const p=[{u:-w,v:-h},{u:w,v:-h},{u:w,v:h},{u:-w,v:h}]; return cw?p.reverse():p; };
  const cases = [];
  for (const cw of [false, true]) {
    cases.push({ name:'Kreis r=1 '+(cw?'cw':'ccw'),  prof:{outer:circle(1,64,cw), holes:[]}, area:Math.PI },
               { name:'Rechteck '+(cw?'cw':'ccw'),   prof:{outer:rect(1,0.6,cw), holes:[]},  area:2*1.2 },
               { name:'Ring '+(cw?'cw':'ccw'),       prof:{outer:circle(1,64,cw), holes:[circle(0.5,48,!cw)]}, area:Math.PI*0.75 });
  }
  const out = [];
  for (const c of cases) {
    const row = { name:c.name };
    for (const [tag, fil, cha] of [['scharf',0,0], ['rund',1.5,0], ['fase',0,1.5]]) {
      const g = _skBuildGeoFromProfiles([c.prof], 10, fil, cha);   // 10 mm hoch = 1 Unit
      const t = topo(g), V = vol(g);
      row[tag] = { ...t, vol:+V.toFixed(4) };
    }
    out.push(row);
  }
  return { out };
});

console.log(JSON.stringify(res, null, 1));
console.log('pageerrors:', errs);

const fails = [];
if (res.err) fails.push(res.err);
else for (const r of res.out) {
  const A = r.name.startsWith('Kreis') ? Math.PI : r.name.startsWith('Rechteck') ? 2.4 : Math.PI*0.75;
  for (const tag of ['scharf','rund','fase']) {
    const v = r[tag];
    if (v.open || v.nonman) fails.push(`${r.name} / ${tag}: nicht wasserdicht (offen ${v.open}, non-manifold ${v.nonman})`);
    if (v.vol <= 0) fails.push(`${r.name} / ${tag}: Volumen ${v.vol} — Körper ist nach innen gestülpt`);
    // Höhe 1 Unit → Volumen ≈ Fläche; Rundung/Fase nehmen nur wenig weg
    if (Math.abs(v.vol - A) > A*0.1) fails.push(`${r.name} / ${tag}: Volumen ${v.vol}, erwartet ≈ ${A.toFixed(3)}`);
  }
}
if (errs.length) fails.push('Page-Errors: ' + errs.join(' | '));
console.log(fails.length ? '❌ FAIL\n' + fails.map(f=>' - '+f).join('\n') : '✅ Skizzen-Körper unverändert in Ordnung');
await browser.close(); srv.kill();
process.exit(fails.length ? 1 : 0);
