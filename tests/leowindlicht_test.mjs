// Regressionstest für das Leo-Windlicht (🐆, Kegel-Oberteil mit Leo-Relief + Sockel).
//
// Geprüft wird, was beim Drucken, Zusammenschrauben und Leuchten zählt:
//   1. Sockel und Oberteil sind WASSERDICHT, haben Volumen, das Netz bleibt handlich
//   2. Druck ohne Stützen: Sockelkontur und Kegel nicht steiler als der Überhang,
//      Sockelwand nirgends dünner als eingestellt
//   3. das Oberteil lässt sich auf dem ganzen Weg EINDREHEN, das Gewinde greift
//   4. verschraubt steckt nichts ineinander
//   5. das LED-Teelicht geht durch den Hals, liegt in der Mulde und reicht bis zur Kante
//   6. das Relief ist da (außen bzw. innen) und fehlt bei „Glatt“
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
  { name: 'Tupfen',          p: { motif: 'punkte' } },
  { name: 'Glatt',           p: { motif: 'glatt' } },
  { name: 'Relief innen',    p: { side: 'innen' } },
  { name: 'Klein 60',        p: { shadeDiaB: 60, shadeDiaT: 45, shadeH: 70, baseH: 30, lampH: 14, threadH: 6 } },
  { name: 'Groß 160',        p: { shadeDiaB: 160, shadeDiaT: 120, shadeH: 250, baseH: 70, pitch: 5, threadH: 14, lampD: 58 } },
  { name: 'Zylinder',        p: { shadeDiaT: 90 } },
  { name: 'Weit oben',       p: { shadeDiaT: 110 } },
  { name: 'Fuß eingezogen',  p: { foot: 55, belly: 125, overhang: 40 } },
  { name: 'Flacher Sockel',  p: { baseH: 25, lampH: 8 } },
  { name: 'Hohes Teelicht',  p: { lampH: 40 } },
  { name: 'Grobe Flecken',   p: { spot: 28, reliefH: 2 } },
];
for (const v of varianten) {
  const r = await pg.evaluate(({ over }) => {
    const bak = { ..._lwlP };
    Object.assign(_lwlP, over);
    let out;
    try {
      const d = _lwlDims(_lwlP);
      const s = _lwlBaseGeo(_lwlP, 'normal'), c = _lwlShadeGeo(_lwlP, 'normal');
      let maxOut = 0;
      for (let i = 1; i <= 400; i++) {
        const y0 = d.BH * (i - 1) / 400, y1 = d.BH * i / 400;
        maxOut = Math.max(maxOut, Math.abs(d.rOutB(y1) - d.rOutB(y0)) / (y1 - y0));
      }
      let wandB = Infinity;
      for (let i = 0; i <= 200; i++) { const y = d.Wf + (d.BH - d.Wf) * i / 200;
        let dm = Infinity; for (let j = 0; j <= 400; j++) { const yy = d.BH * j / 400; dm = Math.min(dm, Math.hypot(d.rInB(y) - d.rOutB(yy), y - yy)); }
        wandB = Math.min(wandB, dm); }
      const deg = t => Math.atan(t) * 180 / Math.PI;
      out = { okShade: d.okShade, okBase: d.okBase, okLamp: d.okLamp, okThread: d.okThread,
              baseOffen: window._plT.watertight(s), shadeOffen: window._plT.watertight(c),
              baseVol: window._plT.vol(s), shadeVol: window._plT.vol(c),
              shadeTris: c.index.count / 3, baseTris: s.index.count / 3,
              ueberhangSockel: +deg(maxOut).toFixed(1), ueberhangOber: +deg(Math.abs(d.k)).toFixed(1), soll: _lwlP.overhang,
              wandSockelMm: +(wandB * 10).toFixed(2), wandSoll: _lwlP.baseWall };
      s.dispose(); c.dispose();
    } catch (e) { out = { err: String(e && e.stack || e) }; }
    Object.assign(_lwlP, bak);
    return out;
  }, { over: v.p });
  if (r.err) { ok(v.name + ': baut ohne Fehler', false, r.err); continue; }
  ok(v.name + ': Maße gültig', r.okShade && r.okBase && r.okLamp && r.okThread, r);
  ok(v.name + ': Sockel wasserdicht', r.baseOffen === 0 && r.baseVol > 0, { offen: r.baseOffen, vol: +r.baseVol.toFixed(1) });
  ok(v.name + ': Oberteil wasserdicht', r.shadeOffen === 0 && r.shadeVol > 0, { offen: r.shadeOffen, vol: +r.shadeVol.toFixed(1) });
  ok(v.name + ': Netz handlich (Oberteil < 1,2 Mio. Dreiecke)', r.shadeTris < 1.2e6, { ober: r.shadeTris, sockel: r.baseTris });
  ok(v.name + ': Überhang eingehalten', r.ueberhangSockel <= r.soll + 0.5 && r.ueberhangOber <= r.soll, r);
  ok(v.name + ': Sockelwand nicht dünner als eingestellt', r.wandSockelMm >= r.wandSoll * 0.95, { wandMm: r.wandSockelMm, soll: r.wandSoll });
}

