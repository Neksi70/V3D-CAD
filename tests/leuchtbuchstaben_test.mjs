// Regressionstest für die Leucht-Buchstaben (🔤 hohle Kanalbuchstaben).
//
// Geprüft wird, was am Ende beim Drucken und beim Einlegen der Lichterkette zählt:
//   1. jedes Teil ist WASSERDICHT und hat positives Volumen (alle Varianten)
//   2. die Buchstaben sind wirklich HOHL — die Materialfläche schrumpft von vorn
//      nach hinten auf den Wandring zusammen
//   3. die Rückseite ist OFFEN und der Diffusor vorn hat genau die eingestellte
//      Dicke (Strahl von hinten durch den Hohlraum: genau zwei Treffer)
//   4. „Offen" lässt vorn kein Material stehen
//   5. die Kabel-Kerbe nimmt Material weg, ohne die Front anzutasten
//   6. das Bord hat eine echte Nut
//   7. Spiegelung: stehend liest sich der Text vorwärts, in Druck-Lage
//      (Gesicht nach unten) spiegelbildlich — sonst kommt der Druck falsch heraus
//   8. Erstellen legt pro Zeichen ein Teil auf die Platte und schließt den Dialog
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
// Gegen den ausgelieferten Stand (Port 8765) braucht es ein Sitzungs-Cookie,
// sonst schickt der Server auf die Anmeldung. Am Dev-Server (8766) schadet es nicht.
try {
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('lbs-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { console.log('  (kein Sitzungs-Cookie: ' + e.message.split('\n')[0] + ')'); }
const pg = await ctx.newPage();
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

// Rechenkern + Schrift bereitstellen (sonst baut nichts)
const bereit = await pg.evaluate(async () => {
  await _mfInit();
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Font-Timeout')), 30000);
    _npLoadFont(_lbsP.font, () => { clearTimeout(t); res(); }); });
  return { mf: !!_mfWasm, font: !!_lbsFontObj() };
});
ok('Rechenkern und Schrift geladen', bereit.mf && bereit.font, bereit);

// Prüf-Werkzeug in die Seite legen
await pg.evaluate(() => {
  window._lbsT = {
    watertight(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const key = i => { const j = idx ? idx.getX(i) : i;
        return Math.round(p.getX(j)*1e4)+','+Math.round(p.getY(j)*1e4)+','+Math.round(p.getZ(j)*1e4); };
      const m = new Map(); let tris = 0, degen = 0;
      for (let t = 0; t < n; t += 3) {
        const a = key(t), b2 = key(t+1), c = key(t+2);
        if (a===b2 || b2===c || a===c) { degen++; continue; }
        tris++;
        for (const [u,v] of [[a,b2],[b2,c],[c,a]]) m.set(u+'|'+v, (m.get(u+'|'+v)||0)+1);
      }
      let bad = 0;
      for (const [k,v] of m) { const [u,w] = k.split('|'); if (v !== 1 || (m.get(w+'|'+u)||0) !== 1) bad++; }
      return { tris, degen, offen: bad };
    },
    vol(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count; let V = 0;
      const g = (i,k) => { const j = idx ? idx.getX(i) : i; return k===0?p.getX(j):k===1?p.getY(j):p.getZ(j); };
      for (let t = 0; t < n; t += 3) {
        const ax=g(t,0),ay=g(t,1),az=g(t,2), bx=g(t+1,0),by=g(t+1,1),bz=g(t+1,2), cx=g(t+2,0),cy=g(t+2,1),cz=g(t+2,2);
        V += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx);
      }
      return V/6;
    },
    // Ein Zeichen im Bauraum bauen (mm, Z-up, Front z=0, Rückseite offen bei z=Tiefe)
    build(over, zeichen) {
      const bak = { ..._lbsP };
      Object.assign(_lbsP, over || {});
      let out = null;
      try {
        const G = _lbsGlyphs();
        if (G) {
          const L = zeichen ? G.letters.find(l => l.ch === zeichen) : G.letters[0];
          if (L) { const r = _lbsShellGeo(_mfWasm, L.loops, _lbsP); if (r) out = { geo: r.geo, hohl: r.hohl, G }; }
        }
      } catch (e) { out = { err: String(e) }; }
      Object.assign(_lbsP, bak);
      return out;
    },
    mesh(geo) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      m.updateMatrixWorld(true); return m;
    },
    inside(mesh, pt) {
      const rc = new THREE.Raycaster(pt.clone(), new THREE.Vector3(0.5771, 0.5773, 0.5775).normalize(), 0, 1e5);
      return rc.intersectObject(mesh, false).length % 2 === 1;
    },
    // Materialfläche in einer z-Ebene abtasten (Rasterpunkte, die im Körper liegen)
    flaeche(mesh, geo, z, N) {
      geo.computeBoundingBox(); const bb = geo.boundingBox;
      let c = 0, tot = 0, treffer = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = bb.min.x + (i + 0.5) / N * (bb.max.x - bb.min.x);
        const y = bb.min.y + (j + 0.5) / N * (bb.max.y - bb.min.y);
        tot++;
        if (this.inside(mesh, new THREE.Vector3(x, y, z))) { c++; treffer.push([x, y]); }
      }
      return { c, tot, treffer };
    }
  };
});

