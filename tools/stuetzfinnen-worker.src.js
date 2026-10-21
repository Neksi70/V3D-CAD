// Stützfinnen-Worker für V3D CAD (🦈 _sfn* in volme3d.html).
//
// Rechnet mit dem Kern von Support Fins (vendor/support-fins, MIT, printfins.com):
// Überhänge finden, Ausrichtungen bewerten, Finnen + Bett-Pad bauen. Läuft im
// Worker, weil ein Bau bei großen Teilen ein paar Sekunden dauern kann.
//
// Bau: node tools/bau_stuetzfinnen.mjs → lib/stuetzfinnen-worker.js
//
// Koordinaten: alles in mm, Z oben (wie der Kern). volme3d.html rechnet vor dem
// Senden aus der Szene (cm, Y oben) um und nach dem Empfang zurück.
//
// Nachrichten (jeweils mit id, Antwort { id, ok, ... } oder { id, error }):
//   load    { pos: Float32Array }   Dreiecks-Suppe, 9 Werte je Dreieck
//   analyze { threshold }           → Überhang-Flags je Dreieck + Kennzahlen
//   suggest { threshold }           → bis zu 3 Lagen (Drehung im Kern-Rahmen)
//   build   { threshold, opts, walls } → Finnen-Dreiecke (zurück in den Eingaberahmen);
//           walls = von Hand gezeichnete Wände [[ax,ay,az, bx,by,bz], …] im Eingaberahmen,
//           opts.mode 'draw' = NUR diese Wände (+ Pad), sonst zusätzlich zu den automatischen
//   ghost   { a, b }                → eine Wand als schnelle Vorschau (ohne Zinken)
import { buildTopology, analyze } from '../vendor/support-fins/web/overhangs.js';
import { buildFins } from '../vendor/support-fins/web/fins.js';
import { suggestOrientations } from '../vendor/support-fins/web/orient.js';
import { findIslands } from '../vendor/support-fins/web/islands.js';
import { drawnWall } from '../vendor/support-fins/web/draw.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
let topo = null;
let seat = null;   // { res, tris } — das Teil aufgesetzt (Rahmen des Kerns), für gezeichnete Wände

// Teil im „aufgesetzten" Rahmen als flache Liste (wie printTriangles im Original)
function seated(threshold = 45) {
  if (seat && seat.threshold === threshold) return seat;
  const t = needTopo(), res = analyze(t, threshold, ID), { x, y, z } = res.offset;
  const tris = new Float64Array(t.nFaces * 9);
  for (let i = 0; i < tris.length; i += 3) {
    tris[i] = t.pos[i] + x; tris[i + 1] = t.pos[i + 1] + y; tris[i + 2] = t.pos[i + 2] + z;
  }
  seat = { threshold, res, tris };
  return seat;
}

// Kern-Dreiecke (Punkt-Arrays oder flache Zahlen) → flache Zahlenliste, Versatz abgezogen
function flatten(list, off, into) {
  for (const p of list) {
    if (Array.isArray(p) || ArrayBuffer.isView(p)) into.push(p[0] - off.x, p[1] - off.y, p[2] - off.z);
    else { const k = into.length % 3; into.push(p - (k === 0 ? off.x : k === 1 ? off.y : off.z)); }   // schon flach
  }
}

// Eine gezeichnete Wand, a/b im Eingaberahmen
function oneWall(a, b, opts, S) {
  const o = S.res.offset;
  const A = [a[0] + o.x, a[1] + o.y, a[2] + o.z], B = [b[0] + o.x, b[1] + o.y, b[2] + o.z];
  return drawnWall(A, B, S.tris, 0, opts);
}

// Gründe aus draw.js auf Deutsch
function grund(r) {
  const s = String(r || '');
  if (s.startsWith('wall too short')) return 'zu kurz (mindestens 2 mm ziehen)';
  if (s.startsWith('no surface')) return 'auf dieser Linie liegt keine Unterseite des Teils';
  if (s.startsWith('too close to the part')) return 'zu nah am Teil — der Fuß würde ins Teil schneiden';
  if (s.startsWith('nothing to hold up')) return 'die Linie liegt an der Platte, da ist nichts zu stützen';
  if (s.startsWith('part of the model sits under') || s.startsWith('this overhang sits above'))
    return 'unter diesem Überhang liegt ein anderer Teil des Modells';
  return s;
}

