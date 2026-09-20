// Regressionstest für die von Layerling übernommenen Funktionen:
//   1. ⋂ Schnittmenge (intersectSelected): echter Boolean-Common, wasserdicht,
//      Volumen = Überlappvolumen, leere Schnittmenge bricht sauber ab
//   2. Senkkopfschraube DIN 7991: wasserdicht, Kopf-Ø/Kegelwinkel stimmen,
//      Gesamtlänge = eingestellte Länge (Maß über alles)
//   3. Schraubenloch (Durchgang/Kernloch/Gewinde × keine/Senkung/Zylinder):
//      wasserdicht, Bohrungsdurchmesser nach Norm, stanzt wirklich ein Loch
//   4. Größe M12 in allen Typen baubar
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
// newScene() fragt per confirm() nach; Playwright lehnt Dialoge sonst stumm ab
// und die Szene wird NICHT geleert (Folgetests zählen dann alte Körper mit).
pg.on('dialog', d => d.accept());
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

// Prüf-Werkzeuge in die Seite legen
await pg.evaluate(async () => {
  await _mfInit();
  window._lyT = {
    // Kantenparität: bei einem wasserdichten Netz hat jede Kante genau 2 Nachbarn
    topo(geo){
      const p=geo.attributes.position, idx=geo.index;
      const n=idx?idx.count/3:p.count/3, key=new Map(); let deg=0;
      const vid=new Map(), id=i=>{
        const k=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');
        if(!vid.has(k)) vid.set(k,vid.size); return vid.get(k); };
      for(let t=0;t<n;t++){
        const a=id(idx?idx.getX(t*3):t*3), bb=id(idx?idx.getX(t*3+1):t*3+1), c=id(idx?idx.getX(t*3+2):t*3+2);
        for(const [x,y] of [[a,bb],[bb,c],[c,a]]){
          const k=x<y?x+'_'+y:y+'_'+x; key.set(k,(key.get(k)||0)+1);
        }
      }
      for(const v of key.values()) if(v!==2) deg++;
      return { tris:n, offeneKanten:deg, dicht:deg===0 };
    },
    // Volumen (mm³) über das Divergenztheorem, Geometrie in App-Units
    vol(geo){
      const p=geo.attributes.position, idx=geo.index;
      const n=idx?idx.count/3:p.count/3; let V=0;
      const g=(i)=>[p.getX(i),p.getY(i),p.getZ(i)];
      for(let t=0;t<n;t++){
        const a=g(idx?idx.getX(t*3):t*3), b=g(idx?idx.getX(t*3+1):t*3+1), c=g(idx?idx.getX(t*3+2):t*3+2);
        V += (a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
      }
      return Math.abs(V)*1000;   // Units³ → mm³
    },
    bbox(geo){ geo.computeBoundingBox(); const b=geo.boundingBox;
      return { x:(b.max.x-b.min.x)*10, y:(b.max.y-b.min.y)*10, z:(b.max.z-b.min.z)*10, minY:b.min.y*10 }; },
    // Radius der Geometrie auf einer bestimmten Höhe y (mm), mit Toleranz
    rAt(geo, yMM, tolMM){
      const p=geo.attributes.position; let r=0;
      for(let i=0;i<p.count;i++){
        if(Math.abs(p.getY(i)*10-yMM)<=tolMM){ const d=Math.hypot(p.getX(i),p.getZ(i))*10; if(d>r)r=d; }
      }
      return r;
    }
  };
});

// ───────────────────────── 1. Schnittmenge ─────────────────────────────────
{
  const r = await pg.evaluate(async () => {
    _newCreate(false);   // Szene leeren ohne Nachfrage-Dialog
    // Zwei 20-mm-Würfel, um 10 mm in X versetzt → Überlappung 10×20×20 = 4000 mm³.
    // Setzen der Position ERST, wenn beide da sind: addShape schiebt neue Körper
    // automatisch neben die vorhandenen.
    addShape('box'); const a = objects[objects.length-1];
    addShape('box'); const c = objects[objects.length-1];
    a.position.set(0,1,0); c.position.set(1,1,0);
    a.updateMatrixWorld(true); c.updateMatrixWorld(true);
    selectObjs([a,c]);
    await intersectSelected();
    const res = objects[objects.length-1];
    return { anzahl: objects.length, name: res.userData.name,
             istSchnitt: !!res.userData.isIntersect,
             topo: _lyT.topo(res.geometry), vol: _lyT.vol(res.geometry),
             bbox: _lyT.bbox(res.geometry) };
  });
  ok('Schnittmenge: nur ein Körper bleibt übrig', r.anzahl === 1, r.anzahl);
  ok('Schnittmenge: wasserdicht', r.topo.dicht, r.topo);
  ok('Schnittmenge: Volumen = Überlappung (4000 mm³)', Math.abs(r.vol - 4000) < 20, Math.round(r.vol));
  ok('Schnittmenge: Maße 10×20×20 mm',
     Math.abs(r.bbox.x-10)<0.2 && Math.abs(r.bbox.y-20)<0.2 && Math.abs(r.bbox.z-20)<0.2, r.bbox);
}
{
  const r = await pg.evaluate(async () => {
    _newCreate(false);   // Szene leeren ohne Nachfrage-Dialog
    addShape('box'); const a = objects[objects.length-1];
    addShape('box'); const c = objects[objects.length-1];
    a.position.set(0,1,0); c.position.set(8,1,0);   // weit weg
    a.updateMatrixWorld(true); c.updateMatrixWorld(true);
    selectObjs([a,c]);
    await intersectSelected();
    return { anzahl: objects.length };
  });
  ok('Schnittmenge ohne Überlappung: bricht ab, Teile bleiben stehen', r.anzahl === 2, r.anzahl);
}
{
  const r = await pg.evaluate(async () => {
    _newCreate(false);   // Szene leeren ohne Nachfrage-Dialog
    // Drei Körper: Schnittmenge muss über ALLE gehen (nicht nur die ersten zwei)
    for (let i=0;i<3;i++) addShape('box');
    [0, 0.5, 1.0].forEach((x,i)=>{ objects[i].position.set(x,1,0); objects[i].updateMatrixWorld(true); });
    selectObjs(objects.slice());
    await intersectSelected();
    const res = objects[objects.length-1];
    return { anzahl: objects.length, bbox: _lyT.bbox(res.geometry), dicht: _lyT.topo(res.geometry).dicht };
  });
  // Überlappung dreier 20-mm-Würfel bei x=0/5/10 mm → 10 mm breit
  ok('Schnittmenge über 3 Körper', r.anzahl === 1 && Math.abs(r.bbox.x-10) < 0.2 && r.dicht, r.bbox);
  // (x=0/5/10 → gemeinsamer Bereich ist der Schnitt von [−10,10], [−5,15], [0,20])
}

// ───────────────────── 2. Senkkopfschraube DIN 7991 ────────────────────────
{
  const r = await pg.evaluate(() => {
    const out = {};
    for (const sz of ['M3','M6','M12']) {
      const s = SCREW_SPECS[sz];
      const g = _buildScrewGeometry({ type:'senk', size:sz, length:30, clearance:0.4, outer:0, threadLen:0, headH:0, leftHand:false });
      out[sz] = { topo:_lyT.topo(g), bbox:_lyT.bbox(g),
                  kopfR:_lyT.rAt(g, 0, 0.05), sollKopfR:s.cskD/2,
                  kopfH:s.cskH, winkel: Math.atan2((s.cskD-s.d)/2, s.cskH)*180/Math.PI };
    }
    return out;
  });
  for (const sz of ['M3','M6','M12']) {
    const v = r[sz];
    ok(`Senkkopf ${sz}: Kopf-Ø nach Norm`, Math.abs(v.kopfR - v.sollKopfR) < 0.05, [v.kopfR, v.sollKopfR]);
    ok(`Senkkopf ${sz}: 90°-Kegel (45° Flanke)`, Math.abs(v.winkel - 45) < 1.5, v.winkel);
    // 0,7 mm Toleranz: Kopf und Schaft überlappen bewusst, damit das Netz dicht
    // bleibt — bei Außen-/Innen-/Torx-Schrauben ist es genauso.
    ok(`Senkkopf ${sz}: Länge über alles = 30 mm`, Math.abs(v.bbox.y - 30) < 1.0, v.bbox.y);
    ok(`Senkkopf ${sz}: Kopf liegt auf der Platte (y=0)`, Math.abs(v.bbox.minY) < 0.01, v.bbox.minY);
  }
}

// ─────────────────────── 3. Schraubenloch ──────────────────────────────────
{
  const r = await pg.evaluate(() => {
    const out = {};
    for (const kind of ['durchgang','kern','gewinde']) {
      for (const head of (kind==='gewinde' ? ['keine'] : ['keine','senk','zyl'])) {
        const g = _buildScrewGeometry({ type:'loch', size:'M6', clearance:0.4, length:20,
                                        holeKind:kind, holeHead:head, holeDepth:12, leftHand:false });
        out[kind+'/'+head] = { topo:_lyT.topo(g), bbox:_lyT.bbox(g), rSchaft:_lyT.rAt(g, 0, 0.05) };
      }
    }
    out.specs = { thruD: SCREW_SPECS.M6.thruD, minor: SCREW_SPECS.M6.minor,
                  cskD: SCREW_SPECS.M6.cskD, sockD: SCREW_SPECS.M6.sockD, sockH: SCREW_SPECS.M6.sockH };
    return out;
  });
  const sp = r.specs;
  ok('Loch M6 Durchgang: wasserdicht', r['durchgang/keine'].topo.dicht, r['durchgang/keine'].topo);
  ok('Loch M6 Durchgang: Ø 6,6 mm (Reihe mittel)', Math.abs(r['durchgang/keine'].rSchaft - sp.thruD/2) < 0.05, r['durchgang/keine'].rSchaft);
  ok('Loch M6 Kernloch: Ø 5,0 mm', Math.abs(r['kern/keine'].rSchaft - sp.minor/2) < 0.05, r['kern/keine'].rSchaft);
  ok('Loch M6 Kernloch: wasserdicht', r['kern/keine'].topo.dicht, r['kern/keine'].topo);
  ok('Loch M6 Gewinde: wasserdicht', r['gewinde/keine'].topo.dicht, r['gewinde/keine'].topo);
  ok('Loch M6 Gewinde: Tiefe 12 mm', Math.abs(r['gewinde/keine'].bbox.y - 12) < 0.4, r['gewinde/keine'].bbox.y);
  ok('Loch M6 + Senkung: wasserdicht', r['durchgang/senk'].topo.dicht, r['durchgang/senk'].topo);
  ok('Loch M6 + Senkung: Senk-Ø ≥ Kopf-Ø', r['durchgang/senk'].bbox.x >= sp.cskD - 0.05, [r['durchgang/senk'].bbox.x, sp.cskD]);
  ok('Loch M6 + Zylinder: wasserdicht', r['durchgang/zyl'].topo.dicht, r['durchgang/zyl'].topo);
  ok('Loch M6 + Zylinder: Ø ≥ Kopf-Ø, Höhe = Tiefe + Senkung',
     r['durchgang/zyl'].bbox.x >= sp.sockD - 0.05 && Math.abs(r['durchgang/zyl'].bbox.y - (12 + sp.sockH + 0.4)) < 0.2,
     r['durchgang/zyl'].bbox);
}
// Loch stanzt wirklich — über den echten Abzieh-Weg
{
  const r = await pg.evaluate(async () => {
    _newCreate(false);   // Szene leeren ohne Nachfrage-Dialog
    addShape('box'); const plate = objects[objects.length-1];
    plate.scale.set(4, 0.8, 4); plate.position.set(0, 0.8, 0);   // 80×16×80 mm Platte
    plate.updateMatrixWorld(true);
    const wg = plate.geometry.clone(); wg.applyMatrix4(plate.matrixWorld);
    const volVor = _lyT.vol(wg);
    _screwP = Object.assign({}, _screwP, { type:'loch', size:'M6', holeKind:'durchgang', holeHead:'keine', holeDepth:20, clearance:0.4 });
    _createScrew();
    const loch = objects[objects.length-1];
    const istBohrung = !!loch.userData.isHole;
    loch.position.set(0, 0, 0); loch.updateMatrixWorld(true);   // Loch ragt unten raus → geht durch
    selectObjs([plate, loch]);
    // subtractHoles() startet die Rechnung nur (fire-and-forget) → auf das
    // Ergebnis warten, statt sofort weiterzumessen.
    subtractHoles();
    for (let i=0; i<300 && objects.length!==1; i++) await new Promise(r=>setTimeout(r,100));
    const res = objects[objects.length-1];
    return { istBohrung, anzahl: objects.length, volVor,
             volNach: _lyT.vol(res.geometry), dicht: _lyT.topo(res.geometry).dicht };
  });
  ok('Schraubenloch wird als Bohrung angelegt', r.istBohrung);
  // Standard-Box = 20 mm → Platte 80×16×80 mm; Ø 6,6 durch 16 mm ≈ 547 mm³
  const weg = r.volVor - r.volNach;
  ok('Schraubenloch stanzt ein echtes Loch (~547 mm³)', Math.abs(weg - 547) < 40, Math.round(weg));
  ok('Platte danach wasserdicht', r.dicht);
}

// ───────────────────────── 4. M12 in allen Typen ───────────────────────────
{
  const r = await pg.evaluate(() => {
    const out = {};
    for (const t of SCREW_TYPES) {
      try {
        const g = _buildScrewGeometry({ type:t, size:'M12', length:30, clearance:0.4, outer:0, threadLen:0, headH:0,
                                        leftHand:false, holeKind:'durchgang', holeHead:'keine', holeDepth:12 });
        out[t] = { tris: _lyT.topo(g).tris, dicht: _lyT.topo(g).dicht };
      } catch (e) { out[t] = 'FEHLER: ' + e.message; }
    }
    return out;
  });
  for (const t of Object.keys(r)) ok(`M12 als „${t}" baubar`, typeof r[t] === 'object' && r[t].tris > 100, r[t]);
}

// ─────────── 5. Bedienoberfläche: Knopf-Reihenfolge stimmt ─────────────────
// Die Sync-Funktionen markieren den aktiven Knopf per nth-child gegen
// SCREW_TYPES/SCREW_SIZES — kommt ein Knopf an der falschen Stelle ins HTML,
// leuchtet stumm der falsche auf.
{
  const r = await pg.evaluate(() => {
    const txt = sel => [...document.querySelectorAll(sel)].map(e => e.textContent.trim());
    const out = { typen: txt('#sbg-type .vtb'), groessen: txt('#sbg-size .vtb'),
                  eTypen: txt('#esbg-type .vtb'), eGroessen: txt('#esbg-size .vtb'), aktiv: {} };
    _openScrewModal();
    for (const t of SCREW_TYPES) {
      _screwSetType(t);
      const on = [...document.querySelectorAll('#sbg-type .vtb')].findIndex(e => e.classList.contains('on'));
      out.aktiv[t] = { erwartet: SCREW_TYPES.indexOf(t), markiert: on, param: _screwP.type };
    }
    _screwSetSize('M12');
    out.groesseAktiv = [...document.querySelectorAll('#sbg-size .vtb')].findIndex(e => e.classList.contains('on'));
    // Loch-Zeilen ein-/ausblenden
    _screwSetType('loch');
    const vis = id => document.getElementById(id)?.style.display !== 'none';
    out.lochZeilen = { art: vis('screw-holekind-row'), kopf: vis('screw-holehead-row'),
                       tiefe: vis('screw-holedepth-row'), laenge: vis('screw-len-row') };
    _screwSetHole('holeKind','gewinde');
    out.gewindeVerstecktKopf = !vis('screw-holehead-row');
    _closeScrewModal();
    return out;
  });
  ok('Typ-Knöpfe im Generator = SCREW_TYPES',
     JSON.stringify(r.typen) === JSON.stringify(['Außen','Innen','Senk','Torx','Schloss','Mutter','Scheibe','Loch']), r.typen);
  ok('Größen-Knöpfe im Generator = SCREW_SIZES',
     JSON.stringify(r.groessen) === JSON.stringify(['M2','M3','M4','M5','M6','M8','M10','M12']), r.groessen);
  ok('Typ-Knöpfe im Seiten-Panel in gleicher Reihenfolge',
     JSON.stringify(r.eTypen) === JSON.stringify(['Außen','Innen','Senk','Torx','Schloss','Mutter','Scheibe','Loch']), r.eTypen);
  ok('Größen-Knöpfe im Seiten-Panel in gleicher Reihenfolge',
     JSON.stringify(r.eGroessen) === JSON.stringify(['M2','M3','M4','M5','M6','M8','M10','M12']), r.eGroessen);
  for (const t of Object.keys(r.aktiv))
    ok(`„${t}" markiert den richtigen Knopf`, r.aktiv[t].erwartet === r.aktiv[t].markiert && r.aktiv[t].param === t, r.aktiv[t]);
  ok('M12 markiert den 8. Größen-Knopf', r.groesseAktiv === 7, r.groesseAktiv);
  ok('Loch zeigt Art/Kopf/Tiefe und versteckt die Länge',
     r.lochZeilen.art && r.lochZeilen.kopf && r.lochZeilen.tiefe && !r.lochZeilen.laenge, r.lochZeilen);
  ok('Gedrucktes Gewinde blendet die Kopf-Senkung aus', r.gewindeVerstecktKopf);
}
// Schnittmengen-Knopf in der Werkzeugleiste
{
  const r = await pg.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /Schnittmenge/.test(b.textContent));
    return { da: !!btn, onclick: btn && btn.getAttribute('onclick'),
             imMenue: CMDK.some(i => i.t === "Schnittmenge") };
  });
  ok('Knopf „⋂ Schnittmenge" in der Leiste', r.da && r.onclick === 'intersectSelected()', r);
  ok('Schnittmenge in der Befehlssuche', r.imMenue);
}

await b.close();
console.log('\nSkriptfehler auf der Seite:', pageErrors.length);
for (const e of pageErrors) console.log('   •', e.slice(0, 200));
console.log(fails.length ? `\n${fails.length} FEHLER: ` + fails.join(' | ') : '\nAlles grün.');
process.exit(fails.length || pageErrors.length ? 1 : 0);
