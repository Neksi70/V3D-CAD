// Regressionstest für den Rohr-Klipp-Generator (🛡️ Rohr-Klipp).
//
// Geprüft wird, was beim Drucken/Aufschnappen zählt:
//   1. die Hülle ist WASSERDICHT (jede Kante genau 1× hin, 1× zurück)
//   2. die Wicklung zeigt nach außen (positives Volumen) und die Materialmenge
//      passt zum Ringausschnitt × Länge
//   3. die Öffnung sitzt auf der eingestellten Seite (dort ist KEIN Material,
//      gegenüber schon)
//   4. der Bogen ist wirklich drin: Durchhang der Bahn = eingestellter Wert
//   5. das Rohr passt hinein: die Innenfläche hält überall mind. Ø+Spiel frei
//   6. Sonderfälle: gerade Variante, Kabelbinder-Nuten, dünne Wand
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
  window._rkTest = {
    // Kanten-Parität: geschlossene Mannigfaltigkeit ⇒ jede Kante genau 1× hin, 1× zurück
    watertight(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const key = i => { const j = idx ? idx.getX(i) : i;
        return Math.round(p.getX(j) * 1e4) + ',' + Math.round(p.getY(j) * 1e4) + ',' + Math.round(p.getZ(j) * 1e4); };
      const m = new Map();
      let tris = 0, degen = 0;
      for (let t = 0; t < n; t += 3) {
        const a = key(t), b = key(t + 1), c = key(t + 2);
        if (a === b || b === c || a === c) { degen++; continue; }
        tris++;
        for (const [u, v] of [[a, b], [b, c], [c, a]]) m.set(u + '|' + v, (m.get(u + '|' + v) || 0) + 1);
      }
      let bad = 0;
      for (const [k, cnt] of m) { const [u, v] = k.split('|');
        if (cnt !== 1 || (m.get(v + '|' + u) || 0) !== 1) bad++; }
      return { tris, degen, badEdges: bad };
    },
    // Vorzeichenbehaftetes Volumen (Units³): > 0 ⇒ Dreiecke zeigen nach außen
    volume(geo) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const g = (i, o) => { const j = idx ? idx.getX(i) : i;
        return o === 0 ? p.getX(j) : o === 1 ? p.getY(j) : p.getZ(j); };
      let v = 0;
      for (let t = 0; t < n; t += 3) {
        const ax = g(t,0), ay = g(t,1), az = g(t,2);
        const bx = g(t+1,0), by = g(t+1,1), bz = g(t+1,2);
        const cx = g(t+2,0), cy = g(t+2,1), cz = g(t+2,2);
        v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      }
      return v;
    },
    // Strahl von (x,y,z) in +Y: ungerade Trefferzahl ⇒ Punkt liegt im Körper
    inside(geo, x, y, z) {
      const p = geo.attributes.position, idx = geo.index;
      const n = idx ? idx.count : p.count;
      const G = i => { const j = idx ? idx.getX(i) : i; return [p.getX(j), p.getY(j), p.getZ(j)]; };
      let hits = 0;
      for (let t = 0; t < n; t += 3) {
        const A = G(t), B = G(t + 1), C = G(t + 2);
        // 2D-Test in der XZ-Ebene, dann Höhe des Schnittpunkts
        const d = (B[0]-A[0])*(C[2]-A[2]) - (C[0]-A[0])*(B[2]-A[2]);
        if (Math.abs(d) < 1e-12) continue;
        const u = ((x-A[0])*(C[2]-A[2]) - (C[0]-A[0])*(z-A[2])) / d;
        const v = ((B[0]-A[0])*(z-A[2]) - (x-A[0])*(B[2]-A[2])) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const yh = A[1] + u*(B[1]-A[1]) + v*(C[1]-A[1]);
        if (yh > y) hits++;
      }
      return hits % 2 === 1;
    },
    // Kleinster Abstand aller Punkte zur Rohrachse (Bogenmittellinie), in mm.
    // Gerechnet wird im Bau-Koordinatensystem: rkOffset wieder herausnehmen,
    // dort ist die Achse der Kreis mit Radius R um (0, y, R) in der XZ-Ebene.
    minAxisDist(geo, R) {
      const p = geo.attributes.position, o = geo.userData.rkOffset;
      let min = Infinity;
      for (let i = 0; i < p.count; i++) {
        const x = (p.getX(i)-o.x) * 10, y = (p.getY(i)-o.y) * 10, z = (p.getZ(i)-o.z) * 10;
        const d = isFinite(R) ? Math.hypot(Math.hypot(x, R - z) - R, y) : Math.hypot(z, y);
        if (d < min) min = d;
      }
      return min;
    },
  };
});

