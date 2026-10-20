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
//   build   { threshold, opts }     → Finnen-Dreiecke (zurück in den Eingaberahmen)
import { buildTopology, analyze } from '../vendor/support-fins/web/overhangs.js';
import { buildFins } from '../vendor/support-fins/web/fins.js';
import { suggestOrientations } from '../vendor/support-fins/web/orient.js';
import { findIslands } from '../vendor/support-fins/web/islands.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
let topo = null;

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
  load({ pos }) {
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

  build({ threshold = 45, opts = {} }) {
    const t = needTopo();
    const res = analyze(t, threshold, ID);
    const o = { ...opts };
    // Volle Abdeckung stützt auch Inseln (Punkte, die in der Luft anfangen)
    if (o.mode === 'full') o.islands = findIslands(t, res, ID);
    const built = buildFins(t, res, ID, o);
    // Kern liefert Eckpunkte im „aufgesetzten" Rahmen (Teil mittig, Unterkante z=0):
    // Versatz abziehen, dann liegen sie wieder im Rahmen der gesendeten Suppe.
    const { x: ox, y: oy, z: oz } = res.offset;
    const list = [...(built.triangles || []), ...(built.padTriangles || [])];
    const out = new Float32Array(list.length * 3);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      out[i * 3] = p[0] - ox; out[i * 3 + 1] = p[1] - oy; out[i * 3 + 2] = p[2] - oz;
    }
    const fins = built.fins || [];
    return {
      tris: out,
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
