// Druck-Check — Slicer-Analyse: Einstellungen gegen Material, Düse und Modell
// abgleichen und Verbesserungen vorschlagen. Reiner Rechenkern ohne DOM, läuft
// im Browser und in Node (Tests). EINE Quelle für den V3D Slicer (Werkzeug
// „Prüfen") und das Standalone-Tool V3D Druckcheck (~/v3ddruckcheck, bauen.py
// bettet diese Datei ein).
//
// Eingänge:
//  • G-Code (Orca/Bambu: CONFIG_BLOCK mit allen Werten + Kopf-Statistik)
//  • .gcode.3mf / Projekt-3MF (Metadata/project_settings.config = JSON,
//    Netze aus 3D/*.model inkl. Bambu-Komponenten)
//  • STL (nur Modell; Einstellungen kommen dann aus einer Vorgabe)
//  • im Slicer: gemergte Profilkette + Overrides + Welt-Netze
//
// Ausgang: Befunde { id, level, cat, title, detail, fixes:[{key,value}] } —
// fixes sind Orca-Schlüssel, die der Slicer 1:1 übernimmt bzw. die in ein
// korrigiertes 3MF geschrieben werden.

export const LEVEL = { OK: 0, INFO: 1, WARN: 2, ERROR: 3 };
export const LEVEL_NAMES = ['OK', 'Hinweis', 'Warnung', 'Fehler'];
export const LEVEL_ICONS = ['✅', 'ℹ️', '⚠️', '⛔'];

// ---------------------------------------------------------------------------
// Config-Zugriff (Werte kommen als String „200,200" / „PLA;PLA" aus dem G-Code
// oder als Array/String aus project_settings bzw. der Profilkette)
// ---------------------------------------------------------------------------
const unq = s => String(s).trim().replace(/^"(.*)"$/, '$1');
export function cfgList(cfg, key) {
  const v = cfg ? cfg[key] : undefined;
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map(unq);
  const s = String(v);
  if (s.includes(';')) return s.split(';').map(unq);
  if (/^\s*-?[\d.]+%?(\s*,\s*-?[\d.]+%?)+\s*$/.test(s)) return s.split(',').map(x => x.trim());
  return [unq(s)];
}
export function cfgStr(cfg, key, i = 0) {
  const l = cfgList(cfg, key);
  return l.length ? (l[i] !== undefined ? l[i] : l[0]) : '';
}
export function cfgNum(cfg, key, i = 0, def = NaN) {
  const v = parseFloat(cfgStr(cfg, key, i));
  return Number.isFinite(v) ? v : def;
}
export function cfgBool(cfg, key, i = 0) {
  const s = cfgStr(cfg, key, i).toLowerCase();
  return s === '1' || s === 'true';
}
const has = (cfg, key) => cfg && cfg[key] !== undefined && cfg[key] !== null && cfg[key] !== '';

// Breite „0.42" oder „105%" (von der Düse) → mm; 0/leer = automatisch → NaN
function widthMm(v, d) {
  const s = String(v || '').trim();
  if (!s) return NaN;
  const x = parseFloat(s);
  if (!Number.isFinite(x) || x <= 0) return NaN;
  return s.endsWith('%') ? d * x / 100 : x;
}
const r2 = v => Math.round(v * 100) / 100;
const de = (v, n = 2) => (Math.round(v * 10 ** n) / 10 ** n).toString().replace('.', ',');

// Lesbare Namen + Fundort in Bambu Studio / OrcaSlicer
// Name = genau wie im deutschen Bambu Studio (aus dessen Übersetzung abgelesen), damit man
// ihn dort findet; wo Studio deutsch ist, steht der englische Fachbegriff (OrcaSlicer,
// englische Anleitungen) in Klammern dahinter. Plattennamen lässt Studio englisch.
export const LABELS = {
  nozzle_temperature: ['Düsentemperatur (Nozzle temperature)', 'Filament › Drucktemperatur › Düse › Andere Schichten'],
  nozzle_temperature_initial_layer: ['Düsentemperatur erste Schicht (Initial layer)', 'Filament › Drucktemperatur › Düse › Erste Schicht'],
  cool_plate_temp: ['Druckbetttemperatur Cool Plate', 'Filament › Druckbetttemperatur › Andere Schichten'],
  eng_plate_temp: ['Druckbetttemperatur Engineering Plate', 'Filament › Druckbetttemperatur › Andere Schichten'],
  hot_plate_temp: ['Druckbetttemperatur Smooth PEI Plate / High Temp Plate', 'Filament › Druckbetttemperatur › Andere Schichten'],
  textured_plate_temp: ['Druckbetttemperatur Textured PEI Plate', 'Filament › Druckbetttemperatur › Andere Schichten'],
  supertack_plate_temp: ['Druckbetttemperatur Cool Plate (SuperTack)', 'Filament › Druckbetttemperatur › Andere Schichten'],
  textured_cool_plate_temp: ['Druckbetttemperatur Textured Cool Plate', 'Filament › Druckbetttemperatur › Andere Schichten'],
  cool_plate_temp_initial_layer: ['Druckbetttemperatur erste Schicht Cool Plate', 'Filament › Druckbetttemperatur › Erste Schicht'],
  eng_plate_temp_initial_layer: ['Druckbetttemperatur erste Schicht Engineering Plate', 'Filament › Druckbetttemperatur › Erste Schicht'],
  hot_plate_temp_initial_layer: ['Druckbetttemperatur erste Schicht Smooth PEI Plate / High Temp Plate', 'Filament › Druckbetttemperatur › Erste Schicht'],
  textured_plate_temp_initial_layer: ['Druckbetttemperatur erste Schicht Textured PEI Plate', 'Filament › Druckbetttemperatur › Erste Schicht'],
  supertack_plate_temp_initial_layer: ['Druckbetttemperatur erste Schicht Cool Plate (SuperTack)', 'Filament › Druckbetttemperatur › Erste Schicht'],
  textured_cool_plate_temp_initial_layer: ['Druckbetttemperatur erste Schicht Textured Cool Plate', 'Filament › Druckbetttemperatur › Erste Schicht'],
  curr_bed_type: ['Druckplatte (Plate type)', 'Plattenauswahl oben im Slicer'],
  layer_height: ['Schichthöhe (Layer height)', 'Prozess › Qualität › Schichthöhe'],
  initial_layer_print_height: ['Höhe der ersten Schicht (Initial layer height)', 'Prozess › Qualität › Schichthöhe'],
  line_width: ['Breite der Linie › Standard (Line width › Default)', 'Prozess › Qualität › Breite der Linie'],
  outer_wall_line_width: ['Breite der Linie › Außenwand (Outer wall)', 'Prozess › Qualität › Breite der Linie'],
  inner_wall_line_width: ['Breite der Linie › Innere Wand (Inner wall)', 'Prozess › Qualität › Breite der Linie'],
  initial_layer_line_width: ['Breite der Linie › Erste Schicht (Initial layer)', 'Prozess › Qualität › Breite der Linie'],
  sparse_infill_line_width: ['Breite der Linie › Füllung (Sparse infill)', 'Prozess › Qualität › Breite der Linie'],
  top_surface_line_width: ['Breite der Linie › Oberfläche (Top surface)', 'Prozess › Qualität › Breite der Linie'],
  enable_support: ['Stützstrukturen aktivieren (Enable support)', 'Prozess › Stützen'],
  support_type: ['Stützen › Typ (Support type)', 'Prozess › Stützen › Typ'],
  brim_type: ['Randtyp (Brim type)', 'Prozess › Sonstige › Umrandung'],
  brim_width: ['Randbreite (Brim width)', 'Prozess › Sonstige › Umrandung'],
  wall_generator: ['Wandgenerator (Wall generator)', 'Prozess › Qualität › Wandgenerator'],
  min_feature_size: ['Minimale Feature-Größe (Minimum feature size)', 'Prozess › Qualität › Wandgenerator (bei Arachne)'],
  min_bead_width: ['Minimale Wandbreite (Minimum wall width)', 'Prozess › Qualität › Wandgenerator (bei Arachne)'],
  min_length_factor: ['Minimale Wandlänge (Minimum wall length, nur OrcaSlicer)', 'Prozess › Qualität › Wandgenerator (bei Arachne)'],
  wall_loops: ['Wandlinien (Wall loops)', 'Prozess › Stärke › Wände'],
  top_shell_layers: ['Obere Schalenschichten (Top shell layers)', 'Prozess › Stärke › Obere/Untere Schichten'],
  bottom_shell_layers: ['Untere Schalenschichten (Bottom shell layers)', 'Prozess › Stärke › Obere/Untere Schichten'],
  sparse_infill_density: ['Fülldichte (Sparse infill density)', 'Prozess › Stärke › Füllung'],
  fan_min_speed: ['Min fan speed', 'Filament › Kühlung › Bauteillüfter'],
  fan_max_speed: ['Max fan speed', 'Filament › Kühlung › Bauteillüfter'],
  enable_overhang_speed: ['Verlangsamen bei Überhängen (Slow down for overhang)', 'Prozess › Geschwindigkeit'],
};
// Weitere deutsche Namen (Slicer: aus params.json; Standalone: von bauen.py eingebettet)
let EXTRA_LABELS = {};
export function setKeyLabels(map) { EXTRA_LABELS = map || {}; }
// params.json (Seiten › Gruppen › Optionen) → Schlüssel → deutscher Name; doppelte Namen
// („Andere Schichten") bekommen die Gruppe davor
export function labelsFromParams(P) {
  const out = {}, seen = {};
  for (const pg of (P && P.pages) || []) for (const g of pg.groups || []) for (const k of g.options || []) {
    const l = P.options[k] && P.options[k].label;
    if (!l) continue;
    out[k] = [l, g.name]; seen[l] = (seen[l] || 0) + 1;
  }
  for (const k in out) out[k] = seen[out[k][0]] > 1 ? `${out[k][1]}: ${out[k][0]}` : out[k][0];
  return out;
}
export function keyLabel(key) { return LABELS[key] ? LABELS[key][0] : EXTRA_LABELS[key] || key; }
export function keyWhere(key) { return (LABELS[key] || [, ''])[1]; }

