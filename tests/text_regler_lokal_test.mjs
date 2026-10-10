// Test: Maß-Regler an Text/SVG-Reliefs wirken in den EIGENEN Achsen des Motivs.
// Ralf 10.10.26 (Handyhalter, Text auf der senkrechten Vorderfläche): „Nach
// Texterstellung falsche Richtungen beim Ziehen mit den Schiebern. Höhe sollte
// immer die Erhabenheit des Teils sein."
// Ursache: applyDimChange arbeitete auf der WELT-Box. An einer senkrechten Wand
// zeigt die Extrusion (lokal Y) waagrecht → „Höhe Z" verstellte die Zeilenhöhe,
// „Tiefe Y" die Erhabenheit, und das aus der Mitte heraus (halb in die Wand).
// Soll: Breite = Laufrichtung (lokal X), Tiefe = Zeilenhöhe (lokal Z),
// Höhe = Erhabenheit (lokal Y, Überstand über die Trägerfläche); die Seite auf
// dem Trägerkörper bleibt liegen. Fälle: flach, an senkrechter Fläche, um die
// Hochachse gedreht, schräg gekippt; Proportional, „Vom Zentrum" aus.
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8843/volme3d.html';
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };
const nah = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter(); document.getElementById('auth-overlay')?.classList.add('hidden'); });

// Hilfen im Seitenkontext: Text erzeugen, Zustand messen
await pg.evaluate(() => {
  window._t = {
    txt: () => objects.find(x => x.userData.type === 'svg'),
    mess: () => {
      const o = _t.txt(); o.updateMatrixWorld(true);
      const g = o.geometry; g.computeBoundingBox(); const bb = g.boundingBox;
      const ws = getMeshBox(o);
      const r = _reliefInfo(o);
      // Weltlage markanter lokaler Punkte (mm)
      const W = (x, y, z) => o.localToWorld(new THREE.Vector3(x, y, z)).multiplyScalar(10);
      const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const sl = o.userData._snapSurfaceLocal;
      return {
        L: [r.w, r.t, r.d],                                     // lokal Breite / Dicke / Zeilenhöhe (mm)
        h: r.h, attached: r.attached,
        unten: W(cx, bb.min.y, cz).toArray(),                   // Mitte der Unterseite
        links: W(bb.min.x, bb.min.y, cz).toArray(),
        mitte: W(cx, (bb.min.y + bb.max.y) / 2, cz).toArray(),
        grund: W(cx, bb.min.y, bb.max.z).toArray(),             // Grundlinie (Text-Unten = lokal +Z)
        wand: sl ? o.localToWorld(new THREE.Vector3(sl.x, sl.y, sl.z)).multiplyScalar(10).toArray() : null,
        wminY: ws.min.y * 10,
        fp: ['fpw', 'fpd', 'fph'].map(id => parseFloat(document.getElementById(id)?.value)),
        lbl: [...document.querySelectorAll('#fp .fp-lbl')].slice(0, 3).map(x => x.textContent),
        sl: ['dn-w', 'dn-d', 'dn-h'].map(id => parseFloat(document.getElementById(id).value)),
        q: o.quaternion.toArray(),
      };
    },
  };
});
const mess = () => pg.evaluate(() => _t.mess());
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function neuerText(mitSchild) {
  await pg.evaluate((mitSchild) => {
    _newCreate(false); scaleLocked = false; scaleFromCenter = true;
    if (mitSchild) {   // Handyhalter-Schild: 60 breit, 40 hoch, 6 dick, steht auf der Platte
      addShape('box'); const o = objects[objects.length - 1];
      o.scale.set(3, 2, 0.3); o.position.set(0, 2, 0); o.updateMatrixWorld(true);
      deselect();
    }
    addTextShape(); document.getElementById('text3d-input').value = 'Hallo';
    _text3dSetMode(mitSchild ? 'surface' : 'free'); _confirmText3d();
  }, mitSchild);
  if (mitSchild) {
    await pg.waitForFunction(() => !!_lblPick, { timeout: 30000 });
    // wie der Nutzer: auf die Vorderfläche des Schilds klicken
    const pt = await pg.evaluate(() => {
      const bx = objects.find(x => x.userData.type === 'box');
      bx.position.set(0, 2, 0); bx.updateMatrixWorld(true);   // Text-Einfügen schiebt Teile beiseite
      const bb = getMeshBox(bx);
      const v = new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, bb.max.z).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (-v.y + 1) / 2 * r.height };
    });
    await pg.mouse.click(pt.x, pt.y);
    await pg.waitForFunction(() => !_lblPick, { timeout: 10000 });
    await pg.evaluate(() => _lblClose());
  } else {
    await pg.waitForFunction(() => !!_t.txt(), { timeout: 30000 });
  }
  await pg.evaluate(() => { const o = _t.txt(); selectObjs([o]); _fpCurType = null; updateFP(); });
}
const regler = (ax, v) => pg.evaluate(([ax, v]) => fpApplyDim(ax, v), [ax, v]);

