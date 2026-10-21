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
//   brace   { p, opts }             → Stabilisierungsrippe an der Seitenwand unter p (Vorschau);
//           build nimmt sie als braces: [{ p:[x,y,z] }, …] mit
//   strength { dir }                → stärkste druckbare Lage für eine kritische Zugrichtung
import { buildTopology, analyze } from '../vendor/support-fins/web/overhangs.js';
import { buildFins, applyTunables } from '../vendor/support-fins/web/fins.js';
import { suggestOrientations, suggestStrengthPose, loadAlignment } from '../vendor/support-fins/web/orient.js';
import { swayAtFace, faceIsUpright } from '../vendor/support-fins/web/sway.js';
import { PROP, BRACE } from '../vendor/support-fins/web/prop.js';
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

// ── Stabilisierungsrippen von Hand (sway.js swayAtFace) ──────────────────
// Wie im Original (ui/walls.js braceAt): Klick weit oben (≥ 75 % der vollen
// Rippenhöhe) = Rippe über die ganze Seite, sonst endet sie auf Klickhöhe (1-mm-Raster).
const SNAP_TOP = 0.75;

// Nächstes Dreieck zum Klickpunkt (Eingaberahmen); Klicks liegen auf der Fläche,
// also reicht der Abstand zur Dreiecksebene + Lage im Dreieck (grob, aber robust)
function nearestFace(p) {
  const t = needTopo(), P = t.pos;
  let best = -1, bd = Infinity;
  for (let f = 0; f < t.nFaces; f++) {
    const o = f * 9;
    const cx = (P[o] + P[o + 3] + P[o + 6]) / 3, cy = (P[o + 1] + P[o + 4] + P[o + 7]) / 3, cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3;
    const nx = t.nrm[f * 3], ny = t.nrm[f * 3 + 1], nz = t.nrm[f * 3 + 2];
    const dPlane = Math.abs((p[0] - cx) * nx + (p[1] - cy) * ny + (p[2] - cz) * nz);
    if (dPlane > 0.5) continue;
    // im Dreieck? Vorzeichen der drei Kantenprodukte gegen die Normale
    let inside = true;
    for (let i = 0; i < 3; i++) {
      const a = o + i * 3, b = o + ((i + 1) % 3) * 3;
      const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2];
      const qx = p[0] - P[a], qy = p[1] - P[a + 1], qz = p[2] - P[a + 2];
      const c = (ey * qz - ez * qy) * nx + (ez * qx - ex * qz) * ny + (ex * qy - ey * qx) * nz;
      if (c < -1e-3) { inside = false; break; }
    }
    const d = dPlane + (inside ? 0 : 1e3 + Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

function braceOpts(o) {
  return { uncappedDepth: false, gripFrom: 0, tineSpacing: 6, reach: 0.15, crossRise: 0.5,
           gap: PROP.gap, tines: o.tines !== false, iface: PROP.iface, layerHeight: o.layerHeight,
           crossAbove: o.tallRibs === false ? Infinity : BRACE.tallH };
}

// Eine Rippe für den Klickpunkt p (Eingaberahmen); avoid = { braces, walls } im Kern-Rahmen
function oneBrace(p, o, S, avoid) {
  const f = nearestFace(p);
  if (f < 0) return { ok: false, reason: 'there is no face under that spot to brace' };
  if (!faceIsUpright(needTopo(), ID, f)) return { ok: false, reason: 'that face leans too far to stand a brace against' };
  const off = S.res.offset, q = [p[0] + off.x, p[1] + off.y, p[2] + off.z];
  const bo = braceOpts(o);
  const full = swayAtFace(needTopo(), S.res, ID, f, q, { ...bo, full: true }, avoid);
  if (!full.ok || q[2] >= SNAP_TOP * full.height) return { ...full, full: true };
  const z = Math.max(1, Math.round(q[2]));
  const r = swayAtFace(needTopo(), S.res, ID, f, [q[0], q[1], z], bo, avoid);
  return { ...r, full: false };
}

// Gründe aus draw.js / sway.js auf Deutsch
function grund(r) {
  const s = String(r || '');
  if (s.startsWith('that face leans too far')) return 'diese Fläche ist zu schräg — eine senkrechte Seite anklicken';
  if (s.startsWith('there is no face under')) return 'dort ist keine Seitenfläche';
  if (s.startsWith('that face only reaches')) return 'die Seite ist zu niedrig, sie braucht keine Rippe';
  if (s.startsWith('that’s too low for a brace')) return 'zu tief geklickt — weiter oben an der Seite klicken';
  if (s.startsWith('the part sticks out over that spot')) return 'darüber steht das Teil vor, eine Rippe von der Platte kommt nicht hin';
  if (s.startsWith('the part’s base spreads out')) return 'der Fuß des Teils läuft unter dieser Seite aus, kein Platz für den Rippenfuß';
  if (s.startsWith('too little of this face lines up')) return 'zu wenig ebene Fläche für die Zinken — eine flachere Stelle der Seite wählen';
  if (s.startsWith('this side only starts')) return 'die Seite beginnt erst weit oben, die Rippe fände unten keinen Halt';
  if (s.startsWith('that face is too small or curved')) return 'die Fläche ist zu klein oder zu stark gewölbt für eine Rippe';
  if (s.startsWith('it would run into another brace')) return 'sie träfe eine andere Rippe — versetzt daneben klicken';
  if (s.startsWith('a support already stands there')) return 'dort steht schon eine Stütze, beide würden verschmelzen — daneben klicken';
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
  brace({ p, opts = {}, threshold = 45 }) {
    applyTunables(opts.tunables);
    const S = seated(threshold);
    let r;
    try { r = oneBrace(p, opts, S, { braces: [], walls: [] }); } catch (e) { r = { ok: false, reason: String(e.message || e) }; }
    if (!r.ok) return { ok2: false, grund: grund(r.reason) };
    const flat = []; flatten(r.tris, S.res.offset, flat);
    return { ok2: true, tris: Float32Array.from(flat), height: r.height, full: r.full };
  },

  // Festigkeit: dir = kritische Zugrichtung im Eingaberahmen (Z = Bauachse).
  // Zug: die Kraft selbst. Hebel: der Hebelarm (dort zieht die Biegung die Schichten auf).
  strength({ dir, threshold = 45 }) {
    const now = loadAlignment(dir);
    const best = suggestStrengthPose(needTopo(), dir, { threshold });
    return { now: now ? { cross: now.cross, quality: now.quality } : null,
             best: best ? { rot: Array.from(best.rot), cross: best.cross, quality: best.quality,
                            height: best.height, over: best.over, bedArea: best.bedArea } : null };
  },

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

  build({ threshold = 45, opts = {}, walls = [], braces = [] }) {
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
    // Rippen von Hand: der Reihe nach, jede weicht den vorigen und den Finnen aus
    const ribs = [], autoWalls = (built.fins || []).map((f) => f.line).filter((l) => Array.isArray(l) && l.length);
    const braceInfo = braces.map((b) => {
      let r;
      try { r = oneBrace(b.p, o, S, { braces: ribs, walls: autoWalls }); } catch (e) { r = { ok: false, reason: String(e.message || e) }; }
      if (r.ok) { ribs.push(r); flatten(r.tris, off, flat); }
      return r.ok ? { ok: true, height: r.height, full: r.full, tines: r.tines || 0 } : { ok: false, grund: grund(r.reason) };
    });
    const out = Float32Array.from(flat);
    const fins = built.fins || [];
    return {
      tris: out, walls: wallInfo, handBraces: braceInfo,
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
