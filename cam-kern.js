// ═══ cam-kern.js — gemeinsamer Rechenkern fuer CNC ═══════════════════════
//
// EINE QUELLE FUER ZWEI PROGRAMME:
//   - V3D CAD (volme3d.html)  — 2,5D aus der Skizze; build.js bettet diese
//                               Datei beim Bauen ein, dist bleibt eine Datei.
//   - V3D CAM (~/v3dcam)      — Rohteil und Schruppen aus STEP/STL.
//
// Hier steht nur, was BEIDE brauchen: Maschinen- und Materialtabellen, die
// Schnittwerte-Rechnung, die Bahn-Mathematik und die beiden Postprozessoren.
// Nichts hier kennt das DOM, Three.js oder den Skizzen-Editor. Alles rechnet
// in Maschinen-Millimetern; wie die Kontur dahin kommt, ist Sache der App.
//
// Warum getrennt: Laege der Fanuc-Dezimalpunkt in zwei Kopien, waere er in
// einem halben Jahr in der einen korrigiert und in der anderen nicht — und
// genau das ist der Fehler, der eine Maschine zerlegt.
//
// Vorbild: v3dschichten/bauen.py zieht seinen Rechenkern aus dem V3D Slicer.

// Maschinen. Was sich unterscheidet, ist nicht nur der Dialekt: eine
// Robodrill steht auf Guss, hat Kühlmittel und Werkzeugwechsler, ein
// Hobbyportal hat nichts davon. Darum entscheidet die Maschine auch, wie
// tief in Metall zugestellt werden darf.
//   nMin/nMax – Drehzahlbereich der Spindel (nMax ist im Fenster änderbar)
//   eil       – Eilganggeschwindigkeit, nur für die Zeitschätzung
//   vfMax     – Deckel für den Bahnvorschub
const _CNC_MASCHINE = {
  grbl:  { n:'GRBL-Portal',      post:'grbl',  nMin:5000, nMax:24000, eil:3000,  vfMax:3000,  kuehl:false },
  fanuc: { n:'Fanuc / Robodrill',post:'fanuc', nMin:100,  nMax:10000, eil:48000, vfMax:10000, kuehl:true  },
};

// Materialien. Statt einer festen Drehzahl steht hier die
// SCHNITTGESCHWINDIGKEIT vc in m/min — daraus wird n = vc·1000/(π·D).
// Eine feste Drehzahl gilt immer nur für einen Durchmesser; vc gilt für
// alle. Genauso ist fz (Span je Zahn) auf Ø6 bezogen und wird skaliert.
//   apF   – Zustellung je Durchgang × Durchmesser auf einer STEIFEN Maschine
//   apHob – dasselbe auf einem Hobbyportal; 0 heißt „geht dort nicht"
//   aeF   – Bahnabstand beim Taschen-Ausräumen × Durchmesser
//   kuehl – 1 = will Kühlmittel, wenn die Maschine welches hat
//   vcB   – Schnittgeschwindigkeit beim BOHREN. Ein Bohrer ist kein Fräser:
//           in der Mitte schneidet er mit vc≈0, räumt schlecht aus und läuft
//           darum viel langsamer. Ø5 in Alu will ~4500 min⁻¹, nicht 10.000.
//   fU    – Bohrvorschub je UMDREHUNG (nicht je Zahn), bezogen auf Ø6
//   peckF – Abstichtiefe × Durchmesser beim Entspanen
const _CNC_MAT = {
  sperrholz: { n:'Sperrholz',  vc:330, fz:0.070, apF:0.70, apHob:0.70, aeF:0.45, tauch:0.33, kuehl:0 , vcB:90, fU:0.2, peckF:3 },
  mdf:       { n:'MDF',        vc:330, fz:0.090, apF:0.60, apHob:0.60, aeF:0.45, tauch:0.33, kuehl:0 , vcB:90, fU:0.2, peckF:3 },
  hartholz:  { n:'Hartholz',   vc:300, fz:0.055, apF:0.40, apHob:0.40, aeF:0.40, tauch:0.30, kuehl:0 , vcB:70, fU:0.15, peckF:2.5 },
  acryl:     { n:'Acryl',      vc:250, fz:0.060, apF:0.35, apHob:0.35, aeF:0.40, tauch:0.30, kuehl:0 , vcB:60, fU:0.1, peckF:2 },
  kunst:     { n:'POM / PA',   vc:400, fz:0.080, apF:0.50, apHob:0.50, aeF:0.45, tauch:0.35, kuehl:0 , vcB:90, fU:0.18, peckF:3 },
  alu:       { n:'Aluminium',  vc:300, fz:0.055, apF:0.40, apHob:0.06, aeF:0.40, tauch:0.30, kuehl:1 , vcB:70, fU:0.12, peckF:2 },
  messing:   { n:'Messing',    vc:200, fz:0.050, apF:0.40, apHob:0.06, aeF:0.40, tauch:0.30, kuehl:1 , vcB:50, fU:0.12, peckF:2 },
  stahl:     { n:'Stahl',      vc:110, fz:0.040, apF:0.25, apHob:0,    aeF:0.30, tauch:0.25, kuehl:1 , vcB:25, fU:0.1, peckF:1.5 },
  edelstahl: { n:'Edelstahl',  vc:75,  fz:0.030, apF:0.20, apHob:0,    aeF:0.25, tauch:0.20, kuehl:1 , vcB:12, fU:0.06, peckF:1 },
};