function needTopo() {
  if (!topo) throw new Error('Kein Teil geladen');
  return topo;
}

// Kennzahlen, die das Panel anzeigt (ohne die großen Arrays)
function stats(res) {
  return { regions: res.regions.length, overArea: res.overArea, bedArea: res.bedArea,
           size: res.size, offset: res.offset };
}

const handlers = {
  ghost({ a, b, threshold = 45 }) {
    const S = seated(threshold);
    let r;
    try { r = oneWall(a, b, { braceTall: true }, S); } catch (e) { r = { ok: false, reason: String(e.message || e) }; }
    if (!r.ok) return { ok2: false, grund: grund(r.reason) };
    const flat = []; flatten(r.tris, S.res.offset, flat);
    return { ok2: true, tris: Float32Array.from(flat), height: r.height, length: r.length };
  },

  load({ pos }) {
    seat = null;
    topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
    return { faces: topo.nFaces };
  },

  analyze({ threshold = 45 }) {
    const res = analyze(needTopo(), threshold, ID);
    return { kept: res.kept.slice(), ...stats(res) };
  },

  suggest({ threshold = 45 }) {
    const s = suggestOrientations(needTopo(), { top: 3, threshold });
    return { confidence: s.confidence,
             candidates: s.candidates.map((c) => ({
               rot: Array.from(c.rot), overArea: c.overArea, bedArea: c.bedArea,
               height: c.height, regions: c.regions, walls: c.walls, coverage: c.coverage,
               volume: c.volume, seating: c.seating })) };
  },

  build({ threshold = 45, opts = {}, walls = [] }) {
    const t = needTopo();
    const res = analyze(t, threshold, ID);
    const o = { ...opts };
    // Volle Abdeckung stützt auch Inseln (Punkte, die in der Luft anfangen)
    if (o.mode === 'full') o.islands = findIslands(t, res, ID);
    const built = buildFins(t, res, ID, o);
    // Kern liefert Eckpunkte im „aufgesetzten" Rahmen (Teil mittig, Unterkante z=0):
    // Versatz abziehen, dann liegen sie wieder im Rahmen der gesendeten Suppe.
    const off = res.offset;
    const flat = [];
    flatten([...(built.triangles || []), ...(built.padTriangles || [])], off, flat);
    // Von Hand gezeichnete Wände, mit denselben Zinken wie die automatischen
    const S = seated(threshold);
    const wopts = { tines: o.tines !== false, tineDensity: o.tineDensity || 0, layerHeight: o.layerHeight,
                    plateOnly: false, braceTall: o.tallRibs !== false, topo: t, rot: ID, offset: off };
    const wallInfo = walls.map((w) => {
      let r;
      try { r = oneWall(w.slice(0, 3), w.slice(3, 6), wopts, S); } catch (e) { r = { ok: false, reason: String(e.message || e) }; }
      if (r.ok) flatten(r.tris, off, flat);
      return r.ok ? { ok: true, height: r.height, length: r.length, tines: r.tines || 0 } : { ok: false, grund: grund(r.reason) };
    });
    const out = Float32Array.from(flat);
    const fins = built.fins || [];
    return {
      tris: out, walls: wallInfo,
      fins: fins.filter((f) => f.kind !== 'sway').length,
      braces: fins.filter((f) => f.kind === 'sway').length,
      tines: built.tines || 0,
      pad: !!built.pad,
      unserved: built.unserved || 0,
      volume: built.volume || 0,
      seating: built.seating ? built.seating.kind : 'unknown',
      floating: Array.isArray(built.floating) ? built.floating.length : (built.floating ? 1 : 0),
      bare: built.bare ? { area: built.bare.area, total: built.bare.total } : null,
      ...stats(res),
    };
  },
};

self.onmessage = (e) => {
  const { id, cmd } = e.data || {};
  try {
    const h = handlers[cmd];
    if (!h) throw new Error('Unbekannter Befehl: ' + cmd);
    const r = h(e.data);
    const transfer = r && r.tris ? [r.tris.buffer] : (r && r.kept ? [r.kept.buffer] : []);
    self.postMessage({ id, ok: true, ...r }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