// ── A) Text flach auf der Platte ───────────────────────────────────────────
console.log('A) Text flach');
await neuerText(false);
{
  const m0 = await mess();
  ok('A: Panel = lokale Maße', nah(m0.fp[0], m0.L[0], 0.06) && nah(m0.fp[1], m0.L[2], 0.06) && nah(m0.fp[2], m0.L[1], 0.06), { fp: m0.fp, L: m0.L });
  ok('A: Beschriftung Höhe (erhaben)', m0.lbl[2] === 'Höhe (erhaben)', m0.lbl);
  await regler('h', m0.L[1] * 2);
  const m1 = await mess();
  ok('A: Höhe ×2 = Dicke ×2', nah(m1.L[1], m0.L[1] * 2) && nah(m1.L[0], m0.L[0]) && nah(m1.L[2], m0.L[2]), m1.L);
  ok('A: Unterseite bleibt liegen', dist(m1.unten, m0.unten) < 0.01, { vor: m0.unten, nach: m1.unten });
  await regler('w', m0.L[0] * 1.5);
  const m2 = await mess();
  ok('A: Breite ×1,5 nur Laufrichtung', nah(m2.L[0], m0.L[0] * 1.5) && nah(m2.L[1], m1.L[1]) && nah(m2.L[2], m0.L[2]), m2.L);
  ok('A: Breite aus der Mitte', dist(m2.mitte, m1.mitte) < 0.01, m2.mitte);
  // rechtes Panel („Abmessungen") zeigt dieselben Maße und wirkt gleich
  await pg.evaluate(() => sliderChanged('sd', 12));
  const m3 = await mess();
  ok('A: Tiefe (rechtes Panel) = Zeilenhöhe 12', nah(m3.L[2], 12) && nah(m3.L[0], m2.L[0]) && nah(m3.L[1], m2.L[1]), m3.L);
  ok('A: rechtes Panel zeigt lokale Maße', nah(m3.sl[0], m3.L[0], 0.06) && nah(m3.sl[1], 12, 0.06) && nah(m3.sl[2], m3.L[1], 0.06), m3.sl);
}

