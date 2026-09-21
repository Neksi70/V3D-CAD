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
  const P = { op:'aus', mas:'grbl', nMax:24000, oNr:1, tNr:1, hNr:1, g54:'G54', kuehl:'aus', mat:'sperrholz', lauf:'gleich', d:3, z:2, dicke:10, tiefe:3,
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
// n = vc·1000/(π·D) = 330000/(π·3) = 35014 → auf 24000 (GRBL) gedeckelt.
// fz = 0,07 × (3/6) = 0,035. Vorschub = 24000 × 2 × 0,035 = 1680 mm/min.
ok('Drehzahl aus Schnittgeschwindigkeit, an der Spindel gedeckelt',
   aus.w.rpm===24000 && aus.w.gedeckelt===true && aus.w.nRoh===35014, aus.w);
ok('Vorschub folgt Span je Zahn inkl. Durchmesser-Skalierung',
   aus.w.fz===0.035 && aus.w.vorschub===1680, aus.w);
ok('Zustellung bleibt unter dem Fräserdurchmesser (Vollnutschnitt!)',
   aus.w.ap < 3 && aus.w.ap > 1, aus.w.ap);

// ── Tasche: Ringe von innen nach außen, Wandabstand = r ──────────────────
const tasche = await pg.evaluate(async () => {
  const P = { op:'tasche', mas:'grbl', nMax:24000, oNr:1, tNr:1, hNr:1, g54:'G54', kuehl:'aus', mat:'mdf', lauf:'gleich', d:3, z:2, dicke:10, tiefe:4,
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
  const P = { op:'grav', mas:'grbl', nMax:24000, oNr:1, tNr:1, hNr:1, g54:'G54', kuehl:'aus', mat:'hartholz', lauf:'gleich', d:3, z:2, dicke:10, tiefe:1,
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
  const P = { op:'bohr', mas:'grbl', nMax:24000, oNr:1, tNr:1, hNr:1, g54:'G54', kuehl:'aus', mat:'sperrholz', lauf:'gleich', d:3, z:2, dicke:10, tiefe:3,
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
ok('Entspanen: zwischen den Abstichen wird ausgefahren', bohr.hoch >= bohr.abstiche-1 && bohr.abstiche>=2, {abstiche:bohr.abstiche, hoch:bohr.hoch});

// ── Vorschau räumt sich auf ──────────────────────────────────────────────
const prev = await pg.evaluate(async () => {
  const erg = await _cncBuild({ op:'aus', mas:'grbl', nMax:24000, oNr:1, tNr:1, hNr:1, g54:'G54', kuehl:'aus', mat:'sperrholz', lauf:'gleich', d:3, z:2, dicke:10,
    tiefe:3, zugabe:0.3, zSafe:5, rampe:15, stege:4, stegB:6, stegH:1.2 });
  _cncPrevZeichnen(erg);
  const nachher = !!scene.getObjectByName('_cncPrev');
  exitSketchMode();
  return { nachher, weg: !scene.getObjectByName('_cncPrev') };
});
ok('Vorschau erscheint in der Szene', prev.nachher);
ok('Vorschau verschwindet mit dem Skizzen-Modus', prev.weg);

// ════ FANUC / ROBODRILL ══════════════════════════════════════════════════
// Der teuerste Unterschied zu GRBL: Fanuc liest eine Zahl OHNE Dezimalpunkt
// in kleinsten Eingabeschritten. „Z5" ist dort 0,005 mm, nicht 5 mm. Der
// GRBL-Schreiber kürzt „5.000" genau zu „Z5" — auf der Robodrill wäre das
// eine Kollision. Darum ist das hier die wichtigste Prüfung im ganzen Test.
const fa = await pg.evaluate(async () => {
  enterSketchMode();
  const R = [{u:0,v:0},{u:6,v:0},{u:6,v:4},{u:0,v:4},{u:0,v:0}];
  _sk.ents = [ { type:'poly', pts:R, closed:true },
               { type:'circle', c:{u:2,v:2}, r:0.5 },
               { type:'circle', c:{u:4,v:2}, r:0.15 } ];
  const P = { op:'aus', mas:'fanuc', mat:'alu', lauf:'gleich', nMax:10000, oNr:42, tNr:3, hNr:3,
              g54:'G55', kuehl:'m8', d:6, z:2, dicke:10, tiefe:3, zugabe:0.3, zSafe:50,
              rampe:15, stege:4, stegB:6, stegH:1.2 };
  const erg = await _cncBuild(P);
  const Pb = Object.assign({}, P, { op:'bohr' });
  const ergB = await _cncBuild(Pb);
  return { g:_cncGcodeFanuc(erg, P), w:erg.w, gb:_cncGcodeFanuc(ergB, Pb) };
});

const zeilen = fa.g.split('\n');
const saetze = zeilen.filter(l => l && l !== '%' && !l.startsWith('(') && !l.startsWith('O'));
// Jedes Wort mit Zahlwert, das eine Länge oder einen Vorschub trägt, braucht den Punkt.
const ohnePunkt = [];
for(const l of saetze) for(const t of l.split(' ')){
  if(/^[XYZRQIJKF]-?[0-9]/.test(t) && !t.includes('.')) ohnePunkt.push(l);
}
ok('FANUC: jede Koordinate trägt einen Dezimalpunkt', ohnePunkt.length===0, ohnePunkt.slice(0,4));
ok('FANUC: auch runde Werte („Z50.")', /Z50\.(\s|$)/m.test(fa.g), zeilen.find(l=>/Z50\./.test(l)));

ok('FANUC: Programm steht zwischen %-Zeilen', zeilen[0]==='%' && fa.g.trim().endsWith('%'));
ok('FANUC: O-Nummer vierstellig aus dem Feld', /^O0042 /.test(zeilen[1]), zeilen[1]);
ok('FANUC: sicherer Startsatz löscht Korrekturen und Zyklen', fa.g.includes('G0 G17 G40 G49 G80 G90'));
ok('FANUC: Werkzeugwechsel und Längenkorrektur', fa.g.includes('T3 M6') && /G43 H3 Z50\./.test(fa.g));
ok('FANUC: Nullpunkt aus dem Feld übernommen', /\nG55\n/.test(fa.g));
ok('FANUC: Kühlmittel an und wieder aus', /\nM8\n/.test(fa.g) && /\nM9\n/.test(fa.g));
ok('FANUC: Z zuerst auf Referenz, dann X/Y', fa.g.indexOf('G91 G28 Z0.') < fa.g.indexOf('G28 X0. Y0.') &&
   fa.g.includes('G91 G28 Z0.') && fa.g.trim().endsWith('%') && fa.g.includes('M30'));

// Kommentare: Klammern ausgeglichen, reines ASCII in Großbuchstaben
const koms = zeilen.filter(l => l.includes('('));
ok('FANUC: Kommentare sind ASCII-Großbuchstaben ohne Umlaute',
   koms.every(l => !/[a-zäöüßÄÖÜ]/.test(l.slice(l.indexOf('(')))), koms.filter(l=>/[a-zäöüß]/.test(l)).slice(0,2));
ok('FANUC: keine verschachtelten Klammern',
   koms.every(l => { const t=l.slice(l.indexOf('(')); return (t.match(/\(/g)||[]).length===1 && (t.match(/\)/g)||[]).length===1; }));

// Bohren läuft über den Zyklus, nicht über ausgeschriebene Abstiche
ok('FANUC: Bohren als Zyklus G83 mit Rückzugsebene und Entspanen',
   /G98 G83 X[-0-9.]+ Y[-0-9.]+ Z-10\.3 R1\. Q[0-9.]+ F[0-9.]+/.test(fa.gb),
   fa.gb.split('\n').find(l=>l.includes('G83')));
ok('FANUC: Zyklus wird mit G80 abgewählt', fa.gb.includes('\nG80\n'));

// Drehzahl: n = vc·1000/(π·D) = 300000/(π·6) = 15915 → auf 10000 gedeckelt
ok('FANUC: Drehzahl an der Spindel gedeckelt (15915 ideal → 10000)',
   fa.w.rpm===10000 && fa.w.nRoh===15915 && fa.w.gedeckelt===true, fa.w);
ok('FANUC: Alu darf auf der steifen Maschine 0,4×D zustellen', Math.abs(fa.w.ap-2.4)<1e-9, fa.w.ap);
ok('FANUC: Kühlmittel wird für Metall verlangt', fa.w.kuehl===1);

// Was auf einem Hobbyportal nicht geht, wird abgelehnt statt still gerechnet
const stahlGrbl = await pg.evaluate(async () => {
  try { await _cncBuild({ op:'aus', mas:'grbl', mat:'stahl', lauf:'gleich', nMax:24000, oNr:1, tNr:1,
        hNr:1, g54:'G54', kuehl:'aus', d:6, z:2, dicke:5, tiefe:3, zugabe:0.3, zSafe:5,
        rampe:15, stege:4, stegB:6, stegH:1.2 }); return 'kein Fehler'; }
  catch(e){ return e.message; }
});
ok('Stahl auf dem Hobbyportal wird abgelehnt', /steife Maschine/.test(stahlGrbl), stahlGrbl);

// GRBL bleibt, wie es war — dort ist „Z5" richtig und kürzer
const gr = await pg.evaluate(async () => {
  const P = { op:'aus', mas:'grbl', mat:'sperrholz', lauf:'gleich', nMax:24000, oNr:1, tNr:1, hNr:1,
              g54:'G54', kuehl:'aus', d:3, z:2, dicke:6, tiefe:3, zugabe:0.3, zSafe:5,
              rampe:15, stege:4, stegB:6, stegH:1.2 };
  return _cncGcode(await _cncBuild(P), P);
});
ok('GRBL: unverändert ohne %, ohne O-Nummer, mit kurzem Z5',
   !gr.includes('%') && !/^O/m.test(gr) && /\nG0 Z5\n/.test(gr) && gr.trim().endsWith('M30'));

// ── Bohren rechnet mit BOHRER-Werten, nicht mit Fräs-Werten ──────────────
// Ein Bohrer schneidet in der Mitte mit vc≈0 und räumt schlecht aus. Mit den
// Fräswerten (S10000 für Ø5 in Alu) wäre er nach zwei Löchern hin.
const bw = await pg.evaluate(async () => {
  const B = { mas:'fanuc', lauf:'gleich', nMax:10000, oNr:1, tNr:1, hNr:1, g54:'G54', kuehl:'m8',
              d:5, z:2, dicke:8, tiefe:3, zugabe:0.3, zSafe:50, rampe:15, stege:0, stegB:0, stegH:0 };
  const f = (await _cncBuild({...B, op:'aus', mat:'alu'})).w;
  const b = (await _cncBuild({...B, op:'bohr', mat:'alu'})).w;
  const st = (await _cncBuild({...B, op:'bohr', mat:'stahl'})).w;
  let grblStahl; try { await _cncBuild({...B, mas:'grbl', op:'bohr', mat:'stahl'}); grblStahl='kein Fehler'; }
  catch(e){ grblStahl = e.message; }
  return { f, b, st, grblStahl };
});
// Ø5 Alu: n = 70000/(π·5) = 4456 → 4460. Vorschub = 4460 × (0,12 × 5/6) = 446
ok('Bohren: eigene Schnittgeschwindigkeit statt Fräsdrehzahl',
   bw.b.rpm===4460 && bw.f.rpm===10000, {bohren:bw.b.rpm, fraesen:bw.f.rpm});
ok('Bohren: Vorschub je Umdrehung statt je Zahn', bw.b.fU===0.1 && bw.b.vorschub===446, bw.b);
ok('Bohren: Abstichtiefe als Vielfaches des Durchmessers (2×5)', bw.b.ap===10, bw.b.ap);
// Ø5 Stahl: n = 25000/(π·5) = 1592 — die Robodrill geht bis 100 hinunter
ok('Bohren in Stahl läuft deutlich langsamer', bw.st.rpm===1590, bw.st.rpm);
ok('Bohren in Stahl auf dem Hobbyportal wird abgelehnt (Spindel zu schnell)',
   /nicht langsam genug/.test(bw.grblStahl), bw.grblStahl);

ok('Keine Seitenfehler', errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