// Anzeige-Werte (Enums)
const ENUM_DE = {
  'tree(auto)': 'Baum (auto) (Tree(auto))', 'normal(auto)': 'Normal (auto)', 'tree(manual)': 'Baum (manuell) (Tree(manual))', 'normal(manual)': 'Normal (manuell)',
  auto_brim: 'Automatisch (Auto)', outer_only: 'Nur äußerer Rand (Outer brim only)', no_brim: 'Keine Umrandung (No-brim)', brim_ears: 'Mouse ear',
  inner_only: 'Nur innerer Rand (Inner brim only)', outer_and_inner: 'Äußerer und innerer Rand (Outer and inner brim)', painted: 'Bemalt (Painted)',
  arachne: 'Arachne', classic: 'Klassisch (Classic)',
  'Textured PEI Plate': 'Textured PEI Plate', 'Cool Plate': 'Cool Plate', 'High Temp Plate': 'Smooth PEI Plate / High Temp Plate',
  'Smooth PEI Plate': 'Smooth PEI Plate / High Temp Plate', 'Engineering Plate': 'Engineering Plate', 'Supertack Plate': 'Cool Plate (SuperTack)',
  'Cool Plate (SuperTack)': 'Cool Plate (SuperTack)', 'Textured Cool Plate': 'Textured Cool Plate',
};
export function valueText(key, v) {
  const s = String(v ?? '');
  if (key === 'enable_support' || key === 'enable_overhang_speed') return s === '1' || s === 'true' ? 'an' : 'aus';
  if (ENUM_DE[s]) return ENUM_DE[s];
  if (/temp/.test(key) && s !== '') return s + ' °C';
  if (/(height|width)$/.test(key) && /^[\d.]+$/.test(s)) return de(parseFloat(s), 3) + ' mm';
  if (/fan_.*speed/.test(key) && /^[\d.]+$/.test(s)) return s + ' %';
  if (/^[\d.]+%$/.test(s)) return s.replace('%', ' %').replace('.', ',');
  return s.replace('.', ',');
}

// ---------------------------------------------------------------------------
// Material-Tabelle (Fallback, wenn das Profil keinen Temperaturbereich hat).
// bed: [min,max] je Plattenart; null = für das Material ungeeignet
// ---------------------------------------------------------------------------
const MAT = {
  PLA:  { noz: [190, 230], bed: { cool: [35, 45], tex: [45, 65], hot: [45, 65], eng: [45, 65], tack: [35, 55], texcool: [35, 50] }, fanLow: 50 },
  PETG: { noz: [220, 260], bed: { cool: null, tex: [60, 80], hot: [60, 80], eng: [60, 80], tack: [50, 70], texcool: null } },
  ABS:  { noz: [240, 280], bed: { cool: null, tex: [90, 110], hot: [90, 110], eng: [90, 110], tack: null, texcool: null }, fanMax: 50, warp: true },
  ASA:  { noz: [240, 280], bed: { cool: null, tex: [90, 110], hot: [90, 110], eng: [90, 110], tack: null, texcool: null }, fanMax: 50, warp: true },
  PC:   { noz: [260, 300], bed: { cool: null, tex: [100, 120], hot: [100, 120], eng: [100, 120], tack: null, texcool: null }, fanMax: 50, warp: true },
  PA:   { noz: [260, 300], bed: { cool: null, tex: [80, 110], hot: [80, 110], eng: [80, 110], tack: null, texcool: null }, fanMax: 50, warp: true },
  TPU:  { noz: [210, 250], bed: { cool: [30, 45], tex: [30, 50], hot: [30, 50], eng: [30, 50], tack: [30, 45], texcool: [30, 45] } },
  PVA:  { noz: [190, 220], bed: { cool: [35, 50], tex: [45, 60], hot: [45, 60], eng: [45, 60], tack: [35, 50], texcool: [35, 50] } },
  HIPS: { noz: [220, 260], bed: { cool: null, tex: [90, 110], hot: [90, 110], eng: [90, 110], tack: null, texcool: null }, fanMax: 50, warp: true },
};
export function materialFamily(type) {
  const t = String(type || '').toUpperCase();
  if (/^(PCTG|PETG|PET)/.test(t)) return 'PETG';
  if (/^(PLA|PHA)/.test(t)) return 'PLA';
  if (/^ABS/.test(t)) return 'ABS';
  if (/^ASA/.test(t)) return 'ASA';
  if (/^PC/.test(t)) return 'PC';
  if (/^(PA|PAHT|PPA|NYLON)/.test(t)) return 'PA';
  if (/^(TPU|TPE|FLEX)/.test(t)) return 'TPU';
  if (/^(PVA|BVOH)/.test(t)) return 'PVA';
  if (/^HIPS/.test(t)) return 'HIPS';
  return null;
}
// curr_bed_type (Orca-, Bambu- und V3D-Slicer-Schreibweisen) → Kurzname + Temperatur-Schlüssel
export function bedInfo(bedType) {
  const b = String(bedType || '').toLowerCase();
  if (/supertack/.test(b)) return { kind: 'tack', key: 'supertack_plate_temp', name: 'Cool Plate (SuperTack)' };
  if (/textured cool/.test(b)) return { kind: 'texcool', key: 'textured_cool_plate_temp', name: 'Textured Cool Plate' };
  if (/cool/.test(b)) return { kind: 'cool', key: 'cool_plate_temp', name: 'Cool Plate' };
  if (/eng/.test(b)) return { kind: 'eng', key: 'eng_plate_temp', name: 'Engineering Plate' };
  if (/high temp|smooth/.test(b)) return { kind: 'hot', key: 'hot_plate_temp', name: 'Smooth PEI Plate / High Temp Plate' };
  return { kind: 'tex', key: 'textured_plate_temp', name: 'Textured PEI Plate' };
}

// ---------------------------------------------------------------------------
// Einlesen
// ---------------------------------------------------------------------------
// G-Code: Config-Block, Kopf-Statistik, Merkmalsarten (;TYPE: bzw. ; FEATURE:)
export function parseGcode(text) {
  const cfg = {};
  let block = text;
  const a = text.indexOf('; CONFIG_BLOCK_START'), b = text.indexOf('; CONFIG_BLOCK_END');
  if (a >= 0 && b > a) block = text.slice(a, b);
  const re = /^; ([a-z0-9_]+) = (.*)$/gm;
  let m;
  while ((m = re.exec(block))) cfg[m[1]] = m[2];
  const features = {};
  const fre = /^;\s?(?:TYPE:|FEATURE: )(.+)$/gm;
  while ((m = fre.exec(text))) { const f = m[1].trim(); features[f] = (features[f] || 0) + 1; }
  const head = text.slice(0, 4000);
  const grab = (r, s = text) => { const x = s.match(r); return x ? x[1].trim() : ''; };
  const nums = s => s ? s.split(',').map(parseFloat).filter(Number.isFinite) : [];
  const weights = nums(grab(/total filament weight \[g\] : ([\d.,]+)/, head)) ;
  const w2 = weights.length ? weights : nums(grab(/^; filament used \[g\] = ([\d.,]+)/m));
  const timeText = grab(/total estimated time: ([^;\n]+)/);
  const used = nums(grab(/^; filament: ([\d,]+)/m, head)).map(x => x - 1).filter(x => x >= 0);
  return {
    cfg, features,
    stats: {
      slicer: grab(/^; (BambuStudio [\d.]+)/m, head) || grab(/^; generated by (\S+ \S+)/m, head) || '',
      timeText, timeS: parseDuration(timeText),
      weightG: w2.reduce((s, x) => s + x, 0) || parseFloat(grab(/^; total filament used \[g\] = ([\d.]+)/m)) || 0,
      layers: parseInt(grab(/total layer number: (\d+)/, head), 10) || 0,
      maxZ: parseFloat(grab(/max_z_height: ([\d.]+)/, head)) || 0,
    },
    usedFilaments: used.length ? used : null,
  };
}
// Sekunden → „1 h 05 min" / „16 min 29 s"
export function fmtDuration(t) {
  if (!(t > 0)) return '';
  const d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), sec = Math.round(t % 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return m ? `${m} min ${sec} s` : `${sec} s`;
}
export function parseDuration(s) {
  if (!s) return 0;
  let t = 0;
  for (const [, v, u] of String(s).matchAll(/([\d.]+)\s*([dhms])/g))
    t += parseFloat(v) * { d: 86400, h: 3600, m: 60, s: 1 }[u];
  return t;
}

// --- ZIP lesen/schreiben (3MF) ---------------------------------------------
async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
async function deflateRaw(u8) {
  try {
    const cs = new CompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
  } catch { return null; }
}
// Map name → { get(): Promise<Uint8Array> } über das zentrale Verzeichnis
export function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--)
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine ZIP/3MF-Datei');
  let n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nl));
    off += 46 + nl + xl + cl;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(start, start + csize);
    let cache = null;
    files.set(name, { get: () => cache || (cache = method === 8 ? inflateRaw(raw) : Promise.resolve(raw)) });
  }
  return files;
}
function crc32(u8) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < u8.length; n++) {
    c = (crc ^ u8[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
export async function writeZip(files /* [{name, data}] */) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(raw);
    const def = await deflateRaw(raw);
    const useDef = def && def.length < raw.length;
    const body = useDef ? def : raw;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, useDef ? 8 : 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, useDef ? 8 : 0, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true);
    ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'model/3mf' });
}

// --- 3MF-Netze (inkl. Bambu-Komponenten in 3D/Objects/*.model) --------------
const MAT_ID = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function parseTransform(s) {
  if (!s) return MAT_ID;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : MAT_ID;
}
// 3MF: Zeilenvektor · M → x' = x·m00 + y·m10 + z·m20 + m30
function mulT(a, b) {   // erst a, dann b
  const r = new Array(12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j] + (i === 3 ? b[9 + j] : 0);
  }
  return r;
}
const attr = (s, n) => { const m = s.match(new RegExp('\\s' + n + '="([^"]*)"')); return m ? m[1] : null; };
function parseModelXml(xml) {
  const objs = new Map();
  const ore = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = ore.exec(xml))) {
    const id = attr(m[1], 'id'), body = m[2];
    const o = { id, name: attr(m[1], 'name') || '', mesh: null, comps: [] };
    const mi = body.indexOf('<mesh');
    if (mi >= 0) {
      const vs = [], ts = [];
      const vre = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
      let v; while ((v = vre.exec(body))) vs.push(+v[1], +v[2], +v[3]);
      const tre = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
      while ((v = tre.exec(body))) ts.push(+v[1], +v[2], +v[3]);
      o.mesh = { pos: new Float32Array(vs), index: new Uint32Array(ts) };
    }
    const cre = /<component\b([^>]*)\/?>/g;
    let c; while ((c = cre.exec(body)))
      o.comps.push({ path: attr(c[1], 'p:path'), id: attr(c[1], 'objectid'), T: parseTransform(attr(c[1], 'transform')) });
    objs.set(id, o);
  }
  const items = [];
  const ire = /<item\b([^>]*)\/?>/g;
  while ((m = ire.exec(xml))) items.push({ id: attr(m[1], 'objectid'), T: parseTransform(attr(m[1], 'transform')),
    printable: attr(m[1], 'printable') !== '0' });
  return { objs, items };
}
async function read3mfMeshes(zip) {
  const dec = new TextDecoder();
  const docs = new Map();
  const doc = async p => {
    const key = p.replace(/^\//, '');
    if (!docs.has(key)) { const f = zip.get(key); docs.set(key, f ? parseModelXml(dec.decode(await f.get())) : { objs: new Map(), items: [] }); }
    return docs.get(key);
  };
  const root = await doc('3D/3dmodel.model');
  const out = [];
  const collect = async (d, id, T, parts, depth) => {
    const o = d.objs.get(id);
    if (!o || depth > 8) return;
    if (o.mesh && o.mesh.index.length) parts.push({ ...o.mesh, T });
    for (const c of o.comps) await collect(c.path ? await doc(c.path) : d, c.id, mulT(c.T, T), parts, depth + 1);
  };
  for (const it of root.items) {
    if (!it.printable) continue;
    const parts = [];
    await collect(root, it.id, it.T, parts, 0);
    if (!parts.length) continue;
    const nv = parts.reduce((s, p) => s + p.pos.length, 0), ni = parts.reduce((s, p) => s + p.index.length, 0);
    const pos = new Float32Array(nv), index = new Uint32Array(ni);
    let ov = 0, oi = 0;
    for (const p of parts) {
      const T = p.T, P = p.pos;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        pos[ov + i] = x * T[0] + y * T[3] + z * T[6] + T[9];
        pos[ov + i + 1] = x * T[1] + y * T[4] + z * T[7] + T[10];
        pos[ov + i + 2] = x * T[2] + y * T[5] + z * T[8] + T[11];
      }
      for (let i = 0; i < p.index.length; i++) index[oi + i] = p.index[i] + ov / 3;
      ov += P.length; oi += p.index.length;
    }
    out.push({ name: root.objs.get(it.id)?.name || `Objekt ${out.length + 1}`, pos: dropToBed(pos), index });
  }
  return out;
}
function dropToBed(pos) {
  let mz = Infinity;
  for (let i = 2; i < pos.length; i += 3) if (pos[i] < mz) mz = pos[i];
  if (Number.isFinite(mz) && Math.abs(mz) > 1e-6) for (let i = 2; i < pos.length; i += 3) pos[i] -= mz;
  return pos;
}

