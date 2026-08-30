// Test für die neue SVG-Nachbearbeitung:
//   1. Import: SVG mit 3 Formen (2 Rechtecke + Form mit Loch) → 1 Objekt, Pfaddaten da
//   2. ⧉ Zerlegen: 3 Einzelobjekte, Gesamt-BBox bleibt (Teile stehen wo sie standen),
//      jedes Teil hat seinen Drehpunkt in der eigenen Mitte
//   3. ✎ Als Skizze bearbeiten: Original weg, Skizze offen, Konturen in richtiger Größe
//   4. Skizze extrudieren → Körper entsteht (Loch bleibt Loch)
//   5. ⬆ SVG laden (Skizze): physische mm (width="50mm" + viewBox) werden respektiert
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

// Drei Formen: Rechteck links, Rechteck rechts oben, Rahmen mit Loch unten
const TEST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M0,0 H20 V20 H0 Z"/>
  <path d="M60,0 H100 V25 H60 Z"/>
  <path d="M20,50 H80 V100 H20 Z M35,65 V85 H65 V65 Z"/>
</svg>`;

// ── 1. Import ────────────────────────────────────────────────────────────
const imp = await pg.evaluate((svg) => {
  const mesh = _importSvgConfirm({ svgText: svg, mode: 'extrude', depthMM: 5, targetMM: 60, name: 'SvgTest' });
  if (!mesh) return null;
  const bb = new THREE.Box3().setFromObject(mesh);
  const s = bb.getSize(new THREE.Vector3());
  return { nObj: objects.length, nShapes: mesh.userData._svgPathData.length,
           w: s.x * 10, d: s.z * 10, h: s.y * 10, id: mesh.userData.id };
}, TEST_SVG);
ok('Import liefert 1 Objekt', imp && imp.nObj === 1, imp);
ok('3 Formen in den Pfaddaten', imp && imp.nShapes === 3, imp && imp.nShapes);
ok('Größe ≈ 60 mm breit, 5 mm hoch', imp && Math.abs(imp.w - 60) < 1 && Math.abs(imp.h - 5) < 0.5,
   imp && { w: imp.w.toFixed(1), h: imp.h.toFixed(1) });

// ── 2. Zerlegen ──────────────────────────────────────────────────────────
const exp = await pg.evaluate(() => {
  const o = objects[0];
  const bbBefore = new THREE.Box3().setFromObject(o);
  selectObjs([o]);
  _svgExplode();
  if (objects.length < 2) return { n: objects.length };
  const bbAfter = new THREE.Box3();
  for (const p of objects) bbAfter.union(new THREE.Box3().setFromObject(p));
  const dMin = bbBefore.min.distanceTo(bbAfter.min), dMax = bbBefore.max.distanceTo(bbAfter.max);
  // Drehpunkt in der eigenen Mitte: Geometrie-BBox jedes Teils ist um 0 zentriert (X/Z)
  const centered = objects.every(p => {
    p.geometry.computeBoundingBox();
    const g = p.geometry.boundingBox;
    return Math.abs(g.min.x + g.max.x) < 0.05 && Math.abs(g.min.z + g.max.z) < 0.05;
  });
  return { n: objects.length, dMin, dMax, centered, names: objects.map(p => p.userData.name),
           allSvg: objects.every(p => p.userData._svgPathData?.length === 1) };
});
ok('Zerlegen → 3 Objekte', exp.n === 3, exp.names || exp.n);
ok('Gesamt-BBox unverändert (Teile bleiben an Ort und Stelle)', exp.dMin < 0.05 && exp.dMax < 0.05,
   { dMin: exp.dMin?.toFixed(3), dMax: exp.dMax?.toFixed(3) });
ok('Jedes Teil um eigene Mitte zentriert', exp.centered === true);
ok('Jedes Teil trägt eigene Pfaddaten (überlebt Speichern/Undo)', exp.allSvg === true);

// Undo bringt das Original zurück
const und = await pg.evaluate(() => { undo(); return { n: objects.length, shapes: objects[0]?.userData._svgPathData?.length }; });
ok('Undo nach Zerlegen → wieder 1 Objekt mit 3 Formen', und.n === 1 && und.shapes === 3, und);

// ── 3. Als Skizze bearbeiten ─────────────────────────────────────────────
const skz = await pg.evaluate(() => {
  selectObjs([objects[0]]);
  _svgEditAsSketch();
  return { nObj: objects.length, skActive: _sk.active, nEnts: _sk.ents.length,
           closed: _sk.ents.every(e => e.type === 'poly' && e.closed),
           hVal: document.getElementById('sketch-h').value };
});
ok('Objekt entfernt, Skizzen-Modus offen', skz.nObj === 0 && skz.skActive === true, skz);
ok('4 Konturen übernommen (3 Außen + 1 Loch), alle geschlossen', skz.nEnts === 4 && skz.closed, skz.nEnts);
ok('Extrusionshöhe aus SVG-Tiefe vorbelegt (5 mm)', Math.abs(parseFloat(skz.hVal) - 5) < 0.11, skz.hVal);

// Konturen-Ausdehnung: 60 mm größte Seite → 6 Units
const ext = await pg.evaluate(() => {
  let mn = { u: 1e9, v: 1e9 }, mx = { u: -1e9, v: -1e9 };
  for (const e of _sk.ents) for (const p of e.pts) {
    mn.u = Math.min(mn.u, p.u); mn.v = Math.min(mn.v, p.v);
    mx.u = Math.max(mx.u, p.u); mx.v = Math.max(mx.v, p.v);
  }
  return { w: (mx.u - mn.u) * 10, h: (mx.v - mn.v) * 10 };
});
ok('Skizzen-Konturen ≈ 60 mm breit', Math.abs(ext.w - 60) < 1, { w: ext.w.toFixed(1), h: ext.h.toFixed(1) });

// ── 4. Extrudieren aus der Skizze ────────────────────────────────────────
const extr = await pg.evaluate(() => {
  _skExtrude();
  const o = objects[objects.length - 1];
  if (!o) return null;
  const bb = new THREE.Box3().setFromObject(o);
  const s = bb.getSize(new THREE.Vector3());
  // Loch-Probe: Strahl von oben durch die Loch-Mitte des Rahmens darf im
  // Rahmen-Bereich (unteres Drittel) nichts treffen — grob über Dreiecke unnötig,
  // stattdessen: Profile enthalten ein Loch?
  const hasHole = (o.userData._skProfiles || []).some(p => (p.holes || []).length > 0);
  return { n: objects.length, type: o.userData.shapeType, w: s.x * 10, h: s.y * 10, hasHole };
});
ok('Extrudieren → Skizzen-Körper', extr && extr.n === 1 && extr.type === 'sketch', extr && extr.type);
ok('Körper ≈ 60 mm breit, 5 mm hoch', extr && Math.abs(extr.w - 60) < 1.5 && Math.abs(extr.h - 5) < 0.3,
   extr && { w: extr.w.toFixed(1), h: extr.h.toFixed(1) });
ok('Loch im Profil erhalten', extr && extr.hasHole === true);

// ── 5. SVG mit physischen mm direkt in die Skizze ────────────────────────
const phys = await pg.evaluate(() => {
  newScene(true);
  if (_sk.active) exitSketchMode();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="30mm" viewBox="0 0 100 60"><path d="M0,0 H100 V60 H0 Z"/></svg>';
  _skImportSVG(svg);
  let mn = 1e9, mx = -1e9;
  for (const e of _sk.ents) for (const p of e.pts) { mn = Math.min(mn, p.u); mx = Math.max(mx, p.u); }
  return { active: _sk.active, n: _sk.ents.length, wMM: (mx - mn) * 10 };
});
ok('SVG laden öffnet Skizze', phys.active === true && phys.n === 1, phys.n);
ok('width="50mm" wird respektiert (nicht auf 100 eingepasst)', Math.abs(phys.wMM - 50) < 0.5, phys.wMM.toFixed(1));

ok('Keine Seitenfehler', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log(fails.length ? '\n' + fails.length + ' FEHLER' : '\nAlle Tests OK');
process.exit(fails.length ? 1 : 0);