// ── Kleinkram ────────────────────────────────────────────────────────────
function _cncDist(a, b){ return Math.hypot(b[0]-a[0], b[1]-a[1]); }

// Vorzeichenbehaftete Fläche (Gaußsche Trapezformel). > 0 = gegen den
// Uhrzeigersinn. Gilt im Maschinen-Frame, weil hier schon gespiegelt wurde.
function _cncArea(lp){
  let a = 0;
  for(let i=0;i<lp.length;i++){ const p=lp[i], q=lp[(i+1)%lp.length]; a += p[0]*q[1] - q[0]*p[1]; }
  return a/2;
}
function _cncLaenge(lp, closed){
  let L = 0;
  for(let i=1;i<lp.length;i++) L += _cncDist(lp[i-1], lp[i]);
  if(closed && lp.length>1) L += _cncDist(lp[lp.length-1], lp[0]);
  return L;
}

// Umlaufsinn für Gleich- oder Gegenlauf setzen.
//
// Gleichlauf heißt: das Material liegt RECHTS der Fahrtrichtung (die Schneide
// greift mit voller Spandicke an und läuft auf null aus — bessere Kante, aber
// die Maschine muss spielfrei sein). Daraus folgt:
//   Außenkontur → im Uhrzeigersinn (Fläche < 0)
//   Loch/Tasche → gegen den Uhrzeigersinn (Fläche > 0)
// Gegenlauf ist jeweils umgekehrt und verzeiht Spiel in den Spindeln — darum
// bei alten oder spielbehafteten Portalen die sicherere Wahl.
function _cncWicklung(lp, gleichlauf, istLoch){
  const willCW = gleichlauf ? !istLoch : istLoch;
  const istCW  = _cncArea(lp) < 0;
  return (willCW === istCW) ? lp.slice() : lp.slice().reverse();
}

// Punkt auf einem Polyzug bei Bogenlänge s (L = kumulierte Bogenlängen)
function _cncAuf(pfad, L, s){
  let i = 1;
  while(i < L.length-1 && L[i] < s) i++;
  const d = L[i] - L[i-1];
  const t = d > 1e-9 ? (s - L[i-1]) / d : 0;
  return [ pfad[i-1][0] + (pfad[i][0]-pfad[i-1][0])*t,
           pfad[i-1][1] + (pfad[i][1]-pfad[i-1][1])*t ];
}

// ── Tiefenstaffel ────────────────────────────────────────────────────────
// Gleichmäßig aufteilen statt „volle Schritte + Rest": ein 0,2-mm-Restschnitt
// am Ende bringt nichts und kostet eine ganze Umrundung.
function _cncTiefen(zStart, zEnd, ap){
  const ges = zStart - zEnd;
  if(ges <= 1e-6) return [zEnd];
  const n = Math.max(1, Math.ceil(ges / Math.max(0.05, ap)));
  const out = [];
  for(let i=1;i<=n;i++) out.push(zStart - ges*i/n);
  return out;
}