// geo bauen + Kennzahlen holen
const run = async (params, label) => {
  const r = await pg.evaluate(p => {
    Object.assign(_rkP, _RK_DEFAULTS, p);
    const geo = window._rkBuild(_rkP, false);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const arc = window._rkArc(_rkP);
    return {
      wt: window._rkTest.watertight(geo),
      vol: window._rkTest.volume(geo) * 1000,          // Units³ → mm³
      bb: { x: [bb.min.x*10, bb.max.x*10], y: [bb.min.y*10, bb.max.y*10], z: [bb.min.z*10, bb.max.z*10] },
      arc,
      // Prüfpunkte am Bogenscheitel (x=0), mittig in der Wand: in Öffnungs-
      // richtung und gegenüber. Am Scheitel zeigt die Bogen-Außenseite nach −Z,
      // die Rohrachse liegt dort im Bau-System auf (0,0,0) → rkOffset addieren.
      probe: (() => {
        const P = _rkP, o = geo.userData.rkOffset;
        const rm = (P.dia/2 + P.clr + P.wall/2) / 10;
        // dx: knapp neben dem Scheitel, damit der Strahl nicht exakt auf einer
        // Gitterlinie des Netzes liegt (dort zählt der Schnitttest doppelt)
        const dx = 0.0733;
        const pt = deg => { const th = deg * Math.PI/180;
          return { x: o.x + dx, y: Math.sin(th)*rm + o.y, z: -Math.cos(th)*rm + o.z }; };
        const a = pt(P.rot), c = pt(P.rot + 180);
        return { open: window._rkTest.inside(geo, a.x, a.y, a.z),
                 back: window._rkTest.inside(geo, c.x, c.y, c.z) };
      })(),
      minAxis: window._rkTest.minAxisDist(geo, arc.R),
    };
  }, params);
  console.log('\n— ' + label + ' —');
  return r;
};

// ── 1) Ralfs Fall: Ø 23 mm, 180 mm lang, 8 mm Durchhang, Öffnung innen ───────
{
  const r = await run({}, 'Standard (Ø23, 180 mm, Durchhang 8 mm, Öffnung innen)');
  ok('wasserdicht', r.wt.badEdges === 0 && r.wt.degen === 0, r.wt);
  ok('Wicklung nach außen (Volumen > 0)', r.vol > 0, Math.round(r.vol) + ' mm³');
  const P = { dia: 23, clr: 0.4, wall: 2.4, len: 180, wrap: 245 };
  const ri = P.dia/2 + P.clr, ro = ri + P.wall;
  const soll = (P.wrap/360) * Math.PI * (ro*ro - ri*ri) * P.len;
  ok('Materialmenge passt zum Ringausschnitt (±8 %)', Math.abs(r.vol - soll)/soll < 0.08,
     { ist: Math.round(r.vol), soll: Math.round(soll) });
  ok('Öffnung ist offen (kein Material auf der Öffnungsseite)', r.probe.open === false);
  ok('Gegenüber der Öffnung ist Material', r.probe.back === true);
  ok('Durchhang wie eingestellt', Math.abs(r.arc.sag - 8) < 0.15, r.arc);
  // Engste Stelle = Spitze der Rastnase: ri − Nase. Alles andere liegt weiter außen.
  ok('Rastnase greift genau um den eingestellten Wert ein', Math.abs(r.minAxis - (ri - 0.6)) < 0.02,
     { minAbstandZurAchse: Math.round(r.minAxis*100)/100, erwartet: ri - 0.6 });
  const r0 = await run({ lip: 0 }, 'ohne Rastnase');
  ok('ohne Nase: Innenfläche hält genau Ø+Spiel frei', Math.abs(r0.minAxis - ri) < 0.02,
     { minAbstandZurAchse: Math.round(r0.minAxis*100)/100, erwartet: ri });
  ok('Höhe ≤ Schalendurchmesser', r.bb.y[1] - r.bb.y[0] <= 2*ro + 0.05,
     { hoehe: Math.round((r.bb.y[1]-r.bb.y[0])*100)/100, max: 2*ro });
}