// STL (binär oder ASCII) → { pos, index:null }
export function parseStl(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const nb = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  if (u8.length >= 84 && 84 + nb * 50 === u8.length) {
    const pos = new Float32Array(nb * 9);
    for (let t = 0; t < nb; t++) for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
    return { pos: dropToBed(pos), index: null };
  }
  const txt = new TextDecoder().decode(u8);
  const vs = [];
  for (const m of txt.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) vs.push(+m[1], +m[2], +m[3]);
  if (!vs.length) throw new Error('STL ohne Dreiecke');
  return { pos: dropToBed(new Float32Array(vs)), index: null };
}

// Beliebige Datei → { source, cfg|null, gcode|null, meshes:[], zip|null }
export async function loadAny(name, u8) {
  const low = name.toLowerCase();
  if (low.endsWith('.stl')) return { source: 'stl', cfg: null, gcode: null, meshes: [{ name, ...parseStl(u8) }], zip: null };
  if (low.endsWith('.gcode') || low.endsWith('.gco') || low.endsWith('.g')) {
    const g = parseGcode(new TextDecoder().decode(u8));
    return { source: 'gcode', cfg: g.cfg, gcode: g, meshes: [], zip: null };
  }
  const zip = readZip(u8);
  const dec = new TextDecoder();
  let cfg = null, gcode = null;
  const ps = zip.get('Metadata/project_settings.config');
  if (ps) { try { cfg = JSON.parse(dec.decode(await ps.get())); } catch {} }
  const gname = [...zip.keys()].find(n => /^Metadata\/plate_\d+\.gcode$/.test(n));
  if (gname) {
    gcode = parseGcode(dec.decode(await zip.get(gname).get()));
    cfg = cfg ? { ...gcode.cfg, ...cfg } : gcode.cfg;
  }
  let meshes = [];
  try { meshes = await read3mfMeshes(zip); } catch {}
  return { source: gcode ? 'gcode3mf' : '3mf', cfg, gcode, meshes, zip };
}

// ---------------------------------------------------------------------------
// Modell-Analyse
// ---------------------------------------------------------------------------
class DSU {
  constructor(n) { this.p = new Int32Array(n); for (let i = 0; i < n; i++) this.p[i] = i; }
  f(x) { const p = this.p; while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }
  u(a, b) { a = this.f(a); b = this.f(b); if (a !== b) this.p[a] = b; }
}

// Netz (Druckkoordinaten, z ab 0) → Kennzahlen für die Regeln
export function analyzeMesh(pos, index, { name = '', maxThickSamples = 6000 } = {}) {
  const nT = index ? index.length / 3 : pos.length / 9;
  // Vertices verschweißen (nicht-indizierte STL), Raster 1e-4 mm
  const corner = new Uint32Array(nT * 3);
  const vmap = new Map();
  const vx = [], vy = [], vz = [];
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const src = index ? index[t * 3 + k] : t * 3 + k;
    const x = pos[src * 3], y = pos[src * 3 + 1], z = pos[src * 3 + 2];
    const key = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
    let id = vmap.get(key);
    if (id === undefined) { id = vx.length; vmap.set(key, id); vx.push(x); vy.push(y); vz.push(z); }
    corner[t * 3 + k] = id;
  }
  const nV = vx.length;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < nV; i++) {
    if (vx[i] < minX) minX = vx[i]; if (vx[i] > maxX) maxX = vx[i];
    if (vy[i] < minY) minY = vy[i]; if (vy[i] > maxY) maxY = vy[i];
    if (vz[i] < minZ) minZ = vz[i]; if (vz[i] > maxZ) maxZ = vz[i];
  }
  const height = maxZ - minZ;
  const nx = new Float32Array(nT), ny = new Float32Array(nT), nz = new Float32Array(nT), area = new Float32Array(nT);
  let areaTot = 0, vol = 0, upArea = 0, gentleUp = 0, contact = 0;
  let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
  const downHist = new Float64Array(18);   // Unterseiten über dem Bett je 5° Neigung zur Waagerechten
  const flag = new Uint8Array(nT);         // 1 = steiler Überhang (<45°), 2 = waagerechte Unterseite (Brücke)
  const downTilt = new Float32Array(nT).fill(-1);   // Neigung freier Unterseiten über dem Bett
  for (let t = 0; t < nT; t++) {
    const a = corner[t * 3], b = corner[t * 3 + 1], c = corner[t * 3 + 2];
    const ux = vx[b] - vx[a], uy = vy[b] - vy[a], uz = vz[b] - vz[a];
    const wx = vx[c] - vx[a], wy = vy[c] - vy[a], wz = vz[c] - vz[a];
    let cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
    const l = Math.hypot(cx, cy, cz);
    vol += (vx[a] * (vy[b] * vz[c] - vz[b] * vy[c]) - vy[a] * (vx[b] * vz[c] - vz[b] * vx[c]) + vz[a] * (vx[b] * vy[c] - vy[b] * vx[c])) / 6;
    if (l < 1e-12) continue;
    cx /= l; cy /= l; cz /= l;
    const A = l / 2;
    nx[t] = cx; ny[t] = cy; nz[t] = cz; area[t] = A; areaTot += A;
    const zt = Math.max(vz[a], vz[b], vz[c]), zb = Math.min(vz[a], vz[b], vz[c]);
    if (cz > 0.05) {
      upArea += A;
      const tilt = Math.acos(Math.min(1, cz)) * 180 / Math.PI;   // 0 = waagerecht
      if (tilt > 3 && tilt < 25) gentleUp += A;
    } else if (cz < -0.05) {
      if (cz < -0.985 && zt <= minZ + 0.05) {
        contact += A;
        for (const v of [a, b, c]) {
          if (vx[v] < cMinX) cMinX = vx[v]; if (vx[v] > cMaxX) cMaxX = vx[v];
          if (vy[v] < cMinY) cMinY = vy[v]; if (vy[v] > cMaxY) cMaxY = vy[v];
        }
      } else if (zb > minZ + 0.1) {
        downTilt[t] = Math.acos(Math.min(1, -cz)) * 180 / Math.PI;
      }
    }
  }
  // Raster für alle Strahltests; Unterseiten, die auf eigener Geometrie aufliegen
  // (Schrift auf Sockel, überlappende Körper), zählen NICHT als Überhang
  const bb = [minX, minY, minZ, maxX, maxY, maxZ];
  const grid = buildGrid(vx, vy, vz, corner, nT, area, bb);
  const freeFrac = new Float32Array(nT);
  let budget = 60000;
  for (let t = 0; t < nT; t++) {
    const tilt = downTilt[t];
    if (!(tilt >= 0)) continue;
    let fr = 1;
    if (grid && tilt < 55 && budget > 0) {
      const k = Math.max(1, Math.min(16, Math.ceil(area[t] / 4)));
      budget -= k;
      let free = 0;
      for (let s = 0; s < k; s++) {
        let u = ((s + 0.5) / k + 0.618034 * s) % 1, v = (0.754878 * (s + 1)) % 1;
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const a = corner[t * 3], b = corner[t * 3 + 1], c = corner[t * 3 + 2];
        const px = vx[a] + u * (vx[b] - vx[a]) + v * (vx[c] - vx[a]);
        const py = vy[a] + u * (vy[b] - vy[a]) + v * (vy[c] - vy[a]);
        const pz = vz[a] + u * (vz[b] - vz[a]) + v * (vz[c] - vz[a]);
        if (!restsOn(grid, px, py, pz, t, minZ, corner, vx, vy, vz, nz)) free++;
      }
      fr = free / k;
    }
    freeFrac[t] = fr;
    if (fr <= 0) continue;
    downHist[Math.min(17, Math.floor(tilt / 5))] += area[t] * fr;
    if (fr >= 0.5) { if (tilt < 3) flag[t] = 2; else if (tilt < 45) flag[t] = 1; }
  }
  // Kanten: offene/nicht-mannigfaltige Kanten + Überhang-/Brücken-Regionen (Dreiecke über gemeinsame Kanten)
  const edges = new Map();
  const tri = new DSU(nT);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = corner[t * 3 + k], b = corner[t * 3 + (k + 1) % 3];
    if (a === b) continue;
    const key = a < b ? a * nV + b : b * nV + a;
    const e = edges.get(key);
    if (e === undefined) edges.set(key, t * 4 + 1);
    else {
      const t0 = Math.floor(e / 4), cnt = e % 4;
      edges.set(key, t0 * 4 + Math.min(3, cnt + 1));
      if (flag[t] && flag[t] === flag[t0]) tri.u(t, t0);
    }
  }
  let openEdges = 0, nonManifold = 0;
  for (const e of edges.values()) { const c = e % 4; if (c === 1) openEdges++; else if (c > 2) nonManifold++; }
  const regions = new Map();
  for (let t = 0; t < nT; t++) {
    if (!flag[t]) continue;
    const r = tri.f(t);
    let R = regions.get(r);
    if (!R) regions.set(r, R = { kind: flag[t], area: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, z: Infinity });
    R.area += area[t];
    for (let k = 0; k < 3; k++) {
      const v = corner[t * 3 + k];
      if (vx[v] < R.x0) R.x0 = vx[v]; if (vx[v] > R.x1) R.x1 = vx[v];
      if (vy[v] < R.y0) R.y0 = vy[v]; if (vy[v] > R.y1) R.y1 = vy[v];
      if (vz[v] < R.z) R.z = vz[v];
    }
  }
  const bridges = [], overhangs = [];
  for (const R of regions.values()) {
    const span = Math.min(R.x1 - R.x0, R.y1 - R.y0), o = { area: R.area, span, z: R.z - minZ, c: [(R.x0 + R.x1) / 2, (R.y0 + R.y1) / 2, R.z] };
    if (R.kind === 2) { if (R.area > 1) bridges.push(o); } else if (R.area > 1) overhangs.push(o);
  }
  bridges.sort((p, q) => q.span - p.span); overhangs.sort((p, q) => q.area - p.area);
  // Inseln: tiefste Punkte über dem Bett (Bereich gleicher Höhe ohne tieferen Nachbarn) → schweben in der Luft
  const lower = new Uint8Array(nV), vd = new DSU(nV);
  const EPS = 1e-3;
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = corner[t * 3 + k], b = corner[t * 3 + (k + 1) % 3];
    if (vz[b] < vz[a] - EPS) lower[a] = 1;
    else if (vz[a] < vz[b] - EPS) lower[b] = 1;
    else vd.u(a, b);
  }
  const rootLower = new Map();
  for (let v = 0; v < nV; v++) {
    if (vz[v] <= minZ + 0.3) continue;
    const r = vd.f(v);
    rootLower.set(r, (rootLower.get(r) || 0) | lower[v]);
  }
  // Bereich liegt auf, wenn eine angrenzende Unterseite aufliegt oder der tiefste Punkt selbst
  const rested = new Set();
  for (let t = 0; t < nT; t++) {
    if (!(downTilt[t] >= 0) || freeFrac[t] >= 1) continue;
    for (let k = 0; k < 3; k++) rested.add(vd.f(corner[t * 3 + k]));
  }
  const members = new Map();
  for (let v = 0; v < nV; v++) {
    const r = vd.f(v);
    if (rootLower.get(r) === 0 && !rested.has(r)) { const l = members.get(r); if (l) { if (l.length < 64) l.push(v); } else members.set(r, [v]); }
  }
  const islands = [], islandPts = [];
  for (const [r, vs] of members) {
    // T-Stoß: Bereich hängt an einer tiefer reichenden Fläche, ohne gemeinsame Kante
    if (grid && vs.some(v => restsOn(grid, vx[v], vy[v], vz[v], -1, minZ, corner, vx, vy, vz, nz)
                        || onLowerFace(grid, vx[v], vy[v], vz[v], corner, vx, vy, vz))) continue;
    islands.push(vz[r] - minZ);
    islandPts.push([vx[r], vy[r], vz[r]]);
  }
  islands.sort((p, q) => p - q);

  // Wandstärke: Strahl von Seitenflächen nach innen bis zur Gegenwand (≤ 4 mm)
  const thick = wallThickness(grid, vx, vy, vz, corner, nT, nx, ny, nz, area, maxThickSamples);
  return {
    name, tris: nT, size: [maxX - minX, maxY - minY, height], bbox: [minX, minY, minZ, maxX, maxY, maxZ],
    area: areaTot, volume: Math.abs(vol), contact,
    contactSize: contact > 0 ? [cMaxX - cMinX, cMaxY - cMinY] : [0, 0],
    upArea, gentleUp, downHist: Array.from(downHist), bridges: bridges.slice(0, 20), overhangs: overhangs.slice(0, 20),
    islands, islandPts, openEdges, nonManifold, thick,
    triClass: flag,   // je Eingabe-Dreieck: 1 = freier Überhang < 45°, 2 = freie waagerechte Unterseite
  };
}