// ── Haltestege, Rampe, Tiefenwege ───────────────────────────────────────
// Z-Verlauf über die Haltestege. Stege lassen an n Stellen eine dünne Brücke
// stehen, damit das fertige Teil im letzten Durchgang nicht losbricht und
// unter dem laufenden Fräser wegfliegt. An beiden Steg-Enden liegt eine kurze
// Anlauframpe, sonst fährt der Fräser senkrecht gegen die Steg-Flanke.
function _cncZSteg(ges, zZiel, stege, stegB, stegZ){
  if(!stege || stegB <= 0 || stegZ <= zZiel) return () => zZiel;
  const anl = 1.5;
  return s => {
    const su = ((s % ges) + ges) % ges;
    let z = zZiel;
    for(let k=0;k<stege;k++){
      const c = (k + 0.5) * ges / stege;
      let d = Math.abs(su - c);
      if(d > ges/2) d = ges - d;                    // zyklischer Abstand auf dem Ring
      if(d <= stegB/2) return stegZ;
      if(d <= stegB/2 + anl) z = Math.max(z, zZiel + (stegZ - zZiel) * (1 - (d - stegB/2)/anl));
    }
    return z;
  };
}

// Eine Umrundung eines geschlossenen Weges. Taucht über `rampe` mm Weglänge
// schräg von zVon auf zZiel ein, statt senkrecht zu stechen — ein Zweischneider
// stirbt im MDF genau am senkrechten Stechen. Zusätzliche Stützpunkte entstehen
// nur dort, wo sich die Höhe ändert; der Rest behält die Originalpunkte, sonst
// bläht sich der G-Code auf.
function _cncRingWeg(lp, zVon, zZiel, rampe, stege, stegB, stegZ){
  const ring = lp.concat([lp[0]]);
  const L = [0];
  for(let i=1;i<ring.length;i++) L.push(L[i-1] + _cncDist(ring[i-1], ring[i]));
  const ges = L[L.length-1];
  if(ges < 1e-6) return [];

  const stegeOk = stege > 0 && stegB > 0 && ges > stege * (stegB + 4) * 1.5;
  const zSteg = _cncZSteg(ges, zZiel, stegeOk ? stege : 0, stegB, stegZ);
  const rmp = Math.min(Math.max(0, rampe), ges * 0.45);
  const zRamp = s => (rmp > 1e-6 && s < rmp) ? (zVon + (zZiel - zVon) * (s/rmp)) : zZiel;

  const marken = new Set(L);
  if(rmp > 1e-6) for(const f of [0.25, 0.5, 0.75, 1]) marken.add(rmp*f);
  if(stegeOk){
    for(let k=0;k<stege;k++){
      const c = (k + 0.5) * ges / stege;
      for(const off of [-stegB/2-1.5, -stegB/2, stegB/2, stegB/2+1.5]){
        marken.add((((c+off) % ges) + ges) % ges);
      }
    }
  }
  const ss = Array.from(marken).filter(s => s >= -1e-9 && s <= ges + 1e-9).sort((a,b)=>a-b);
  return ss.map(s => { const p = _cncAuf(ring, L, s); return [p[0], p[1], Math.max(zRamp(s), zSteg(s))]; });
}

// Geschlossene Kontur über alle Tiefen: ohne Zwischen-Rückzug, jede Lage rampt
// aus der vorigen heraus weiter nach unten. Zum Schluss eine flache Umrundung
// auf Endtiefe — die schneidet die Rampe weg, die sonst als Schräge stehen
// bliebe. Haltestege gibt es nur in der letzten Lage und im Schlichtlauf.
function _cncKonturWeg(lp, tiefen, rampe, stege, stegB, stegZ){
  let weg = [], zVon = 0;
  for(let i=0;i<tiefen.length;i++){
    const letzte = i === tiefen.length - 1;
    weg = weg.concat(_cncRingWeg(lp, zVon, tiefen[i], rampe, letzte ? stege : 0, stegB, stegZ));
    zVon = tiefen[i];
  }
  return weg.concat(_cncRingWeg(lp, zVon, zVon, 0, stege, stegB, stegZ));
}

