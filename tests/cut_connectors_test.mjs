// Regressionstest für die Verbinder beim ✂ Schneiden (Stift / Schwalbenschwanz /
// Gewindebolzen).
//
// Geprüft wird, was beim Drucken und Zusammensetzen zählt:
//   1. Passstift (Altbestand) funktioniert unverändert: 2 Teile, beide wasserdicht
//   2. Schwalbenschwanz: Zunge an Teil A, Öffnung in Teil B, durch die GANZE
//      Materialdicke, am Kopf breiter als am Hals (hält gegen Auseinanderziehen),
//      und die Öffnung ist GRÖSSER als die Zunge (sonst klemmt es)
//   3. Gewinde: es entstehen 3 Objekte (2 Hälften + Bolzen), in BEIDEN Hälften
//      sitzt an der Verbinderstelle wirklich ein Loch (Punkt-im-Körper per
//      Raycast), daneben steht Material, und der Bolzen hat Soll-Maß
//   4. Mischbetrieb Gewinde + Stift (die empfohlene Verdrehsicherung) läuft durch
//   5. ⚡ Auto legt im Gewinde-Modus genau EINEN Bolzen und sonst Stifte an
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
try {   // Sitzungs-Cookie, damit der Test auch gegen die Auslieferung (8765) läuft
  const sess = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('cut-test','test@lokal'))"],
                            { cwd: process.cwd(), encoding: 'utf8' }).trim();
  await ctx.addCookies([{ name: 'v3dsess', value: sess, domain: new global.URL(URL).hostname,
                          path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
} catch (e) { /* Dev-Server braucht keins */ }
const pg = await ctx.newPage();
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
pg.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

// Werkzeugkasten in der Seite
await pg.evaluate(() => {
  window._ctT = {
    watertight(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const key = i => { const j = idx ? idx.getX(i) : i;
        return Math.round(p.getX(j)*1e4)+','+Math.round(p.getY(j)*1e4)+','+Math.round(p.getZ(j)*1e4); };
      const m = new Map();
      for (let t = 0; t < n; t += 3) {
        const a = key(t), b2 = key(t+1), c = key(t+2);
        if (a===b2 || b2===c || a===c) continue;
        [[a,b2],[b2,c],[c,a]].forEach(([x,y]) => {
          const k = x < y ? x+'|'+y : y+'|'+x;
          m.set(k, (m.get(k)||0) + (x<y?1:-1));
        });
      }
      let offen = 0; m.forEach(v => { if (v !== 0) offen++; });
      return offen;
    },
    vol(mesh) {                              // Volumen in mm³ (Weltmaß)
      mesh.updateMatrixWorld(true);
      const g = mesh.geometry, p = g.attributes.position, idx = g.index;
      const n = idx ? idx.count : p.count, M = mesh.matrixWorld;
      const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
      let v6 = 0;
      for (let t = 0; t < n; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t+1) : t+1, i2 = idx ? idx.getX(t+2) : t+2;
        va.fromBufferAttribute(p, i0).applyMatrix4(M);
        vb.fromBufferAttribute(p, i1).applyMatrix4(M);
        vc.fromBufferAttribute(p, i2).applyMatrix4(M);
        v6 += va.dot(vb.clone().cross(vc));
      }
      return Math.abs(v6 / 6) * 1000;        // Units³ → mm³
    },
    // Punkt im Körper? Parität der Ray-Treffer in eine feste Richtung
    inside(mesh, pt) {
      mesh.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      ray.far = 1e5;
      ray.set(new THREE.Vector3(...pt), new THREE.Vector3(0.3714, 0.5571, 0.7428).normalize());
      const hits = ray.intersectObject(mesh, true).filter(h => h.distance > 1e-5);
      return hits.length % 2 === 1;
    },
    reset() {
      if (typeof exitSpecialMode === 'function') exitSpecialMode();
      objects.slice().forEach(o => scene.remove(o));
      objects.length = 0; deselect(); updateTree();
    },
    // Würfel 40 mm, Verbinder setzen, schneiden. conns = [{u,v,kind}]
    async schneide(conns, params) {
      this.reset();
      addShape('box');
      const box = objects[objects.length - 1];
      box.scale.set(2, 2, 2);                       // 40 mm Kantenlänge
      box.updateMatrixWorld(true);
      const v0 = this.vol(box);
      selectObjs([box]);
      openCutTool();
      Object.assign(_cut.cParams, params || {});
      _cut.connectors = conns.map(c => ({ ...c }));
      const n = _cutNormal().clone();
      const wps = _cut.connectors.map(c => _cutInPlaneToWorld(c).toArray());
      const el = document.getElementById('cut-lay'); if (el) el.checked = false;
      await _cutExecute();
      return { v0, n: n.toArray(), wps };
    },
  };
});

// ── 0. Bedienung im Panel (echte Klicks, nicht nur die Funktionen dahinter) ──
{
  await pg.evaluate(() => {
    window._ctT.reset();
    addShape('box');
    selectObjs([objects[0]]);
    openCutTool();
  });
  const knoepfe = await pg.$$('.cut-ct');
  ok('Panel: drei Verbinder-Typen', knoepfe.length === 3);
  await pg.click('.cut-ct[data-ct="thread"]');
  const nachThread = await pg.evaluate(() => ({
    typ: _cut.cParams.type,
    felder: [...document.querySelectorAll('#cut-conn-params input, #cut-conn-params select')].map(e => e.id),
    hinweis: document.getElementById('cut-conn-params').textContent.includes('Bolzen M6'),
  }));
  ok('Panel: Klick auf Gewinde schaltet um', nachThread.typ === 'thread', nachThread.typ);
  ok('Panel: Gewinde-Felder erscheinen', nachThread.felder.includes('cut-ts') && nachThread.felder.includes('cut-td'), nachThread.felder);
  ok('Panel: Bolzenmaß wird angezeigt', nachThread.hinweis);
  await pg.click('.cut-ct[data-ct="dove"]');
  const nachDove = await pg.evaluate(() => ({
    typ: _cut.cParams.type,
    felder: [...document.querySelectorAll('#cut-conn-params input')].map(e => e.id),
  }));
  ok('Panel: Klick auf Schwalbe schaltet um', nachDove.typ === 'dove' && nachDove.felder.includes('cut-dw') && !nachDove.felder.includes('cut-da'), nachDove);
  // Schwalbenschwänze setzt die Bauart-Wahl von selbst — ohne Klick auf die Ebene
  const marker = await pg.evaluate(() => ({
    n: _cut.markers.length, kinds: _cut.connectors.map(c => c.kind), auto: _cut.doveAuto,
    zaehler: document.getElementById('cut-conn-cnt').textContent }));
  ok('Panel: Schwalbe wird automatisch gesetzt', marker.n >= 1 && marker.auto &&
     marker.kinds.every(k => k === 'dove') && marker.zaehler === String(marker.n), marker);
  await pg.evaluate(() => _cutClose());
}

// ── 1. Passstift (Regression) ───────────────────────────────────────────────
{
  const r = await pg.evaluate(async () => {
    const t = window._ctT;
    const res = await t.schneide([{ u: 0, v: 0, kind: 'pin' }]);
    return {
      n: objects.length,
      namen: objects.map(o => o.userData.name),
      offen: objects.map(o => t.watertight(o.geometry)),
      vols: objects.map(o => t.vol(o)),
      v0: res.v0,
    };
  });
  ok('Stift: 2 Teile', r.n === 2, r.namen);
  ok('Stift: beide wasserdicht', r.offen.every(x => x === 0), r.offen);
  ok('Stift: Zapfen in A, Loch in B', r.vols[0] > r.v0 / 2 && r.vols[1] < r.v0 / 2,
     { A: Math.round(r.vols[0]), B: Math.round(r.vols[1]), halb: Math.round(r.v0 / 2) });
}

// ── 2. Schwalbenschwanz ─────────────────────────────────────────────────────
// Würfel waagerecht geschnitten: Zunge ragt 9 mm nach oben in Teil B, Kopf 12 mm
// breit (Hals 6,6 mm), läuft in X durch den ganzen Würfel.
{
  const r = await pg.evaluate(async () => {
    const t = window._ctT;
    const res = await t.schneide([{ u: 0, v: 0, kind: 'dove' }], { dW: 12, dL: 9, dClr: 0.2 });
    const n = new THREE.Vector3(...res.n), wp = new THREE.Vector3(...res.wps[0]);
    const { U, V } = _cutBasis(n);            // T = U (Schnittlinie), D = V (Dicke)
    const P = (s, tt, d) => wp.clone().addScaledVector(n, s).addScaledVector(U, tt).addScaledVector(V, d).toArray();
    const A = objects[0], B = objects[1];
    return { n: objects.length, offen: objects.map(o => t.watertight(o.geometry)),
             vols: objects.map(o => t.vol(o)), v0: res.v0,
             kopfA: t.inside(A, P(0.7, 0.45, 0.03)), kopfB: t.inside(B, P(0.7, 0.45, 0.03)),
             halsA: t.inside(A, P(0.1, 0.45, 0.03)), halsB: t.inside(B, P(0.1, 0.45, 0.03)),
             durch: [-1.8, 1.8].map(d => t.inside(A, P(0.5, 0.02, d))),
             ueber: t.inside(A, P(1.1, 0.02, 0.03)) };
  });
  const halb = r.v0 / 2, zapfen = r.vols[0] - halb, tasche = halb - r.vols[1];
  ok('Schwalbe: 2 Teile', r.n === 2);
  ok('Schwalbe: beide wasserdicht', r.offen.every(x => x === 0), r.offen);
  ok('Schwalbe: Zunge hat Soll-Volumen (Trapez × 40 mm)', Math.abs(zapfen - (6 + 3.3) * 9 * 40) < 150, { zapfen_mm3: Math.round(zapfen) });
  ok('Schwalbe: Öffnung größer als Zunge (Spiel)', tasche > zapfen,
     { zapfen: Math.round(zapfen), tasche: Math.round(tasche) });
  ok('Schwalbe: Kopf gehört zu Teil A, nicht zu B', r.kopfA && !r.kopfB, r);
  ok('Schwalbe: neben dem Hals steht Teil B (Hinterschnitt)', r.halsB && !r.halsA, r);
  ok('Schwalbe: Zunge läuft durch die ganze Dicke', r.durch.every(Boolean), r.durch);
  ok('Schwalbe: Zunge endet nach 9 mm', !r.ueber);
}

// ── 3. Gewindebolzen ────────────────────────────────────────────────────────
{
  const r = await pg.evaluate(async () => {
    const t = window._ctT;
    const res = await t.schneide([{ u: 0, v: 0, kind: 'thread' }],
                                 { tSize: 'M6', tDepth: 8, tClr: 0.4 });
    const n = new THREE.Vector3(...res.n), wp = new THREE.Vector3(...res.wps[0]);
    const A = objects[0], B = objects[1], bolt = objects[2];
    // 3 mm ins Material hinein, auf der Achse → muss LEER sein
    const inA = wp.clone().addScaledVector(n, -0.3);
    const inB = wp.clone().addScaledVector(n,  0.3);
    // 8 mm seitlich versetzt (quer zur Normalen) → dort muss Material stehen
    const quer = new THREE.Vector3(1, 0, 0).cross(n).lengthSq() > 0.1
               ? new THREE.Vector3(1, 0, 0).cross(n).normalize()
               : new THREE.Vector3(0, 0, 1).cross(n).normalize();
    const refA = inA.clone().addScaledVector(quer, 0.8);
    const refB = inB.clone().addScaledVector(quer, 0.8);
    bolt.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(bolt);
    return {
      n: objects.length,
      namen: objects.map(o => o.userData.name),
      offen: objects.map(o => t.watertight(o.geometry)),
      lochA: !t.inside(A, inA.toArray()), matA: t.inside(A, refA.toArray()),
      lochB: !t.inside(B, inB.toArray()), matB: t.inside(B, refB.toArray()),
      boltD: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 10,
      boltH: (bb.max.y - bb.min.y) * 10,
      boltUnten: bb.min.y * 10,
      vols: objects.map(o => t.vol(o)), v0: res.v0,
    };
  });
  ok('Gewinde: 2 Teile + 1 Bolzen', r.n === 3, r.namen);
  ok('Gewinde: alle Teile wasserdicht', r.offen.every(x => x === 0), r.offen);
  ok('Gewinde: Loch in Teil A', r.lochA);
  ok('Gewinde: Material neben dem Loch in A', r.matA);
  ok('Gewinde: Loch in Teil B', r.lochB);
  ok('Gewinde: Material neben dem Loch in B', r.matB);
  ok('Gewinde: Bolzen Ø ≈ M6', Math.abs(r.boltD - 6) < 0.4, { d: +r.boltD.toFixed(2) });
  ok('Gewinde: Bolzenlänge = 2×8 − 1,5 mm', Math.abs(r.boltH - 14.5) < 1.2, { h: +r.boltH.toFixed(2) });
  ok('Gewinde: Bolzen steht auf der Platte', Math.abs(r.boltUnten) < 0.05, { y: +r.boltUnten.toFixed(3) });
  ok('Gewinde: Löcher kosten Material', r.vols[0] + r.vols[1] < r.v0 - 200,
     { summe: Math.round(r.vols[0] + r.vols[1]), v0: Math.round(r.v0) });
}

// ── 4. Mischbetrieb Gewinde + Stift ─────────────────────────────────────────
{
  const r = await pg.evaluate(async () => {
    const t = window._ctT;
    await t.schneide([{ u: 0, v: 0, kind: 'thread' }, { u: 1.2, v: 0, kind: 'pin' }],
                     { tSize: 'M6', tDepth: 8, tClr: 0.4, d: 5, L: 6, clr: 0.15 });
    return { n: objects.length, offen: objects.map(o => t.watertight(o.geometry)) };
  });
  ok('Misch: 2 Teile + 1 Bolzen', r.n === 3);
  ok('Misch: alle wasserdicht', r.offen.every(x => x === 0), r.offen);
}

// ── 5. ⚡ Auto im Gewinde-Modus ─────────────────────────────────────────────
{
  const r = await pg.evaluate(() => {
    const t = window._ctT;
    t.reset();
    addShape('box');
    const box = objects[objects.length - 1];
    box.scale.set(4, 2, 2);                        // 80 × 40 × 40 mm → Platz für mehrere
    box.updateMatrixWorld(true);
    selectObjs([box]);
    openCutTool();
    _cut.cParams.type = 'thread';
    _cutAutoConnectors();
    const kinds = _cut.connectors.map(c => c.kind);
    _cutClose();
    return { kinds };
  });
  ok('Auto: genau ein Gewinde', r.kinds.filter(k => k === 'thread').length === 1, r.kinds);
  ok('Auto: mindestens eine Verdrehsicherung', r.kinds.filter(k => k !== 'thread').length >= 1, r.kinds);
}

// ── 6. Passung: steckt der Bolzen irgendwo im Material? ─────────────────────
// Prüfkörper ist ein Gewindestab mit SOLL-Durchmesser in exakt der Lage und
// Phase, in der das Loch geschnitten wurde (derselbe Aufruf, nur ohne Spiel).
// Kein Punkt davon darf im Material einer Hälfte stecken — sonst klemmt es.
{
  const r = await pg.evaluate(async () => {
    const t = window._ctT;
    const res = await t.schneide([{ u: 0, v: 0, kind: 'thread' }],
                                 { tSize: 'M6', tDepth: 8, tClr: 0.4 });
    const spec = SCREW_SPECS.M6;
    const soll = _cutThreadCutterGeo(spec, 8, 0, false);      // Ø 6,0 statt 6,4
    const pos = soll.attributes.position;
    const n = new THREE.Vector3(...res.n), wp = new THREE.Vector3(...res.wps[0]);
    const M = new THREE.Matrix4().compose(wp, new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), n), new THREE.Vector3(1, 1, 1));
    const A = objects[0], B = objects[1];
    let drin = 0, geprueft = 0, tiefstes = 0;
    const step = Math.ceil(pos.count / 400);
    for (let i = 0; i < pos.count; i += step) {
      const yl = pos.getY(i) * 10;                            // lokale Höhe in mm
      if (Math.abs(yl) > 7.0) continue;                       // Lochgrund ausklammern
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(M);
      geprueft++;
      const teil = yl < 0 ? A : B;
      if (t.inside(teil, p.toArray())) {
        drin++;
        const rad = Math.hypot(pos.getX(i), pos.getZ(i)) * 10;
        if (rad > tiefstes) tiefstes = rad;
      }
    }
    soll.dispose();
    return { drin, geprueft, tiefstes };
  });
  ok('Passung: kein Punkt des Soll-Bolzens im Material', r.drin === 0, r);
}

