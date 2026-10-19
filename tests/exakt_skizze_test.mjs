// Exakte Form für Skizzen-Extrusionen: Profil mit Kreisloch → exaktes Prisma mit
// echtem Kreis, Rundung neben dem Loch ohne Delle, Skizzen-Kreis als Bohrung
// abziehen bleibt exakt, Speichern/Laden behält die Form.
// Aufruf (im Worktree): node tests/exakt_skizze_test.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
const HIER = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 18847;
const srv = spawn('python3', [path.join(HIER, 'umgebungen-test-server.py'), String(PORT), '--dev'], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const warn = []; p.on('console', m => { if (/\[exakt\]/.test(m.text())) warn.push(m.text().slice(0, 200)); });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d-umgebungen.html`);
  await p.waitForFunction(() => typeof objects !== 'undefined' && typeof _skMakeBodyFromShapes === 'function', null, { timeout: 60000 });
  await p.evaluate(async () => { await _loadOCCT(); try { hideStarter(); } catch (e) {} return true; });

  // Rechteck 40×30 mm mit Loch Ø14 (64 Punkte wie aus der Skizze), 20 mm hoch
  const r1 = await p.evaluate(() => {
    _newCreate(false);
    const kreis = (cu, cv, r, n = 64) => Array.from({ length: n }, (_, i) => ({ u: cu + r * Math.cos(i / n * 2 * Math.PI), v: cv + r * Math.sin(i / n * 2 * Math.PI) }));
    const rechteck = [{ u: -2, v: -1.5 }, { u: 2, v: -1.5 }, { u: 2, v: 1.5 }, { u: -2, v: 1.5 }];
    const m = _skMakeBodyFromShapes([{ outer: rechteck, holes: [kreis(0, 0, 0.7)] }], 20, 0, null);
    const u = m.userData, w = _exaktWelt(_oc, m);
    return { exakt: !!u.exakt, ok: _brepOk(m), kanten: (u._brepEdges || []).length, kreise: (u._brepEdges || []).filter(e => e.circle).length, vol: w ? _occtVolumen(_oc, w) : 0 };
  });
  const soll1 = (12 - Math.PI * 0.49) * 2;
  ok(r1.exakt && r1.ok, 'Skizzen-Extrusion trägt die exakte Form');
  ok(Math.abs(r1.vol - soll1) < 1e-4, `Volumen ${r1.vol.toFixed(5)} = Soll ${soll1.toFixed(5)} cm³ (Loch als echter Kreis)`);
  ok(r1.kanten === 14 && r1.kreise === 2, `Kanten: ${r1.kanten} (12 + 2 Lochränder: ${r1.kreise} Kreise)`);

  // Dasselbe mit andersherum gezeichnetem Loch (Uhrzeigersinn)
  const r1b = await p.evaluate(() => {
    const kreis = Array.from({ length: 64 }, (_, i) => ({ u: 0.7 * Math.cos(-i / 64 * 2 * Math.PI), v: 0.7 * Math.sin(-i / 64 * 2 * Math.PI) }));
    const m = _skMakeBodyFromShapes([{ outer: [{ u: -2, v: 1.5 }, { u: 2, v: 1.5 }, { u: 2, v: -1.5 }, { u: -2, v: -1.5 }], holes: [kreis] }], 20, 0, null);
    const w = _exaktWelt(_oc, m), v = w ? _occtVolumen(_oc, w) : 0;
    scene.remove(m); objects.splice(objects.indexOf(m), 1);
    return { exakt: !!m.userData.exakt, vol: v };
  });
  ok(r1b.exakt && Math.abs(r1b.vol - soll1) < 1e-4, `andersherum gezeichnet: ${r1b.vol.toFixed(5)} = Soll`);

  // Obere Längskanten (y = 2, |z| = 1,5) mit 10 mm runden — reicht ins Loch (Steg 8 mm)
  const r2 = await p.evaluate(async () => {
    const o = objects[0]; selectObjs([o]); enterEdgeMode(true);
    const de = o.userData._dynamicEdges || [];
    _edgeSel.clear();
    de.forEach((e, i) => { if (Math.abs(e.worldA[0] - e.worldB[0]) > 3.9 && Math.abs(e.worldA[1] - 2) < 1e-3 && Math.abs(e.worldB[1] - 2) < 1e-3 && Math.abs(Math.abs(e.worldA[2]) - 1.5) < 1e-3) _edgeSel.add(i); });
    const n = _edgeSel.size;
    await _applyEdgeHandleValue(1.0);
    const res = objects[0], w = _exaktWelt(_oc, res);
    const arten = w ? _occtEindeutig(_oc, w, _oc.TopAbs_ShapeEnum.TopAbs_FACE, x => _oc.TopoDS.Face_1(x)).map(f => new _oc.BRepAdaptor_Surface_2(f, true).GetType().value) : [];
    // Soll: Quader ohne Loch runden, dann Loch
    const oc = _oc, box = new oc.BRepPrimAPI_MakeBox_1(4, 2, 3).Shape();
    const op = new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    _occtEindeutig(oc, box, oc.TopAbs_ShapeEnum.TopAbs_EDGE, x => oc.TopoDS.Edge_1(x)).forEach(e => { const c = new oc.BRepAdaptor_Curve_2(e), a = c.Value(c.FirstParameter()), b2 = c.Value(c.LastParameter()); if (Math.abs(a.Y() - 2) < 1e-6 && Math.abs(b2.Y() - 2) < 1e-6 && Math.abs(a.X() - b2.X()) > 3.9) op.Add_2(1.0, e); });
    op.Build();
    const cyl = new oc.BRepPrimAPI_MakeCylinder_3(new oc.gp_Ax2_3(new oc.gp_Pnt_3(2, -1, 1.5), new oc.gp_Dir_4(0, 1, 0)), 0.7, 4).Shape();
    const soll = _occtVolumen(oc, new oc.BRepAlgoAPI_Cut_3(op.Shape(), cyl).Shape());
    return { n, vol: w ? _occtVolumen(oc, w) : 0, soll, frei: arten.filter(t => t > 4).length };
  });
  ok(r2.n === 2, 'Kanten-Modus: 2 obere Längskanten gewählt');
  ok(Math.abs(r2.vol - r2.soll) < 1e-4, `Rundung 10 mm am Skizzenkörper: ${r2.vol.toFixed(5)} = Soll ${r2.soll.toFixed(5)}`);
  ok(r2.frei === 0, `keine Freiformfläche (Delle): ${r2.frei}`);

  // Skizzen-Kreis Ø10 als Bohrung aus einem Quader (wie Extrudieren „Abziehen“)
  const r3 = await p.evaluate(async () => {
    _newCreate(false); addShape('box');
    const bx = objects[0]; bx.position.set(0, 1, 0); bx.updateMatrixWorld(true);
    const kreis = Array.from({ length: 64 }, (_, i) => ({ u: 0.3 + 0.5 * Math.cos(i / 64 * 2 * Math.PI), v: 0.2 + 0.5 * Math.sin(i / 64 * 2 * Math.PI) }));
    const m = _skMakeBodyFromShapes([{ outer: kreis, holes: [] }], 30, 0, null);
    m.userData.isHole = true;
    selectObjs([bx, m]); subtractHoles();
    for (let i = 0; i < 100 && !(objects.length === 1 && objects[0].userData.isSubtract); i++) await new Promise(r => setTimeout(r, 200));
    const o = objects[0], w = o.userData.exakt ? _exaktWelt(_oc, o) : null;
    return { n: objects.length, exakt: !!o.userData.exakt, vol: w ? _occtVolumen(_oc, w) : 0, kreise: (o.userData._brepEdges || []).filter(e => e.circle).length };
  });
  const soll3 = 8 - Math.PI * 0.25 * 2;
  ok(r3.n === 1 && r3.exakt && Math.abs(r3.vol - soll3) < 1e-4, `Skizzen-Kreis abgezogen: exakt ${r3.vol.toFixed(5)} = Soll ${soll3.toFixed(5)}`);
  ok(r3.kreise === 2, `Lochränder als echte Kreise: ${r3.kreise}`);

  // Speichern/Laden eines Skizzenkörpers
  const r4 = await p.evaluate(async () => {
    _newCreate(false);
    const m = _skMakeBodyFromShapes([{ outer: [{ u: 0, v: 0 }, { u: 2, v: 0 }, { u: 2, v: 1 }, { u: 0, v: 1 }], holes: [] }], 10, 0, null);
    const d = JSON.parse(JSON.stringify(objectToData(m)));
    const n = buildObjectFromData(d);
    for (let i = 0; i < 50 && !_brepOk(n); i++) await new Promise(r => setTimeout(r, 100));
    const w = _exaktWelt(_oc, n);
    return { ok: _brepOk(n), vol: w ? _occtVolumen(_oc, w) : 0 };
  });
  ok(r4.ok && Math.abs(r4.vol - 2) < 1e-5, `Skizzenkörper Speichern/Laden: exakt ${r4.vol.toFixed(5)} = 2 cm³`);

  // Gerundete Extrusion (Kante oben) bleibt beim Netz — ohne Fehler
  const r5 = await p.evaluate(() => {
    _newCreate(false);
    const m = _skMakeBodyFromShapes([{ outer: [{ u: 0, v: 0 }, { u: 2, v: 0 }, { u: 2, v: 1 }, { u: 0, v: 1 }], holes: [] }], 10, 0, { top: { fil: true, mm: 2 } });
    return { exakt: !!m.userData.exakt, n: objects.length };
  });
  ok(r5.n === 1 && !r5.exakt, 'Extrusion mit Rundung oben: Netz wie bisher');

  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
  if (warn.length) console.log('Hinweise:', warn.join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLE OK');
process.exit(fail ? 1 : 0);