// Offener Pfad (Gravur): Pendeln statt Eintauchen. Jede Lage läuft einmal über
// den ganzen Pfad und fällt dabei gleichmäßig auf die nächste Tiefe, die
// nächste Lage zurück. So wird nie gestochen und nie leer gefahren; zum Schluss
// ein flacher Zug, der die Schräge entfernt.
function _cncPendelWeg(pts, tiefen){
  const L = [0];
  for(let i=1;i<pts.length;i++) L.push(L[i-1] + _cncDist(pts[i-1], pts[i]));
  const ges = L[L.length-1];
  if(ges < 1e-6) return [];
  const weg = []; let zVon = 0, vor = true;
  for(const zZ of tiefen){
    for(let i=0;i<pts.length;i++){
      const j = vor ? i : pts.length-1-i;
      const s = vor ? L[i] : (ges - L[j]);
      weg.push([pts[j][0], pts[j][1], zVon + (zZ - zVon) * (s/ges)]);
    }
    zVon = zZ; vor = !vor;
  }
  const zE = tiefen[tiefen.length-1];
  for(let i=0;i<pts.length;i++){ const j = vor ? i : pts.length-1-i; weg.push([pts[j][0], pts[j][1], zE]); }
  return weg;
}

function _cncCS(W, form){ return new W.CrossSection([form.outer, ...form.holes], 'EvenOdd'); }

// CrossSection → Ringe mit Kennzeichnung „Loch". Manifold liefert Außenringe
// gegen und Löcher im Uhrzeigersinn; verlassen wird sich darauf aber nicht,
// entschieden wird über das Vorzeichen der Fläche.
function _cncRinge(cs){
  return cs.toPolygons()
    .filter(p => p.length >= 3)
    .map(p => ({ lp: p, loch: _cncArea(p) < 0 }))
    .filter(r => _cncLaenge(r.lp, true) > 0.5);
}

// ── Netz → Manifold ─────────────────────────────────────────────────────
// Braucht jede App, die aus einem importierten Netz rechnen will: V3D CAD
// beim Verbinden und Schneiden, V3D CAM beim Schruppen gegen das Teil.
function _mfFromSoup(w, tris) {
  // Entartete Dreiecke VORHER aussortieren. _healTrisForBool tut das auch,
  // greift aber erst, nachdem Manifold ein Netz abgelehnt hat — und genau
  // das passiert hier nicht: Manifold nimmt sie an und rechnet sich fest.
  // Gemessen an einem Hunyuan3D-Netz (439.692 Dreiecke, davon 187.652 mit
  // doppelter Ecke): mit den Entarteten >25 min ohne Ergebnis, ohne sie
  // 1,1 s. Der Rest des Netzes war sauber (F/V = 2,0, keine offene Kante).
  // Bewusst nur EXAKTE Entartung (zwei gleiche Ecken oder Kreuzprodukt
  // genau 0) — ein Epsilon würde echte feine Geometrie mitnehmen.
  try { return _mfAusSuppe(w, tris, true); }
  catch (e) {
    // Ein „Nadel"-Dreieck (drei VERSCHIEDENE Ecken auf einer Linie) ist Teil
    // der geschlossenen Hülle: Seine drei Kanten teilt es mit Nachbarn. Fliegt
    // es raus, klafft ein Loch → „Not manifold". So an einem importierten
    // Bauteil (33.600 Dreiecke, 3 Nadeln, sonst dicht) — Abziehen scheiterte
    // mit „kein gültiges Werkzeug". Dann nur die mit doppelter Ecke aussortieren.
    try { return _mfAusSuppe(w, tris, false); }
    catch (_) { throw e; }
  }
}

