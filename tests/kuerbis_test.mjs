// Regressionstest für den Kürbis-Generator (🎃), Schwerpunkt auf den neuen
// Deko-Formen nach Vorbild der weichen Kürbis-Dosen:
//   1. alle Vorlagen bauen eine Vorschau ohne Ausnahme
//   2. Schulterdeckel: Körper + Deckel wasserdicht, Fuge läuft WELLIG
//   3. der Zentrierkragen ragt unter die Fuge, steckt aber nicht im Körper
//   4. Schale: ein Teil, oben offen (Hohlraum vorhanden), welliger Rand
//   5. Regression: Halloween (kleiner Kegeldeckel) und Massiv bauen weiter
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
  window._kbsT = {
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
    inside(mesh, pt) {
      const rc = new THREE.Raycaster(pt.clone(), new THREE.Vector3(0.5771, 0.5773, 0.5775).normalize(), 0, 1e4);
      rc.firstHitOnly = false;
      return rc.intersectObject(mesh, false).length % 2 === 1;
    },
    // baut den Kürbis über den echten Erstellen-Pfad und liefert die Teile
    async build(over) {
      const bak = { ..._kbsP };
      Object.assign(_kbsP, _KBS_DEFAULTS, over);
      const n0 = objects.length;
      try { await _kbsCreate(); } finally { Object.assign(_kbsP, bak); }
      if (objects.length === n0) return { err: 'nichts erstellt' };
      // seit v1.18.31 Körper und Deckel als eigene Objekte (keine Gruppe)
      const meshes = objects.slice(n0);
      return { meshes, root: meshes[0] };
    }
  };
});

// ── 1: Vorschau aller Vorlagen ─────────────────────────────────────────────
for (const v of ['halloween', 'deko', 'schale']) {
  const r = await pg.evaluate(k => {
    const bak = { ..._kbsP };
    Object.assign(_kbsP, _KBS_DEFAULTS, _KBS_PRESETS[k]);
    let out;
    try { const g = _kbsPreviewGeo(); out = { tris: (g.index ? g.index.count : g.attributes.position.count) / 3 }; g.dispose(); }
    catch (e) { out = { err: String(e) }; }
    Object.assign(_kbsP, bak);
    return out;
  }, v);
  ok('Vorschau ' + v, !r.err && r.tris > 1000, r.err || r);
}

// ── 2+3: Schulterdeckel (Deko-Dose) ────────────────────────────────────────
{
  const r = await pg.evaluate(async () => {
    const P = { ..._KBS_PRESETS.deko };
    const res = await window._kbsT.build(P);
    if (res.err) return res;
    const [body, lid] = res.meshes;
    const bak = { ..._kbsP }; Object.assign(_kbsP, _KBS_DEFAULTS, P);
    const cut = _kbsCutParams(_kbsP), sh = cut.sh;
    Object.assign(_kbsP, bak);
    const S = 0.1;                                   // mm → App-Units
    const bb = new THREE.Box3().setFromObject(body), lb = new THREE.Box3().setFromObject(lid);
    // Fugenkante am Körper: höchste Punkte je Winkelsektor → Wellenhöhe
    const pos = body.geometry.attributes.position;
    const sect = new Array(72).fill(-1e9);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x), k = Math.floor((a + Math.PI) / (2*Math.PI) * 72) % 72;
      if (y > sect[k]) sect[k] = y;
    }
    const hi = Math.max(...sect), lo = Math.min(...sect);
    // Kragen: steckt ein Deckelpunkt deutlich unter der Fuge im Körper?
    const bm = new THREE.Mesh(body.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    bm.updateMatrixWorld(true);
    const lp = lid.geometry.attributes.position;
    let unten = 0, stecken = 0;
    const yFuge = (cut.yCut - cut.amp) * S;
    for (let i = 0; i < lp.count; i++) {
      const y = lp.getY(i);
      if (y > yFuge - 0.02) continue;                // nur der Teil unter der Fuge
      unten++;
      if (window._kbsT.inside(bm, new THREE.Vector3(lp.getX(i), y, lp.getZ(i)))) stecken++;
    }
    return {
      teile: res.meshes.length,
      body: { ...window._kbsT.watertight(body.geometry), vol: window._kbsT.vol(body.geometry) },
      lid:  { ...window._kbsT.watertight(lid.geometry),  vol: window._kbsT.vol(lid.geometry) },
      welle: (hi - lo) / S, amp: cut.amp, yFuge,
      kragenPunkte: unten, stecken,
      bodyTop: bb.max.y, lidBot: lb.min.y
    };
  });
  ok('Deko-Dose: zwei Teile', !r.err && r.teile === 2, r.err || r.teile);
  if (!r.err) {
    ok('Deko-Dose: Körper wasserdicht', r.body.offen === 0 && r.body.vol > 0, { offen: r.body.offen, vol: +r.body.vol.toFixed(2) });
    ok('Deko-Dose: Deckel wasserdicht', r.lid.offen === 0 && r.lid.vol > 0, { offen: r.lid.offen, vol: +r.lid.vol.toFixed(2) });
    ok('Deko-Dose: Fuge läuft wellig', r.welle > r.amp * 1.2, { welleMm: +r.welle.toFixed(2), amp: +r.amp.toFixed(2) });
    ok('Deko-Dose: Kragen ragt unter die Fuge', r.kragenPunkte > 50, r.kragenPunkte);
    ok('Deko-Dose: Kragen klemmt nicht im Körper', r.stecken === 0, { stecken: r.stecken, von: r.kragenPunkte });
  }
}