// ── B) Text an der senkrechten Vorderfläche (Ralfs Fall) ────────────────────
console.log('B) Text an senkrechter Fläche');
await neuerText(true);
{
  const m0 = await mess();
  { const ny = await pg.evaluate(() => new THREE.Vector3(0, 1, 0).applyQuaternion(_t.txt().quaternion).toArray());
    ok('B: Text steht an der Wand (Extrusion zeigt nach vorn)', m0.attached && ny[2] > 0.99, { attached: m0.attached, ny }); }
  ok('B: Panel-Höhe = Überstand, nicht Weltachse', nah(m0.fp[2], m0.h, 0.06) && m0.h < m0.L[1] + 1e-6 && nah(m0.fp[1], m0.L[2], 0.06), { fp: m0.fp, h: m0.h, L: m0.L });
  const wand0 = m0.wand;
  const innen0 = m0.L[1] - m0.h;
  await regler('h', 3);
  const m1 = await mess();
  ok('B: Höhe 3 → Überstand 3 mm', nah(m1.h, 3) && nah(m1.fp[2], 3, 0.06), { h: m1.h, fp: m1.fp });
  ok('B: Zeilenhöhe + Breite unverändert', nah(m1.L[2], m0.L[2]) && nah(m1.L[0], m0.L[0]), m1.L);
  ok('B: eingebetteter Teil + Unterseite bleiben liegen', nah(m1.L[1] - m1.h, innen0) && dist(m1.unten, m0.unten) < 0.01, { innen: m1.L[1] - m1.h, unten: m1.unten });
  ok('B: Wandpunkt bleibt in der Welt', dist(m1.wand, wand0) < 0.01, m1.wand);
  await regler('h', 0.8);
  const m1b = await mess();
  ok('B: Höhe 0,8 → Überstand 0,8 mm', nah(m1b.h, 0.8) && dist(m1b.unten, m0.unten) < 0.01, m1b.h);
  await regler('d', m0.L[2] * 1.5);
  const m2 = await mess();
  ok('B: Tiefe = Zeilenhöhe ×1,5', nah(m2.L[2], m0.L[2] * 1.5) && nah(m2.L[0], m0.L[0]) && nah(m2.h, 0.8), m2.L);
  ok('B: Text bleibt an der Wand (Mitte fest)', dist(m2.mitte, m1b.mitte) < 0.01 && dist(m2.wand, wand0) < 0.01, m2.mitte);
  await regler('w', m0.L[0] * 0.8);
  const m3 = await mess();
  ok('B: Breite = Laufrichtung', nah(m3.L[0], m0.L[0] * 0.8) && nah(m3.L[2], m2.L[2]) && nah(m3.h, 0.8), m3.L);
  // Ohne „Vom Zentrum": Textanfang bzw. Grundlinie bleibt stehen
  await pg.evaluate(() => { scaleFromCenter = false; });
  const m4a = await mess();
  await regler('w', m3.L[0] * 1.25);
  const m4 = await mess();
  ok('B: Kante: Breite hält den Textanfang', dist(m4.links, m4a.links) < 0.01 && nah(m4.L[0], m3.L[0] * 1.25), m4.links);
  await regler('d', m4.L[2] * 1.25);
  const m5 = await mess();
  ok('B: Kante: Tiefe hält die Grundlinie', dist(m5.grund, m4.grund) < 0.01, { vor: m4.grund, nach: m5.grund });
  await pg.evaluate(() => { scaleFromCenter = true; scaleLocked = true; });
  // Proportional: Breite + Zeilenhöhe zusammen, Erhabenheit bleibt
  await regler('w', m5.L[0] * 2);
  const m6 = await mess();
  ok('B: Proportional skaliert Breite+Tiefe, Höhe bleibt', nah(m6.L[0], m5.L[0] * 2) && nah(m6.L[2], m5.L[2] * 2) && nah(m6.h, 0.8), { L: m6.L, h: m6.h });
  await pg.evaluate(() => { scaleLocked = false; });
  const vorUnion = await pg.evaluate(() => _t.txt().userData._snapSurfaceLocal != null);
  ok('B: Wandbezug bleibt erhalten', vorUnion);
}

// ── B2) Anfasser am Text an der Wand: Griff vorn (Welt +Z = nach außen) ziehen
console.log('B2) Anfasser am Text an der Wand');
await neuerText(true);
{
  const m0 = await mess();
  // Blick fast waagrecht von vorn (sonst ist der vordere Griff unten als „Rückseite“ ausgeblendet),
  // Größe-Modus: Griffe anfassbar
  await pg.evaluate(() => { orbitTarget.set(0, 2, 0); sph.theta = 0.9; sph.phi = 1.52; sph.r = 6; sph2cam(); setMode('scale'); _doRepositionDimHandles(); });
  await pg.waitForTimeout(200);
  const g = await pg.evaluate(() => {
    const h = _dimHandleData.find(x => x.key === 'fz+'); if (!h) return null;
    const r = h.el.getBoundingClientRect();
    // Zugrichtung wie im Griff-Code: Box-Mitte → Mitte der Vorderseite (Welt +Z)
    const o = _t.txt(), bb = getMeshBox(o), cr = canvas.getBoundingClientRect();
    const c = bb.getCenter(new THREE.Vector3()), f = c.clone(); f.z = bb.max.z;
    const P = v => { const p = v.clone().project(camera); return [cr.left + (p.x + 1) / 2 * cr.width, cr.top + (-p.y + 1) / 2 * cr.height]; };
    const [cx, cy] = P(c), [fx, fy] = P(f);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, cx, cy, fx, fy };
  });
  ok('B2: Tiefen-Griff vorhanden', !!g, g);
  if (g) {
    const len = Math.hypot(g.fx - g.cx, g.fy - g.cy) || 1, ux = (g.fx - g.cx) / len, uy = (g.fy - g.cy) / len;
    await pg.mouse.move(g.x, g.y); await pg.mouse.down();
    for (let i = 1; i <= 5; i++) await pg.mouse.move(g.x + ux * 4 * i, g.y + uy * 4 * i);
    await pg.mouse.up();
    await pg.waitForTimeout(100);
    const m1 = await mess();
    ok('B2: Zug nach außen macht den Text erhabener', m1.L[1] > m0.L[1] + 0.5 && nah(m1.L[2], m0.L[2]) && nah(m1.L[0], m0.L[0]), m1.L);
    ok('B2: Unterseite bleibt in der Wand', dist(m1.unten, m0.unten) < 0.01, { vor: m0.unten, nach: m1.unten });
    ok('B2: Wandpunkt nachgeführt → Höhe (erhaben) stimmt', dist(m1.wand, m0.wand) < 0.01 && nah(m1.h, m1.L[1] - (m0.L[1] - m0.h)), { h: m1.h, L: m1.L });
    ok('B2: Panel zeigt den neuen Überstand', nah(m1.fp[2], m1.h, 0.06), m1.fp);
  }
}

