// Test: CNC-Fräsen (_cnc*) — 2,5D-CAM von der Skizze bis zum GRBL-G-Code.
// Geprüft wird das, woran so ein CAM scheitert und wo es teuer wird:
//   (1) Werkzeugradiuskorrektur in die RICHTIGE Richtung — außen weiter,
//       Löcher enger, beides um genau den halben Fräserdurchmesser,
//   (2) Umlaufsinn: Gleichlauf heißt außen im Uhrzeigersinn, innen dagegen.
//       Verkehrt herum rupft der Fräser und zieht sich ins Material,
//   (3) Haltestege stehen wirklich (sonst fliegt das Teil weg) und die
//       Endtiefe wird nirgends überschritten,
//   (4) KEIN Eilgang quer durchs Material: jede G0-Fahrt in XY muss über
//       dem Werkstück liegen. Das ist der Fehler, der Fräser abreißt,
//   (5) kein senkrechtes Stechen, wo eine Rampe eingestellt ist,
//   (6) der G-Code ist gültiges GRBL — nur bekannte Wörter, keine NaN.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('cnc-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show');
                          document.getElementById('auth-overlay')?.classList.add('hidden'); });

// Prüfskizze: Rechteck 60 × 40 mm, darin ein Ø10-Loch und ein Ø3-Loch.
// 1 Skizzen-Unit = 10 mm, darum 6 × 4 Units.
await pg.evaluate(() => {
  enterSketchMode();
  const R = [{u:0,v:0},{u:6,v:0},{u:6,v:4},{u:0,v:4},{u:0,v:0}];
  _sk.ents = [
    { type:'poly', pts:R, closed:true },
    { type:'circle', c:{u:2,v:2}, r:0.5 },    // Ø10 mm
    { type:'circle', c:{u:4,v:2}, r:0.15 },   // Ø3 mm — genau Fräsergröße
  ];
});

const bbox = pts => pts.reduce((a,p)=>({x0:Math.min(a.x0,p[0]),x1:Math.max(a.x1,p[0]),
  y0:Math.min(a.y0,p[1]),y1:Math.max(a.y1,p[1])}), {x0:1e9,x1:-1e9,y0:1e9,y1:-1e9});

// ── (1)+(2) Ausschneiden: Versatz und Umlaufsinn ─────────────────────────
const aus = await pg.evaluate(async () => {
  const P = { op:'aus', mat:'sperrholz', lauf:'gleich', d:3, z:2, dicke:10, tiefe:3,
              zugabe:0.3, zSafe:5, rampe:15, stege:4, stegB:6, stegH:1.2 };
  const W = await _mfInit(); const tmp=[]; const keep=x=>{tmp.push(x);return x;};
  const f = _cncFormen()[0];
  const cs = keep(_cncCS(W, f));
  const ringe = _cncRinge(keep(cs.offset(1.5,'Round',2,24)));
  const raw = ringe.map(r => ({ loch:r.loch, flaeche:_cncArea(r.lp), pts:r.lp }));
  const gew = ringe.map(r => ({ loch:r.loch, flaeche:_cncArea(_cncWicklung(r.lp, true, r.loch)),
                                gegen:_cncArea(_cncWicklung(r.lp, false, r.loch)) }));
  for(const t of tmp){ try{t.delete();}catch(_){} }
  const erg = await _cncBuild(P);
  return { raw, gew, moves: erg.moves, warn: erg.warn, w: erg.w, stats: erg.stats,
           gcode: _cncGcode(erg, P) };
});

const aussen = aus.raw.find(r => !r.loch);
const bbA = bbox(aussen.pts);
// Skizze: X 0…60, Y −40…0. Mit Ø3-Fräser muss die Mitte 1,5 mm weiter außen laufen.
ok('Außenkontur um +r versetzt (1,5 mm)',
   Math.abs(bbA.x0+1.5)<0.05 && Math.abs(bbA.x1-61.5)<0.05 && Math.abs(bbA.y0+41.5)<0.05 && Math.abs(bbA.y1-1.5)<0.05,
   {x0:+bbA.x0.toFixed(2), x1:+bbA.x1.toFixed(2), y0:+bbA.y0.toFixed(2), y1:+bbA.y1.toFixed(2)});

const loecher = aus.raw.filter(r => r.loch);
const gross = loecher.map(r => { const b=bbox(r.pts); return (b.x1-b.x0+b.y1-b.y0)/4; }).sort((a,b)=>b-a);
ok('Ø10-Loch auf Bahnradius 3,5 mm geschrumpft', gross.length && Math.abs(gross[0]-3.5)<0.08, +gross[0]?.toFixed(3));
ok('Ø3-Loch fällt weg (nicht fräsbar) und wird gemeldet',
   loecher.length===1 && aus.warn.some(w=>/schmaler als der Fräser/.test(w)), {loecher:loecher.length, warn:aus.warn});

