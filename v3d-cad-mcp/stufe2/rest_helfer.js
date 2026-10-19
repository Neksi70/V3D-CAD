  // ── Flächen, Skizzen mit Bedingungen, genaues Messen, Kamera ────────────
  // Formeln in allen Befehlen auswerten — außer dort, wo Text gespeichert wird
  const bpWantsEval = c => !/^(param|timeline)\./.test(c) && !['scene.load', 'file.import'].includes(c);
  const dirWorld = v => [v.x, -v.z, v.y];                     // Editor-Richtung → Welt (Z oben)
  // Ebene Flächen eines Körpers: Dreiecke nach Normale + Ebenenabstand gruppiert
  function facesOf(o) {
    o.updateMatrixWorld(true);
    const groups = new Map();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    o.traverse(m => {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.position || m.userData.isEdgeLines) return;
      const g = m.geometry, p = g.attributes.position, idx = g.index ? g.index.array : null, n = idx ? idx.length : p.count;
      for (let i = 0; i + 2 < n; i += 3) {
        a.fromBufferAttribute(p, idx ? idx[i] : i).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(p, idx ? idx[i + 1] : i + 1).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(p, idx ? idx[i + 2] : i + 2).applyMatrix4(m.matrixWorld);
        const A = toWorld(a), B = toWorld(b), Cc = toWorld(c);
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
        const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
        const len = Math.hypot(nx, ny, nz); if (len < 1e-9) continue;
        const N = [nx / len, ny / len, nz / len], d = N[0] * A[0] + N[1] * A[1] + N[2] * A[2];
        const key = N.map(x => Math.round(x * 200)).join(',') + '|' + Math.round(d * 20);
        let G = groups.get(key);
        if (!G) { G = { n: N, d, area: 0, cx: 0, cy: 0, cz: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; groups.set(key, G); }
        const ar = len / 2; G.area += ar;
        G.cx += ar * (A[0] + B[0] + Cc[0]) / 3; G.cy += ar * (A[1] + B[1] + Cc[1]) / 3; G.cz += ar * (A[2] + B[2] + Cc[2]) / 3;
        for (const P of [A, B, Cc]) for (let k = 0; k < 3; k++) { G.min[k] = Math.min(G.min[k], P[k]); G.max[k] = Math.max(G.max[k], P[k]); }
      }
    });
    const bw = boxWorld(o);
    const list = [...groups.values()].filter(G => G.area > 0.5).sort((x, y) => y.area - x.area).map(G => ({
      normal: G.n.map(r3), center: [r3(G.cx / G.area), r3(G.cy / G.area), r3(G.cz / G.area)], area_mm2: r3(G.area),
      bbox: { min: G.min.map(r3), max: G.max.map(r3) } }));
    // Namen für die äußeren, achsenparallelen Flächen (die größte je Richtung)
    const tags = [['top', 2, 1], ['bottom', 2, -1], ['+x', 0, 1], ['-x', 0, -1], ['+y', 1, 1], ['-y', 1, -1]];
    list.forEach((f, i) => { f.index = i; });
    for (const [name, ax, sg] of tags) {
      const f = list.find(f => Math.abs(f.normal[ax] - sg) < 1e-3 && Math.abs(f.center[ax] - (sg > 0 ? bw.max[ax] : bw.min[ax])) < 0.05);
      if (f && !f.name) f.name = name;
    }
    return list.slice(0, 60);
  }
  function pickFace(o, sel) {
    const fs = facesOf(o); if (!fs.length) fail('Körper ' + o.userData.id + ' hat keine ebenen Flächen');
    if (typeof sel === 'number') { const f = fs[sel]; if (!f) fail('Fläche ' + sel + ' gibt es nicht (0–' + (fs.length - 1) + ')'); return f; }
    if (typeof sel === 'string') { const f = fs.find(f => f.name === sel.toLowerCase()); if (!f) fail('Fläche „' + sel + '“ gibt es nicht — siehe body.faces'); return f; }
    if (isVec3(sel)) {
      let best = null;
      for (const f of fs) {
        const d = Math.abs(f.normal[0] * sel[0] + f.normal[1] * sel[1] + f.normal[2] * sel[2] - (f.normal[0] * f.center[0] + f.normal[1] * f.center[1] + f.normal[2] * f.center[2]));
        const inside = [0, 1, 2].every(k => sel[k] >= f.bbox.min[k] - 0.1 && sel[k] <= f.bbox.max[k] + 0.1);
        if (inside && (!best || d < best.d)) best = { f, d };
      }
      if (!best || best.d > 0.5) fail('Keine ebene Fläche bei [' + sel.join(', ') + '] — siehe body.faces');
      return best.f;
    }
    fail('face: index, Name (top, bottom, +x, -x, +y, -y) oder Punkt [x,y,z]');
  }
  // Skizzen-Rahmen auf einer Fläche: x-Achse = Welt-X auf die Fläche projiziert (bzw. Y), Normale nach außen
  function faceFrame(f) {
    const n = new THREE.Vector3(...f.normal);
    let x = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x);
    if (x.length() < 0.3) x = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(n, x);
    return { x, y, n, o: new THREE.Vector3(...f.center) };
  }

  // Skizze mit Elementen + Bedingungen über den Skizzen-Löser des Editors (_skcSolve)
  const SKC_TYPES = { h: 'h', horizontal: 'h', v: 'v', vertical: 'v', par: 'par', parallel: 'par', perp: 'perp', perpendicular: 'perp',
    eq: 'eq', equal: 'eq', coin: 'coin', coincident: 'coin', on: 'on', tan: 'tan', tangent: 'tan', conc: 'conc', concentric: 'conc',
    mid: 'mid', midpoint: 'mid', col: 'col', collinear: 'col', sym: 'sym', symmetric: 'sym', fix: 'fix',
    len: 'len', length: 'len', dia: 'dia', diameter: 'dia', rad: 'rad', radius: 'rad', dist: 'dist', distance: 'dist', ang: 'ang', angle: 'ang' };
  function solveSketch(sk) {
    if (!sk || !Array.isArray(sk.entities) || !sk.entities.length) fail('sketch.entities: Liste von Linien/Kreisen/Bögen');
    const idMap = new Map(); let nr = 1;
    const ents = sk.entities.map((e, i) => {
      const id = String(e.id || 'e' + (i + 1)); if (idMap.has(id)) fail('id „' + id + '“ doppelt');
      const P = (q, k) => { if (!Array.isArray(q) || q.length !== 2 || !q.every(isFinite)) fail(id + '.' + k + ': [x, y] in mm'); return { u: q[0] / S, v: q[1] / S }; };
      let en;
      if (e.type === 'line') en = { type: 'line', a: P(e.a, 'a'), b: P(e.b, 'b') };
      else if (e.type === 'circle') { if (!(e.r > 0)) fail(id + '.r > 0'); en = { type: 'circle', c: P(e.c, 'c'), r: e.r / S }; }
      else if (e.type === 'arc') { if (!(e.r > 0)) fail(id + '.r > 0'); en = { type: 'arc', c: P(e.c, 'c'), r: e.r / S, a0: (+e.a0 || 0) * DEG, a1: (+e.a1 || 0) * DEG }; }
      else fail(id + ': type line, circle oder arc');
      en.id = nr++; idMap.set(id, en); return en;
    });
    const ref = s => {
      const [nm, pt] = String(s).split('.'); const en = idMap.get(nm); if (!en) fail('Bezug „' + s + '“: Element „' + nm + '“ gibt es nicht');
      if (pt && !['a', 'b', 'c', 's', 'e'].includes(pt)) fail('Bezug „' + s + '“: Punkt a/b (Linie), c (Mitte), s/e (Bogenenden)');
      return { id: en.id, p: pt || null };
    };
    const cons = (sk.constraints || []).map((c, i) => {
      const t = SKC_TYPES[String(c.type || '').toLowerCase()]; if (!t) fail('constraints[' + i + '].type „' + c.type + '“ unbekannt — ' + Object.keys(SKC_TYPES).filter(k => k.length > 3).join(', '));
      const refs = (c.refs || []).map(ref); if (!refs.length) fail('constraints[' + i + '].refs fehlt');
      const isLine = r => ents.find(e => e.id === r.id).type === 'line';
      const out = { t: t === 'dist' && refs.length === 2 && refs[1].p === null && isLine(refs[1]) ? 'pld' : t, refs };   // Punkt–Linie
      if (['len', 'dia', 'rad', 'dist', 'pld'].includes(out.t)) { if (!(+c.value >= 0)) fail('constraints[' + i + '].value (mm) fehlt'); out.val = +c.value / S; }
      if (out.t === 'ang') { if (!isFinite(+c.value)) fail('constraints[' + i + '].value (Grad) fehlt'); out.val = +c.value * DEG; }
      return out;
    });
    // Vorzeichen-Bedingungen wie im Editor aus der Ausgangslage bestimmen
    const keep = { ents: _sk.ents, cons: _sk.cons, nextId: _sk.nextId, dof: _sk.dof };
    try {
      _sk.ents = ents; _sk.cons = []; _sk.nextId = nr;
      for (const c of cons) {
        const E = c.refs.map(r => ents.find(e => e.id === r.id));
        if (c.t === 'tan') c.s = E[0].type === 'line' ? (Math.sign(_skcLineDist(E[0], E[1].c)) || 1) : (Math.hypot(E[0].c.u - E[1].c.u, E[0].c.v - E[1].c.v) > Math.max(E[0].r, E[1].r) ? 1 : -1);
        if (c.t === 'pld') c.s = Math.sign(_skcLineDist(E[1], _skcPt(E[0], c.refs[0].p))) || 1;
        if (c.t === 'ang') { const a = _skcLn(E[0]), b = _skcLn(E[1]); c.s = Math.sign(a.dx * b.dy - a.dy * b.dx) || 1; }
        if (c.t === 'fix') {
          if (c.refs[0].p) { const q = _skcPt(E[0], c.refs[0].p); c.fx = { u: q.u, v: q.v }; }
          else { c.fx = {}; for (const k of _skcParams(E[0])) c.fx[k.join('.')] = _skcGet(E[0], k); }
        }
      }
      _sk.cons = cons;
      const res = _skcSolve({});
      const loops = _skBuildLoops().map(lp => lp.map(q => ({ u: q.u, v: q.v })));
      const back = {};
      for (const [k, en] of idMap) back[k] = en.type === 'line' ? { a: [r3(en.a.u * S), r3(en.a.v * S)], b: [r3(en.b.u * S), r3(en.b.v * S)] }
        : { c: [r3(en.c.u * S), r3(en.c.v * S)], r: r3(en.r * S), ...(en.type === 'arc' ? { a0: r3(en.a0 / DEG), a1: r3(en.a1 / DEG) } : {}) };
      return { ok: res.ok, dof: res.dof, residual: res.err, entities: back, loops };
    } finally { _sk.ents = keep.ents; _sk.cons = keep.cons; _sk.nextId = keep.nextId; _sk.dof = keep.dof; }
  }
  // Geschlossene Schleifen → Profile (äußere Kontur + Löcher nach Verschachtelung)
  function loopsToShapes(loops) {
    const area = lp => { let s = 0; for (let i = 0; i < lp.length; i++) { const a = lp[i], b = lp[(i + 1) % lp.length]; s += a.u * b.v - b.u * a.v; } return Math.abs(s / 2); };
    const inside = (pt, lp) => { let c = false; for (let i = 0, j = lp.length - 1; i < lp.length; j = i++) {
      const a = lp[i], b = lp[j]; if ((a.v > pt.v) !== (b.v > pt.v) && pt.u < (b.u - a.u) * (pt.v - a.v) / (b.v - a.v) + a.u) c = !c; } return c; };
    const L = loops.map(lp => ({ lp, A: area(lp) })).sort((x, y) => y.A - x.A);
    L.forEach((x, i) => { x.parent = null; for (let j = i - 1; j >= 0; j--) if (inside(x.lp[0], L[j].lp)) { x.parent = L[j]; break; } });
    const depth = x => x.parent ? 1 + depth(x.parent) : 0;
    const outers = L.filter(x => depth(x) % 2 === 0);
    return outers.map(o => ({ outer: o.lp, holes: L.filter(x => x.parent === o).map(x => x.lp) }));
  }

  // Genaues Messen über Manifold (mm, Z oben)
  async function mfOf(o) {
    const w = await _mfInit();
    const mf = _mfUnionObjs(w, [o]); if (!mf) fail('Körper ' + o.userData.id + ' hat keine Flächen');
    return { w, mf };
  }
  async function minDistance(A, B) {
    const { mf: a } = await mfOf(A), { mf: b } = await mfOf(B);
    try {
      const ba = boxWorld(A), bb = boxWorld(B);
      const search = Math.max(1, ...[0, 1, 2].map(k => Math.max(ba.max[k], bb.max[k]) - Math.min(ba.min[k], bb.min[k]))) * 2;
      const gap = a.minGap(b, search);
      let overlap = 0;
      if (gap <= 1e-6) { const x = a.intersect(b); overlap = x.volume(); x.delete(); }
      return { min_distance_mm: r3(gap), overlap_mm3: r3(overlap) };
    } finally { a.delete(); b.delete(); }
  }
  async function section(o, axis, at) {
    const { mf } = await mfOf(o);
    let m = mf;
    try {
      // slice schneidet bei Z = at → für X/Y den Körper vorher so drehen, dass die Achse nach oben zeigt
      if (axis === 'X') m = mf.rotate([0, -90, 0]);
      else if (axis === 'Y') m = mf.rotate([90, 0, 0]);
      const cs = m.slice(at);                                   // Rx(90°): neues Z = altes Y, Ry(−90°): neues Z = altes X
      const polys = cs.toPolygons(), area = cs.area(), bd = cs.bounds();
      cs.delete();
      return { area_mm2: r3(area), contours: polys.length, bounds2d: { min: [r3(bd.min[0]), r3(bd.min[1])], max: [r3(bd.max[0]), r3(bd.max[1])] } };
    } finally { if (m !== mf) m.delete(); mf.delete(); }
  }

  // Schnittansicht im Screenshot: Clipping-Ebene an allen Körpern, behält die Seite keep (−: kleiner als at)
  function clipScene(sec) {
    const ax = { X: 0, Y: 1, Z: 2 }[String(sec.axis || 'Z').toUpperCase()]; if (ax === undefined) fail('section.axis: X, Y oder Z');
    const at = +sec.at; if (!isFinite(at)) fail('section.at (mm) fehlt');
    const sg = sec.keep === '+' ? 1 : -1;
    const nw = [0, 0, 0]; nw[ax] = sg;
    const plane = new THREE.Plane(dirApp(nw).normalize(), -sg * at / S);
    const mats = [];
    objects.forEach(o => o.traverse(m => { if ((m.isMesh || m.isLine) && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => { mats.push([mt, mt.clippingPlanes]); mt.clippingPlanes = [plane]; mt.needsUpdate = true; }); }));
    const before = renderer.localClippingEnabled; renderer.localClippingEnabled = true;
    return () => { mats.forEach(([mt, cp]) => { mt.clippingPlanes = cp; mt.needsUpdate = true; }); renderer.localClippingEnabled = before; };
  }
  // Freie Kamera wie in SolidCraft: Ziel + Drehung (yaw um Z, pitch nach oben, Grad) + Abstand (mm); fov 0 = orthografisch
  function customCam(c, w, h) {
    const t = needVec3(c.target || [0, 0, 0], 'camera.target'), dist = +c.distance;
    if (!(dist > 0)) fail('camera.distance (mm) > 0 nötig');
    const yaw = (+c.yaw || 0) * DEG, pitch = (+c.pitch || 0) * DEG;
    // yaw 0 = von vorn (−Y), 90 = von rechts (+X), 180 = von hinten; pitch 90 = von oben
    const eyeW = [t[0] + dist * Math.sin(yaw) * Math.cos(pitch), t[1] - dist * Math.cos(yaw) * Math.cos(pitch), t[2] + dist * Math.sin(pitch)];
    const fov = c.fov === undefined ? 35 : +c.fov;
    let cam;
    if (fov > 0) cam = new THREE.PerspectiveCamera(fov, w / h, dist / S * 0.01, dist / S * 100 + 200);
    else { const hh = 0.4 * dist / S; cam = new THREE.OrthographicCamera(-hh * w / h, hh * w / h, hh, -hh, 0.01, dist / S * 100 + 200); }
    cam.position.copy(toApp(eyeW));
    cam.up.copy(Math.abs(Math.cos(pitch)) < 1e-3 ? dirApp([-Math.sin(yaw), Math.cos(yaw), 0]) : new THREE.Vector3(0, 1, 0));
    cam.lookAt(toApp(t));
    return cam;
  }