// ── 1: alle Varianten wasserdicht ───────────────────────────────────────────
const varianten = [
  { name: 'Standard 18',        p: {} },
  { name: 'Text MAX',           p: { text: 'MAX' } },
  { name: 'Offen vorn',         p: { offen: 1 } },
  { name: 'Ohne Kabel-Kerbe',   p: { kabel: 0 } },
  { name: 'Klein 45 mm',        p: { hoehe: 45, wall: 1.6, tiefe: 10, kabelD: 3 } },
  { name: 'Groß 400 mm',        p: { hoehe: 400, tiefe: 60, wall: 4 } },
  { name: 'Dicke Wand 5 mm',    p: { wall: 5 } },
  { name: 'Schreibschrift',     p: { font: 'sniglet_local', text: 'Ab' } },
  { name: 'Sonderzeichen',      p: { text: '7&8' } },
];
for (const v of varianten) {
  if (v.p.font) await pg.evaluate(k => new Promise(r => _npLoadFont(k, r)), v.p.font);
  const r = await pg.evaluate(({ over }) => {
    const b2 = window._lbsT.build(over);
    if (!b2 || b2.err) return { err: (b2 && b2.err) || 'kein Körper' };
    const w = window._lbsT.watertight(b2.geo), vol = window._lbsT.vol(b2.geo);
    b2.geo.dispose();
    return { ...w, vol, hohl: b2.hohl };
  }, { over: v.p });
  ok(v.name + ': wasserdicht + Volumen', !r.err && r.offen === 0 && r.vol > 0,
     r.err || { offen: r.offen, tris: r.tris, volMm3: Math.round(r.vol), hohl: r.hohl });
}

// ── 2+3: wirklich hohl, hinten offen, Diffusor in Soll-Dicke ────────────────
const hohl = await pg.evaluate(() => {
  const T = window._lbsT;
  const b2 = T.build({ text: '8', hoehe: 150, tiefe: 25, wall: 2, diff: 0.8 });
  if (!b2 || b2.err) return { err: (b2 && b2.err) || 'kein Körper' };
  const m = T.mesh(b2.geo);
  const vorn = T.flaeche(m, b2.geo, 0.4, 26);        // in der Diffusor-Haut
  const hinten = T.flaeche(m, b2.geo, 24, 26);       // knapp vor der offenen Rückseite
  // Punkt, der vorn Material hat, hinten aber Hohlraum ist → dort von hinten durchschauen
  const hSet = new Set(hinten.treffer.map(p => p.join(',')));
  const loch = vorn.treffer.find(p => !hSet.has(p.join(',')));
  let treffer = null, dicke = null;
  if (loch) {
    const rc = new THREE.Raycaster(new THREE.Vector3(loch[0], loch[1], 40), new THREE.Vector3(0, 0, -1), 0, 200);
    const hits = rc.intersectObject(m, false).map(h => +h.point.z.toFixed(3));
    treffer = hits;
    if (hits.length === 2) dicke = Math.abs(hits[0] - hits[1]);
  }
  const vol = T.vol(b2.geo);
  b2.geo.dispose();
  const massiv = T.build({ text: '8', hoehe: 150, tiefe: 25, wall: 2, diff: 0.8, kabel: 0 });
  let volMassiv = null;
  if (massiv && !massiv.err) { volMassiv = T.vol(massiv.geo); massiv.geo.dispose(); }
  return { vorn: vorn.c, hinten: hinten.c, tot: vorn.tot, treffer, dicke, vol, volMassiv, hohl: b2.hohl };
});
ok('„8" wird hohl gebaut', hohl.hohl === true, hohl.err || {});
ok('Materialfläche schrumpft nach hinten auf den Wandring', hohl.hinten > 0 && hohl.hinten < hohl.vorn * 0.72,
   { vorn: hohl.vorn, hinten: hohl.hinten, von: hohl.tot });