function _mfAusSuppe(w, tris, nadelnWeg) {
  let vol = 0, gut = 0;
  const behalten = new Uint8Array(tris.length / 9);
  for (let i = 0, t = 0; i < tris.length; i += 9, t++) {
    const ax=tris[i],ay=tris[i+1],az=tris[i+2], bx=tris[i+3],by=tris[i+4],bz=tris[i+5], cx=tris[i+6],cy=tris[i+7],cz=tris[i+8];
    if ((ax===bx&&ay===by&&az===bz) || (bx===cx&&by===cy&&bz===cz) || (ax===cx&&ay===cy&&az===cz)) continue;
    const ux=bx-ax,uy=by-ay,uz=bz-az, vx=cx-ax,vy=cy-ay,vz=cz-az;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    if (nadelnWeg && nx===0 && ny===0 && nz===0) continue;
    behalten[t] = 1; gut++;
    vol += ax*(by*cz - bz*cy) - ay*(bx*cz - bz*cx) + az*(bx*cy - by*cx);
  }
  if (!gut) throw new Error('Netz besteht nur aus entarteten Dreiecken');
  if (gut < behalten.length) {
    console.warn('[mf] ' + (behalten.length - gut) + ' entartete Dreiecke übersprungen (von ' + behalten.length + ')' + (nadelnWeg ? '' : ' — Nadeln behalten'));
    const rein = new Float32Array(gut * 9);
    for (let t = 0, w2 = 0; t < behalten.length; t++) {
      if (!behalten[t]) continue;
      for (let q = 0; q < 9; q++) rein[w2++] = tris[t * 9 + q];
    }
    tris = rein;
  }
  const nVert = tris.length / 3;
  const idx = new Uint32Array(nVert);
  if (vol < 0) { console.warn('[mold] Netz invertiert (Volumen ' + (vol/6).toFixed(0) + ') — Wicklung wird umgedreht');
    for (let t = 0; t < nVert; t += 3) { idx[t] = t; idx[t+1] = t+2; idx[t+2] = t+1; } }
  else for (let t = 0; t < nVert; t++) idx[t] = t;
  const soup = new w.Mesh({
    numProp: 3,
    vertProperties: tris instanceof Float32Array ? tris : new Float32Array(tris),
    triVerts: idx
  });
  soup.merge();
  return new w.Manifold(soup);
}

// ── Werte ────────────────────────────────────────────────────────────────
function _cncWerte(P){
  const m = _CNC_MAT[P.mat], ma = _CNC_MASCHINE[P.mas] || _CNC_MASCHINE.grbl;
  const nMax = Math.max(ma.nMin, Math.min(P.nMax || ma.nMax, 60000));
  // fz gilt für Ø6; dünnere Fräser vertragen weniger Span, dickere mehr.
  const fz = m.fz * Math.min(1.6, Math.max(0.5, P.d/6));
  const nRoh = m.vc * 1000 / (Math.PI * P.d);
  const rpm = Math.round(Math.min(nMax, Math.max(ma.nMin, nRoh)) / 10) * 10;
  const vorschub = Math.min(ma.vfMax, Math.max(20, Math.round(rpm * P.z * fz)));
  const apF = (ma.post === 'grbl') ? m.apHob : m.apF;
  const o = {
    rpm, fz: Math.round(fz*1000)/1000, vorschub,
    tauchen: Math.max(20, Math.round(vorschub * m.tauch)),
    ap: Math.max(0.05, Math.round(P.d * apF * 100)/100),
    ae: Math.max(0.2, Math.round(P.d * m.aeF * 10)/10),
    kuehl: (ma.kuehl && m.kuehl) ? 1 : 0,
    nRoh: Math.round(nRoh),
    gedeckelt: nRoh > nMax + 1,
    geht: apF > 0,
    warum: apF > 0 ? '' : 'das braucht eine steife Maschine mit Kühlung',
    ma
  };
  if(P.op === 'bohr'){
    // Bohren rechnet komplett anders: eigene Schnittgeschwindigkeit und
    // Vorschub je Umdrehung statt je Zahn. Mit den Fräswerten würde ein
    // Ø5-Bohrer in Alu bei 10.000 min⁻¹ laufen und wäre nach zwei Löchern hin.
    const nB = Math.min(nMax, Math.max(ma.nMin, m.vcB * 1000 / (Math.PI * P.d)));
    const fU = m.fU * Math.min(2, Math.max(0.4, P.d/6));
    o.rpm = Math.round(nB / 10) * 10;
    o.vorschub = o.tauchen = Math.min(ma.vfMax, Math.max(10, Math.round(o.rpm * fU)));
    o.ap = Math.max(0.3, Math.round(P.d * m.peckF * 10) / 10);   // Abstichtiefe
    o.nRoh = Math.round(m.vcB * 1000 / (Math.PI * P.d));
    o.gedeckelt = o.nRoh > nMax + 1;
    // Beim Bohren ist nicht die Zustellung das Problem, sondern die MINDEST-
    // drehzahl: eine Frässpindel geht nach unten oft nicht unter 5000 min⁻¹,
    // ein Ø5-Bohrer in Stahl will aber 1600. Zu schnell heißt hier: Bohrer hin.
    o.geht = o.nRoh >= ma.nMin * 0.7;
    o.warum = o.geht ? '' : 'die Spindel dreht nicht langsam genug (' + o.nRoh +
              ' min⁻¹ wären nötig, sie geht nur bis ' + ma.nMin + ' hinunter)';
    o.fU = Math.round(fU * 1000) / 1000;
  }
  return o;
}

