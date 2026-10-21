// 3MF-Parser ohne DOM (V3D CAD). Liest die .model-XMLs direkt als Bytes.
// Warum: DOMParser auf einem 50-MB-Scan-3MF (entpackt mehrere 100 MB XML) fror die
// Seite minutenlang ein („Diese Seite antwortet nicht", 21.10.26). Dieser Scanner legt
// keinen DOM-Baum an, schreibt direkt in Typed Arrays und läuft zusätzlich als Worker
// (dieselbe Datei: im Haupt-Thread per <script>, im Worker per new Worker('lib/p3mf.js')).
//
// Ergebnis von P3MF.parseZip(u8) / P3MF.assemble(models): [{name, pos:Float32Array}]
// in mm, ein Teil pro Build-Item; hat das 3MF nur EIN Item, dessen Objekt aber mehrere
// Mesh-Komponenten (Bambu „Objekt mit Teilen"), wird pro Komponente geteilt.
// Echte Slicer-/Makerworld-3MFs: Geometrie in 3D/Objects/*.model (3D/3dmodel.model
// enthält nur Komponenten-Verweise via p:path), Indizes zählen pro Objekt ab 0,
// Platzierung aus den transform-Attributen von <item>/<component>.
(function (root) {
  'use strict';
  const dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  // 3MF-Transform: 12 Zahlen, Zeilenvektor-Konvention v' = v·M + t (Zeile 4 = Translation).
  function mat(str) {
    if (!str) return null;
    const m = str.trim().split(/\s+/).map(Number);
    return (m.length === 12 && m.every(Number.isFinite)) ? m : null;
  }
  function mul(a, b) { // erst a anwenden, dann b → kombinierte 12er-Matrix
    if (!a) return b; if (!b) return a;
    const r = new Array(12);
    for (let i = 0; i < 4; i++) {
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      r[i * 3]     = x * b[0] + y * b[3] + z * b[6] + (i === 3 ? b[9] : 0);
      r[i * 3 + 1] = x * b[1] + y * b[4] + z * b[7] + (i === 3 ? b[10] : 0);
      r[i * 3 + 2] = x * b[2] + y * b[5] + z * b[8] + (i === 3 ? b[11] : 0);
    }
    return r;
  }

  const P10 = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];
  // Zahl aus Bytes [a,b) — Vorzeichen, Ganz-/Nachkommateil, Exponent; sonst NaN.
  function num(u8, a, b) {
    let k = a;
    while (k < b && u8[k] <= 32) k++;
    let sign = 1;
    if (u8[k] === 45) { sign = -1; k++; } else if (u8[k] === 43) k++;
    let v = 0, any = false, d;
    while (k < b && (d = u8[k] - 48) >= 0 && d <= 9) { v = v * 10 + d; k++; any = true; }
    if (u8[k] === 46) {
      k++; let f = 0, nd = 0;
      while (k < b && (d = u8[k] - 48) >= 0 && d <= 9) { if (nd < 15) { f = f * 10 + d; nd++; } k++; any = true; }
      v += f / P10[nd];
    }
    if (!any) return NaN;
    if (u8[k] === 101 || u8[k] === 69) {
      k++; let es = 1, e = 0, ea = false;
      if (u8[k] === 45) { es = -1; k++; } else if (u8[k] === 43) k++;
      while (k < b && (d = u8[k] - 48) >= 0 && d <= 9) { e = e * 10 + d; k++; ea = true; }
      if (!ea) return NaN;
      v *= Math.pow(10, es * e);
    }
    while (k < b && u8[k] <= 32) k++;
    return k === b ? sign * v : NaN;
  }
  function str(u8, a, b) {
    const s = dec ? dec.decode(u8.subarray(a, b)) : String.fromCharCode.apply(null, u8.subarray(a, b));
    return s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      const l = e.toLowerCase();
      if (l[0] === '#') return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[l];
    });
  }
  // Attribute in [a,b) durchlaufen: cb(lokalerNameStart, nameEnde, wertStart, wertEnde)
  function eachAttr(u8, a, b, cb) {
    let p = a;
    while (p < b) {
      while (p < b && (u8[p] <= 32 || u8[p] === 47)) p++;
      if (p >= b) break;
      const ns = p; let ls = p;
      while (p < b && u8[p] !== 61 && u8[p] > 32) { if (u8[p] === 58) ls = p + 1; p++; }
      const ne = p;
      while (p < b && u8[p] !== 34 && u8[p] !== 39) p++;
      if (p >= b) break;
      const q = u8[p], vs = p + 1; let ve = vs;
      while (ve < b && u8[ve] !== q) ve++;
      if (ne > ns) cb(ls, ne, vs, ve);
      p = ve + 1;
    }
  }
  function attrs(u8, a, b) {
    const o = {};
    eachAttr(u8, a, b, (ls, ne, vs, ve) => { o[str(u8, ls, ne)] = str(u8, vs, ve); });
    return o;
  }

  // Eine .model-Datei → {objs:{id:{mesh:{verts,tris}|null, comps:[], name}}, items:[], scale}
  function scanModel(u8) {
    const n = u8.length, objs = {}, items = [];
    let scale = 1, cur = null, V = null, nv = 0, T = null, nt = 0;
    const endObj = () => {
      if (cur && nt) cur.mesh = { verts: V.subarray(0, nv * 3), tris: T.subarray(0, nt * 3) };
      cur = null; V = T = null; nv = nt = 0;
    };
    let i = 0;
    for (;;) {
      const lt = u8.indexOf(60, i); if (lt < 0) break;
      let j = lt + 1; const c = u8[j];
      if (c === 33 || c === 63) {          // <!-- --> / <![CDATA[ ]]> / <? ?>
        if (u8[j + 1] === 45 && u8[j + 2] === 45) {
          let k = j + 3; while (k < n && !(u8[k] === 45 && u8[k + 1] === 45 && u8[k + 2] === 62)) k++;
          i = k + 3;
        } else if (u8[j + 1] === 91) {
          let k = j + 2; while (k < n && !(u8[k] === 93 && u8[k + 1] === 93 && u8[k + 2] === 62)) k++;
          i = k + 3;
        } else { const gt = u8.indexOf(62, j); i = gt < 0 ? n : gt + 1; }
        continue;
      }
      const close = c === 47; if (close) j++;
      let ls = j;
      while (j < n) { const ch = u8[j]; if (ch <= 32 || ch === 47 || ch === 62) break; if (ch === 58) ls = j + 1; j++; }
      let k = j, q = 0;
      while (k < n) { const ch = u8[k]; if (q) { if (ch === q) q = 0; } else if (ch === 34 || ch === 39) q = ch; else if (ch === 62) break; k++; }
      const te = k; i = k + 1;
      const len = j - ls, f0 = u8[ls];
      // Schnellweg für die Millionen <vertex>/<triangle>
      if (!close && f0 === 118 && len === 6 && u8[ls + 5] === 120) {          // vertex
        if (!cur) continue;
        if (!V) V = new Float32Array(3 * 4096);
        if (nv * 3 + 3 > V.length) { const b = new Float32Array(V.length * 2); b.set(V); V = b; }
        let x = NaN, y = NaN, z = NaN;
        eachAttr(u8, j, te, (as, ae, vs, ve) => {
          if (ae - as !== 1) return; const a = u8[as];
          if (a === 120) x = num(u8, vs, ve); else if (a === 121) y = num(u8, vs, ve); else if (a === 122) z = num(u8, vs, ve);
        });
        V[nv * 3] = x; V[nv * 3 + 1] = y; V[nv * 3 + 2] = z; nv++;
        continue;
      }
      if (!close && f0 === 116 && len === 8 && u8[ls + 1] === 114 && u8[ls + 7] === 101) {   // triangle
        if (!cur) continue;
        if (!T) T = new Uint32Array(3 * 8192);
        if (nt * 3 + 3 > T.length) { const b = new Uint32Array(T.length * 2); b.set(T); T = b; }
        let a1 = -1, a2 = -1, a3 = -1;
        eachAttr(u8, j, te, (as, ae, vs, ve) => {
          if (ae - as !== 2 || u8[as] !== 118) return; const d = u8[as + 1];
          if (d === 49) a1 = num(u8, vs, ve); else if (d === 50) a2 = num(u8, vs, ve); else if (d === 51) a3 = num(u8, vs, ve);
        });
        // ungültige Indizes → 0xFFFFFFFF, fliegt beim Zusammensetzen raus
        T[nt * 3] = a1 >= 0 ? a1 : 4294967295; T[nt * 3 + 1] = a2 >= 0 ? a2 : 4294967295; T[nt * 3 + 2] = a3 >= 0 ? a3 : 4294967295; nt++;
        continue;
      }
      const nm = str(u8, ls, j);
      if (close) { if (nm === 'object') endObj(); continue; }
      const selfClose = u8[te - 1] === 47;
      if (nm === 'object') {
        endObj();
        const at = attrs(u8, j, te);
        if (at.id) { cur = { mesh: null, comps: [], name: at.name || '' }; objs[at.id] = cur; }
        if (selfClose) endObj();
      } else if (nm === 'component') {
        if (!cur) continue;
        const at = attrs(u8, j, te);
        cur.comps.push({ id: at.objectid, path: at.path || '', m: mat(at.transform) });
      } else if (nm === 'item') {
        const at = attrs(u8, j, te);
        items.push({ id: at.objectid, path: at.path || '', m: mat(at.transform) });
      } else if (nm === 'model') {
        const unit = (attrs(u8, j, te).unit || 'millimeter').toLowerCase();
        scale = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unit] || 1;
      }
    }
    endObj();
    return { objs, items, scale };
  }

  // models = {zipPfad→Uint8Array} aller .model-Dateien → [{name, pos}]
  function assemble(models) {
    const norm = p => String(p || '').replace(/^\//, '');
    const parsed = {};
    for (const name of Object.keys(models)) {
      try { parsed[norm(name)] = scanModel(models[name]); } catch (e) { console.warn('3MF: Modell-Datei unlesbar:', name, e); }
    }
    const keys = Object.keys(parsed); if (!keys.length) return [];
    const rootKey = keys.find(k => /(^|\/)3dmodel\.model$/i.test(k)) || keys.find(k => parsed[k].items.length) || keys[0];
    const rt = parsed[rootKey];
    const getObj = (pathKey, id) => { const mod = parsed[pathKey]; return mod && mod.objs[id]; };
    function count(pathKey, id, depth) {
      if (depth > 8) return 0;
      const o = getObj(pathKey, id); if (!o) return 0;
      let c = o.mesh ? o.mesh.tris.length / 3 : 0;
      for (const cp of o.comps) c += count(cp.path ? norm(cp.path) : pathKey, cp.id, depth + 1);
      return c;
    }
    function emit(st, pathKey, id, m, depth) {
      if (depth > 8) return;
      const o = getObj(pathKey, id); if (!o) return;
      if (o.mesh) {
        const { verts, tris } = o.mesh, nvx = verts.length / 3, out = st.out;
        for (let t = 0; t < tris.length; t += 3) {
          let p = st.p, ok = true;
          for (let jj = 0; jj < 3; jj++) {
            const vi = tris[t + jj];
            if (vi >= nvx) { ok = false; break; }
            let x = verts[vi * 3], y = verts[vi * 3 + 1], z = verts[vi * 3 + 2];
            if (m) { const nx = x * m[0] + y * m[3] + z * m[6] + m[9], ny = x * m[1] + y * m[4] + z * m[7] + m[10], nz = x * m[2] + y * m[5] + z * m[8] + m[11]; x = nx; y = ny; z = nz; }
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; break; }
            out[p++] = x; out[p++] = y; out[p++] = z;
          }
          if (ok) st.p = p;
        }
      }
      for (const cp of o.comps) emit(st, cp.path ? norm(cp.path) : pathKey, cp.id, mul(cp.m, m), depth + 1);
    }
    const roots = rt.items.length
      ? rt.items.map(it => ({ path: it.path ? norm(it.path) : rootKey, id: it.id, m: it.m }))
      : Object.keys(rt.objs).map(id => ({ path: rootKey, id, m: null }));
    let units = roots;
    if (roots.length === 1) {
      const o = getObj(roots[0].path, roots[0].id);
      if (o && !(o.mesh && o.mesh.tris.length) && o.comps.length > 1)
        units = o.comps.map(c => ({ path: c.path ? norm(c.path) : roots[0].path, id: c.id, m: mul(c.m, roots[0].m) }));
    }
    const parts = [];
    units.forEach((u, i) => {
      const nTri = count(u.path, u.id, 0); if (!nTri) return;
      const st = { out: new Float32Array(nTri * 9), p: 0 };
      emit(st, u.path, u.id, u.m, 0);
      if (!st.p) return;
      let pos = st.p === st.out.length ? st.out : st.out.slice(0, st.p);
      if (rt.scale !== 1) for (let q = 0; q < pos.length; q++) pos[q] *= rt.scale;
      const o = getObj(u.path, u.id);
      parts.push({ name: (o && o.name) || ('Teil ' + (i + 1)), pos });
    });
    return parts;
  }

  function parseZip(u8) {
    let models = {};
    try { models = root.fflate.unzipSync(u8, { filter: fl => /\.model$/i.test(fl.name) }); } catch (e) { models = {}; }
    return assemble(models);
  }

  root.P3MF = { scanModel, assemble, parseZip, mat, mul, num };

  // Als Worker gestartet: Zip rein, Teile (übertragbare Float32Arrays) raus
  if (typeof document === 'undefined' && typeof importScripts === 'function') {
    importScripts('fflate.min.js');
    root.onmessage = e => {
      const d = e.data || {};
      try {
        const parts = parseZip(new Uint8Array(d.buf));
        root.postMessage({ id: d.id, parts }, parts.map(p => p.pos.buffer));
      } catch (err) { root.postMessage({ id: d.id, error: String((err && err.message) || err) }); }
    };
  }
})(typeof self !== 'undefined' ? self : this);