ok('Rückseite offen: Strahl von hinten trifft nur den Diffusor (2×)', hohl.treffer && hohl.treffer.length === 2, hohl.treffer);
ok('Diffusor ist 0,8 mm dick', hohl.dicke !== null && Math.abs(hohl.dicke - 0.8) < 0.06, { dickeMm: hohl.dicke });

// ── 4: „Offen" lässt vorn nichts stehen ─────────────────────────────────────
const offen = await pg.evaluate(() => {
  const T = window._lbsT;
  const b2 = T.build({ text: '8', hoehe: 150, tiefe: 25, wall: 2, offen: 1 });
  if (!b2 || b2.err) return { err: (b2 && b2.err) || 'kein Körper' };
  const m = T.mesh(b2.geo);
  const vorn = T.flaeche(m, b2.geo, 0.4, 26), hinten = T.flaeche(m, b2.geo, 24, 26);
  b2.geo.dispose();
  return { vorn: vorn.c, hinten: hinten.c };
});
ok('Offen vorn: vorn gleich viel Material wie hinten (nur Wandring)',
   !offen.err && Math.abs(offen.vorn - offen.hinten) <= Math.max(2, offen.hinten * 0.25), offen);

// ── 5: Kabel-Kerbe nimmt Material weg, Front bleibt zu ─────────────────────
const kerbe = await pg.evaluate(() => {
  const T = window._lbsT;
  const base = { text: '8', hoehe: 150, tiefe: 25, wall: 2, diff: 0.8 };
  const mit = T.build({ ...base, kabel: 1, kabelD: 4 });
  const ohne = T.build({ ...base, kabel: 0 });
  if (!mit || mit.err || !ohne || ohne.err) return { err: 'kein Körper' };
  const mM = T.mesh(mit.geo), mO = T.mesh(ohne.geo);
  const fM = T.flaeche(mM, mit.geo, 0.4, 26).c, fO = T.flaeche(mO, ohne.geo, 0.4, 26).c;
  const vM = T.vol(mit.geo), vO = T.vol(ohne.geo);
  const wM = T.watertight(mit.geo).offen;
  mit.geo.dispose(); ohne.geo.dispose();
  return { vM, vO, fM, fO, wM };
});
ok('Kabel-Kerbe nimmt Material weg', !kerbe.err && kerbe.vM < kerbe.vO - 10,
   { mitMm3: Math.round(kerbe.vM || 0), ohneMm3: Math.round(kerbe.vO || 0) });
ok('Kabel-Kerbe lässt die Front unberührt', kerbe.fM === kerbe.fO, { mit: kerbe.fM, ohne: kerbe.fO });
ok('Kabel-Kerbe bleibt wasserdicht', kerbe.wM === 0, { offen: kerbe.wM });

