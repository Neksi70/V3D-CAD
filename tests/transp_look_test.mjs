// Regressionstest Durchsicht-Modus ("Transparent"): keine Innenflächen-/Kanten-
// Suppe mehr (Tester-Meldung: Körper wird schwarz), und "aus" stellt sauber her.
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from '@playwright/test';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails=[]; const ok=(n,c,e)=>{console.log((c?'  OK  ':'FEHLER ')+n+(e!==undefined?'  → '+JSON.stringify(e):'')); if(!c) fails.push(n);};
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1200,height:800}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });
await p.goto(URL,{waitUntil:'load'});
await p.waitForFunction(()=>typeof window.addShape==='function',{timeout:60000});
await p.evaluate(()=>{document.getElementById('start-modal')?.classList.remove('show');document.getElementById('auth-overlay')?.classList.add('hidden');});

const r = await p.evaluate(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const out={};
  const snap=o=>({side:o.material.side, dw:o.material.depthWrite, tr:o.material.transparent,
                  op:Math.round(o.material.opacity*100)/100, cast:o.castShadow,
                  edge:(()=>{const c=o.children.find(c=>c.userData.isEdgeLines);
                    return c?{col:'#'+c.material.color.getHexString(),op:c.material.opacity}:null})()});
  // Textkörper (viele Kanten — der gemeldete Fall)
  addTextShape(); await sleep(700);
  document.getElementById('text3d-input').value='test';
  document.getElementById('text3d-size').value='50';
  _confirmText3d(); await sleep(2500);
  const o=objects[objects.length-1]; selectObjs([o]);
  out.off1=snap(o);
  setTransparent(true);  out.on=snap(o);
  setTransparent(false); out.off2=snap(o);
  // Kantenneubau (z.B. nach Maßänderung) darf den Zustand nicht verlieren
  setTransparent(true); _updateObjEdgeLines(o); out.afterEdgeRebuild=snap(o);
  // Speichern → Laden
  const data=objectToData(o);
  if (data){ const o2=buildObjectFromData(data); out.reload=snap(o2); }
  // Bohrung darf unverändert bleiben
  shapeMode='hole'; addShape('cylinder'); shapeMode='solid';
  const h=objects[objects.length-1]; out.hole=snap(h);
  return out;
});
console.log(JSON.stringify(r,null,1));
const FRONT=0, DOUBLE=2;
ok('aus: DoubleSide, Tiefe an, Schatten an, Kanten schwarz',
   r.off1.side===DOUBLE && r.off1.dw===true && r.off1.cast===true && r.off1.edge.col==='#000000', r.off1);
ok('an: FrontSide, Tiefe aus, kein Eigenschatten, Kanten blass',
   r.on.side===FRONT && r.on.dw===false && r.on.cast===false && r.on.edge.col!=='#000000' && r.on.edge.op<0.5, r.on);
ok('wieder aus: Ausgangszustand zurück',
   r.off2.side===DOUBLE && r.off2.dw===true && r.off2.cast===true && r.off2.edge.col==='#000000' && r.off2.op===1, r.off2);
ok('Kanten-Neubau behält Durchsicht', r.afterEdgeRebuild.edge.col!=='#000000' && r.afterEdgeRebuild.side===FRONT, r.afterEdgeRebuild);
if (r.reload) ok('nach Laden weiter durchsichtig + blasse Kanten',
   r.reload.tr===true && r.reload.side===FRONT && r.reload.cast===false, r.reload);
ok('Bohrung unverändert (DoubleSide, Schatten)', r.hole.side===DOUBLE && r.hole.cast===true, r.hole);
if(errs.length) console.log('Seitenfehler:', errs.slice(0,5));
console.log(fails.length? '\n'+fails.length+' FEHLER' : '\nalles gruen');
await b.close();
process.exit(fails.length?1:0);
