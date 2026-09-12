// Regressionstest für den Pilz-Generator (🍄 Pilz, zweiteilig mit Gewinde).
//
// Geprüft wird, was beim Drucken und beim Zusammenschrauben zählt:
//   1. Stiel und Hut sind WASSERDICHT (Kantenparität) und haben positives Volumen
//   2. das Gewinde passt wirklich ineinander — kein Vertex des Stiels steckt in
//      der Hut-Wand (echter Punkt-im-Körper-Test per Raycast), und der Spalt
//      bleibt klein genug, dass es nicht schlackert
//   3. der Hut greift über den Stielkopf, ohne ihn zu berühren
//   4. alle Hut-Häute und Rippen-Arten bauen fehlerfrei
//   5. ein zu flacher Hut wird gemeldet statt still ein Loch durch die Spitze zu bohren
//   6. Erstellen legt genau zwei Teile an, beide mit Unterkante auf y=0 (Drucklage)
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
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

await pg.evaluate(() => {
  window._plzT = {
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
    // Punkt im geschlossenen Netz? Ungerade Trefferzahl = innen.
    inside(mesh, pt) {   // Material-Test: Strahl muss BEIDE Seiten sehen, sonst stimmt die Parität nicht
      const rc = new THREE.Raycaster(pt.clone(), new THREE.Vector3(0.5771, 0.5773, 0.5775).normalize(), 0, 1e4);
      rc.firstHitOnly = false;
      const hits = rc.intersectObject(mesh, false);
      return hits.length % 2 === 1;
    }
  };
});