// Gleichmäßiges 3D-Raster über alle Dreiecke (CSR); null wenn zu groß
function buildGrid(vx, vy, vz, corner, nT, area, bb) {
  const sx = bb[3] - bb[0], sy = bb[4] - bb[1], sz = bb[5] - bb[2];
  let cs = Math.max(0.5, Math.cbrt((sx * sy * sz + 1) / Math.max(1000, nT)) * 2);
  while ((Math.ceil(sx / cs) + 1) * (Math.ceil(sy / cs) + 1) * (Math.ceil(sz / cs) + 1) > 2e6) cs *= 1.5;
  const GX = Math.ceil(sx / cs) + 1, GY = Math.ceil(sy / cs) + 1, GZ = Math.ceil(sz / cs) + 1;
  const ci = (v, o, G) => Math.min(G - 1, Math.max(0, Math.floor((v - o) / cs)));
  const N = GX * GY * GZ;
  const cnt = new Uint32Array(N);
  const range = t => {
    const a = corner[t * 3], b = corner[t * 3 + 1], c = corner[t * 3 + 2];
    return [ci(Math.min(vx[a], vx[b], vx[c]), bb[0], GX), ci(Math.max(vx[a], vx[b], vx[c]), bb[0], GX),
            ci(Math.min(vy[a], vy[b], vy[c]), bb[1], GY), ci(Math.max(vy[a], vy[b], vy[c]), bb[1], GY),
            ci(Math.min(vz[a], vz[b], vz[c]), bb[2], GZ), ci(Math.max(vz[a], vz[b], vz[c]), bb[2], GZ)];
  };
  let total = 0;
  for (let t = 0; t < nT; t++) {
    if (area[t] === 0) continue;
    const [x0, x1, y0, y1, z0, z1] = range(t);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { cnt[(x * GY + y) * GZ + z]++; total++; }
    if (total > 3e7) return null;
  }
  const start = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) start[i + 1] = start[i] + cnt[i];
  const fill = start.slice(0, N), list = new Uint32Array(total);
  for (let t = 0; t < nT; t++) {
    if (area[t] === 0) continue;
    const [x0, x1, y0, y1, z0, z1] = range(t);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) list[fill[(x * GY + y) * GZ + z]++] = t;
  }
  return { GX, GY, GZ, cs, bb, ci, start, list, stamp: new Uint32Array(nT), stampId: 0 };
}

// Liegt der Punkt (Unterseite) auf etwas auf? Strahl senkrecht nach unten:
// Bett oder Fläche ≤ 0,3 mm darunter, oder erster Treffer ist eine Unterseite
// (Punkt steckt in einem anderen Körper) → aufliegend
function restsOn(G, px, py, pz, self, minZ, corner, vx, vy, vz, nz) {
  if (pz - minZ <= 0.3) return true;
  const ox = px, oy = py, oz = pz - 1e-4;
  const X = G.ci(ox, G.bb[0], G.GX), Y = G.ci(oy, G.bb[1], G.GY);
  const id = ++G.stampId;
  let best = Infinity, bestT = -1;
  for (let z = G.ci(oz, G.bb[2], G.GZ); z >= 0; z--) {
    const cell = (X * G.GY + Y) * G.GZ + z;
    for (let i = G.start[cell]; i < G.start[cell + 1]; i++) {
      const u = G.list[i];
      if (u === self || G.stamp[u] === id) continue;
      G.stamp[u] = id;
      const d = rayTri(ox, oy, oz, 0, 0, -1, corner, u, vx, vy, vz);
      if (d >= 0 && d < best) { best = d; bestT = u; }
    }
    if (best < oz - (G.bb[2] + z * G.cs)) break;   // nächster Treffer liegt sicher in dieser Zelle
  }
  if (bestT < 0) return false;
  return best <= 0.3 || nz[bestT] < -0.05;
}

// Liegt der Punkt auf einem Dreieck, das tiefer hinunterreicht?
function onLowerFace(G, px, py, pz, corner, vx, vy, vz) {
  const X = G.ci(px, G.bb[0], G.GX), Y = G.ci(py, G.bb[1], G.GY), Z = G.ci(pz, G.bb[2], G.GZ);
  const id = ++G.stampId;
  for (let x = Math.max(0, X - 1); x <= Math.min(G.GX - 1, X + 1); x++)
    for (let y = Math.max(0, Y - 1); y <= Math.min(G.GY - 1, Y + 1); y++)
      for (let z = Math.max(0, Z - 1); z <= Math.min(G.GZ - 1, Z + 1); z++) {
        const cell = (x * G.GY + y) * G.GZ + z;
        for (let i = G.start[cell]; i < G.start[cell + 1]; i++) {
          const u = G.list[i];
          if (G.stamp[u] === id) continue;
          G.stamp[u] = id;
          const a = corner[u * 3], b = corner[u * 3 + 1], c = corner[u * 3 + 2];
          if (Math.min(vz[a], vz[b], vz[c]) > pz - 0.01) continue;
          if (pointTriDist(px, py, pz, vx[a], vy[a], vz[a], vx[b], vy[b], vz[b], vx[c], vy[c], vz[c]) < 2e-3) return true;
        }
      }
  return false;
}
function pointTriDist(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e0x = bx - ax, e0y = by - ay, e0z = bz - az, e1x = cx - ax, e1y = cy - ay, e1z = cz - az;
  let nx = e0y * e1z - e0z * e1y, ny = e0z * e1x - e0x * e1z, nz = e0x * e1y - e0y * e1x;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) return Infinity;
  nx /= l; ny /= l; nz /= l;
  const wx = px - ax, wy = py - ay, wz = pz - az;
  const dist = wx * nx + wy * ny + wz * nz;
  if (Math.abs(dist) > 2e-3) return Infinity;
  // Baryzentrisch in der Ebene
  const d00 = e0x * e0x + e0y * e0y + e0z * e0z, d01 = e0x * e1x + e0y * e1y + e0z * e1z, d11 = e1x * e1x + e1y * e1y + e1z * e1z;
  const d20 = wx * e0x + wy * e0y + wz * e0z, d21 = wx * e1x + wy * e1y + wz * e1z;
  const den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-18) return Infinity;
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den, e = 1e-4;
  return v >= -e && w >= -e && v + w <= 1 + e ? Math.abs(dist) : Infinity;
}

