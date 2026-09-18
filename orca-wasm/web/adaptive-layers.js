// Adaptive Schichthöhe „Automatisch" (Krümmung + Details) — reiner Rechenkern
// ohne DOM, läuft im Browser und in Node (Tests).
//
// Eingabe: Dreiecke eines Objekts in Druck-Koordinaten (z ab 0, nach allen
// Nutzer-Transformationen). Ausgabe: fertige Schichtfolge + ein Orca-
// layer_height_profile, das GENAU diese Folge reproduziert.
//
// Kriterien (je Höhenband, das strengste gewinnt):
//  • Schräge  — Treppenstufen-Fehler ≈ h·|nz| → flache Schrägen fein, Wände grob
//  • Überhang — nach unten zeigende Flächen jenseits ~30° bekommen dünnere Schichten
//  • Relief   — zwischen zwei waagerechten Oberflächen ≤ 3 mm Abstand (Schrift,
//               Prägungen, kleine Stufen) wird fein gedruckt
//  • Kante    — waagerechte Flächen (Oberkante Schrift, Stufen, Deckel, Brücken-
//               unterseiten) liegen EXAKT auf einer Schichtgrenze (kein ±h/2-Fehler)
// Danach wird die Höhe weich begrenzt (max. Änderung je mm), damit keine
// sichtbaren Sprünge zwischen dick und dünn entstehen.
//
// Orca-Profil-Semantik (Slicing.cpp generate_object_layers): die Höhe einer
// Schicht wird bei z_unten + ½·min_layer_height aus dem Profil interpoliert.
// Je Schicht zwei Stützpunkte (z_unten, h) und (z_oben − PE, h) → die Lerp
// liefert exakt h. Erster Wert = Erstschichthöhe, letzter z = Objekthöhe —
// sonst verwirft Orca das Profil still.

export const REASON = { BASE: 0, SLOPE: 1, OVERHANG: 2, RELIEF: 3, FIRST: 4 };
export const REASON_NAMES = ['Grundhöhe', 'Schräge', 'Überhang', 'Relief/Schrift', 'Erste Schicht'];