const gA = aus.gew.find(r=>!r.loch), gL = aus.gew.find(r=>r.loch);
ok('Gleichlauf: Außenkontur im Uhrzeigersinn', gA.flaeche < 0, +gA.flaeche.toFixed(1));
ok('Gleichlauf: Loch gegen den Uhrzeigersinn', gL.flaeche > 0, +gL.flaeche.toFixed(1));
ok('Gegenlauf dreht beide um', gA.gegen > 0 && gL.gegen < 0, {aussen:+gA.gegen.toFixed(1), loch:+gL.gegen.toFixed(1)});

// ── (3) Tiefen und Haltestege ────────────────────────────────────────────
const zs = aus.moves.filter(m=>m.g===1 && m.z!==undefined).map(m=>m.z);
const zEnd = -10.3;
ok('Endtiefe wird nirgends überschritten', Math.min(...zs) >= zEnd-1e-6, +Math.min(...zs).toFixed(3));
ok('Endtiefe wird erreicht', Math.abs(Math.min(...zs)-zEnd)<1e-6, +Math.min(...zs).toFixed(3));
// Stege: Material 10 mm, Steghöhe 1,2 → Steg-Z = −8,8. Auf der letzten Lage
// muss es Punkte auf genau dieser Höhe geben.
const stegZ = -8.8;
ok('Haltestege stehen (Punkte auf Steghöhe)', zs.some(z=>Math.abs(z-stegZ)<1e-6), zs.filter(z=>Math.abs(z-stegZ)<1e-6).length);

// ── (4) Kein Eilgang durchs Material ─────────────────────────────────────
let x=0,y=0,z=5, quer=0, tiefsterEilXY=99;
for(const m of aus.moves){
  const nx=m.x===undefined?x:m.x, ny=m.y===undefined?y:m.y, nz=m.z===undefined?z:m.z;
  if(m.g===0 && (Math.abs(nx-x)>1e-9 || Math.abs(ny-y)>1e-9)){
    tiefsterEilXY = Math.min(tiefsterEilXY, Math.min(z,nz));
    if(Math.min(z,nz) < 0) quer++;
  }
  x=nx;y=ny;z=nz;
}
ok('Kein Eilgang in XY unterhalb der Werkstückoberkante', quer===0, {verstoesse:quer, tiefster:+tiefsterEilXY.toFixed(2)});

// ── (5) Kein senkrechtes Stechen bei eingestellter Rampe ─────────────────
x=0;y=0;z=5; let stechen=0;
for(const m of aus.moves){
  const nx=m.x===undefined?x:m.x, ny=m.y===undefined?y:m.y, nz=m.z===undefined?z:m.z;
  // Senkrecht abwärts im Vorschub, aber nur wenn dabei ins Volle gefahren wird
  if(m.g===1 && nz < z-0.01 && Math.hypot(nx-x,ny-y) < 1e-6 && z < 0) stechen++;
  x=nx;y=ny;z=nz;
}
ok('Kein senkrechtes Stechen unterhalb der Oberkante', stechen===0, stechen);

// ── (6) G-Code ist gültiges GRBL ─────────────────────────────────────────
const g = aus.gcode.split('\n').filter(l=>l && !l.startsWith('('));
const erlaubt = /^(G0|G1|G4|G17|G21|G90|G94|M3|M5|M30|X|Y|Z|F|S|P)/;
const schlecht = g.filter(l => l.split(' ').some(t => !erlaubt.test(t) || /NaN|undefined|Infinity/.test(t)));
ok('Nur bekannte GRBL-Wörter, keine NaN', schlecht.length===0, schlecht.slice(0,3));
ok('Kopf und Fuß vollständig',
   aus.gcode.includes('G21 G90 G17 G94') && aus.gcode.includes('M3 S') && /M5\n/.test(aus.gcode) && aus.gcode.trim().endsWith('M30'));
// fz skaliert mit dem Durchmesser: 0,07 × (3/6) = 0,035 mm je Zahn.
// Vorschub = 18000 × 2 × 0,035 = 1260 mm/min. Zustellung 0,7 × 3 = 2,1 mm.
ok('Vorschub folgt Span je Zahn inkl. Durchmesser-Skalierung',
   aus.w.fz===0.035 && aus.w.vorschub===1260, aus.w);
ok('Zustellung bleibt unter dem Fräserdurchmesser (Vollnutschnitt!)',
   aus.w.ap < 3 && aus.w.ap > 1, aus.w.ap);