// ── 5b: Rückwand — Falz, Passung, Kanal ────────────────────────────────────
const rueck = await pg.evaluate(() => {
  const T = window._lbsT;
  const base = { text: '8', hoehe: 150, tiefe: 25, wall: 2.5, diff: 0.8, kabel: 1,
                 rueck: 1, plattenD: 2, fuehrung: 1, streifenB: 10 };
  // Buchstabe MIT Falz und die zugehörige Platte
  const bak = { ..._lbsP };
  Object.assign(_lbsP, base);
  const sh = _lbsShellGeo(_mfWasm, _lbsGlyphs().letters[0].loops, _lbsP);
  let out = { falz: _lbsFalzBreite(_lbsP), hatPlatte: !!(sh && sh.platte) };
  if (sh && sh.platte) {
    const pg2 = _lbsPlatteGeo(_mfWasm, sh.platte, _lbsP, sh.bb);
    out.kanal = pg2 && pg2.kanal;
    if (pg2) {
      const g = pg2.geo;
      out.platte = { ...T.watertight(g), vol: T.vol(g) };
      g.computeBoundingBox();
      const bb = g.boundingBox;
      out.zVon = +bb.min.z.toFixed(2); out.zBis = +bb.max.z.toFixed(2);
      // Rippen stehen VOR der Platte (Richtung Vorderseite = kleineres z)
      out.rippenTief = +(25 - 2 - bb.min.z).toFixed(2);
      const m = T.mesh(g);
      // Kanalbreite messen: waagerechter Strahl in Rippenhöhe quer durch den Kanal
      const zR = 25 - 2 - 1.0;
      let luecken = [];
      for (let y = bb.min.y + 5; y < bb.max.y - 5; y += 2.5) {
        const rc = new THREE.Raycaster(new THREE.Vector3(bb.min.x - 10, y, zR), new THREE.Vector3(1, 0, 0), 0, 500);
        const hits = rc.intersectObject(m, false).map(h => h.point.x);
        for (let i = 1; i + 1 < hits.length; i += 2) {
          const w2 = hits[i + 1] - hits[i];
          if (w2 > 3 && w2 < 30) luecken.push(+w2.toFixed(2));
        }
      }
      luecken = luecken.filter(v => v > 5).sort((a, b) => a - b);
      out.kanalBreite = luecken.length ? luecken[0] : null;      // senkrechter Durchgang
      out.kanalBreitMax = luecken.length ? luecken[luecken.length - 1] : null;
      out.messungen = luecken.length;
    }
  }
  // Buchstabe OHNE Rückwand zum Vergleich (Falz muss Material kosten)
  Object.assign(_lbsP, { ...base, rueck: 0 });
  const sh0 = _lbsShellGeo(_mfWasm, _lbsGlyphs().letters[0].loops, _lbsP);
  out.volMitFalz = sh ? T.vol(sh.geo) : null;
  out.volOhneFalz = sh0 ? T.vol(sh0.geo) : null;
  // Zu dünne Wand: kein Falz, keine Platte
  Object.assign(_lbsP, { ...base, wall: 1.4 });
  const shD = _lbsShellGeo(_mfWasm, _lbsGlyphs().letters[0].loops, _lbsP);
  out.duenneWandFalz = _lbsFalzBreite(_lbsP);
  out.duenneWandPlatte = !!(shD && shD.platte);
  if (sh) sh.geo.dispose(); if (sh0) sh0.geo.dispose(); if (shD) shD.geo.dispose();
  Object.assign(_lbsP, bak);
  return out;
});
ok('Rückwand: Falz wird ausgefräst', rueck.hatPlatte && rueck.falz > 0.6, rueck.falz);
ok('Rückwand: Platte ist wasserdicht', rueck.platte && rueck.platte.offen === 0 && rueck.platte.vol > 0,
   rueck.platte && { offen: rueck.platte.offen, volMm3: Math.round(rueck.platte.vol) });
ok('Rückwand: sitzt hinten und schließt bündig ab', Math.abs(rueck.zBis - 25) < 0.01, { zVon: rueck.zVon, zBis: rueck.zBis });
ok('Rückwand: Rippen stehen nach vorn in den Hohlraum', rueck.rippenTief > 1 && rueck.rippenTief <= 3.6, { mm: rueck.rippenTief });
ok('Rückwand: Kanal entsteht auch am runden Zeichen', rueck.kanal === true);