// ── Taschen ──────────────────────────────────────────────────────────────
// Konzentrische Ringe von der Wand nach innen. Gefahren wird von innen nach
// außen, damit der letzte Durchgang die Wand schlichtet — er nimmt dann nur
// noch den Bahnabstand ab und hinterlässt keine Stufen.
function _cncTaschenLagen(cs, r, ae, tmp){
  const lagen = [];
  for(let i=0;i<500;i++){
    const o = cs.offset(-(r + i*ae), 'Round', 2, 24); tmp.push(o);
    const ringe = _cncRinge(o);
    if(!ringe.length) break;
    lagen.push(ringe);
  }
  return lagen.reverse();
}

// Welches Programm den Code erzeugt hat, steht als Kommentar im Kopf. Der
// Kern weiss das nicht von sich aus — die App reicht es in P herein.
function _cncApp(P){ return P.app || 'V3D CAM'; }

// ── G-Code ───────────────────────────────────────────────────────────────
// Zwei Dialekte. Gemeinsam ist beiden, dass die Bahnen durch den Versatz
// ohnehin Polyzüge sind — Kreisinterpolation braucht es nirgends.
function _cncGcode(erg, P){
  return (_CNC_MASCHINE[P.mas] || _CNC_MASCHINE.grbl).post === 'fanuc'
    ? _cncGcodeFanuc(erg, P) : _cncGcodeGrbl(erg, P);
}

// ── Fanuc (Robodrill und Verwandte) ──────────────────────────────────────
// Die Unterschiede zu GRBL, die wirklich zählen:
//
//  * DER DEZIMALPUNKT IST PFLICHT. Eine Zahl ohne Punkt liest Fanuc in
//    kleinsten Eingabeschritten — „Z5" ist dort 0,005 mm, nicht 5 mm.
//    Der GRBL-Schreiber kürzt „5.000" genau zu „Z5"; auf der Robodrill
//    wäre das eine Kollision. Hier bekommt jede Koordinate einen Punkt,
//    notfalls als nachgestellter „5.".
//  * Das Programm steht zwischen zwei %-Zeilen und braucht eine O-Nummer.
//  * Der sichere Startsatz G0 G17 G40 G49 G80 G90 löscht Radiuskorrektur,
//    Längenkorrektur und einen noch aktiven Bohrzyklus. Ohne ihn startet
//    man in dem Zustand, den das Programm davor hinterlassen hat.
//  * Werkzeug über T/M6, Werkzeuglänge über G43 H.
//  * Gebohrt wird mit dem Zyklus G83 — das kann die Steuerung selbst, und
//    der Satz ist ein Bruchteil so lang wie ausgeschriebene Abstiche.
//  * Kommentare nur in Klammern und in ASCII-Großbuchstaben. Umlaute und
//    Sonderzeichen bringen ältere Steuerungen zum Alarm.