// ── 2) Gerade Variante ───────────────────────────────────────────────────────
{
  const r = await run({ bend: 'straight' }, 'Gerade');
  ok('gerade: wasserdicht', r.wt.badEdges === 0 && r.wt.degen === 0, r.wt);
  ok('gerade: Volumen > 0', r.vol > 0);
  ok('gerade: Länge = 180 mm', Math.abs((r.bb.x[1]-r.bb.x[0]) - 180) < 0.05, r.bb.x);
  ok('gerade: kein Durchhang', r.arc.sag === 0);
  ok('gerade: Öffnung offen', r.probe.open === false);
}

// ── 3) Öffnung nach oben, weite Umschlingung, Kabelbinder-Nuten ──────────────
{
  const r = await run({ rot: 90, wrap: 300, ties: 1, tieN: 3, lip: 1.2 }, 'Öffnung oben, 300°, 3 Nuten');
  ok('Variante: wasserdicht', r.wt.badEdges === 0 && r.wt.degen === 0, r.wt);
  ok('Variante: Volumen > 0', r.vol > 0);
  ok('Variante: Öffnung oben ist offen', r.probe.open === false);
  ok('Variante: gegenüber Material', r.probe.back === true);
}

// ── 4) Extreme: dünne Wand, kurz, kleiner Radius, enge Umschlingung ──────────
{
  const r = await run({ dia: 8, clr: 0, wall: 0.8, len: 25, bend: 'radius', rad: 60,
                        wrap: 130, lip: 0, ends: 3 }, 'Extrem (Ø8, Wand 0,8, R60, 130°)');
  ok('Extrem: wasserdicht', r.wt.badEdges === 0 && r.wt.degen === 0, r.wt);
  ok('Extrem: Volumen > 0', r.vol > 0);
}

// ── 5) Durchhang, der auf der Länge nicht mehr geht → sauber begrenzt ────────
{
  const r = await run({ len: 60, sag: 60 }, 'Durchhang übertrieben (60 mm auf 60 mm)');
  ok('Begrenzung: wasserdicht', r.wt.badEdges === 0 && r.wt.degen === 0, r.wt);
  ok('Begrenzung: Bogen ≤ Halbkreis', r.arc.sag <= 60/Math.PI + 0.01, r.arc);
}

// ── 6) Erstellen legt ein Objekt in die Szene ────────────────────────────────
{
  const res = await pg.evaluate(() => {
    Object.assign(_rkP, _RK_DEFAULTS);
    const before = objects.length;
    window._createRk();
    const o = objects[objects.length - 1];
    return { added: objects.length - before, type: o?.userData?.type, name: o?.userData?.name,
             minY: (o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox)).min.y };
  });
  ok('Erstellen legt genau ein Objekt an', res.added === 1, res);
  ok('Typ ist pipeclip', res.type === 'pipeclip', res.type);
  ok('steht auf der Arbeitsebene (min Y = 0)', Math.abs(res.minY) < 1e-6, res.minY);
}

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log('\n' + (fails.length ? '❌ ' + fails.length + ' Fehler: ' + fails.join(' | ') : '✅ alles grün'));
process.exit(fails.length ? 1 : 0);