const kanalI = await pg.evaluate(() => {
  const T = window._lbsT;
  const bak = { ..._lbsP };
  const messe = (breite) => {
    Object.assign(_lbsP, { text: 'I', hoehe: 150, tiefe: 25, wall: 2.5, rueck: 1, plattenD: 2,
                           fuehrung: 1, streifenB: breite, kabel: 0 });
    const sh = _lbsShellGeo(_mfWasm, _lbsGlyphs().letters[0].loops, _lbsP);
    if (!sh || !sh.platte) return null;
    const pg2 = _lbsPlatteGeo(_mfWasm, sh.platte, _lbsP, sh.bb);
    sh.geo.dispose();
    if (!pg2) return null;
    const g = pg2.geo; g.computeBoundingBox();
    const bb = g.boundingBox, m = T.mesh(g);
    const zR = 25 - 2 - 1.0;                     // mitten in der Rippenhöhe
    const w = [];
    for (let y = bb.min.y + 20; y < bb.max.y - 20; y += 5) {
      const rc = new THREE.Raycaster(new THREE.Vector3(bb.min.x - 10, y, zR), new THREE.Vector3(1, 0, 0), 0, 500);
      const hits = rc.intersectObject(m, false).map(h => h.point.x);
      if (hits.length === 4) w.push(+(hits[2] - hits[1]).toFixed(2));   // Rippe | KANAL | Rippe
    }
    g.dispose();
    w.sort((a, b) => a - b);
    return { n: w.length, min: w[0], max: w[w.length - 1], kanal: pg2.kanal };
  };
  const out = { z10: messe(10), z6: messe(6) };
  Object.assign(_lbsP, bak);
  return out;
});
ok('Rückwand: Kanal am geraden Strich ist genau streifenbreit', kanalI.z10 && kanalI.z10.n > 10
   && kanalI.z10.min >= 10 && kanalI.z10.max <= 10.6, kanalI.z10);
ok('Rückwand: schmalerer Streifen gibt schmaleren Kanal', kanalI.z6 && kanalI.z6.min >= 6 && kanalI.z6.max <= 6.6, kanalI.z6);
ok('Rückwand: der Falz kostet Material im Buchstaben', rueck.volMitFalz < rueck.volOhneFalz - 50,
   { mit: Math.round(rueck.volMitFalz || 0), ohne: Math.round(rueck.volOhneFalz || 0) });
ok('Rückwand: zu dünne Wand → gar kein Falz statt brüchiger Rand',
   rueck.duenneWandFalz < 0.6 && rueck.duenneWandPlatte === false, rueck.duenneWandFalz);

// ── 5c: Platte passt wirklich in die Tasche (Spiel, kein Übermaß) ──────────
const passung = await pg.evaluate(() => {
  const T = window._lbsT;
  const bak = { ..._lbsP };
  Object.assign(_lbsP, { text: '8', hoehe: 150, tiefe: 25, wall: 2.5, rueck: 1, plattenD: 2, fuehrung: 0, kabel: 0 });
  const loops = _lbsGlyphs().letters[0].loops;
  const sh = _lbsShellGeo(_mfWasm, loops, _lbsP);
  const pg2 = _lbsPlatteGeo(_mfWasm, sh.platte, _lbsP, sh.bb);
  const buchstabe = T.mesh(sh.geo);
  const platte = pg2.geo; platte.computeBoundingBox();
  // Jeder Punkt der Platte muss im Buchstaben LEER sein (sonst klemmt sie)
  const pos = platte.getAttribute('position');
  let drin = 0, geprueft = 0;
  for (let i = 0; i < pos.count; i += 7) {
    const z = pos.getZ(i);
    if (z < 25 - 2 - 0.1 || z > 25 + 0.1) continue;           // nur der Plattenkörper
    // auf halbe Plattenhöhe gezogen: dort MUSS die Tasche frei sein
    const P2 = new THREE.Vector3(pos.getX(i), pos.getY(i), 25 - 1);
    geprueft++;
    if (T.inside(buchstabe, P2)) drin++;
  }
  sh.geo.dispose(); platte.dispose();
  Object.assign(_lbsP, bak);
  return { drin, geprueft };
});
ok('Rückwand: steckt nirgends im Buchstaben-Material', passung.drin === 0 && passung.geprueft > 50, passung);