// Zahl mit garantiertem Dezimalpunkt
function _cncFa(v){
  const r = Math.abs(v) < 5e-4 ? 0 : v;
  return r.toFixed(3).replace(/0+$/, '');       // 5.000→"5."  2.100→"2.1"  0→"0."
}
// Kommentar: Klammern auf, ASCII-Großbuchstaben, nichts Exotisches
function _cncFaKom(t){
  return '(' + String(t).toUpperCase()
    .replace(/Ä/g,'AE').replace(/Ö/g,'OE').replace(/Ü/g,'UE').replace(/ß/g,'SS')
    .replace(/[^A-Z0-9 .,:;\/+\-=_]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 64) + ')';
}

function _cncGcodeFanuc(erg, P){
  const w = erg.w, m = _CNC_MAT[P.mat], F = _cncFa, K = _cncFaKom;
  const opN = { aus:'AUSSCHNEIDEN', tasche:'TASCHE', grav:'GRAVUR', bohr:'BOHREN',
                schrupp:'SCHRUPPEN' }[P.op] || 'FRAESEN';
  const L = [];
  L.push('%');
  L.push('O' + String(Math.max(1, Math.min(9999, P.oNr))).padStart(4, '0') + ' ' + K(_cncApp(P) + ' ' + opN));
  L.push(K('ENTWURF: ' + (P.entwurf || 'OHNE NAMEN')));
  L.push(K('MATERIAL: ' + m.n + ', DICKE ' + F(P.dicke) + ' MM'));
  L.push(K('WERKZEUG T' + P.tNr + ' H' + P.hNr + ': ' + (P.op === 'bohr' ? 'BOHRER D' + F(P.d) + ' MM'
           : 'FRAESER D' + F(P.d) + ' MM, ' + P.z + ' SCHNEIDEN')));
  L.push(K('S' + w.rpm + ' F' + w.vorschub + ' AP' + F(w.ap) + ' VC' + Math.round(m.vc * Math.min(1, w.rpm / Math.max(1, w.nRoh)))));
  L.push(K('NULLPUNKT ' + P.g54 + ', Z0 OBEN AUF DEM WERKSTUECK'));
  L.push(K('WERTE PRUEFEN. ERSTEN LAUF EINZELSATZ UND MIT OVERRIDE FAHREN'));
  // Sicherer Ausgangszustand, bevor irgendetwas verfährt
  L.push('G0 G17 G40 G49 G80 G90');
  L.push('G21');
  L.push('T' + P.tNr + ' M6');
  L.push(P.g54);
  L.push('S' + w.rpm + ' M3');
  L.push('G43 H' + P.hNr + ' Z' + F(P.zSafe));
  if(P.kuehl !== 'aus') L.push(P.kuehl === 'm7' ? 'M7' : 'M8');

  if(erg.bohr && erg.bohr.punkte.length){
    // G98: nach jedem Loch zurück auf die Ausgangshöhe — sicher über
    // Spannmitteln. G83 ist der Zyklus MIT vollem Ausfahren (entspanen).
    const b = erg.bohr, pt = b.punkte;
    L.push('G0 X' + F(pt[0][0]) + ' Y' + F(pt[0][1]));
    L.push('G98 G83 X' + F(pt[0][0]) + ' Y' + F(pt[0][1]) + ' Z' + F(b.zEnd) +
           ' R' + F(b.r) + ' Q' + F(b.peck) + ' F' + F(b.f));
    for(let i=1;i<pt.length;i++) L.push('X' + F(pt[i][0]) + ' Y' + F(pt[i][1]));
    L.push('G80');
  } else {
    let lx, ly, lf, lz = P.zSafe;
    for(const mv of erg.moves){
      const ax = [];
      if(mv.x !== undefined && mv.x !== lx) ax.push('X' + F(mv.x));
      if(mv.y !== undefined && mv.y !== ly) ax.push('Y' + F(mv.y));
      if(mv.z !== undefined && mv.z !== lz) ax.push('Z' + F(mv.z));
      if(!ax.length) continue;
      const t = ['G' + mv.g];
      t.push.apply(t, ax);
      if(mv.g === 1 && mv.f && mv.f !== lf){ t.push('F' + F(mv.f)); lf = mv.f; }
      if(mv.x !== undefined) lx = mv.x;
      if(mv.y !== undefined) ly = mv.y;
      if(mv.z !== undefined) lz = mv.z;
      L.push(t.join(' '));
    }
  }
  L.push('G0 Z' + F(P.zSafe));
  if(P.kuehl !== 'aus') L.push('M9');
  L.push('M5');
  L.push('G91 G28 Z0.');            // Z auf Referenz — erst dann darf X/Y fahren
  L.push('G28 X0. Y0.');
  L.push('G90');
  L.push('M30');
  L.push('%');
  return L.join('\n') + '\n';
}