// ── C) Text flach, um die Hochachse gedreht (30°) ──────────────────────────
console.log('C) Text um die Hochachse gedreht');
await neuerText(false);
{
  await pg.evaluate(() => { const o = _t.txt(); o.rotation.set(0, 30 * Math.PI / 180, 0); o.updateMatrixWorld(true); _fpCurType = null; updateFP(); });
  const m0 = await mess();
  ok('C: Panel zeigt Textlänge statt Welt-X', nah(m0.fp[0], m0.L[0], 0.06), { fp: m0.fp, L: m0.L });
  await regler('w', m0.L[0] * 1.5);
  const m1 = await mess();
  ok('C: Breite verlängert nur den Schriftzug', nah(m1.L[0], m0.L[0] * 1.5) && nah(m1.L[2], m0.L[2]) && nah(m1.L[1], m0.L[1]), m1.L);
  ok('C: Mitte bleibt, Lage bleibt', dist(m1.mitte, m0.mitte) < 0.01 && m1.q.every((v, i) => nah(v, m0.q[i], 1e-6)), m1.mitte);
  await regler('d', 10);
  const m2 = await mess();
  ok('C: Tiefe = Zeilenhöhe 10', nah(m2.L[2], 10) && nah(m2.L[0], m1.L[0]), m2.L);
  await regler('h', 4);
  const m3 = await mess();
  ok('C: Höhe 4 = Dicke 4, Boden bleibt liegen', nah(m3.L[1], 4) && nah(m3.wminY, m0.wminY, 0.01), { L: m3.L, minY: m3.wminY });
}

// ── D) Text schräg gekippt (25° um X), frei ────────────────────────────────
console.log('D) Text schräg gekippt');
await neuerText(false);
{
  await pg.evaluate(() => { const o = _t.txt(); o.rotation.set(25 * Math.PI / 180, 0, 0); o.position.y += 2; o.updateMatrixWorld(true); _fpCurType = null; updateFP(); });
  const m0 = await mess();
  await regler('h', m0.L[1] * 2);
  const m1 = await mess();
  ok('D: Höhe verdoppelt die Dicke entlang der Kippachse', nah(m1.L[1], m0.L[1] * 2) && nah(m1.L[2], m0.L[2]) && nah(m1.L[0], m0.L[0]), m1.L);
  ok('D: Unterseite bleibt liegen', dist(m1.unten, m0.unten) < 0.01, m1.unten);
}

// ── E) Speichern/Laden behält die Maße ─────────────────────────────────────
{
  const r = await pg.evaluate(() => {
    const o = _t.txt(); const d = objectToData(o); const o2 = buildObjectFromData(d); o2.updateMatrixWorld(true);
    const a = _reliefInfo(o), c = _reliefInfo(o2);
    return { a: [a.w, a.t, a.d], c: [c.w, c.t, c.d] };
  });
  ok('E: Speichern/Laden behält lokale Maße', r.a.every((v, i) => nah(v, r.c[i])), r);
}

ok('keine Seitenfehler', errs.length === 0, errs);
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