// ── 6: Bord hat eine Nut ───────────────────────────────────────────────────
const bord = await pg.evaluate(() => {
  const T = window._lbsT;
  const bak = { ..._lbsP };
  Object.assign(_lbsP, { text: '18', tiefe: 25, sockelH: 14 });
  const geo = _lbsSockelGeo(_mfWasm, _lbsP, 100);
  Object.assign(_lbsP, bak);
  if (!geo) return { err: 'kein Bord' };
  geo.computeBoundingBox(); const bb = geo.boundingBox;
  const m = T.mesh(geo);
  const w = T.watertight(geo), vol = T.vol(geo);
  const kasten = (bb.max.x-bb.min.x)*(bb.max.y-bb.min.y)*(bb.max.z-bb.min.z);
  // Punkt mitten in der Nut (oben, mittig in der Tiefe) darf kein Material sein
  const inNut = T.inside(m, new THREE.Vector3(0, -2, 12.5));
  const unten = T.inside(m, new THREE.Vector3(0, -12, 12.5));
  geo.dispose();
  return { offen: w.offen, vol, kasten, hoehe: bb.max.y-bb.min.y, tiefe: bb.max.z-bb.min.z, inNut, unten };
});
ok('Bord wasserdicht', !bord.err && bord.offen === 0, bord.err || { offen: bord.offen });
ok('Bord hat die eingestellte Höhe', Math.abs(bord.hoehe - 14) < 0.01 && Math.abs(bord.tiefe - (25 + 0.6 + 6)) < 0.01,
   { hoehe: bord.hoehe, tiefe: bord.tiefe });
ok('Nut ist wirklich ausgefräst', bord.inNut === false && bord.unten === true && bord.vol < bord.kasten * 0.95,
   { inNut: bord.inNut, unten: bord.unten, anteil: +(bord.vol / bord.kasten).toFixed(2) });

// ── 7: Spiegelung — stehend vorwärts, Druck-Lage spiegelbildlich ────────────
const spiegel = await pg.evaluate(() => {
  const bak = { ..._lbsP };
  Object.assign(_lbsP, { text: 'AB', hoehe: 120, tiefe: 20, sockel: 0 });
  const lese = lage => {
    const r = _lbsParts(_lbsP, lage);
    if (!r) return null;
    const out = r.parts.map(p => {
      const g = p.geo; g.computeBoundingBox();
      return { name: p.name, x: +p.pos.x.toFixed(3), yMin: +g.boundingBox.min.y.toFixed(3),
               hoch: +(g.boundingBox.max.y - g.boundingBox.min.y).toFixed(3) };
    });
    r.parts.forEach(p => p.geo.dispose());
    return out;
  };
  const st = lese('stehend'), fl = lese('flach');
  Object.assign(_lbsP, bak);
  return { st, fl };
});
const stA = spiegel.st && spiegel.st.find(p => /A$/.test(p.name));
const stB = spiegel.st && spiegel.st.find(p => /B$/.test(p.name));
const flA = spiegel.fl && spiegel.fl.find(p => /A$/.test(p.name));
const flB = spiegel.fl && spiegel.fl.find(p => /B$/.test(p.name));
ok('Stehend: „A" steht links von „B"', !!(stA && stB) && stA.x < stB.x, { A: stA && stA.x, B: stB && stB.x });
ok('Druck-Lage: gespiegelt, „A" liegt rechts von „B"', !!(flA && flB) && flA.x > flB.x, { A: flA && flA.x, B: flB && flB.x });
ok('Stehend: Buchstabenhöhe = 120 mm (12 Einheiten)', !!stA && Math.abs(stA.hoch - 12) < 0.05, { hoch: stA && stA.hoch });
ok('Druck-Lage: liegt flach, Bauhöhe = Tiefe 20 mm', !!flA && Math.abs(flA.hoch - 2) < 0.05, { hoch: flA && flA.hoch });
ok('Alle Teile stehen auf der Platte (y=0)',
   [...(spiegel.st || []), ...(spiegel.fl || [])].every(p => Math.abs(p.yMin) < 0.02),
   (spiegel.st || []).concat(spiegel.fl || []).map(p => p.yMin));

// ── 7b: Bord hebt die Buchstaben in die Nut ────────────────────────────────
const mitBord = await pg.evaluate(() => {
  const bak = { ..._lbsP };
  Object.assign(_lbsP, { text: 'A', hoehe: 120, tiefe: 20, sockel: 1, sockelH: 14 });
  const r = _lbsParts(_lbsP, 'stehend');
  let out = null;
  if (r) {
    out = r.parts.map(p => { p.geo.computeBoundingBox();
      return { name: p.name, yMin: +p.geo.boundingBox.min.y.toFixed(3), yMax: +p.geo.boundingBox.max.y.toFixed(3) }; });
    r.parts.forEach(p => p.geo.dispose());
  }
  Object.assign(_lbsP, bak);
  return out;
});
const bd = mitBord && mitBord.find(p => p.name === 'Bord');
const bu = mitBord && mitBord.find(p => p.name !== 'Bord');
ok('Mit Bord: Bord steht auf der Platte, Buchstabe steckt 6 mm in der Nut',
   !!(bd && bu) && Math.abs(bd.yMin) < 0.02 && Math.abs(bu.yMin - 0.8) < 0.02, { bord: bd, buchstabe: bu });