// ── 7. Schrauben nach dem Deckel-Fix in _buildThreadGeo ─────────────────────
{
  const r = await pg.evaluate(() => {
    const t = window._ctT;
    t.reset();
    const out = {};
    ['aussen', 'innen', 'mutter'].forEach(typ => {
      const g = _buildScrewGeometry({ type: typ, size: 'M6', length: 20, clearance: 0.4,
                                      outer: 0, threadLen: 0, headH: 0, leftHand: false });
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
      out[typ] = { offen: t.watertight(g), vol: Math.round(t.vol(m)) };
      g.dispose();
    });
    // reines Gewinde-Werkzeug
    const gt = _buildThreadGeo(12, 1.75, 5, 32, false);
    out.thread = { offen: t.watertight(gt), vol: Math.round(t.vol(new THREE.Mesh(gt, new THREE.MeshStandardMaterial()))) };
    gt.dispose();
    return out;
  });
  ok('Schraube außen: Volumen plausibel', r.aussen.vol > 300 && r.aussen.vol < 2000, r.aussen);
  ok('Mutter: wasserdicht', r.mutter.offen === 0, r.mutter);
  ok('Gewinde-Werkzeug: wasserdicht', r.thread.offen === 0, r.thread);
}

// ── Schwalbenschwanz automatisch an einer großen Platte ────────────────────
// 620 × 20 × 420 mm, in der Mitte geteilt (Achse X). Erwartet: Zungen wie beim
// Puzzle — entlang der 420-mm-Schnittlinie verteilt, durch die 20 mm Dicke,
// Teil A trägt die Zungen, Teil B die Öffnungen. Klick auf „Schwalbe" setzt sie
// ohne weiteres Zutun, sie wandern mit der Ebene mit.
{
  const platte = () => pg.evaluate(() => {
    const t = window._ctT; t.reset();
    addShape('box');
    const box = objects[objects.length - 1];
    box.scale.multiply(new THREE.Vector3(31, 1, 21));
    box.updateMatrixWorld(true);
    selectObjs([box]); openCutTool();
    Object.assign(_cut.cParams, { type: 'pin', dW: 20, dL: 10, dClr: 0.2 });
    _cutSetAxis('x');
  });
  await platte();
  await pg.click('.cut-ct[data-ct="dove"]');
  const lage = () => pg.evaluate(() => {
    const c0 = _cut.bbox.getCenter(new THREE.Vector3());
    const wp = _cut.connectors.map(c => _cutInPlaneToWorld(c));
    const mb = _cut.markers.map(m => new THREE.Box3().setFromObject(m));
    return { n: _cut.connectors.length, auto: _cut.doveAuto,
      kinds: _cut.connectors.map(c => c.kind),
      x: wp.map(p => +(p.x * 10).toFixed(1)),
      yMitte: wp.map(p => +((p.y - c0.y) * 10).toFixed(2)),
      z: wp.map(p => +((p.z - c0.z) * 10).toFixed(1)).sort((a, b) => a - b),
      // Vorschau: 20 mm hoch (Dicke), 10 mm über die Ebene, 20 mm breit
      marker: mb.map(b => [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +(v * 10).toFixed(1))),
      hinweis: document.getElementById('cut-conn-hint').textContent };
  });
  const a = await lage();
  ok('Platte: 5 Schwalben automatisch gesetzt', a.n === 5 && a.auto && a.kinds.every(k => k === 'dove'), a);
  ok('Platte: Zungen mittig in der Dicke', a.yMitte.every(y => Math.abs(y) < 0.6), a.yMitte);
  ok('Platte: gleichmäßig und symmetrisch über die 420 mm', a.z.every((z, i) => Math.abs(z - (-140 + 70 * i)) < 4), a.z);
  ok('Platte: Vorschau zeigt Zunge 10 × 20 × 20 mm', a.marker.every(m => Math.abs(m[0] - 10) < 0.2 && Math.abs(m[1] - 20) < 1 && Math.abs(m[2] - 20) < 0.2), a.marker[0]);
  ok('Platte: Hinweis nennt die Automatik', /automatisch/.test(a.hinweis), a.hinweis);
  // Ebene verschieben → Zungen ziehen nach (verzögert)
  await pg.evaluate(() => _cutOnSlider(String(parseFloat(document.getElementById('cut-num').value) + 40)));
  await pg.waitForTimeout(700);
  const b2 = await lage();
  ok('Platte: Zungen wandern mit der Ebene', b2.n === a.n && Math.abs(b2.x[0] - a.x[0] - 40) < 0.5,
     { vorher: a.x, nachher: b2.x, n: b2.n });
  // 🗑 beendet die Automatik
  const aus = await pg.evaluate(async () => {
    _cutClearConnectors(); _cutOnSlider(document.getElementById('cut-num').value);
    await new Promise(r => setTimeout(r, 600));
    return _cut.connectors.length;
  });
  ok('Platte: nach 🗑 kommt nichts von selbst zurück', aus === 0, aus);
  await pg.click('.cut-ct[data-ct="pin"]');
  await pg.click('.cut-ct[data-ct="dove"]');
  const r = await pg.evaluate(async () => {
    const t = window._ctT, n0 = _cut.connectors.length;
    // Ablegen bleibt AN (Standard): keine Hälfte darf hochkant auf der Schnittkante stehen
    await _cutExecute();
    return { n0, teile: objects.length, offen: objects.map(o => t.watertight(o.geometry)),
             hoehe: objects.map(o => { const b = new THREE.Box3().setFromObject(o); return +((b.max.y - b.min.y) * 10).toFixed(1); }),
             vol: objects.map(o => Math.round(t.vol(o))) };
  });
  ok('Platte: erneut Schwalbe wählen setzt wieder', r.n0 === 5, r.n0);
  ok('Platte: Schnitt ergibt 2 wasserdichte Teile', r.teile === 2 && r.offen.every(o => o === 0), r);
  ok('Platte: beide Hälften liegen flach (20 mm hoch)', r.hoehe.every(h => Math.abs(h - 20) < 0.5), r.hoehe);
  ok('Platte: Volumen bleibt bis auf das Spiel erhalten', r.vol[0] + r.vol[1] < 620*20*420 &&
     620*20*420 - r.vol[0] - r.vol[1] < 3000, r.vol);

  // Form der Verbindung in Originallage (ohne Ablegen): Schnitt bei x = Mitte
  await platte();
  await pg.click('.cut-ct[data-ct="dove"]');
  const g = await pg.evaluate(async () => {
    const t = window._ctT;
    const wps = _cut.connectors.map(c => _cutInPlaneToWorld(c));
    const bb = _cut.bbox.clone();
    document.getElementById('cut-lay').checked = false;
    await _cutExecute();
    const A = objects[0], B = objects[1];
    const bA = new THREE.Box3().setFromObject(A), bB = new THREE.Box3().setFromObject(B);
    const x0 = wps[0].x, yU = bb.min.y + 0.05, yO = bb.max.y - 0.05;
    const P = (w, s, dz, y) => [w.x + s, y, w.z + dz];
    return {
      offen: objects.map(o => t.watertight(o.geometry)),
      ueberstandA: +((bA.max.x - x0) * 10).toFixed(2),      // Zungen ragen 10 mm über die Ebene
      kanteB: +((bB.min.x - x0) * 10).toFixed(2),           // Teil B beginnt an der Ebene
      // je Zunge: Kopf (8 mm tief, 8 mm seitlich) gehört unten UND oben zu A …
      kopf: wps.map(w => [yU, yO].every(y => t.inside(A, P(w, 0.8, 0.8, y)) && !t.inside(B, P(w, 0.8, 0.8, y)))),
      // … am Hals (1 mm tief, 8 mm seitlich) steht dagegen Teil B → hält auf Zug
      hals: wps.map(w => [yU, yO].every(y => t.inside(B, P(w, 0.1, 0.8, y)) && !t.inside(A, P(w, 0.1, 0.8, y)))),
      // Spiel: knapp außerhalb der Zungenflanke ist Luft (weder A noch B)
      luft: wps.map(w => !t.inside(A, P(w, 1.01, 0.03, yU)) && !t.inside(B, P(w, 1.01, 0.03, yU))),
    };
  });
  ok('Puzzle: beide Teile wasserdicht', g.offen.every(o => o === 0), g.offen);
  ok('Puzzle: Zungen ragen 10 mm über die Schnittkante', Math.abs(g.ueberstandA - 10) < 0.1 && Math.abs(g.kanteB) < 0.05, g);
  ok('Puzzle: Zungen gehen durch die ganze Dicke (Kopf in A)', g.kopf.every(Boolean), g.kopf);
  ok('Puzzle: Hinterschnitt — neben dem Hals steht Teil B', g.hals.every(Boolean), g.hals);
  ok('Puzzle: Spiel zwischen Zungenkopf und Öffnung', g.luft.every(Boolean), g.luft);
}

ok('keine JS-Fehler', pageErrors.length === 0, pageErrors.slice(0, 3));
await b.close();
console.log(fails.length ? '\nFEHLGESCHLAGEN: ' + fails.join(', ') : '\nAlles grün.');
process.exit(fails.length ? 1 : 0);
