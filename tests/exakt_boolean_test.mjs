// Schritt 2 Arbeitsumgebungen: Die exakte Form überlebt Abziehen/Vereinen/Schnittmenge.
// Quader minus Zylinder → Ergebnis trägt _brepStep, Kanten-Modus bietet echte Kanten
// (inkl. Lochrand), Rundung/Fase neben dem Loch ohne Delle (Volumen = Soll, keine
// Freiformfläche), Speichern/Laden behält die exakte Form.
// Aufruf (im Worktree): node tests/exakt_boolean_test.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
const HIER = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 18836;
const srv = spawn('python3', [path.join(HIER, 'umgebungen-test-server.py'), String(PORT), '--dev'], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const warn = []; p.on('console', m => { if (/\[exakt\]/.test(m.text())) warn.push(m.text().slice(0, 200)); });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d-umgebungen.html`);
  await p.waitForFunction(() => typeof objects !== 'undefined' && typeof addShape === 'function', null, { timeout: 60000 });
  await p.evaluate(async () => { await _loadOCCT(); return true; });

  // Quader 40×24×20 mm (App-Einheit = cm), Durchgangsloch Ø14 mittig → 5 mm Steg zur Vorder-/Hinterkante
  const bauen = () => p.evaluate(async () => {
    try { hideStarter(); } catch (e) {}
    _newCreate(false); addShape('box'); addShape('cylinder');
    const [bx, cy] = objects;
    bx.scale.set(2, 1, 1.2); bx.position.set(0, 1, 0);
    cy.scale.set(0.7, 1.5, 0.7); cy.position.set(0, 1, 0);
    bx.updateMatrixWorld(true); cy.updateMatrixWorld(true);
    selectObjs([cy]); toggleHole(); selectObjs([bx, cy]); subtractHoles();
  });
  const fertig = () => p.waitForFunction(() => objects.length === 1 && !objects[0].userData.isHole && objects[0].userData.isSubtract, null, { timeout: 60000 });
  await bauen(); await fertig(); await p.waitForTimeout(300);

  const r1 = await p.evaluate(() => {
    const o = objects[0], u = o.userData;
    const oc = _oc, raw = _brepReadStep(oc, u._brepStep);
    const vol = raw ? _occtVolumen(oc, raw) : 0;
    return { exakt: !!u.exakt, brepOk: _brepOk(o), kanten: (u._brepEdges || []).length, kreise: (u._brepEdges || []).filter(e => e.circle).length, vol, bytes: u._brepStep ? u._brepStep.length : 0 };
  });
  const sollVol = 4 * 2.4 * 2 - Math.PI * 0.49 * 2;   // cm³
  ok(r1.exakt && r1.brepOk, 'Abziehen: Ergebnis trägt die exakte Form (_brepStep, ' + r1.bytes + ' Bytes)');
  ok(Math.abs(r1.vol - sollVol) < 1e-4, `exaktes Volumen ${r1.vol.toFixed(5)} = Soll ${sollVol.toFixed(5)} cm³ (Loch exakt rund)`);
  ok(r1.kanten === 14 && r1.kreise === 2, `echte Kanten: ${r1.kanten} (12 Quaderkanten + 2 Lochränder: ${r1.kreise} Kreise, Naht der Lochwand ausgeblendet)`);

  // Speichern → Laden (wie Datei/Projekt: JSON) behält die exakte Form
  const rt = await p.evaluate(async () => {
    const d = JSON.parse(JSON.stringify(objectToData(objects[0])));
    const n = buildObjectFromData(d);
    for (let i = 0; i < 50 && !_brepOk(n); i++) await new Promise(r => setTimeout(r, 100));
    const w = _exaktWelt(_oc, n);
    return { b64: !!d._brepStepB64, ok: _brepOk(n), kanten: (n.userData._brepEdges || []).length, vol: w ? _occtVolumen(_oc, w) : 0 };
  });
  ok(rt.b64 && rt.ok && rt.kanten === 14 && Math.abs(rt.vol - sollVol) < 1e-4, `Speichern/Laden: exakte Form bleibt (${rt.kanten} Kanten, ${rt.vol.toFixed(5)} cm³)`);

  // Kanten-Modus: obere Vorder- und Hinterkante runden (r = 8 mm, reicht ins Loch)
  const runden = (wert) => p.evaluate(async (wert) => {
    const o = objects[0];
    selectObjs([o]); enterEdgeMode(true);
    const de = o.userData._dynamicEdges || [];
    const lang = (e) => Math.abs(e.worldA[0] - e.worldB[0]) > 3.9;
    const oben = de.map((e, i) => ({ e, i })).filter(({ e }) => lang(e) && Math.abs(e.worldA[1] - 2) < 1e-3 && Math.abs(e.worldB[1] - 2) < 1e-3 && Math.abs(Math.abs(e.worldA[2]) - 1.2) < 1e-3);
    _edgeSel.clear(); oben.forEach(({ i }) => _edgeSel.add(i));
    await _applyEdgeHandleValue(wert);
    const n = objects[0], oc = _oc;
    const P = n.userData._occtParams;
    const base = _buildOCCTBaseShape(oc, n.userData.occtShape, P.sx, P.sy, P.sz, null, 0, false, n.userData._brep);
    const rr = _replayOCCTOps(oc, base, P.ops, P.sx, P.sy, P.sz);
    const arten = _occtEindeutig(oc, rr.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, x => oc.TopoDS.Face_1(x)).map(f => { const a = new oc.BRepAdaptor_Surface_2(f, true); return a.GetType().value; });
    return { gewaehlt: oben.length, angebot: de.length, opOk: rr.opOk, vol: _occtVolumen(oc, rr.shape), frei: arten.filter(t => t > 4).length, flaechen: arten.length, gueltig: _occtShapeValid(oc, rr.shape) };
  }, wert);
  // Soll: Quader ohne Loch runden, dann Loch abziehen (direkt in OCCT gerechnet)
  const soll = (wert, art) => p.evaluate(({ wert, art }) => {
    const oc = _oc;
    const box = new oc.BRepPrimAPI_MakeBox_1(4, 2, 2.4).Shape();
    const kanten = _occtEindeutig(oc, box, oc.TopAbs_ShapeEnum.TopAbs_EDGE, x => oc.TopoDS.Edge_1(x)).filter(e => {
      const c = new oc.BRepAdaptor_Curve_2(e), a = c.Value(c.FirstParameter()), b2 = c.Value(c.LastParameter());
      return Math.abs(a.Y() - 2) < 1e-6 && Math.abs(b2.Y() - 2) < 1e-6 && Math.abs(a.X() - b2.X()) > 3.9;
    });
    const op = art === 'fase' ? new oc.BRepFilletAPI_MakeChamfer(box) : new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    kanten.forEach(e => op.Add_2(wert, e)); op.Build();
    const ax = new oc.gp_Ax2_3(new oc.gp_Pnt_3(2, -1, 1.2), new oc.gp_Dir_4(0, 1, 0));
    const cyl = new oc.BRepPrimAPI_MakeCylinder_3(ax, 0.7, 4).Shape();
    return _occtVolumen(oc, new oc.BRepAlgoAPI_Cut_3(op.Shape(), cyl).Shape());
  }, { wert, art });

  const r2 = await runden(0.8), s2 = await soll(0.8, 'rund');
  ok(r2.gewaehlt === 2, `Kanten-Modus bietet ${r2.angebot} echte Kanten, 2 obere Längskanten gewählt`);
  ok(r2.opOk && r2.gueltig, 'Rundung 8 mm neben dem Loch: gültige Form');
  ok(Math.abs(r2.vol - s2) < 1e-4, `Rundung 8 mm: Volumen ${r2.vol.toFixed(5)} = Soll ${s2.toFixed(5)}`);
  ok(r2.frei === 0, `Rundung 8 mm: keine Freiformfläche (Delle) – ${r2.frei} von ${r2.flaechen}`);

  // Rückgängig nach der Rundung: zurück zum exakten Körper mit Loch
  const un = await p.evaluate(async () => {
    undo();
    const o = objects[0];
    for (let i = 0; i < 50 && !_brepOk(o); i++) await new Promise(r => setTimeout(r, 100));
    const w = _exaktWelt(_oc, o);
    return { n: objects.length, ok: _brepOk(o), params: !!o.userData._occtParams, vol: w ? _occtVolumen(_oc, w) : 0 };
  });
  ok(un.n === 1 && un.ok && !un.params && Math.abs(un.vol - sollVol) < 1e-4, `Rückgängig: wieder exakter Körper mit Loch (${un.vol.toFixed(5)} cm³)`);
  // … und nach dem Rückgängig noch einmal runden: das Ergebnis muss wieder stimmen
  const r2b = await runden(0.8);
  ok(r2b.opOk && Math.abs(r2b.vol - s2) < 1e-4 && r2b.frei === 0, `nach Rückgängig erneut gerundet: ${r2b.vol.toFixed(5)} = Soll`);
  // Rundung → Speichern → Laden: die OCCT-Schritte samt Grundform (_brep) kommen mit
  const rt2 = await p.evaluate(async () => {
    const d = JSON.parse(JSON.stringify(objectToData(objects[0])));
    const n = buildObjectFromData(d);
    for (let i = 0; i < 50 && !n.userData._brepEdges; i++) await new Promise(r => setTimeout(r, 100));
    const w = _exaktWelt(_oc, n);
    return { meta: !!d._brepMeta, vol: w ? _occtVolumen(_oc, w) : 0, kanten: (n.userData._brepEdges || []).length };
  });
  ok(rt2.meta && Math.abs(rt2.vol - s2) < 1e-4 && rt2.kanten > 14, `gerundeter Körper Speichern/Laden: ${rt2.vol.toFixed(5)} cm³, ${rt2.kanten} Kanten`);

  // Fase: neu bauen, dann Fase 8 mm (negativer Wert = Fase)
  await bauen(); await fertig(); await p.waitForTimeout(300);
  const r3 = await runden(-0.8), s3 = await soll(0.8, 'fase');
  ok(r3.opOk && r3.gueltig && Math.abs(r3.vol - s3) < 1e-4, `Fase 8 mm: Volumen ${r3.vol.toFixed(5)} = Soll ${s3.toFixed(5)}`);
  ok(r3.frei === 0, 'Fase 8 mm: keine Freiformfläche');

  // Vereinen + Schnittmenge exakt
  const ver = await p.evaluate(async () => {
    _newCreate(false); addShape('box'); addShape('cylinder');
    const [bx, cy] = objects; bx.position.set(0, 1, 0); cy.scale.set(0.5, 1.5, 0.5); cy.position.set(1, 1.5, 0); cy.updateMatrixWorld(true); bx.updateMatrixWorld(true);
    selectObjs([bx, cy]); await unionSelected();
    const o = objects[0];
    const w = o.userData.exakt ? _exaktWelt(_oc, o) : null;   // Weltform (Netz kann in mm mit Maßstab 0,1 liegen)
    return { n: objects.length, exakt: !!o.userData.exakt, vol: w ? _occtVolumen(_oc, w) : 0 };
  });
  // Würfel 2³ + Zylinder r .5 h 3 (y 0..3), halb im Würfel (x 0.5..1.5 → x>1 außerhalb)
  const verSoll = 8 + Math.PI * 0.25 * 1 + Math.PI * 0.25 * 2 / 2;
  ok(ver.n === 1 && ver.exakt && Math.abs(ver.vol - verSoll) < 1e-4, `Vereinen exakt: ${ver.vol.toFixed(5)} = ${verSoll.toFixed(5)}`);
  const sch = await p.evaluate(async () => {
    _newCreate(false); addShape('box'); addShape('cylinder');
    const [bx, cy] = objects; bx.position.set(0, 1, 0); cy.scale.set(0.5, 1.5, 0.5); cy.position.set(0, 1.5, 0); cy.updateMatrixWorld(true); bx.updateMatrixWorld(true);
    selectObjs([bx, cy]); await intersectSelected();
    const o = objects[0];
    const w = o.userData.exakt ? _exaktWelt(_oc, o) : null;   // Weltform (Netz kann in mm mit Maßstab 0,1 liegen)
    return { n: objects.length, exakt: !!o.userData.exakt, vol: w ? _occtVolumen(_oc, w) : 0 };
  });
  const schSoll = Math.PI * 0.25 * 2;   // Zylinder im Würfel: Höhe 2 (y 0..2)
  ok(sch.n === 1 && sch.exakt && Math.abs(sch.vol - schSoll) < 1e-4, `Schnittmenge exakt: ${sch.vol.toFixed(5)} = ${schSoll.toFixed(5)}`);

  // Netz-Import (kein exakter Körper) → bleibt beim Netz, ohne Fehler
  const netz = await p.evaluate(async () => {
    _newCreate(false); addShape('sphere'); addShape('box');
    const [sp, bx] = objects; sp.position.set(0, 1, 0); bx.position.set(0.8, 1, 0); sp.updateMatrixWorld(true); bx.updateMatrixWorld(true);
    selectObjs([sp, bx]); await unionSelected();
    return { n: objects.length, exakt: !!objects[0].userData.exakt };
  });
  ok(netz.n === 1 && !netz.exakt, 'Kugel + Quader: kein exakter Grundkörper → Netz wie bisher');

  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
  if (warn.length) console.log('Hinweise:', warn.join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLE OK');
process.exit(fail ? 1 : 0);