// ── Tasche: Ringe von innen nach außen, Wandabstand = r ──────────────────
const tasche = await pg.evaluate(async () => {
  const P = { op:'tasche', mat:'mdf', lauf:'gleich', d:3, z:2, dicke:10, tiefe:4,
              zugabe:0.3, zSafe:5, rampe:15, stege:0, stegB:0, stegH:0 };
  const erg = await _cncBuild(P);
  const zs = erg.moves.filter(m=>m.g===1&&m.z!==undefined).map(m=>m.z);
  // Reihenfolge der Bahn-Anfänge: erster G0-XY je Bahn
  const starts = []; let vor = null;
  for(const m of erg.moves){ if(m.g===0 && m.x!==undefined){ starts.push([m.x,m.y]); } }
  return { min:Math.min(...zs), starts, warn:erg.warn };
});
ok('Tasche erreicht genau die Solltiefe', Math.abs(tasche.min+4)<1e-6, +tasche.min.toFixed(3));

// ── Gravieren: exakt auf der Linie, kein Versatz ─────────────────────────
const grav = await pg.evaluate(async () => {
  const P = { op:'grav', mat:'hartholz', lauf:'gleich', d:3, z:2, dicke:10, tiefe:1,
              zugabe:0, zSafe:5, rampe:15, stege:0, stegB:0, stegH:0 };
  const erg = await _cncBuild(P);
  const pts = erg.moves.filter(m=>m.x!==undefined&&m.y!==undefined).map(m=>[m.x,m.y]);
  const zs = erg.moves.filter(m=>m.g===1&&m.z!==undefined).map(m=>m.z);
  return { pts, min:Math.min(...zs) };
});
const bbG = bbox(grav.pts);
ok('Gravur läuft auf der Linie (kein Versatz)',
   Math.abs(bbG.x0)<0.05 && Math.abs(bbG.x1-60)<0.05 && Math.abs(bbG.y0+40)<0.05 && Math.abs(bbG.y1)<0.05,
   {x0:+bbG.x0.toFixed(2), x1:+bbG.x1.toFixed(2), y0:+bbG.y0.toFixed(2), y1:+bbG.y1.toFixed(2)});
ok('Gravurtiefe stimmt', Math.abs(grav.min+1)<1e-6, +grav.min.toFixed(3));

// ── Bohren: nur der kleine Kreis, mit Entspanen ──────────────────────────
const bohr = await pg.evaluate(async () => {
  const P = { op:'bohr', mat:'sperrholz', lauf:'gleich', d:3, z:2, dicke:10, tiefe:3,
              zugabe:0.3, zSafe:5, rampe:15, stege:0, stegB:0, stegH:0 };
  const erg = await _cncBuild(P);
  const xy = erg.moves.filter(m=>m.g===0&&m.x!==undefined).map(m=>[m.x,m.y]);
  const zs = erg.moves.filter(m=>m.g===1&&m.z!==undefined).map(m=>m.z);
  // Entspanen: nach jedem Abstich muss es wieder hoch gehen
  let hoch = 0, prev = null;
  for(const m of erg.moves){ if(m.z!==undefined){ if(prev!==null && m.z>prev+0.5 && m.g===0) hoch++; prev=m.z; } }
  return { xy, min:Math.min(...zs), abstiche:zs.length, hoch, warn:erg.warn };
});
ok('Bohrt nur den Ø3-Kreis (Ø10 wird gemeldet)',
   bohr.xy.length===1 && Math.abs(bohr.xy[0][0]-40)<0.01 && Math.abs(bohr.xy[0][1]+20)<0.01 &&
   bohr.warn.some(w=>/größer als der Fräser/.test(w)), {xy:bohr.xy, warn:bohr.warn});
ok('Bohrung geht bis Dicke + Durchbruch', Math.abs(bohr.min+10.3)<1e-6, +bohr.min.toFixed(3));
ok('Entspanen: zwischen den Abstichen wird ausgefahren', bohr.hoch >= bohr.abstiche-1, {abstiche:bohr.abstiche, hoch:bohr.hoch});

// ── Vorschau räumt sich auf ──────────────────────────────────────────────
const prev = await pg.evaluate(async () => {
  const erg = await _cncBuild({ op:'aus', mat:'sperrholz', lauf:'gleich', d:3, z:2, dicke:10,
    tiefe:3, zugabe:0.3, zSafe:5, rampe:15, stege:4, stegB:6, stegH:1.2 });
  _cncPrevZeichnen(erg);
  const nachher = !!scene.getObjectByName('_cncPrev');
  exitSketchMode();
  return { nachher, weg: !scene.getObjectByName('_cncPrev') };
});
ok('Vorschau erscheint in der Szene', prev.nachher);
ok('Vorschau verschwindet mit dem Skizzen-Modus', prev.weg);

ok('Keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
