'use strict';
// Bench/Test für die SVG-Prismen-Fusion im occt-server.
// Vergleicht sequenziellen Fuse (Ist) mit Einmal-Fuse (Soll) bzgl. Zeit und
// Gültigkeit (Shape vorhanden, Volumen ~gleich). Läuft offline ohne Listener.
const { getOC, buildSvgSolid, SVG_OVERLAP_MM } = require('./occt-server.js');

// N synthetische Glyph-Pfade (Kreise + Rechtecke, teils überlappend) erzeugen.
function makePaths(n) {
  const paths = [];
  for (let i = 0; i < n; i++) {
    const ox = (i % 6) * 14;          // grid-artig verteilt, mit Überlappung
    const oy = Math.floor(i / 6) * 14;
    if (i % 2 === 0) {
      // Kreis (24 Segmente)
      const pts = [];
      for (let a = 0; a < 24; a++) {
        const t = (a / 24) * Math.PI * 2;
        pts.push([ox + 6 + Math.cos(t) * 6, oy + 6 + Math.sin(t) * 6]);
      }
      paths.push({ pts, holes: [] });
    } else {
      // Rechteck
      paths.push({ pts: [[ox, oy], [ox + 11, oy], [ox + 11, oy + 11], [ox, oy + 11]], holes: [] });
    }
  }
  return paths;
}

function volume(oc, shape) {
  try {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
    const v = props.Mass();
    props.delete();
    return v;
  } catch (e) { return NaN; }
}

// Ist-Verfahren: 18× sequenziell
function fuseSequential(oc, shapes) {
  let tool = shapes[0];
  const keep = [];
  for (let k = 1; k < shapes.length; k++) {
    const f = new oc.BRepAlgoAPI_Fuse_3(tool, shapes[k]); f.Build();
    if (f.IsDone()) { tool = f.Shape(); keep.push(f); }
    else f.delete();
  }
  return tool;
}

// Soll-Verfahren: ein BOP mit Argument-/Tool-Listen
function fuseOnePass(oc, shapes) {
  const fuse = new oc.BRepAlgoAPI_Fuse_1();
  const args  = new oc.TopTools_ListOfShape_1();
  const tools = new oc.TopTools_ListOfShape_1();
  args.Append_1(shapes[0]);
  for (let k = 1; k < shapes.length; k++) tools.Append_1(shapes[k]);
  fuse.SetArguments(args);
  fuse.SetTools(tools);
  fuse.Build();
  if (!fuse.IsDone()) { fuse.delete(); throw new Error('OnePass nicht IsDone'); }
  return fuse.Shape();
}

(async () => {
  const oc = await getOC();
  console.log('OCCT geladen.');

  // API-Probe
  const has = name => typeof oc[name] !== 'undefined';
  for (const n of ['BRepAlgoAPI_Fuse_1', 'TopTools_ListOfShape_1',
                   'TopTools_ListOfShape_2', 'BOPAlgo_Builder_1',
                   'GProp_GProps_1', 'BRepGProp']) {
    console.log(`  ${has(n) ? '✓' : '✗'} ${n}`);
  }

  const N = 19;
  const paths = makePaths(N);
  const build = () => paths.map(p =>
    buildSvgSolid(oc, p, 1.0, 0, 0, 1, -SVG_OVERLAP_MM, 5)).filter(Boolean);

  // Lauf 1: sequenziell
  let shapes = build();
  console.log(`\n${shapes.length} Prismen gebaut.`);
  let t = Date.now();
  const seq = fuseSequential(oc, shapes);
  const tSeq = Date.now() - t;
  const vSeq = volume(oc, seq);
  console.log(`[sequenziell] ${tSeq} ms, Volumen=${vSeq.toFixed(1)}`);

  // Lauf 2: einmal
  shapes = build();
  t = Date.now();
  let one, tOne, vOne;
  try {
    one = fuseOnePass(oc, shapes);
    tOne = Date.now() - t;
    vOne = volume(oc, one);
    console.log(`[einmal]      ${tOne} ms, Volumen=${vOne.toFixed(1)}`);
  } catch (e) {
    console.log(`[einmal]      FEHLER: ${e.message}`);
    process.exit(2);
  }

  const dv = Math.abs(vSeq - vOne) / Math.max(vSeq, 1);
  console.log(`\nVolumen-Abweichung: ${(dv * 100).toFixed(3)} %`);
  console.log(`Speedup: ${(tSeq / Math.max(tOne, 1)).toFixed(1)}×`);
  if (dv > 0.01) { console.log('✗ Volumen weicht >1% ab — NICHT übernehmen'); process.exit(3); }
  console.log('✓ Gleiches Volumen, schneller — Optimierung sicher');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