// ── 1+4: alle Varianten bauen, wasserdicht und mit Volumen ──────────────────
const varianten = [
  { name: 'Standard',        p: {} },
  { name: 'Gefurcht',        p: { skin: 'furchen' } },
  { name: 'Rau',             p: { skin: 'rau' } },
  { name: 'Tupfen',          p: { skin: 'tupfen' } },
  { name: 'Stiel massiv',    p: { hollow: 0 } },
  { name: 'Rippen kantig',   p: { ribStyle: 'kante' } },
  { name: 'Rippen Rillen',   p: { ribStyle: 'rille' } },
  { name: 'Rippen aus',      p: { ribs: 0 } },
  { name: 'Drall 120°',      p: { twist: 120 } },
  { name: 'Flacher Hut',     p: { capH: 30, capForm: 95 } },
  { name: 'Spitzer Hut',     p: { capH: 100, capForm: 5 } },
  { name: 'Klein 30/15',     p: { capDia: 30, stemDia: 16, stemH: 18, overlap: 4, threadH: 5, pitch: 2 } },
  { name: 'Groß 220/120',    p: { capDia: 220, stemDia: 120, stemH: 200, threadH: 20, pitch: 5 } },
  { name: 'Grobe Steigung',  p: { pitch: 5, threadH: 20 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(({ over }) => {
    const bak = { ..._pilzP };
    Object.assign(_pilzP, over);
    let out;
    try {
      const s = _pilzStemGeo(_pilzP, 120), c = _pilzCapGeo(_pilzP, 120);
      out = { stem: { ...window._plzT.watertight(s), vol: window._plzT.vol(s) },
              cap:  { ...window._plzT.watertight(c), vol: window._plzT.vol(c) } };
      s.dispose(); c.dispose();
    } catch (e) { out = { err: String(e) }; }
    Object.assign(_pilzP, bak);
    return out;
  }, { over: v.p });
  ok(v.name + ': Stiel wasserdicht', !r.err && r.stem.offen === 0 && r.stem.vol > 0,
     r.err || { offen: r.stem.offen, tris: r.stem.tris, vol: +r.stem.vol.toFixed(2) });
  ok(v.name + ': Hut wasserdicht', !r.err && r.cap.offen === 0 && r.cap.vol > 0,
     r.err || { offen: r.cap.offen, tris: r.cap.tris, vol: +r.cap.vol.toFixed(2) });
}

// ── 2+3: verschraubt — steckt irgendwas ineinander? ─────────────────────────
for (const v of [{ name: 'Standard', p: {} }, { name: 'Grob', p: { pitch: 5, threadH: 14, clr: 0.2 } },
                 { name: 'Fein/eng', p: { pitch: 2, clr: 0.1, bossPct: 75 } }]) {
  const r = await pg.evaluate(({ over }) => {
    const bak = { ..._pilzP };
    Object.assign(_pilzP, over);
    const d = _pilzDims(_pilzP);
    const stemG = _pilzStemGeo(_pilzP, 160), capG = _pilzCapGeo(_pilzP, 160);
    const capMesh = new THREE.Mesh(capG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    capMesh.updateMatrixWorld(true);
    // Hut in Gebrauchslage, plus 0,02 mm Luft: sonst meldet der Paritätstest die
    // planmäßige Berührung von Stielschulter und Buchsen-Unterkante als Treffer
    const lift = d.SH - d.yb + 0.002;
    const pos = stemG.attributes.position;
    let stecken = 0, geprueft = 0, minGap = 1e9;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < d.yb * 0.5) continue;            // nur was in den Hut hineinragt
      const P = new THREE.Vector3(pos.getX(i), y - lift, pos.getZ(i));   // in Hut-lokal
      if (P.y < -0.01) continue;
      geprueft++;
      if (window._plzT.inside(capMesh, P)) stecken++;
    }
    // Spalt im Gewinde: Loch-Radius minus Zapfen-Radius an denselben Stellen
    for (let a = 0; a < 24; a++) for (let j = 1; j < 12; j++) {
      const th = a / 24 * Math.PI * 2, yw = d.SH + (j / 12) * d.Ht;
      const nT = Math.max(26, Math.round((d.Ht / d.P) * 26)), dil = (d.holeTop - d.yb) / nT;
      const rs = _pilzThreadR(yw, th, d.SH, d.SH + d.Ht, d.rCore, d.rThreadOut, d.P, 0);
      const rh = _pilzThreadR(yw - lift, th, d.yb, d.holeTop, d.rCore, d.rThreadOut, d.P, dil) + d.clr;
      minGap = Math.min(minGap, rh - rs);
    }
    // Luft zwischen Stielkopf und Hut-Innenwand
    const kopfLuft = d.rInAtYb - d.rS1;
    // Breite des Auflagerings: darauf zieht der Hut fest, statt am Grund anzuschlagen
    const auflage = Math.min(d.rS1, d.rBoss) - (d.rThreadOut + d.clr);
    stemG.dispose(); capG.dispose();
    Object.assign(_pilzP, bak);
    return { stecken, geprueft, minGap: minGap * 10, kopfLuft: kopfLuft * 10, auflage: auflage * 10, HtMm: d.Ht * 10 };
  }, { over: v.p });
  ok(v.name + ': Stiel steckt nicht im Hut-Material', r.stecken === 0, r);
  ok(v.name + ': Gewinde hat überall Luft (≥0)', r.minGap >= -0.001, { minGapMm: +r.minGap.toFixed(3) });
  ok(v.name + ': Gewinde schlackert nicht (<1 mm Spalt)', r.minGap < 1.0, { minGapMm: +r.minGap.toFixed(3) });
  ok(v.name + ': Hut greift über den Stielkopf', r.kopfLuft > 0, { luftMm: +r.kopfLuft.toFixed(2) });
  ok(v.name + ': Auflagering trägt (≥0,5 mm breit)', r.auflage >= 0.5, { auflageMm: +r.auflage.toFixed(2) });
}

// ── 4b: nirgends dünner als eingestellt (sonst bricht das Teil beim Drucken) ─
for (const v of [{ name: 'Standard', p: {} }, { name: 'Flacher Hut', p: { capH: 32, capForm: 95 } },
                 { name: 'Spitzer Hut', p: { capH: 100, capForm: 0 } }, { name: 'Dünne Wand', p: { wall: 1.2 } }]) {
  const r = await pg.evaluate(({ over }) => {
    const bak = { ..._pilzP };
    Object.assign(_pilzP, over);
    const d = _pilzDims(_pilzP);
    // Hut: kürzester Abstand von der Innen- zur Außenkontur (beide in der r/y-Ebene)
    let minW = 1e9, wo = null;
    for (let i = 1; i <= 60; i++) {
      const ui = i / 61, q = d.inner(d.uRand + (d.uMeet - d.uRand) * ui), ri = q[0], yi = q[1];
      let best = 1e9;
      for (let j = 0; j <= 400; j++) { const uo = j / 400;
        best = Math.min(best, Math.hypot(d.R * d.F(uo) - ri, d.H * uo - yi)); }
      if (best < minW) { minW = best; wo = +(ui).toFixed(2); }
    }
    // Stiel: dünnste Stelle zwischen Rillengrund und Hohlraum, über die ganze Höhe
    let stielMin = 99;
    if (d.canHollow) for (let j = 0; j <= 60; j++) {
      const y = d.W + (j / 60) * (d.SH - d.W);
      const rAussen = (d.rS0 + (d.rS1 - d.rS0) * (y / d.SH)) - d.ribAmp;
      const rIn = Math.max(0.05, Math.min(rAussen - d.W, d.rBore + (d.SH - y)));
      stielMin = Math.min(stielMin, rAussen - rIn);
    }
    // und: hohl muss spürbar Material sparen, sonst bringt die Einstellung nichts
    const vollP = { ..._pilzP, hollow: 0 };
    const gh = _pilzStemGeo(_pilzP, 100), gv = _pilzStemGeo(vollP, 100);
    const anteil = window._plzT.vol(gh) / window._plzT.vol(gv);
    gh.dispose(); gv.dispose();
    const wall = _pilzP.wall;
    Object.assign(_pilzP, bak);
    return { hutMm: minW * 10, beiU: wo, stielMm: stielMin * 10, anteil, wallMm: wall, canHollow: d.canHollow };
  }, { over: v.p });
  ok(v.name + ': Hutwand nirgends zu dünn', r.hutMm >= r.wallMm * 0.92,
     { minMm: +r.hutMm.toFixed(2), sollMm: r.wallMm, beiU: r.beiU });
  ok(v.name + ': Stielwand hält die Vorgabe', r.stielMm >= r.wallMm * 0.98, { minMm: +r.stielMm.toFixed(2), sollMm: r.wallMm });
  ok(v.name + ': hohler Stiel spart Material', !r.canHollow || r.anteil < 0.6, { anteilVomVollen: +r.anteil.toFixed(2) });
}

// ── 5: zu flacher Hut wird gemeldet, nicht stillschweigend durchbohrt ───────
const flach = await pg.evaluate(() => {
  const bak = { ..._pilzP };
  Object.assign(_pilzP, { capDia: 60, capH: 28, overlap: 22, threadH: 20, wall: 3 });
  const d = _pilzDims(_pilzP);
  const g = _pilzCapGeo(_pilzP, 96);
  const w = window._plzT.watertight(g);
  const res = { okThread: d.okThread, okOverlap: d.okOverlap, HtMm: d.Ht * 10, holeTopMm: d.holeTop * 10, HiMm: d.Hi * 10, offen: w.offen };
  g.dispose(); Object.assign(_pilzP, bak);
  return res;
});
ok('Flacher Hut: Gewinde wird gekürzt statt durchzubrechen', flach.holeTopMm <= flach.HiMm - 1.4 && flach.offen === 0, flach);
ok('Flacher Hut: Hinweis wird gesetzt', flach.okThread === false && flach.okOverlap === false, flach);

// ── 6: Erstellen legt zwei Teile in Drucklage an ────────────────────────────
const created = await pg.evaluate(() => {
  const vor = objects.length;
  _pilzOpen();
  const sichtbar = document.getElementById('pilz-modal').classList.contains('show');
  _pilzCreate();
  const neu = objects.slice(vor);
  const box = o => { const b = new THREE.Box3().setFromObject(o); return { yMin: b.min.y, yMax: b.max.y }; };
  return { sichtbar, n: neu.length, namen: neu.map(o => o.userData.name), boxen: neu.map(box),
           zu: !document.getElementById('pilz-modal').classList.contains('show') };
});
ok('Dialog öffnet', created.sichtbar);
ok('Erstellen legt zwei Teile an', created.n === 2, created.namen);
ok('Beide Teile stehen auf der Platte (y=0)', created.boxen.every(b => Math.abs(b.yMin) < 0.02), created.boxen);
ok('Dialog schließt nach dem Erstellen', created.zu);

ok('Keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