// ── 3+4+5: Schraubweg, verschraubter Zustand, Teelicht ──────────────────────
for (const v of [{ name: 'Standard', p: {} }, { name: 'Grob/lang', p: { pitch: 5, threadH: 14, clr: 0.2 } },
                 { name: 'Fein/eng', p: { pitch: 2, clr: 0.15, threadH: 6 } }]) {
  const r = await pg.evaluate(({ over }) => {
    const bak = { ..._lwlP };
    Object.assign(_lwlP, over, { motif: 'glatt' });
    const d = _lwlDims(_lwlP), TAU = Math.PI * 2;
    const male = (ys, th) => (ys < d.BH || ys > d.yTop) ? 0 : _pilzThreadR(ys, th, d.BH, d.yTop, d.rCore, d.rThreadOut, d.P, 0);
    let minWeg = 1e9, wo = null;
    for (let e = 0; e <= d.Ht + 0.05; e += 0.01)
      for (let yc = 0; yc <= d.fem.holeTop; yc += 0.004)
        for (let a = 0; a < 90; a++) {
          const th = a / 90 * TAU, ths = ((th - TAU * e / d.P) % TAU + TAU) % TAU;
          const g = _pilzFemR(d.fem, yc, th) - male(yc + d.BH + e, ths);
          if (g < minWeg) { minWeg = g; wo = { eMm: +(e * 10).toFixed(2), hMm: +(yc * 10).toFixed(2) }; }
        }
    let lochMin = 1e9;
    for (let yc = 0; yc <= d.fem.holeTop; yc += 0.004) for (let a = 0; a < 90; a++) lochMin = Math.min(lochMin, _pilzFemR(d.fem, yc, a / 90 * TAU));
    const baseG = _lwlBaseGeo(_lwlP, 'normal'), shadeG = _lwlShadeGeo(_lwlP, 'preview');
    const shade = new THREE.Mesh(shadeG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const baseM = new THREE.Mesh(baseG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    shade.updateMatrixWorld(true); baseM.updateMatrixWorld(true);
    const pos = baseG.attributes.position;
    let netzStecken = 0, netzGeprueft = 0;
    for (let s = 1; s <= 6; s++) {
      const e = d.Ht * s / 7, rot = TAU * e / d.P, c = Math.cos(rot), sn = Math.sin(rot);
      for (let i = 0; i < pos.count; i += 3) {
        const y = pos.getY(i); if (y <= d.BH + 0.01 || y > d.yTop) continue;
        const x = pos.getX(i), z = pos.getZ(i);
        if (Math.hypot(x, z) < d.rCore + 0.005) continue;
        const yc = y - d.BH - e - 0.002; if (yc < 0) continue;
        netzGeprueft++;
        if (window._plT.inside(shade, new THREE.Vector3(x * c - z * sn, yc, x * sn + z * c))) netzStecken++;
      }
    }
    let verschraubt = 0, vGeprueft = 0;
    for (let i = 0; i < pos.count; i += 3) {
      const y = pos.getY(i); if (y < d.BH - 0.01) continue;
      vGeprueft++;
      if (window._plT.inside(shade, new THREE.Vector3(pos.getX(i), y - d.BH - 0.002, pos.getZ(i)))) verschraubt++;
    }
    // Teelicht als Zylinder in der Mulde
    const rP = _lwlP.lampD / 20, hP = _lwlP.lampH / 10, yB = (d.ped ? d.yPB : d.Wf) + 0.002;
    let koll = 0;
    for (let a = 0; a < 48; a++) for (let j = 0; j <= 8; j++) for (const rr of [rP * 0.999, rP * 0.6]) {
      const th = a / 48 * TAU, y = yB + (hP - 0.004) * j / 8;
      const pt = new THREE.Vector3(rr * Math.cos(th), y, rr * Math.sin(th));
      if (window._plT.inside(baseM, pt)) koll++;
      if (window._plT.inside(shade, new THREE.Vector3(pt.x, y - d.BH, pt.z))) koll++;
    }
    let aufgelegt = 0;
    for (let a = 0; a < 24; a++) { const th = a / 24 * TAU, rr = rP * 0.7;
      if (window._plT.inside(baseM, new THREE.Vector3(rr * Math.cos(th), yB - 0.05, rr * Math.sin(th)))) aufgelegt++; }
    baseG.dispose(); shadeG.dispose();
    Object.assign(_lwlP, bak);
    return { minWegMm: +(minWeg * 10).toFixed(3), wo, eingriffMm: +((d.rThreadOut - lochMin) * 10).toFixed(2), tiefeMm: +(d.depth * 10).toFixed(2),
             netzStecken, netzGeprueft, verschraubt, vGeprueft, koll, aufgelegt,
             teelichtObenMm: +((yB + hP - d.BH) * 10).toFixed(1), durchHals: d.rNeckIn > rP };
  }, { over: v.p });
  ok(v.name + ': Oberteil lässt sich auf dem ganzen Weg eindrehen', r.minWegMm >= -0.001, r);
  ok(v.name + ': Gewinde greift (Eingriff ≥ halbe Gangtiefe)', r.eingriffMm >= r.tiefeMm * 0.5, { eingriffMm: r.eingriffMm, tiefeMm: r.tiefeMm });
  ok(v.name + ': Netz — Hals streift beim Eindrehen nicht', r.netzStecken === 0 && r.netzGeprueft > 50, { netzStecken: r.netzStecken, netzGeprueft: r.netzGeprueft });
  ok(v.name + ': verschraubt steckt nichts im Oberteil', r.verschraubt === 0 && r.vGeprueft > 100, { verschraubt: r.verschraubt, von: r.vGeprueft });
  ok(v.name + ': Teelicht passt (keine Kollision) und geht durch den Hals', r.koll === 0 && r.durchHals, { kollisionen: r.koll });
  ok(v.name + ': Teelicht liegt in der Mulde auf', r.aufgelegt === 24, { aufgelegt: r.aufgelegt });
  ok(v.name + ': Teelicht reicht bis an die Sockelkante', r.teelichtObenMm >= 0.5 && r.teelichtObenMm < 3, { obenMm: r.teelichtObenMm });
}

// ── 6: Relief vorhanden / bei Glatt nicht ────────────────────────────────────
const relief = await pg.evaluate(() => {
  const bak = { ..._lwlP };
  const mess = () => {
    const d = _lwlDims(_lwlP), g = _lwlShadeGeo(_lwlP, 'normal'), p = g.attributes.position;
    let aus = 0, inn = 0, n = 0, hoch = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
      if (y < d.yC + 0.4 || y > d.Hs - 0.3) continue;
      const dOut = (r - d.rOutS(y)) / d.sq, dIn = (d.rInS(y) - r) / d.sq;     // senkrecht zur Kegelwand
      if (Math.abs(dOut) < Math.abs(dIn)) { aus = Math.max(aus, dOut); n++; if (dOut > 0.02) hoch++; }
      else inn = Math.max(inn, dIn);
    }
    g.dispose(); return { ausMm: +(aus * 10).toFixed(2), innMm: +(inn * 10).toFixed(2), anteil: +(hoch / Math.max(1, n)).toFixed(2) };
  };
  const leo = mess();
  Object.assign(_lwlP, { side: 'innen' }); const innen = mess();
  Object.assign(_lwlP, { side: 'aussen', motif: 'glatt' }); const glatt = mess();
  Object.assign(_lwlP, bak);
  return { leo, innen, glatt, soll: _lwlP.reliefH };
});
ok('Relief außen steht heraus (≈ Relief-Höhe)', relief.leo.ausMm > relief.soll * 0.8 && relief.leo.ausMm < relief.soll * 1.2 && relief.leo.innMm < 0.05, relief.leo);
ok('Muster bedeckt einen sinnvollen Anteil (15–60 %)', relief.leo.anteil > 0.15 && relief.leo.anteil < 0.6, relief.leo);
ok('Relief innen: außen glatt, innen Relief', relief.innen.ausMm < 0.05 && relief.innen.innMm > relief.soll * 0.8, relief.innen);
ok('Glatt hat kein Relief', relief.glatt.ausMm < 0.05 && relief.glatt.innMm < 0.05, relief.glatt);

// ── 7: Fenster + Erstellen ───────────────────────────────────────────────────
await pg.click('#gen-dd-btn');
await pg.locator('#gen-dd-list .shp', { hasText: 'Leo-Windlicht' }).first().click();
await pg.waitForTimeout(800);
const ui = await pg.evaluate(() => ({ offen: document.getElementById('lwl-modal').classList.contains('show'),
  info: document.getElementById('lwl-info').textContent }));
ok('Fenster öffnet', ui.offen);
ok('Standard ohne Warnung', ui.info.length > 20 && !ui.info.includes('⚠'), ui.info.slice(0, 160));
if (process.env.SHOT) await pg.locator('#lwl-modal .g3box').screenshot({ path: process.env.SHOT });
const cr = await pg.evaluate(() => {
  const n0 = objects.length;
  _lwlCreate();
  const neu = objects.slice(n0);
  return { namen: neu.map(o => o.userData.name),
           unten: neu.map(o => { const bb = new THREE.Box3().setFromObject(o); return +bb.min.y.toFixed(3); }),
           keep: neu.map(o => Array.isArray(o.userData._dispKeep) && o.userData._dispKeep.length > 0),
           zu: !document.getElementById('lwl-modal').classList.contains('show') };
});
ok('Erstellen legt Sockel und Oberteil an', cr.namen.length === 2 && /Sockel/.test(cr.namen[0]) && /Oberteil/.test(cr.namen[1]), cr.namen);
ok('Beide Teile stehen auf der Platte (y=0)', cr.unten.every(y => Math.abs(y) < 0.005), cr.unten);
ok('Textur-Schutzzonen gesetzt', cr.keep.every(Boolean), cr.keep);
ok('Fenster schließt nach dem Erstellen', cr.zu);
ok('Keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors);

await b.close();
if (fails.length) { console.log(`\n${fails.length} FEHLER: ${fails.join(', ')}`); process.exit(1); }
console.log('\nAlles grün.');