// ── GRBL ─────────────────────────────────────────────────────────────────
// ── G-Code (GRBL) ────────────────────────────────────────────────────────
// Nur G0/G1 — alles ist durch den Versatz ohnehin zu Polyzügen geworden, und
// GRBL braucht keine Zyklen, die es nicht kennt.
function _cncGcodeGrbl(erg, P){
  const w = erg.w, m = _CNC_MAT[P.mat];
  const nz = v => { let s = (+v).toFixed(3); if(s.indexOf('.') >= 0) s = s.replace(/0+$/,'').replace(/\.$/,''); return s; };
  const opN = { aus:'Ausschneiden', tasche:'Tasche ausräumen', grav:'Gravieren', bohr:'Bohren',
                schrupp:'Schruppen' }[P.op] || 'Fräsen';
  const L = [];
  L.push('(' + _cncApp(P) + ' — CNC 2,5D)');
  L.push('(Entwurf: ' + (P.entwurf || 'ohne Namen') + ')');
  L.push('(Bearbeitung: ' + opN + ', ' + (P.lauf === 'gleich' ? 'Gleichlauf' : 'Gegenlauf') + ')');
  L.push('(Material: ' + m.n + ', Dicke ' + nz(P.dicke) + ' mm)');
  L.push('(Werkzeug: Fraeser Durchmesser ' + nz(P.d) + ' mm, ' + P.z + ' Schneiden)');
  L.push('(Drehzahl ' + w.rpm + ' 1/min, Vorschub ' + w.vorschub + ' mm/min, Eintauchen ' + w.tauchen + ' mm/min)');
  L.push('(Zustellung ' + nz(w.ap) + ' mm je Durchgang, Spanungsdicke ' + nz(w.fz) + ' mm je Zahn)');
  L.push('(Nullpunkt: X/Y wie in der Skizze, Z=0 OBEN auf dem Werkstueck)');
  L.push('(Werte sind Startwerte — vor dem ersten Schnitt pruefen und trocken abfahren)');
  L.push('G21 G90 G17 G94');
  L.push('G0 Z' + nz(P.zSafe));
  L.push('M3 S' + w.rpm);
  L.push('G4 P2');                                  // Spindel hochlaufen lassen
  let lx, ly, lf, lz = P.zSafe;                     // der Kopf steht schon auf Sicherheitshöhe
  for(const mv of erg.moves){
    const ax = [];
    if(mv.x !== undefined && mv.x !== lx) ax.push('X' + nz(mv.x));
    if(mv.y !== undefined && mv.y !== ly) ax.push('Y' + nz(mv.y));
    if(mv.z !== undefined && mv.z !== lz) ax.push('Z' + nz(mv.z));
    if(!ax.length) continue;                        // Bewegung ohne Weg — weglassen
    const t = ['G' + mv.g];
    t.push.apply(t, ax);
    if(mv.g === 1 && mv.f && mv.f !== lf){ t.push('F' + Math.round(mv.f)); lf = mv.f; }
    if(mv.x !== undefined) lx = mv.x;
    if(mv.y !== undefined) ly = mv.y;
    if(mv.z !== undefined) lz = mv.z;
    L.push(t.join(' '));
  }
  if(lz !== P.zSafe) L.push('G0 Z' + nz(P.zSafe));
  L.push('M5');
  L.push('G0 X0 Y0');
  L.push('M30');
  return L.join('\n') + '\n';
}
