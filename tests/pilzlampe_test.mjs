// Regressionstest für die Pilzlampe (🍄💡, Schirm mit Relief + gerippter Fuß).
//
// Geprüft wird, was beim Drucken, Zusammenschrauben und Leuchten zählt:
//   1. Fuß und Schirm sind WASSERDICHT, haben Volumen, das Netz bleibt handlich
//   2. Druck ohne Stützen: Schirmkontur nirgends steiler als der eingestellte Überhang,
//      Schirmwand nirgends dünner als eingestellt
//   3. der Schirm lässt sich auf dem ganzen Weg EINDREHEN (Schraubweg abfahren,
//      analytisch und am Netz — die Lehre aus Ralfs Pilz) und das Gewinde greift
//   4. verschraubt steckt nichts ineinander
//   5. der LED-Puck passt in den Napf, liegt auf und ragt in den Schirm
//   6. das Relief ist da (und fehlt bei „Glatt")
//   7. Erstellen legt zwei Teile auf die Platte, Fenster ohne Warnung und ohne JS-Fehler
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
  window._plT = {
    watertight(geo) {
      const p = geo.attributes.position, idx = geo.index, n = idx ? idx.count : p.count;
      const key = i => { const j = idx ? idx.getX(i) : i;
        return Math.round(p.getX(j)*1e4)+','+Math.round(p.getY(j)*1e4)+','+Math.round(p.getZ(j)*1e4); };
      const m = new Map();
      for (let t = 0; t < n; t += 3) {
        const a = key(t), b2 = key(t+1), c = key(t+2);
        if (a===b2 || b2===c || a===c) continue;
        for (const [u,v] of [[a,b2],[b2,c],[c,a]]) m.set(u+'|'+v, (m.get(u+'|'+v)||0)+1);
      }
      let bad = 0;
      for (const [k,v] of m) { const [u,w] = k.split('|'); if (v !== 1 || (m.get(w+'|'+u)||0) !== 1) bad++; }
      return bad;
    },
    vol(geo) {
      const p = geo.attributes.position, ix = geo.index.array; let V = 0;
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t], b2 = ix[t+1], c = ix[t+2];
        const ax=p.getX(a),ay=p.getY(a),az=p.getZ(a),bx=p.getX(b2),by=p.getY(b2),bz=p.getZ(b2),cx=p.getX(c),cy=p.getY(c),cz=p.getZ(c);
        V += ax*(by*cz-bz*cy) - ay*(bx*cz-bz*cx) + az*(bx*cy-by*cx);
      }
      return V / 6;
    },
    inside(mesh, pt) {
      const rc = new THREE.Raycaster(pt.clone(), new THREE.Vector3(0.5771, 0.5773, 0.5775).normalize(), 0, 1e4);
      return rc.intersectObject(mesh, false).length % 2 === 1;
    }
  };
});