// ── 4: Schale ──────────────────────────────────────────────────────────────
{
  const r = await pg.evaluate(async () => {
    const res = await window._kbsT.build({ ..._KBS_PRESETS.schale });
    if (res.err) return res;
    const g = res.meshes[0].geometry;
    const bb = new THREE.Box3().setFromObject(res.meshes[0]);
    const aussen = (bb.max.x-bb.min.x) * (bb.max.y-bb.min.y) * (bb.max.z-bb.min.z);
    return { teile: res.meshes.length, ...window._kbsT.watertight(g), vol: window._kbsT.vol(g), aussen,
             hoehe: bb.max.y - bb.min.y };
  });
  ok('Schale: ein Teil', !r.err && r.teile === 1, r.err || r.teile);
  if (!r.err) {
    ok('Schale: wasserdicht', r.offen === 0 && r.vol > 0, { offen: r.offen, vol: +r.vol.toFixed(2) });
    ok('Schale: ist wirklich hohl', r.vol < r.aussen * 0.25, { vol: +r.vol.toFixed(1), quader: +r.aussen.toFixed(1) });
  }
}

// ── 5: Regression Halloween + Massiv ───────────────────────────────────────
for (const v of [{ n: 'Halloween (Kegeldeckel)', p: {}, teile: 2 },
                 { n: 'Massiv', p: { modus: 'massiv' }, teile: 1 }]) {
  const r = await pg.evaluate(async over => {
    const res = await window._kbsT.build(over);
    if (res.err) return res;
    return { teile: res.meshes.length,
             teil: res.meshes.map(m => ({ ...window._kbsT.watertight(m.geometry), vol: window._kbsT.vol(m.geometry) })) };
  }, v.p);
  ok(v.n + ': Teilezahl', !r.err && r.teile === v.teile, r.err || r.teile);
  if (!r.err) ok(v.n + ': wasserdicht', r.teil.every(t => t.offen === 0 && t.vol > 0), r.teil.map(t => ({ o: t.offen, v: +t.vol.toFixed(1) })));
}

// ── 6: Grenzwerte des Wellenschnitts ───────────────────────────────────────
for (const v of [{ n: 'Fuge ganz unten, volle Welle', p: { lidH: 25, lidWave: 100 } },
                 { n: 'Fuge oben, waagerecht',       p: { lidH: 85, lidWave: 0 } },
                 { n: 'Kleiner Kürbis Ø50',          p: { dia: 50, wall: 1.6 } },
                 { n: 'Extremform',                  p: { bauch: 100, ribSharp: 100, ribDepth: 12 } }]) {
  const r = await pg.evaluate(async over => {
    const res = await window._kbsT.build({ ..._KBS_PRESETS.deko, ...over });
    if (res.err) return res;
    return { teile: res.meshes.length,
             teil: res.meshes.map(m => ({ ...window._kbsT.watertight(m.geometry), vol: window._kbsT.vol(m.geometry) })) };
  }, v.p);
  ok(v.n, !r.err && r.teile === 2 && r.teil.every(t => t.offen === 0 && t.vol > 0),
     r.err || r.teil.map(t => ({ o: t.offen, v: +t.vol.toFixed(1) })));
}

ok('keine JS-Fehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