// ── 7c: zu schmale Schrift wird massiv gemeldet, bleibt aber baubar ─────────
const zuDuenn = await pg.evaluate(() => {
  const bak = { ..._lbsP };
  Object.assign(_lbsP, { text: '18', hoehe: 45, wall: 5, tiefe: 20 });
  const r = _lbsParts(_lbsP, 'flach');
  let out = { massiv: r ? r.massiv : null, n: r ? r.parts.length : 0, offen: null };
  if (r) { out.offen = r.parts.map(p => window._lbsT.watertight(p.geo).offen); r.parts.forEach(p => p.geo.dispose()); }
  Object.assign(_lbsP, bak);
  return out;
});
ok('Zu schmal für den Hohlraum wird gemeldet', !!zuDuenn.massiv && zuDuenn.massiv.length > 0, zuDuenn.massiv);
ok('… und wird trotzdem wasserdicht gebaut', zuDuenn.offen && zuDuenn.offen.every(o => o === 0), zuDuenn.offen);

// ── 8: Dialog + Erstellen ──────────────────────────────────────────────────
const dialog = await pg.evaluate(async () => {
  _lbsOpen();
  const sichtbar = document.getElementById('lbs-modal').classList.contains('show');
  for (let i = 0; i < 80 && !(_gpv['lbs'] && _gpv['lbs'].group); i++) await new Promise(r => setTimeout(r, 100));
  const vorschau = !!(_gpv['lbs'] && _gpv['lbs'].group);
  const info = (document.getElementById('lbs-info').textContent || '').length;
  Object.assign(_lbsP, { text: 'A1', sockel: 1, flach: 1, rueck: 1, fuehrung: 1, wall: 2.5 });
  const vor = objects.length;
  await _lbsCreate();
  const neu = objects.slice(vor);
  const alle = [];
  neu.forEach(o => o.traverse ? o.traverse(c => { if (c.isMesh) alle.push(c); }) : alle.push(o));
  const box = o => { const b2 = new THREE.Box3().setFromObject(o); return +b2.min.y.toFixed(3); };
  const kiste = o => { const b2 = new THREE.Box3().setFromObject(o);
    return { x0: +b2.min.x.toFixed(2), x1: +b2.max.x.toFixed(2), z0: +b2.min.z.toFixed(2), z1: +b2.max.z.toFixed(2) }; };
  return { sichtbar, vorschau, info, n: neu.length, teile: alle.length, kisten: alle.map(kiste),
           namen: alle.map(o => o.userData.name), yMin: alle.map(box),
           zu: !document.getElementById('lbs-modal').classList.contains('show') };
});
ok('Dialog öffnet', dialog.sichtbar);
ok('Vorschau baut ein Modell', dialog.vorschau);
ok('Hinweistext ist gefüllt', dialog.info > 80, { zeichen: dialog.info });
ok('Erstellen legt 2 Buchstaben + 2 Rückwände + Bord an', dialog.teile === 5, dialog.namen);
ok('Erstellen: die Rückwände heißen nach ihrem Buchstaben',
   dialog.namen.filter(n => /^Rückwand [A1]/.test(n)).length === 2, dialog.namen);
ok('Druck-Lage: nichts überlagert sich (jedes Teil hat seinen Platz)',
   dialog.kisten && dialog.kisten.every((a, i) => dialog.kisten.every((b, j) => i === j ||
     a.x1 <= b.x0 + 0.01 || a.x0 >= b.x1 - 0.01 || a.z1 <= b.z0 + 0.01 || a.z0 >= b.z1 - 0.01)),
   dialog.kisten);
ok('Alles liegt auf der Platte', dialog.yMin.every(y => Math.abs(y) < 0.02), dialog.yMin);
ok('Dialog schließt nach dem Erstellen', dialog.zu);

ok('Keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