function wallThickness(G, vx, vy, vz, corner, nT, nx, ny, nz, area, maxS) {
  const MAXD = 4;
  let wallA = 0;
  // Wände = Flächen bis ~58° Neigung; gemessen wird WAAGERECHT (Schichtschnitt), so wie Arachne die Breite sieht
  const isWall = t => Math.abs(nz[t]) < 0.85 && area[t] > 0;
  for (let t = 0; t < nT; t++) if (isWall(t)) wallA += area[t];
  if (wallA <= 0) return { samples: [], wallArea: 0 };
  if (!G) return { samples: [], wallArea: wallA, skipped: true };
  const { GX, GY, GZ, ci, start, list, bb } = G;
  const stamp = G.stamp;
  const samples = [], thinPts = [];
  const step = wallA / maxS;
  let acc = step / 2;
  for (let t = 0; t < nT; t++) {
    if (!isWall(t)) continue;
    acc += area[t];
    while (acc >= step) {
      acc -= step;
      // Punkt: Schwerpunkt, leicht ins Innere versetzt
      const a = corner[t * 3], b = corner[t * 3 + 1], c = corner[t * 3 + 2];
      const hl = Math.hypot(nx[t], ny[t]) || 1;
      const dx = -nx[t] / hl, dy = -ny[t] / hl, dz = 0;
      const ox = (vx[a] + vx[b] + vx[c]) / 3 + dx * 1e-3, oy = (vy[a] + vy[b] + vy[c]) / 3 + dy * 1e-3, oz = (vz[a] + vz[b] + vz[c]) / 3;
      const ex = ox + dx * MAXD, ey = oy + dy * MAXD, ez = oz + dz * MAXD;
      const X0 = ci(Math.min(ox, ex), bb[0], GX), X1 = ci(Math.max(ox, ex), bb[0], GX);
      const Y0 = ci(Math.min(oy, ey), bb[1], GY), Y1 = ci(Math.max(oy, ey), bb[1], GY);
      const Z0 = ci(Math.min(oz, ez), bb[2], GZ), Z1 = ci(Math.max(oz, ez), bb[2], GZ);
      const stampId = ++G.stampId;
      let best = Infinity;
      for (let x = X0; x <= X1; x++) for (let y = Y0; y <= Y1; y++) for (let z = Z0; z <= Z1; z++) {
        const cell = (x * GY + y) * GZ + z;
        for (let i = start[cell]; i < start[cell + 1]; i++) {
          const u = list[i];
          if (u === t || stamp[u] === stampId) continue;
          stamp[u] = stampId;
          if (nx[u] * dx + ny[u] * dy + nz[u] * dz <= 0) continue;   // nur Gegenwand (zeigt in Strahlrichtung nach außen)
          const d = rayTri(ox, oy, oz, dx, dy, dz, corner, u, vx, vy, vz);
          if (d > 0 && d < best) best = d;
        }
      }
      samples.push(best <= MAXD ? best : Infinity);
      if (best < 2 && thinPts.length < 400) thinPts.push([ox, oy, oz, best]);
    }
  }
  return { samples, thinPts, wallArea: wallA };
}
function rayTri(ox, oy, oz, dx, dy, dz, corner, t, vx, vy, vz) {
  const a = corner[t * 3], b = corner[t * 3 + 1], c = corner[t * 3 + 2];
  const e1x = vx[b] - vx[a], e1y = vy[b] - vy[a], e1z = vz[b] - vz[a];
  const e2x = vx[c] - vx[a], e2y = vy[c] - vy[a], e2z = vz[c] - vz[a];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, sx = ox - vx[a], sy = oy - vy[a], sz = oz - vz[a];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// Anteil der Wandfläche dünner als d (aus den Stichproben)
// Fläche (mm²) der Wände dünner als d
export function thinArea(thick, d) { return thinFraction(thick, d) * ((thick && thick.wallArea) || 0); }
export function thinFraction(thick, d) {
  const s = thick && thick.samples;
  if (!s || !s.length) return 0;
  let n = 0; for (const x of s) if (x < d) n++;
  return n / s.length;
}

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------
// ctx: { models:[analyzeMesh…], gcode:{features,stats}|null, usedFilaments:[i]|null,
//        adaptive:bool (Slicer: adaptive Schichthöhe aktiv) }
// Symbole je Thema (Karten im Slicer + Standalone)
export const CAT_ICONS = { Material: '🌡️', Stützen: '🏗️', Haftung: '🧲', Festigkeit: '🧱', Modell: '📐', Qualität: '✨', Abgleich: '🔁', Zweck: '🎯' };

// Wofür ist das Teil? (ctx.purpose) — Zielbereiche; layer = Anteil des Düsendurchmessers
export const PURPOSES = {
  funktion: { name: 'Funktionsteile', short: 'Funktionsteil', walls: [4, 6], infill: [25, 60],
    why: 'Belastete Teile (Halter, Clips, Gewinde) brechen fast immer an den Wänden: 4 Wände und mindestens 25 % Füllung machen sie deutlich stabiler.' },
  deko: { name: 'Deko und Sichtteile', short: 'Deko', walls: [2, 3], infill: [10, 15],
    why: 'Deko trägt nichts: 2–3 Wände und 10–15 % Füllung reichen und sparen Zeit und Material.' },
  figur: { name: 'Figuren und feine Details', short: 'Figur', walls: [2, 3], infill: [10, 15], layer: 0.3, arachne: true,
    why: 'Feine Schichten (≈ 0,12 mm bei 0,4er Düse) zeigen Gesichter und Kanten sauber; Arachne druckt dünne Stellen vollständig.' },
  entwurf: { name: 'schnelle Entwürfe', short: 'Entwurf', walls: [2, 2], infill: [8, 10], layer: 0.7,
    why: 'Zum Ausprobieren zählt die Zeit: dicke Schichten (≈ 0,28 mm), 2 Wände und wenig Füllung halbieren die Druckzeit grob.' },
};

// Wohin gehört ein Wert? 'filament' (Materialprofil), 'process' (Prozessprofil) oder 'project' (nur im Projekt)
export function settingType(key) {
  if (key === 'curr_bed_type') return 'project';
  if (/^(filament_|nozzle_temperature|[a-z_]*_plate_temp|fan_|overhang_fan|close_fan|slow_down|reduce_fan|additional_cooling|full_fan|enable_pressure_advance|pressure_advance|temperature_vitrification|chamber_temperature|activate_air_filtration|during_print_exhaust|complete_print_exhaust)/.test(key)) return 'filament';
  return 'process';
}

// Eigenes Profil (Bambu Studio / Orca-Ableger) aus dem verbesserten Projekt bauen:
// erbt vom Herstellerprofil (inherits_group) und enthält nur die Werte, die davon abweichen —
// die schon vorher selbst geänderten (different_settings_to_system) plus die neuen Korrekturen.
// type 'process' | 'filament'; fi = Filament-Index. Ergebnis { name, inherits, data } oder null.
export function buildPreset(cfg, fixes, { type, fi = 0, name, description = 'Angelegt vom V3D Druck-Assistenten' }) {
  const out = applyFixes(cfg, fixes);
  const slot = type === 'process' ? 0 : 1 + fi;
  const own = type === 'process' ? cfgStr(cfg, 'print_settings_id') : cfgStr(cfg, 'filament_settings_id', fi);
  const inh = cfgList(cfg, 'inherits_group')[slot];
  const inherits = (inh && inh.trim()) || own;
  if (!inherits || !name) return null;
  const keys = new Set(String(cfgList(cfg, 'different_settings_to_system')[slot] || '').split(';').map(s => s.trim()).filter(Boolean));
  for (const x of fixes) if (settingType(x.key) === type && (type === 'process' || (x.idx || 0) === fi)) keys.add(x.key);
  const data = {};
  for (const k of keys) {
    if (settingType(k) !== type || !(k in out) || /(_settings_id|^inherits|^compatible_|^version$|^name$|^from$)/.test(k)) continue;
    const v = out[k];
    data[k] = type === 'filament' ? [String(Array.isArray(v) ? (v[fi] ?? v[0]) : String(v).split(/[;,]/)[fi] ?? v)] : v;
  }
  const ver = String(cfg.version || '').match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  const version = ver ? ver.slice(1, 5).map(n => String(parseInt(n || '0', 10))).join('.') : '1.0.0.0';
  const head = { version, name, from: 'User', inherits, description };
  if (type === 'filament') head.filament_settings_id = [name];
  else head.print_settings_id = name;
  return { name, inherits, type, keys: Object.keys(data), data: { ...head, ...data } };
}

// Vorgeschlagener Profilname: „<Basis> · V3D [Zweck]“ — ein schon vorhandenes V3D-Profil wird weiterbenutzt
export function presetName(cfg, type, { fi = 0, purpose } = {}) {
  const own = type === 'process' ? cfgStr(cfg, 'print_settings_id') : cfgStr(cfg, 'filament_settings_id', fi);
  const base = String(own || '').replace(/\s*·\s*V3D.*$/, '').trim() || (type === 'process' ? 'Prozess' : 'Filament');
  const p = type === 'process' && PURPOSES[purpose] ? ' ' + PURPOSES[purpose].short : '';
  return `${base} · V3D${p}`.replace(/[\\/:*?"<>|]/g, '-');
}

export function checkSettings(cfg, ctx = {}) {
  const F = [];
  // Fixes, die schon dem aktuellen Wert entsprechen, fallen weg (kein „A → A")
  // loc = Stelle im Modell { m: Modellindex, pts: [[x,y,z],…] } für „Klick → 3D"
  const add = (level, cat, id, title, detail, fixes = [], loc = null) => F.push({ id, level, cat, title, detail, loc,
    fixes: fixes.filter(x => cfgStr(cfg, x.key, x.idx || 0) !== String(x.value)) });
  const models = ctx.models || [];
  const mid = m => { const b = m.bbox; return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]; };
  const used = ctx.usedFilaments && ctx.usedFilaments.length ? ctx.usedFilaments : [0];
  const d = cfgNum(cfg, 'nozzle_diameter', 0, 0.4);
  const lh = cfgNum(cfg, 'layer_height', 0, NaN);
  const bed = bedInfo(cfgStr(cfg, 'curr_bed_type'));
  const spiral = cfgBool(cfg, 'spiral_mode');
  const supportOn = cfgBool(cfg, 'enable_support');
  const dz = `${de(d)}er Düse`;

  // --- Bauraum ---
  const pa = cfgStr(cfg, 'printable_area');
  const ptsRaw = Array.isArray(cfg && cfg.printable_area) ? cfg.printable_area : String(pa || '').split(',');
  const pts = ptsRaw.map(p => String(p).split('x').map(parseFloat)).filter(p => p.length === 2 && p.every(Number.isFinite));
  const ph = cfgNum(cfg, 'printable_height', 0, NaN);
  if (models.length && pts.length >= 3) {
    const bw = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
    const bd = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
    models.forEach((m, mi) => {
      const [w, dd, h] = m.size;
      const fits = (w <= bw + 0.01 && dd <= bd + 0.01) || (dd <= bw + 0.01 && w <= bd + 0.01);
      if (!fits || (Number.isFinite(ph) && h > ph + 0.01))
        add(LEVEL.ERROR, 'Modell', 'bauraum', `${models.length > 1 ? m.name + ': ' : ''}Passt nicht in den Drucker`,
          `Modell ${de(w, 1)} × ${de(dd, 1)} × ${de(h, 1)} mm, Drucker ${de(bw, 0)} × ${de(bd, 0)} × ${de(ph, 0)} mm. Verkleinern, drehen oder teilen.`,
          [], { m: mi, pts: [mid(m)] });
    });
  }

  // --- Material: Temperaturen, Platte, Kühlung ---
  for (const fi of used) {
    const type = cfgStr(cfg, 'filament_type', fi);
    const fam = materialFamily(type);
    const M = fam ? MAT[fam] : null;
    const mat = type || fam || 'das Filament';
    const tag = used.length > 1 ? ` (Filament ${fi + 1})` : '';
    const lo = cfgNum(cfg, 'nozzle_temperature_range_low', fi, NaN), hi = cfgNum(cfg, 'nozzle_temperature_range_high', fi, NaN);
    const range = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : M ? M.noz : null;
    const src = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? 'laut Filamentprofil' : 'typisch';
    if (range) {
      for (const key of ['nozzle_temperature', 'nozzle_temperature_initial_layer']) {
        const T = cfgNum(cfg, key, fi, NaN);
        if (!Number.isFinite(T)) continue;
        if (T < range[0] || T > range[1]) {
          const to = T < range[0] ? Math.min(range[0] + 5, (range[0] + range[1]) / 2) : Math.max(range[1] - 5, (range[0] + range[1]) / 2);
          const erste = key.endsWith('initial_layer') ? ' in der ersten Schicht' : '';
          add(LEVEL.WARN, 'Material', key + fi, `Düse${erste} zu ${T < range[0] ? 'kalt' : 'heiß'} für ${mat} (${T} °C)${tag}`,
            (T < range[0] ? 'Zu kalt: Schichten halten schlecht aneinander, die Düse kann verstopfen.'
                          : 'Zu heiß: Fäden ziehen, Blasen, verbrannte Oberfläche.') + ` Richtig sind ${range[0]}–${range[1]} °C (${src}).`,
            [{ key, value: String(Math.round(to)), idx: fi }]);
        }
      }
    }
    // Platte + Bett
    const plateT = cfgNum(cfg, bed.key, fi, NaN);
    const plateBad = M && M.bed[bed.kind] === null;
    if ((has(cfg, bed.key) && plateT === 0) || plateBad) {
      add(LEVEL.ERROR, 'Material', 'platte' + fi, `${mat} hält nicht auf der ${bed.name}${tag}`,
        plateBad ? `${fam} haftet auf dieser Platte schlecht bzw. beschädigt sie. Die Textured PEI Plate ist die sichere Wahl.`
                 : `Das Filamentprofil hat für diese Platte 0 °C hinterlegt = nicht freigegeben. Bambu verweigert den Druck oder er löst sich.`,
        [{ key: 'curr_bed_type', value: 'Textured PEI Plate' }]);
    } else if (M && M.bed[bed.kind] && Number.isFinite(plateT)) {
      const [b0, b1] = M.bed[bed.kind];
      for (const key of [bed.key, bed.key + '_initial_layer']) {
        const T = cfgNum(cfg, key, fi, NaN);
        if (!Number.isFinite(T) || (T >= b0 - 5 && T <= b1 + 5)) continue;
        add(LEVEL.WARN, 'Material', key + fi, `Druckbett zu ${T < b0 ? 'kalt' : 'heiß'} für ${fam} (${T} °C)${tag}`,
          (T < b0 ? 'Die erste Schicht hält schlecht, Ecken heben sich (Warping).' : 'Elefantenfuß unten, das Teil klebt zu fest oder verformt sich.') + ` Üblich auf der ${bed.name}: ${b0}–${b1} °C.`,
          [{ key, value: String(T < b0 ? b0 : b1), idx: fi }]);
      }
    }
    // Kühlung
    if (M && M.fanLow && has(cfg, 'fan_max_speed')) {
      const f = cfgNum(cfg, 'fan_max_speed', fi, NaN);
      if (Number.isFinite(f) && f < M.fanLow)
        add(LEVEL.WARN, 'Material', 'fanlow' + fi, `${fam} wird zu wenig gekühlt (Lüfter max. ${f} %)${tag}`,
          `${fam} braucht viel Kühlung, sonst werden Überhänge, Brücken und kleine Details weich und hängen durch.`,
          [{ key: 'fan_max_speed', value: '100', idx: fi }]);
    }
    if (M && M.fanMax && has(cfg, 'fan_max_speed')) {
      const f = cfgNum(cfg, 'fan_max_speed', fi, NaN);
      if (Number.isFinite(f) && f > M.fanMax + 10)
        add(LEVEL.WARN, 'Material', 'fanmax' + fi, `${fam} wird zu stark gekühlt (Lüfter bis ${f} %)${tag}`,
          `${fam} reißt bei starker Kühlung zwischen den Schichten (Delamination) und verzieht sich.`,
          [{ key: 'fan_max_speed', value: String(M.fanMax - 10), idx: fi }]);
    }
    // Abrasive Filamente
    if (/CF|GF/.test(String(type).toUpperCase())) {
      const nt = cfgStr(cfg, 'nozzle_type', 0).toLowerCase();
      if (nt === 'brass' || nt === 'stainless_steel')
        add(LEVEL.WARN, 'Material', 'abrasiv' + fi, `${type} schleift die ${nt === 'brass' ? 'Messing' : 'Edelstahl'}-Düse aus`,
          'Faserverstärktes Filament macht weiche Düsen in wenigen Stunden kaputt. Gehärtete Düse einsetzen (und im Druckerprofil eintragen).');
    }
  }

  // --- Schichthöhe / Linienbreite ---
  if (Number.isFinite(lh) && d > 0) {
    const hMin = cfgNum(cfg, 'min_layer_height', 0, NaN), hMax = cfgNum(cfg, 'max_layer_height', 0, NaN);
    const good = r2(Math.max(0.08, Math.round(d * 0.5 / 0.02) * 0.02));
    if (lh > d * 0.8 || (Number.isFinite(hMax) && hMax > 0 && lh > hMax + 1e-6))
      add(LEVEL.ERROR, 'Qualität', 'lh_hoch', `Schichten zu dick für die ${dz} (${de(lh)} mm)`,
        `Mehr als ~75 % des Düsendurchmessers: die Schichten haften schlecht aufeinander.`, [{ key: 'layer_height', value: String(good) }]);
    else if (lh > d * 0.7)
      add(LEVEL.WARN, 'Qualität', 'lh_hoch', `Schichten sehr dick für die ${dz} (${de(lh)} mm)`,
        'Grob und schwach zwischen den Schichten. Nur für schnelle Entwürfe sinnvoll.', [{ key: 'layer_height', value: String(good) }]);
    else if (lh < d * 0.2 || (Number.isFinite(hMin) && hMin > 0 && lh < hMin - 1e-6))
      add(LEVEL.WARN, 'Qualität', 'lh_tief', `Schichten feiner als nötig (${de(lh)} mm)`,
        'Unter ~20 % der Düse: lange Druckzeit, Hitzestau und kaum sichtbarer Gewinn.', [{ key: 'layer_height', value: String(r2(Math.round(d * 0.3 / 0.02) * 0.02)) }]);
    const fl = cfgNum(cfg, 'initial_layer_print_height', 0, NaN);
    if (Number.isFinite(fl)) {
      if (fl > d * 0.75)
        add(LEVEL.WARN, 'Haftung', 'fl_hoch', `Erste Schicht zu dick (${de(fl)} mm)`,
          'Sie wird nicht mehr richtig auf die Platte gedrückt und haftet schlecht.', [{ key: 'initial_layer_print_height', value: String(r2(d * 0.5)) }]);
      else if (fl < d * 0.3 && d >= 0.4)
        add(LEVEL.INFO, 'Haftung', 'fl_tief', `Erste Schicht sehr dünn (${de(fl)} mm)`,
          'Sehr empfindlich gegen Unebenheiten der Platte; 0,2 mm (bei 0,4er Düse) verzeiht mehr.', [{ key: 'initial_layer_print_height', value: String(r2(d * 0.5)) }]);
    }
    for (const key of ['line_width', 'outer_wall_line_width', 'inner_wall_line_width', 'initial_layer_line_width', 'sparse_infill_line_width', 'top_surface_line_width']) {
      if (!has(cfg, key)) continue;
      const w = widthMm(cfgStr(cfg, key), d);
      if (!Number.isFinite(w)) continue;
      if (w < d * 0.8 || w > d * 1.8)
        add(LEVEL.WARN, 'Qualität', 'lw_' + key, `${keyLabel(key)} passt nicht zur ${dz} (${de(w)} mm)`,
          w < d * 0.8 ? 'Schmaler als ~80 % der Düse: das Material wird nicht sauber abgelegt.' : 'Breiter als ~180 % der Düse: die Linien quetschen unsauber.',
          [{ key, value: String(r2(key === 'initial_layer_line_width' ? d * 1.25 : d * 1.05)) }]);
    }
  }

  // --- Festigkeit / Schalen ---
  if (!spiral && Number.isFinite(lh)) {
    const walls = cfgNum(cfg, 'wall_loops', 0, NaN);
    if (Number.isFinite(walls) && walls < 2)
      add(LEVEL.WARN, 'Festigkeit', 'walls', `Nur ${walls} Wand – zu dünnwandig`, 'Eine einzelne Wand ist undicht und bricht leicht. 2 ist das Minimum, 3–4 für belastete Teile.', [{ key: 'wall_loops', value: '2' }]);
    const infill = parseFloat(cfgStr(cfg, 'sparse_infill_density'));
    const top = Math.max(cfgNum(cfg, 'top_shell_layers', 0, 0) * lh, cfgNum(cfg, 'top_shell_thickness', 0, 0));
    const bot = Math.max(cfgNum(cfg, 'bottom_shell_layers', 0, 0) * lh, cfgNum(cfg, 'bottom_shell_thickness', 0, 0));
    if (has(cfg, 'top_shell_layers') && top < 0.6 && !(infill >= 100))
      add(LEVEL.WARN, 'Festigkeit', 'top', `Oberseite zu dünn – Löcher möglich`,
        `Nur ${de(top)} mm Deckschicht. Unter ~0,6 mm schließt die Oberseite nicht sauber über der Füllung.`,
        [{ key: 'top_shell_layers', value: String(Math.ceil(0.8 / lh - 1e-6)) }]);
    if (has(cfg, 'bottom_shell_layers') && bot < 0.45 && !(infill >= 100))
      add(LEVEL.WARN, 'Festigkeit', 'bottom', `Boden zu dünn`, `Nur ${de(bot)} mm. Der Boden wird löchrig und undicht.`,
        [{ key: 'bottom_shell_layers', value: String(Math.ceil(0.6 / lh - 1e-6)) }]);
    const volBig = models.some(m => m.volume > 1000);
    if (infill === 0 && (volBig || !models.length))
      add(LEVEL.WARN, 'Festigkeit', 'infill0', 'Innen komplett hohl (0 % Füllung)', 'Deckflächen fallen ohne Unterbau ein, das Teil ist sehr weich.', [{ key: 'sparse_infill_density', value: '15%' }]);
  }

  // --- Modellbezogen ---
  const thr = cfgNum(cfg, 'support_threshold_angle', 0, 0) > 0 ? cfgNum(cfg, 'support_threshold_angle', 0, 30) : 30;
  let needIsl = 0, needArea = 0, longBridge = 0, ohArea = 0;
  const anyModel = models.length > 0;
  const supLoc = { m: 0, pts: [] };
  models.forEach((m, mi) => {
    needIsl += m.islands.length;
    for (let b = 1; b < 18; b++) {
      const tilt = b * 5 + 2.5;
      if (tilt < thr) needArea += m.downHist[b];
      if (tilt < 50) ohArea += m.downHist[b];
    }
    for (const br of m.bridges) if (br.span > 25) { needArea += br.area; longBridge = Math.max(longBridge, br.span); }
    if (!supLoc.pts.length) {
      const p = [...(m.islandPts || []), ...m.bridges.filter(b => b.span > 25).map(b => b.c), ...m.overhangs.slice(0, 3).map(o => o.c)].filter(Boolean);
      if (p.length) { supLoc.m = mi; supLoc.pts = p.slice(0, 8); }
    }
  });
  if (anyModel) {
    const surf = models.reduce((s, m) => s + m.area, 0);
    const need = needIsl > 0 || needArea > Math.max(25, surf * 0.005);
    if (need && !supportOn) {
      const why = [needIsl ? `${needIsl} Stelle(n) beginnen frei in der Luft (ab ${de(models.flatMap(m => m.islands)[0] || 0, 1)} mm Höhe)` : '',
        needArea > 0 ? `${de(needArea / 100, 1)} cm² Überhang flacher als ${thr}°` : '',
        longBridge ? `waagerechte Unterseite über ${de(longBridge, 0)} mm frei` : ''].filter(Boolean).join(', ');
      add(needIsl ? LEVEL.ERROR : LEVEL.WARN, 'Stützen', 'stuetzen_an', needIsl ? 'Teile würden in der Luft beginnen' : 'Überhänge brauchen Stützen',
        `${why}. Ohne Stützen druckt der Drucker dort ins Leere (Spaghetti).`,
        [{ key: 'enable_support', value: '1' }, { key: 'support_type', value: 'tree(auto)' }], supLoc.pts.length ? supLoc : null);
    } else if (!need && supportOn && needArea < 5 && !models.some(m => m.bridges.some(b => b.span > 15))) {
      add(LEVEL.INFO, 'Stützen', 'stuetzen_aus', 'Stützen kannst du dir sparen',
        'Das Modell hat keine schwebenden Stellen und keine nennenswerten Überhänge. Ohne Stützen: schneller, weniger Material, sauberere Unterseite.',
        [{ key: 'enable_support', value: '0' }]);
    }
    if (ohArea > 100 && has(cfg, 'enable_overhang_speed') && !cfgBool(cfg, 'enable_overhang_speed'))
      add(LEVEL.INFO, 'Qualität', 'ohspeed', 'Überhänge werden zu schnell gedruckt',
        `${de(ohArea / 100, 1)} cm² Überhang flacher als 50°. Langsamer drucken = sauberere Überhänge.`, [{ key: 'enable_overhang_speed', value: '1' }],
        supLoc.pts.length ? supLoc : null);

    // Haftung / Standfestigkeit
    const brim = cfgStr(cfg, 'brim_type') || 'auto_brim';
    const fam0 = materialFamily(cfgStr(cfg, 'filament_type', used[0]));
    models.forEach((m, mi) => {
      const [cw, cd] = m.contactSize, h = m.size[2];
      const foot = Math.max(1, Math.min(cw, cd));
      const nm = models.length > 1 ? `${m.name}: ` : '';
      const fussLoc = { m: mi, pts: [[(m.bbox[0] + m.bbox[3]) / 2, (m.bbox[1] + m.bbox[4]) / 2, m.bbox[2]]] };
      if (m.contact < 1 && h > 2) {
        add(LEVEL.WARN, 'Haftung', 'keinfuss', `${nm}Modell steht kaum auf der Platte`,
          `Es berührt die Platte nur punktuell (${de(m.contact, 1)} mm²). Flache Seite nach unten drehen („Automatische Orientierung“) oder mit Brim + Stützen drucken.`,
          brim === 'no_brim' ? [{ key: 'brim_type', value: 'outer_only' }, { key: 'brim_width', value: '5' }] : [], fussLoc);
        return;
      }
      if (h / foot > 4 && h > 25 && brim === 'no_brim')
        add(LEVEL.WARN, 'Haftung', 'kippen', `${nm}Hoher, schmaler Turm kann umkippen`,
          `${de(h, 0)} mm hoch auf nur ${de(foot, 1)} mm Fuß: löst sich beim Drucken leicht. Ein Brim (Umrandung) vergrößert die Haftfläche.`,
          [{ key: 'brim_type', value: 'outer_only' }, { key: 'brim_width', value: '5' }], { m: mi, pts: [mid(m)] });
      else if (fam0 && MAT[fam0].warp && Math.max(cw, cd) > 80 && brim === 'no_brim')
        add(LEVEL.WARN, 'Haftung', 'warping', `${nm}Ecken können sich hochziehen (${fam0}, Warping)`,
          `${de(Math.max(cw, cd), 0)} mm Standfläche: ${fam0} zieht sich beim Abkühlen zusammen, die Ecken heben sich. Brim (Umrandung) + geschlossene Kammer helfen.`,
          [{ key: 'brim_type', value: 'outer_only' }, { key: 'brim_width', value: '5' }], fussLoc);
    });

    // Dünne Wände – Arachne allein reicht nicht (Ralf, 14.10.): erst mit kleiner Feature-Größe
    // und voller Mindest-Wandbreite werden schmale Stellen dicht statt löchrig gedruckt
    const ow = widthMm(cfgStr(cfg, 'outer_wall_line_width') || cfgStr(cfg, 'line_width'), d) || d * 1.05;
    const gen = cfgStr(cfg, 'wall_generator') || 'classic';
    const pct = k => parseFloat(cfgStr(cfg, k));
    const arachneFixes = () => [
      { key: 'wall_generator', value: 'arachne' },
      ...(!(pct('min_feature_size') <= 5) ? [{ key: 'min_feature_size', value: '5%' }] : []),
      ...(!(pct('min_bead_width') >= 100) ? [{ key: 'min_bead_width', value: '100%' }] : []),
      ...(has(cfg, 'min_length_factor') && cfgNum(cfg, 'min_length_factor', 0, 0) > 0 ? [{ key: 'min_length_factor', value: '0' }] : []),
    ];
    const warum = ' Was die Werte bewirken: „Minimale Feature-Größe“ 5 % druckt auch sehr schmale Stellen, statt sie wegzulassen; ' +
      '„Minimale Wandbreite“ 100 % legt schmale Stellen in voller Düsenbreite – dicht statt löchrig (minimal überfüllt).' +
      (has(cfg, 'min_length_factor') ? ' „Minimale Wandlänge“ 0 behält auch ganz kurze Wandstücke.' : '');
    models.forEach((m, mi) => {
      if (!m.thick || !m.thick.samples.length) return;
      const nm = models.length > 1 ? `${m.name}: ` : '';
      const fx = arachneFixes().filter(x => cfgStr(cfg, x.key) !== String(x.value));
      const aTooThin = thinArea(m.thick, d * 0.95), aThin = thinArea(m.thick, ow * 2 * 0.95);
      const fTooThin = thinFraction(m.thick, d * 0.95), fThin = thinFraction(m.thick, ow * 2 * 0.95);
      const locOf = lim => { const p = (m.thick.thinPts || []).filter(q => q[3] < lim).slice(0, 8).map(q => q.slice(0, 3)); return p.length ? { m: mi, pts: p } : null; };
      const wieviel = (a, f) => f >= 0.01 ? `${Math.round(f * 100)} % der Wände` : `Stellen mit zusammen ca. ${de(a, 0)} mm² Wandfläche`;
      // Auch kleine Stellen zählen (dünner Deckel an großem Teil) – Fläche ODER Anteil
      if (aTooThin > 5 || fTooThin > 0.01)
        add(LEVEL.WARN, 'Modell', 'zudünn', `${nm}Stellen dünner als die Düse – werden löchrig`,
          `${wieviel(aTooThin, fTooThin)} sind schmaler als ${de(d)} mm. Dort fehlen sonst Linien oder es bleiben Löcher.` +
          (fx.length ? ' Arachne mit angepassten Werten holt das Meiste heraus.' + warum : '') +
          ' Sicherer: Wand im Modell verstärken, größer skalieren oder eine kleinere Düse.', fx, locOf(d * 0.95));
      else if ((aThin > 10 || fThin > 0.03) && fx.length)
        add(LEVEL.WARN, 'Qualität', 'dünn', `${nm}Dünne Wände drucken lückenhaft`,
          `${wieviel(aThin, fThin)} sind schmaler als ${de(ow * 2)} mm (zwei Linien). ` +
          (gen !== 'arachne' ? 'Mit dem klassischen Wandgenerator entstehen dort Lücken oder Zickzack. Arachne passt die Linienbreite an – aber erst mit passenden Werten wird es dicht.'
                             : 'Arachne ist an, aber noch mit Standardwerten – die lassen schmale Stellen dünn oder weg.') + warum,
          fx, locOf(ow * 2 * 0.95));
    });

    // Treppenstufen auf flachen Schrägen
    if (Number.isFinite(lh) && lh >= 0.16 && !ctx.adaptive) {
      const up = models.reduce((s, m) => s + m.upArea, 0), gentle = models.reduce((s, m) => s + m.gentleUp, 0);
      if (up > 0 && gentle / up > 0.15 && gentle > 200)
        add(LEVEL.INFO, 'Qualität', 'treppe', `Treppenstufen auf flachen Schrägen sichtbar`,
          `${Math.round(gentle / up * 100)} % der Oberseiten sind flach geneigt (3–25°). Kleinere Schichthöhe${ctx.inSlicer ? ' oder adaptive Schichthöhe [A]' : ' oder „Variable Schichthöhe“'} glätten das, kosten aber Zeit.`,
          [{ key: 'layer_height', value: String(r2(Math.max(0.08, Math.round(d * 0.3 / 0.02) * 0.02))) }]);
    }

    // Netzfehler
    models.forEach((m, mi) => {
      // nur echte Löcher; mehrfach genutzte Kanten entstehen schon, wenn zwei Körper aneinanderstoßen
      if (m.openEdges > 0)
        add(LEVEL.INFO, 'Modell', 'netz', `${models.length > 1 ? m.name + ': ' : ''}Modell hat Löcher im Netz`,
          `${m.openEdges} offene Kanten. Der Slicer repariert das meist selbst; wenn im Druck Lücken auftauchen, das Modell reparieren.`,
          [], { m: mi, pts: [mid(m)] });
    });
  }

  // --- G-Code-Merkmale ---
  const feat = ctx.gcode && ctx.gcode.features;
  if (feat) {
    const sup = Object.keys(feat).some(f => /support/i.test(f));
    if (sup && !supportOn) add(LEVEL.INFO, 'Stützen', 'g_sup', 'Im G-Code sind trotzdem Stützen', 'Kommen von bemalten/erzwungenen Stützen.');
    if (!anyModel && supportOn && !sup) add(LEVEL.INFO, 'Stützen', 'g_nosup', 'Stützen an, aber keine erzeugt', 'Das Modell braucht offenbar keine — ausschalten spart nichts, schadet aber auch nicht.');
  }
  // --- Zweck des Teils (nur wenn angegeben, z. B. vom Druck-Assistenten) ---
  const P = PURPOSES[ctx.purpose];
  if (P && !spiral) {
    const pw = cfgNum(cfg, 'wall_loops', 0, NaN), pi = parseFloat(cfgStr(cfg, 'sparse_infill_density'));
    const fx = [];
    if (P.walls && Number.isFinite(pw) && (pw < P.walls[0] || pw > P.walls[1])) fx.push({ key: 'wall_loops', value: String(pw < P.walls[0] ? P.walls[0] : P.walls[1]) });
    if (P.infill && Number.isFinite(pi) && (pi < P.infill[0] || pi > P.infill[1])) fx.push({ key: 'sparse_infill_density', value: (pi < P.infill[0] ? P.infill[0] : P.infill[1]) + '%' });
    if (P.layer && Number.isFinite(lh)) {
      const want = r2(Math.max(0.08, Math.round(d * P.layer / 0.02) * 0.02));
      if (Math.abs(lh - want) > 0.011) fx.push({ key: 'layer_height', value: String(want) });
    }
    if (P.arachne && cfgStr(cfg, 'wall_generator') && cfgStr(cfg, 'wall_generator') !== 'arachne') fx.push({ key: 'wall_generator', value: 'arachne' });
    if (fx.length) add(LEVEL.INFO, 'Zweck', 'zweck_' + ctx.purpose, `Passend für ${P.name}`, P.why, fx);
  }

  const diff = cfgList(cfg, 'different_settings_to_system').join(';').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  if (diff.length)
    add(LEVEL.INFO, 'Abgleich', 'diff', `${diff.length} Wert${diff.length > 1 ? 'e' : ''} gegenüber dem Bambu-/Orca-Standardprofil geändert`,
      'Selbst geändert: ' + diff.slice(0, 30).map(keyLabel).join(', ') + (diff.length > 30 ? ' …' : '') + '. Das ist kein Fehler – nur zur Übersicht.');

  F.sort((a, b) => b.level - a.level);
  return F;
}

// Ein Satz als Urteil (Ring/Kopf)
export function verdict(sum) {
  const n = sum.counts;
  if (n[3]) return { emoji: '🛑', text: `So lieber nicht drucken – ${n[3] === 1 ? 'ein Fehler muss' : n[3] + ' Fehler müssen'} weg` };
  if (n[2] === 1) return { emoji: '🟠', text: 'Fast gut – eine Sache solltest du ändern' };
  if (n[2]) return { emoji: '🟠', text: `Fast gut – ${n[2]} Dinge solltest du ändern` };
  if (n[1]) return { emoji: '👍', text: 'So kannst du drucken – mit kleinen Tipps' };
  return { emoji: '🎉', text: 'Alles passt – ab auf den Drucker!' };
}

// Steckbrief: Zeit, Gewicht, Kosten, Material
export function printFacts(cfg, gcode, models = []) {
  const st = gcode && gcode.stats || {};
  const used = gcode && gcode.usedFilaments && gcode.usedFilaments.length ? gcode.usedFilaments : [0];
  let weight = st.weightG || 0, est = false;
  if (!weight && models.length) {   // grobe Schätzung ohne Slice: Hülle voll + Füllung anteilig
    const dens = cfgNum(cfg, 'filament_density', used[0], 1.24) || 1.24;
    const fill = (parseFloat(cfgStr(cfg, 'sparse_infill_density')) || 15) / 100;
    const vol = models.reduce((s, m) => s + Math.min(m.volume, m.area * 1.2 + (m.volume - Math.min(m.volume, m.area * 1.2)) * fill), 0);
    weight = vol / 1000 * dens; est = true;
  }
  const price = cfgNum(cfg, 'filament_cost', used[0], NaN);
  const types = [...new Set(used.map(i => cfgStr(cfg, 'filament_type', i)).filter(Boolean))];
  return {
    time: fmtDuration(st.timeS) || st.timeText || '', weightG: weight, weightEst: est,
    costEur: Number.isFinite(price) && price > 0 && weight ? weight / 1000 * price : NaN,
    material: types.join(' + '), nozzle: cfgNum(cfg, 'nozzle_diameter', 0, NaN),
    layer: cfgNum(cfg, 'layer_height', 0, NaN), plate: bedInfo(cfgStr(cfg, 'curr_bed_type')).name,
  };
}

export function summarize(findings) {
  const n = [0, 0, 0, 0];
  for (const f of findings) n[f.level]++;
  const score = Math.max(0, 100 - n[3] * 30 - n[2] * 10 - n[1] * 2);
  return { counts: n, score, worst: findings.length ? findings[0].level : LEVEL.OK };
}

// „Alles verbessern“ zu Ende rechnen (Volker 9.11.: nach dem Verbessern 86 → 78 Punkte).
// Eine Änderung kann einen NEUEN Befund auslösen – z. B. feinere Schichten (0,2 → 0,12 mm)
// machen Boden/Decke bei gleicher Schichtzahl zu dünn. Darum nach dem Anwenden neu prüfen,
// die Fixes neuer Befunde mitnehmen (bis nichts mehr dazukommt) und sicherstellen, dass es
// nie schlechter wird: sonst die gewählte Änderung weglassen, deren Wegfall am meisten bringt.
// check(cfg) → Befunde. Ergebnis: { fixes, extra (Folge-Befunde mit ihren Fixes), dropped, before, after }
export function improveAll(cfg, findings, chosen, check, maxRounds = 4) {
  const k = x => x.key + '|' + (x.idx === undefined ? '' : x.idx);
  const before = summarize(findings).score;
  const ids0 = new Set(findings.map(f => f.id));
  const run = sel => {
    let all = sel.slice(); const extra = [];
    for (let r = 0; r <= maxRounds; r++) {
      const fs = check(applyFixes(cfg, all));
      if (r === maxRounds) return { fixes: all, extra, after: summarize(fs).score };
      const have = new Set(all.map(k)), neu = [];
      for (const f of fs) {
        if (ids0.has(f.id)) continue;
        const fx = (f.fixes || []).filter(x => !have.has(k(x)));
        if (fx.length) { fx.forEach(x => have.add(k(x))); neu.push({ ...f, fixes: fx }); }
      }
      if (!neu.length) return { fixes: all, extra, after: summarize(fs).score };
      for (const f of neu) { all = all.concat(f.fixes); extra.push(f); }
    }
  };
  let sel = chosen.slice(), res = run(sel);
  const dropped = [];
  while (res.after < before && sel.length) {
    let best = null;
    for (const x of sel) { const t = run(sel.filter(y => y !== x)); if (!best || t.after > best.t.after) best = { x, t }; }
    sel = sel.filter(y => y !== best.x); dropped.push(best.x); res = best.t;
  }
  return { fixes: res.fixes, chosen: sel, extra: res.extra, dropped, before, after: res.after };
}

// Fix-Liste → Tabelle (alt → neu) für Anzeige/Export
export function fixRows(cfg, findings) {
  const rows = new Map();
  for (const f of findings) for (const x of f.fixes || []) {
    const k = x.key + (x.idx ? '#' + x.idx : '');
    rows.set(k, { key: x.key, idx: x.idx || 0, label: keyLabel(x.key), where: keyWhere(x.key),
      from: cfgStr(cfg, x.key, x.idx || 0), to: x.value });
  }
  return [...rows.values()];
}

// Fixes in eine Config schreiben (Vektor-Werte behalten ihre Form)
export function applyFixes(cfg, fixes) {
  const out = { ...cfg };
  for (const x of fixes) {
    const cur = out[x.key];
    if (Array.isArray(cur)) {
      out[x.key] = cur.map((v, i) => (x.idx === undefined || cur.length === 1 || i === x.idx) ? String(x.value) : v);
    } else if (typeof cur === 'string' && (cur.includes(';') || /^[\d.%]+(,[\d.%]+)+$/.test(cur))) {
      const sep = cur.includes(';') ? ';' : ',';
      const parts = cur.split(sep);
      out[x.key] = parts.map((v, i) => (x.idx === undefined || i === x.idx) ? String(x.value) : v).join(sep);
    } else out[x.key] = String(x.value);
  }
  return out;
}

// Korrigiertes Projekt-3MF: project_settings.config gepatcht; fertige Slices
// (plate_N.gcode, slice_info) fliegen raus, damit Bambu Studio/Orca neu slicen
export async function patched3mf(zip, cfg, fixes) {
  const files = [];
  for (const [name, f] of zip) {
    if (/^Metadata\/plate_\d+\.gcode(\.md5)?$/.test(name) || name === 'Metadata/slice_info.config') continue;
    let data = await f.get();
    if (name === 'Metadata/project_settings.config') data = JSON.stringify(applyFixes(cfg, fixes), null, 4);
    files.push({ name, data });
  }
  return writeZip(files);
}

// Änderungsliste als Text (für Bambu Studio von Hand übernehmen)
export function fixText(rows, title = 'V3D Druckcheck — empfohlene Änderungen') {
  return [title, '', ...rows.map(r => `${r.label}: ${valueText(r.key, r.from) || '–'} → ${valueText(r.key, r.to)}    (${r.where || r.key})`)].join('\n') + '\n';
}

// Grundwerte, wenn nur ein STL vorliegt (Bambu-0,4-Standard je Material)
export function baselineConfig({ material = 'PLA', nozzle = 0.4, bedType = 'Textured PEI Plate', support = false, brim = 'auto_brim',
  printable = [256, 256, 256] } = {}) {
  const fam = materialFamily(material) || 'PLA';
  const M = MAT[fam];
  const bk = bedInfo(bedType);
  const bedT = M.bed[bk.kind] ? Math.round((M.bed[bk.kind][0] + M.bed[bk.kind][1]) / 2) : 0;
  const nz = Math.round((M.noz[0] + M.noz[1]) / 2);
  const c = {
    filament_type: material, nozzle_diameter: String(nozzle), curr_bed_type: bedType,
    nozzle_temperature: String(nz), nozzle_temperature_initial_layer: String(nz),
    nozzle_temperature_range_low: String(M.noz[0]), nozzle_temperature_range_high: String(M.noz[1]),
    layer_height: String(r2(nozzle * 0.5)), initial_layer_print_height: String(r2(nozzle * 0.5)),
    wall_loops: '2', top_shell_layers: String(Math.ceil(0.8 / (nozzle * 0.5) - 1e-6)), bottom_shell_layers: '3',
    sparse_infill_density: '15%', enable_support: support ? '1' : '0', support_type: 'normal(auto)', support_threshold_angle: '30',
    brim_type: brim, wall_generator: 'classic', enable_overhang_speed: '1',
    printable_area: `0x0,${printable[0]}x0,${printable[0]}x${printable[1]},0x${printable[1]}`, printable_height: String(printable[2]),
  };
  c[bk.key] = String(bedT); c[bk.key + '_initial_layer'] = String(bedT);
  return c;
}