// ── 1+2: Varianten bauen ─────────────────────────────────────────────────────
const varianten = [
  { name: 'Standard',        p: {} },
  { name: 'Gräser',          p: { motif: 'graeser' } },
  { name: 'Glatt',           p: { motif: 'glatt' } },
  { name: 'Klein 90',        p: { shadeDia: 90, stemDia: 50, stemH: 50, threadH: 6 } },
  { name: 'Groß 240',        p: { shadeDia: 240, stemDia: 130, stemH: 180, pitch: 5, threadH: 16 } },
  { name: 'Flacher Schirm',  p: { shadeH: 48, equator: 25 } },
  { name: 'Hoher Schirm',    p: { shadeH: 100, equator: 60, round: 3.5 } },
  { name: 'Überhang 40°',    p: { overhang: 40 } },
  { name: 'Kantig',          p: { round: 1.4, shadeWall: 0.8 } },
  { name: 'Taille',          p: { belly: -20, ribs: 0 } },
  { name: 'Großer Puck',     p: { lampD: 60 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(({ over }) => {
    const bak = { ..._plpP };
    Object.assign(_plpP, over);
    let out;
    try {
      const d = _plpDims(_plpP);
      const s = _plpStemGeo(_plpP, 'normal'), c = _plpShadeGeo(_plpP, 'normal');
      // Überhang: Außenkontur (ohne Relief) und Innenseite, Steigung |dr/dy|
      let maxOut = 0, maxIn = 0;
      for (let i = 1; i <= 400; i++) {
        const y0 = d.Hs * (i - 1) / 400, y1 = d.Hs * i / 400;
        maxOut = Math.max(maxOut, Math.abs(d.rOut(y1) - d.rOut(y0)) / (y1 - y0));
      }
      for (let i = 1; i < d.inner.length; i++) {
        const [r0, y0] = d.inner[i - 1], [r1, y1] = d.inner[i];
        if (y1 - y0 > 1e-4) maxIn = Math.max(maxIn, Math.abs(r1 - r0) / (y1 - y0));
      }
      const deg = t => Math.atan(t) * 180 / Math.PI;
      out = { okShade: d.okShade, okCup: d.okCup, okThread: d.okThread,
              stemOffen: window._plT.watertight(s), shadeOffen: window._plT.watertight(c),
              stemVol: window._plT.vol(s), shadeVol: window._plT.vol(c),
              shadeTris: c.index.count / 3, stemTris: s.index.count / 3,
              ueberhangAussen: +deg(maxOut).toFixed(1), ueberhangInnen: +deg(maxIn).toFixed(1), soll: _plpP.overhang,
              wandMm: +(d.wallMin * 10).toFixed(2), wandSoll: _plpP.shadeWall };
      s.dispose(); c.dispose();
    } catch (e) { out = { err: String(e && e.stack || e) }; }
    Object.assign(_plpP, bak);
    return out;
  }, { over: v.p });
  if (r.err) { ok(v.name + ': baut ohne Fehler', false, r.err); continue; }
  ok(v.name + ': Maße gültig', r.okShade && r.okCup && r.okThread, r);
  ok(v.name + ': Fuß wasserdicht', r.stemOffen === 0 && r.stemVol > 0, { offen: r.stemOffen, vol: +r.stemVol.toFixed(1) });
  ok(v.name + ': Schirm wasserdicht', r.shadeOffen === 0 && r.shadeVol > 0, { offen: r.shadeOffen, vol: +r.shadeVol.toFixed(1) });
  ok(v.name + ': Netz handlich (Schirm < 1,2 Mio. Dreiecke)', r.shadeTris < 1.2e6, { shade: r.shadeTris, fuss: r.stemTris });
  ok(v.name + ': Überhang eingehalten (außen+innen)', r.ueberhangAussen <= r.soll + 0.5 && r.ueberhangInnen <= r.soll + 1.5, r);
  ok(v.name + ': Schirmwand nicht dünner als eingestellt', r.wandMm >= r.wandSoll * 0.97, { wandMm: r.wandMm, soll: r.wandSoll });
}

// ── 3+4+5: Schraubweg, verschraubter Zustand, LED-Puck ──────────────────────
for (const v of [{ name: 'Standard', p: {} }, { name: 'Grob/lang', p: { pitch: 5, threadH: 16, clr: 0.2 } },
                 { name: 'Fein/eng', p: { pitch: 2, clr: 0.15, threadH: 7 } }]) {
  const r = await pg.evaluate(({ over }) => {
    const bak = { ..._plpP };
    Object.assign(_plpP, over, { motif: 'glatt' });                     // Kollisionstests brauchen kein Relief
    const d = _plpDims(_plpP), TAU = Math.PI * 2;
    const male = (ys, th) => (ys < d.SH || ys > d.yTop) ? 0 : _pilzThreadR(ys, th, d.SH, d.yTop, d.rCore, d.rThreadOut, d.P, 0);
    let minWeg = 1e9, wo = null;
    for (let e = 0; e <= d.Ht + 0.05; e += 0.01)
      for (let yc = 0; yc <= d.fem.holeTop; yc += 0.004)
        for (let a = 0; a < 90; a++) {
          const th = a / 90 * TAU, ths = ((th - TAU * e / d.P) % TAU + TAU) % TAU;
          const g = _pilzFemR(d.fem, yc, th) - male(yc + d.SH + e, ths);
          if (g < minWeg) { minWeg = g; wo = { eMm: +(e * 10).toFixed(2), hMm: +(yc * 10).toFixed(2) }; }
        }
    let lochMin = 1e9;
    for (let yc = 0; yc <= d.fem.holeTop; yc += 0.004) for (let a = 0; a < 90; a++) lochMin = Math.min(lochMin, _pilzFemR(d.fem, yc, a / 90 * TAU));
    const stemG = _plpStemGeo(_plpP, 'preview'), shadeG = _plpShadeGeo(_plpP, 'preview');
    const shade = new THREE.Mesh(shadeG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const stemM = new THREE.Mesh(stemG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    shade.updateMatrixWorld(true); stemM.updateMatrixWorld(true);
    const pos = stemG.attributes.position;
    // Netz beim Eindrehen: Zapfenwinkel ths = th − 2πe/P  →  im Schirm th = ths + 2πe/P
    let netzStecken = 0, netzGeprueft = 0;
    for (let s = 1; s <= 6; s++) {
      const e = d.Ht * s / 7, rot = TAU * e / d.P, c = Math.cos(rot), sn = Math.sin(rot);
      for (let i = 0; i < pos.count; i += 2) {
        const y = pos.getY(i); if (y <= d.SH + 0.01 || y > d.yTop) continue;
        const x = pos.getX(i), z = pos.getZ(i);
        if (Math.hypot(x, z) < d.rCore + 0.005) continue;
        const yc = y - d.SH - e - 0.002; if (yc < 0) continue;
        netzGeprueft++;
        if (window._plT.inside(shade, new THREE.Vector3(x * c - z * sn, yc, x * sn + z * c))) netzStecken++;
      }
    }
    // Verschraubt: Fuß-Vertices oberhalb der Schulter dürfen nicht im Schirm stecken
    let verschraubt = 0, vGeprueft = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i); if (y < d.SH - 0.01) continue;
      vGeprueft++;
      if (window._plT.inside(shade, new THREE.Vector3(pos.getX(i), y - d.SH - 0.002, pos.getZ(i)))) verschraubt++;
    }
    // LED-Puck als Zylinder: Mantel- und Bodenpunkte dürfen weder im Fuß noch im Schirm stecken
    const rP = _plpP.lampD / 20, hP = 2.1, yB = d.yLedge + 0.002;
    let puckKoll = 0;
    for (let a = 0; a < 48; a++) for (let j = 0; j <= 8; j++) for (const rr of [rP * 0.999, rP * 0.6]) {
      const th = a / 48 * TAU, y = yB + hP * j / 8;
      const pt = new THREE.Vector3(rr * Math.cos(th), y, rr * Math.sin(th));
      if (window._plT.inside(stemM, pt)) puckKoll++;
      if (window._plT.inside(shade, new THREE.Vector3(pt.x, y - d.SH, pt.z))) puckKoll++;
    }
    // liegt er auf? Direkt unter dem Puckrand muss Material sein
    let aufgelegt = 0;
    for (let a = 0; a < 24; a++) { const th = a / 24 * TAU, rr = (d.rStop + d.rPuck) / 2;
      if (window._plT.inside(stemM, new THREE.Vector3(rr * Math.cos(th), d.yLedge - 0.05, rr * Math.sin(th)))) aufgelegt++; }
    stemG.dispose(); shadeG.dispose();
    Object.assign(_plpP, bak);
    return { minWegMm: +(minWeg * 10).toFixed(3), wo, eingriffMm: +((d.rThreadOut - lochMin) * 10).toFixed(2), tiefeMm: +(d.depth * 10).toFixed(2),
             netzStecken, netzGeprueft, verschraubt, vGeprueft, puckKoll, aufgelegt,
             puckUeberstandMm: +((yB + hP - d.yTop) * 10).toFixed(1) };
  }, { over: v.p });
  ok(v.name + ': Schirm lässt sich auf dem ganzen Weg eindrehen', r.minWegMm >= -0.001, r);
  ok(v.name + ': Gewinde greift (Eingriff ≥ halbe Gangtiefe)', r.eingriffMm >= r.tiefeMm * 0.5, { eingriffMm: r.eingriffMm, tiefeMm: r.tiefeMm });
  ok(v.name + ': Netz — Zapfen streift beim Eindrehen nicht', r.netzStecken === 0 && r.netzGeprueft > 50, { netzStecken: r.netzStecken, netzGeprueft: r.netzGeprueft });
  ok(v.name + ': verschraubt steckt nichts im Schirm', r.verschraubt === 0 && r.vGeprueft > 100, { verschraubt: r.verschraubt, von: r.vGeprueft });
  ok(v.name + ': LED-Puck passt (keine Kollision)', r.puckKoll === 0, { kollisionen: r.puckKoll });
  ok(v.name + ': LED-Puck liegt rundum auf', r.aufgelegt === 24, { aufgelegt: r.aufgelegt });
  ok(v.name + ': LED-Puck ragt über den Hals in den Schirm', r.puckUeberstandMm > 5, { ueberstandMm: r.puckUeberstandMm });
}

// ── 6: Relief vorhanden / bei Glatt nicht ────────────────────────────────────
const relief = await pg.evaluate(() => {
  const bak = { ..._plpP };
  const d = _plpDims(_plpP);
  const maxAbw = () => {
    const g = _plpShadeGeo(_plpP, 'normal'), p = g.attributes.position;
    let m = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
      if (y < 0.3 || y > d.Hs - 0.3 || r < d.rOut(y) - 0.05) continue;     // nur Außenhaut
      if (r - d.rOut(y) < 0.02) continue;
      // Relief steht senkrecht zur Fläche: Abstand zur Kontur, nicht radial messen
      let dm = Infinity;
      for (let k = -40; k <= 40; k++) { const yy = y + k * 0.005; dm = Math.min(dm, Math.hypot(r - d.rOut(yy), y - yy)); }
      m = Math.max(m, dm);
    }
    g.dispose(); return m * 10;
  };
  const aehren = maxAbw();
  Object.assign(_plpP, { motif: 'glatt' }); const glatt = maxAbw();
  Object.assign(_plpP, bak);
  return { aehrenMm: +aehren.toFixed(2), glattMm: +glatt.toFixed(2), soll: _plpP.reliefH };
});
ok('Relief steht heraus (≈ Relief-Höhe)', relief.aehrenMm > relief.soll * 0.6 && relief.aehrenMm < relief.soll * 1.3, relief);
ok('Glatt hat kein Relief', relief.glattMm < 0.05, relief);

// ── 7: Fenster + Erstellen ───────────────────────────────────────────────────
// Echter Klickweg: Generator-Menü → Eintrag „Pilzlampe" (nicht nur _plpOpen() aufrufen)
await pg.click('#gen-dd-btn');
await pg.locator('#gen-dd-list .shp', { hasText: 'Pilzlampe' }).first().click();
await pg.waitForTimeout(800);
const ui = await pg.evaluate(() => ({ offen: document.getElementById('plp-modal').classList.contains('show'),
  info: document.getElementById('plp-info').textContent }));
ok('Fenster öffnet', ui.offen);
ok('Standard ohne Warnung', ui.info.length > 20 && !ui.info.includes('⚠'), ui.info.slice(0, 160));
const cr = await pg.evaluate(() => {
  const n0 = objects.length;
  _plpCreate();
  const neu = objects.slice(n0);
  return { namen: neu.map(o => o.userData.name),
           unten: neu.map(o => { const bb = new THREE.Box3().setFromObject(o); return +bb.min.y.toFixed(3); }),
           keep: neu.map(o => Array.isArray(o.userData._dispKeep) && o.userData._dispKeep.length > 0),
           zu: !document.getElementById('plp-modal').classList.contains('show') };
});
ok('Erstellen legt Fuß und Schirm an', cr.namen.length === 2 && /Fuß/.test(cr.namen[0]) && /Schirm/.test(cr.namen[1]), cr.namen);
ok('Beide Teile stehen auf der Platte (y=0)', cr.unten.every(y => Math.abs(y) < 0.005), cr.unten);
ok('Textur-Schutzzonen gesetzt', cr.keep.every(Boolean), cr.keep);
ok('Fenster schließt nach dem Erstellen', cr.zu);
ok('Keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors);

await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER: ${fails.join(', ')}`); process.exit(1); }
console.log('\nAlles grün.');