const PE = 1e-3;            // Abstand des Schicht-End-Stützpunkts (übersteht Studios %f)
const BIN = 0.05;           // Auflösung der Höhenanalyse in mm
const LEVELS = 24;          // Quantisierung der erlaubten Höhen je Band
const FLAT_NZ = 0.9962;     // |nz| darüber = waagerecht (≤ 5°)
const VERT_NZ = 0.0175;     // |nz| darunter = senkrecht (≤ 1°)
const RELIEF_MAX = 3.0;     // Relief-Band: waagerechte Flächen höchstens so weit auseinander
const MIN_KEY_AREA = 0.3;   // mm² — kleinere waagerechte Flächen sind Rauschen
const SMOOTH_K = 0.1;       // max. Höhenänderung je mm z (0,08 → 0,28 in 2 mm)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Grenzen + Zielgrößen aus Profilwerten und Qualitätsregler (0 = schnell, 1 = fein)
export function layerTargets({ hBase, hFirst, hMin, hMax, nozzle, quality = 0.5 }) {
  const nz = nozzle > 0 ? nozzle : 0.4;
  hMin = clamp(hMin > 0 ? hMin : 0.07, 0.03, nz * 0.5);
  hMax = clamp(hMax > 0 ? hMax : nz * 0.75, hMin, nz * 0.85);
  hBase = clamp(hBase > 0 ? hBase : 0.2, hMin, hMax);
  const q = clamp(quality, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  return {
    q, hMin, hMax, hBase, hFirst: hFirst > 0 ? hFirst : hBase,
    hCeil: lerp(hMax, hBase, q),                          // senkrechte Wände
    err: hBase * (1 - 0.6 * q),                           // erlaubte Stufe (senkrecht zur Fläche)
    hOvMin: Math.max(hMin, lerp(hBase, hMin, 0.3 + 0.5 * q)),   // stärkster Überhang
    hRelief: Math.max(hMin, lerp(hBase, hMin, 0.3 + 0.6 * q)),  // Schrift/Relief
  };
}

// pos: Float32Array/Array xyz je Vertex (Druck-Koordinaten); index: optional
export function computeLayerPlan(pos, index, opts) {
  const T = layerTargets(opts);
  const { hMin, hMax, hCeil, err, hOvMin, hRelief, hFirst } = T;
  const nTri = index ? Math.floor(index.length / 3) : Math.floor(pos.length / 9);
  let zLo = Infinity, zHi = -Infinity;
  for (let i = 2; i < pos.length; i += 3) { const z = pos[i]; if (z < zLo) zLo = z; if (z > zHi) zHi = z; }
  const H = zHi - zLo;
  if (!(H > hFirst + hMin)) return null;   // zu flach für ein Profil

  const nb = Math.ceil(H / BIN) + 1;
  const histS = new Float64Array(nb * LEVELS);   // Fläche je (Band, Stufe) — Schräge
  const histO = new Float64Array(nb * LEVELS);   // … Überhang
  const lvlOf = (h) => clamp(Math.floor((h - hMin) / (hMax - hMin) * (LEVELS - 1)), 0, LEVELS - 1);
  const lvlH = (l) => hMin + l * (hMax - hMin) / (LEVELS - 1);
  const flats = new Map();   // gerundetes z → { z, up, down } (Fläche)

  const P = (vi, k) => pos[vi * 3 + k];
  for (let t = 0; t < nTri; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    const ax = P(a, 0), ay = P(a, 1), az = P(a, 2) - zLo;
    const ux = P(b, 0) - ax, uy = P(b, 1) - ay, uz = P(b, 2) - zLo - az;
    const vx = P(c, 0) - ax, vy = P(c, 1) - ay, vz = P(c, 2) - zLo - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const len = Math.hypot(cx, cy, cz);
    if (len < 1e-12) continue;
    const area = len * 0.5, nz = cz / len, anz = Math.abs(nz);
    const z0 = Math.min(az, az + uz, az + vz), z1 = Math.max(az, az + uz, az + vz);
    if (anz > FLAT_NZ) {
      const zm = (az * 3 + uz + vz) / 3;
      const key = Math.round(zm / 0.005);
      const f = flats.get(key) || { z: 0, w: 0, up: 0, down: 0 };
      f.z += zm * area; f.w += area;
      if (nz > 0) f.up += area; else f.down += area;
      flats.set(key, f);
      continue;
    }
    if (anz < VERT_NZ) continue;
    const hS = err / anz;
    let hO = Infinity;
    if (nz < -0.5) {   // Überhang: 30° (nz −0,5) … 64° (nz −0,9) aus der Senkrechten
      const s = clamp((-nz - 0.5) / 0.4, 0, 1);
      hO = hCeil - (hCeil - hOvMin) * s;
    }
    const h = Math.min(hS, hO);
    if (h >= hCeil) continue;
    const hist = hO < hS ? histO : histS;
    const l = lvlOf(h);
    const b0 = clamp(Math.floor(z0 / BIN), 0, nb - 1), b1 = clamp(Math.floor(z1 / BIN), 0, nb - 1);
    if (b0 === b1) { hist[b0 * LEVELS + l] += area; continue; }
    const span = z1 - z0;
    for (let bi = b0; bi <= b1; bi++) {
      const ov = Math.min(z1, (bi + 1) * BIN) - Math.max(z0, bi * BIN);
      if (ov > 0) hist[bi * LEVELS + l] += area * ov / span;
    }
  }

  // Obergrenze je Band + Grund
  const cap = new Float64Array(nb).fill(hCeil);
  const why = new Uint8Array(nb);   // REASON.BASE
  const minArea = 0.15 * (BIN / 0.05);
  for (let bi = 0; bi < nb; bi++) {
    let cs = 0, co = 0;
    for (let l = 0; l < LEVELS; l++) {
      cs += histS[bi * LEVELS + l]; co += histO[bi * LEVELS + l];
      if (cs + co >= minArea) {
        const h = lvlH(l);
        if (h < cap[bi]) { cap[bi] = h; why[bi] = co > cs ? REASON.OVERHANG : REASON.SLOPE; }
        break;
      }
    }
  }

  // Waagerechte Flächen → Kanten-Höhen (gebündelt)
  const flatList = [...flats.values()].filter(f => f.w >= MIN_KEY_AREA)
    .map(f => ({ z: f.z / f.w, up: f.up, down: f.down, area: f.w })).sort((x, y) => x.z - y.z);
  const clusters = [];
  for (const f of flatList) {
    const last = clusters[clusters.length - 1];
    if (last && f.z - last.z < 0.02) {   // gleiche Ebene (Tessellations-Streuung)
      const w = last.area + f.area;
      last.z = (last.z * last.area + f.z * f.area) / w; last.area = w; last.up += f.up; last.down += f.down;
    } else clusters.push({ ...f });
  }
  // Relief-Bänder: zwischen zwei nach oben zeigenden Flächen ≤ RELIEF_MAX
  const ups = clusters.filter(f => f.up >= MIN_KEY_AREA && f.z > 1e-3);
  for (let i = 1; i < ups.length; i++) {
    const za = ups[i - 1].z, zb = ups[i].z;
    if (zb - za > RELIEF_MAX) continue;
    const b0 = clamp(Math.floor(za / BIN), 0, nb - 1), b1 = clamp(Math.ceil(zb / BIN) - 1, 0, nb - 1);
    for (let bi = b0; bi <= b1; bi++)
      if (hRelief < cap[bi]) { cap[bi] = hRelief; why[bi] = REASON.RELIEF; }
  }

  // Weich begrenzen (Lipschitz in z), Grund der Quelle mitnehmen
  const dk = SMOOTH_K * BIN;
  for (let bi = 1; bi < nb; bi++)
    if (cap[bi - 1] + dk < cap[bi]) { cap[bi] = cap[bi - 1] + dk; why[bi] = why[bi - 1]; }
  for (let bi = nb - 2; bi >= 0; bi--)
    if (cap[bi + 1] + dk < cap[bi]) { cap[bi] = cap[bi + 1] + dk; why[bi] = why[bi + 1]; }

  const binOf = (z) => clamp(Math.floor(z / BIN), 0, nb - 1);
  const minCap = (za, zb) => {
    let m = Infinity, r = REASON.BASE;
    for (let bi = binOf(za), be = binOf(zb - 1e-9); bi <= be; bi++) if (cap[bi] < m) { m = cap[bi]; r = why[bi]; }
    return [m, r];
  };

  // Kanten zum Einrasten: nicht in/zu nah an der ersten Schicht, nicht am Dach,
  // untereinander mindestens hMin Abstand (die größere Fläche gewinnt)
  const keys = [];
  for (const f of clusters) {
    if (f.z < hFirst + hMin - 1e-9 || f.z > H - hMin + 1e-9) continue;
    const last = keys[keys.length - 1];
    if (last && f.z - last.z < hMin) { if (f.area > last.area) keys[keys.length - 1] = f; continue; }
    keys.push(f);
  }

  // Schichten stapeln
  const EPS = 1e-7;
  const layers = [{ z0: 0, h: hFirst, r: REASON.FIRST, snap: false }];
  let z = hFirst, ki = 0;
  while (H - z > EPS) {
    let [h, r] = minCap(z, z + cap[binOf(z)]);
    for (let it = 0; it < 3; it++) {
      const [m, mr] = minCap(z, z + h);
      if (m >= h - 1e-12) break;
      h = m; r = mr;
    }
    h = clamp(h, hMin, hMax);
    if (h >= T.hCeil - 1e-9 && r !== REASON.RELIEF) r = REASON.BASE;
    while (ki < keys.length && keys[ki].z <= z + EPS) ki++;
    const target = ki < keys.length ? keys[ki].z : H;
    const d = target - z;
    // Auf die nächste Kante (oder das Dach) zulaufen: die letzten ≤ 3 Schichten
    // gleichmäßig teilen statt einer dünnen Restschicht am Ende
    let snap = false;
    let n = Math.ceil(d / h - 1e-9);
    if (n <= 3) {
      if (d / n < hMin) n = Math.max(1, Math.floor(d / hMin + 1e-9));
      h = Math.min(d / n, hMax);
      snap = n === 1 && ki < keys.length;
    }
    if (h < EPS) break;
    layers.push({ z0: z, h, r, snap });
    z += h;
    if (snap || Math.abs(z - target) < EPS) z = target;
  }

  const profile = [];
  layers.forEach((L, i) => {
    profile.push(L.z0, L.h);
    profile.push(i === layers.length - 1 ? H : L.z0 + L.h - PE, L.h);
  });
  profile[profile.length - 2] = H;

  return {
    height: H, layers, profile,
    nLayers: layers.length,
    nUniform: 1 + Math.ceil(Math.max(0, H - hFirst) / T.hBase - 1e-9),
    snaps: layers.filter(L => L.snap).map(L => +(L.z0 + L.h).toFixed(3)),
    targets: T,
  };
}

// ---------------- 3MF mit Schichtprofil (Bambu Studio / OrcaSlicer / Prusa) --------------
// objects: [{ name, pos (xyz, Druck-Koordinaten), index?, profile? }]

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function deflateRaw(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const out = new Response(new Blob([u8]).stream().pipeThrough(cs));
    return new Uint8Array(await out.arrayBuffer());
  } catch { return null; }
}
export async function zipFiles(files /* [{name, data: Uint8Array|string}] */) {
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
    lh.setUint16(8, useDef ? 8 : 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, useDef ? 8 : 0, true); ch.setUint16(12, 0, true);
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

const xmlEsc = (s) => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const num = (v) => { const s = v.toFixed(5); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };

// Doppelte Vertices zusammenlegen (nicht-indizierte Netze → geschlossene 3MF-Hülle)
function weld(pos, index) {
  const map = new Map(), verts = [], remap = new Int32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let id = map.get(k);
    if (id === undefined) { id = verts.length / 3; map.set(k, id); verts.push(x, y, z); }
    remap[i] = id;
  }
  const n = index ? index.length : pos.length / 3, tris = [];
  for (let i = 0; i + 2 < n; i += 3) {
    const a = remap[index ? index[i] : i], b = remap[index ? index[i + 1] : i + 1], c = remap[index ? index[i + 2] : i + 2];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { verts, tris };
}

export async function build3mf(objects, { title = 'V3D Slicer' } = {}) {
  let resources = '', build = '', profTxt = '';
  objects.forEach((o, i) => {
    const id = i + 1;
    const { verts, tris } = weld(o.pos, o.index);
    const vs = [], ts = [];
    for (let v = 0; v < verts.length; v += 3) vs.push(`<vertex x="${num(verts[v])}" y="${num(verts[v + 1])}" z="${num(verts[v + 2])}"/>`);
    for (let t = 0; t < tris.length; t += 3) ts.push(`<triangle v1="${tris[t]}" v2="${tris[t + 1]}" v3="${tris[t + 2]}"/>`);
    resources += `<object id="${id}" name="${xmlEsc(o.name || `Objekt ${id}`)}" type="model"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>\n`;
    build += `<item objectid="${id}"/>\n`;
    // Studio/Orca lesen object_id 1-basiert in Objekt-Reihenfolge, Werte mit %f
    if (o.profile && o.profile.length >= 6) profTxt += `object_id=${id}|${o.profile.map(v => v.toFixed(6)).join(';')}\n`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${xmlEsc(title)}</metadata>
<metadata name="Application">V3D Slicer</metadata>
<resources>
${resources}</resources>
<build>
${build}</build>
</model>`;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="txt" ContentType="text/plain"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: '3D/3dmodel.model', data: model },
  ];
  if (profTxt) {
    files.push({ name: 'Metadata/layer_heights_profile.txt', data: profTxt });               // Bambu Studio / OrcaSlicer
    files.push({ name: 'Metadata/Slic3r_PE_layer_heights_profile.txt', data: profTxt });    // PrusaSlicer
  }
  return zipFiles(files);
}
