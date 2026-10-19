  // ── Skizze → Körper ────────────────────────────────────────────────────
  // Kontur in Skizzen-mm → Punktliste [[x,y], …]
  function contour(c, name) {
    if (!c || typeof c !== 'object') fail(name + ': Kontur fehlt ({rect}|{circle}|{ngon}|{polygon})');
    const ring = (cx, cy, r, n, a0) => Array.from({ length: n }, (_, i) => {
      const a = (a0 || 0) + 2 * Math.PI * i / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    if (c.polygon) {
      if (!Array.isArray(c.polygon) || c.polygon.length < 3 || !c.polygon.every(q => Array.isArray(q) && q.length === 2 && q.every(isFinite)))
        fail(name + '.polygon: mindestens 3 Punkte [x,y]');
      return c.polygon.map(q => [+q[0], +q[1]]);
    }
    if (c.circle) {
      const { center = [0, 0], r } = c.circle; if (!(r > 0)) fail(name + '.circle.r muss > 0 sein');
      return ring(center[0], center[1], r, 96);
    }
    if (c.ngon) {
      const { center = [0, 0], r, sides } = c.ngon;
      if (!(r > 0) || !(sides >= 3)) fail(name + '.ngon: r > 0 und sides ≥ 3');
      return ring(center[0], center[1], r, Math.round(sides), Math.PI / 2);
    }
    if (c.rect) {
      const { center = [0, 0], size, corner_radius: cr = 0 } = c.rect;
      if (!Array.isArray(size) || !(size[0] > 0) || !(size[1] > 0)) fail(name + '.rect.size muss [b, h] > 0 sein');
      const [w, h] = size, [cx, cy] = center, r = Math.min(Math.max(0, cr), w / 2 - 1e-3, h / 2 - 1e-3);
      if (r < 1e-3) return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
      const pts = [], n = 12;
      [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]].forEach(([ox, oy, a0]) => {
        for (let i = 0; i <= n; i++) { const a = (a0 + 90 * i / n) * DEG; pts.push([cx + ox + r * Math.cos(a), cy + oy + r * Math.sin(a)]); }
      });
      return pts;
    }
    fail(name + ': unbekannte Kontur — {rect}|{circle}|{ngon}|{polygon}');
  }
  // Skizzen-Ebene → Drehung in Weltkoordinaten (Spalten: Bild von Skizzen-x, -y, Extrusionsrichtung)
  const PLANES = {
    XY: new THREE.Matrix4(),
    XZ: new THREE.Matrix4().makeRotationX(Math.PI / 2),
    YZ: new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1),
  };
  async function sketchExtrude(p, log) {
    const h = +p.height; if (!(h > 0)) fail('height muss > 0 mm sein');
    const plane = String(p.plane || 'XY').toUpperCase(); if (!PLANES[plane]) fail('plane: XY, XZ oder YZ');
    const op = p.op || 'new'; if (!['new', 'join', 'cut'].includes(op)) fail('op: new, join oder cut');
    if (op !== 'new') byId(p.target);
    // Skizzen-mm (x,y) → Editor-Skizze (u = Welt-X, v = Editor-Z = −Welt-Y), Einheiten à 10 mm
    const uv = pts => pts.map(([x, y]) => ({ u: x / S, v: -y / S }));
    const shape = { outer: uv(contour(p.outer, 'outer')), holes: (p.holes || []).map((c, i) => uv(contour(c, 'holes[' + i + ']'))) };
    const be = (fil, cha) => fil > 0 ? { fil: true, mm: +fil } : cha > 0 ? { fil: false, mm: +cha } : null;
    const top = be(p.fillet_top, p.chamfer_top), bot = be(p.fillet_bottom, p.chamfer_bottom);
    const keepFace = _sk.onFace; _sk.onFace = false;            // nie auf eine zufällig offene Fläche setzen
    let mesh;
    try { mesh = _skMakeBodyFromShapes([shape], h, 0, top || bot ? { top, bot } : null); }
    finally { _sk.onFace = keepFace; }
    // Körper liegt jetzt in XY mit Unterkante Z=0 → auf den Abstand heben, dann in die Ebene drehen (um den Ursprung)
    mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
    mesh.position.add(toApp([0, 0, +p.offset || 0]));
    mesh.updateMatrix();
    mesh.applyMatrix4(new THREE.Matrix4().multiplyMatrices(Cinv, PLANES[plane]).multiply(C));
    mesh.updateMatrixWorld(true);
    if (p.name) mesh.userData.name = String(p.name);
    if (p.color) setColorOf(mesh, p.color);
    if (op === 'new') return info(mesh, true);
    if (op === 'cut') return Object.assign(await CMDS['bool.subtract'].fn({ target: p.target, tools: [mesh.userData.id] }, log), { op });
    return Object.assign(await CMDS['bool.union'].fn({ ids: [p.target, mesh.userData.id] }, log), { op });
  }

  // ── Kanten runden/fasen (OCCT, derselbe Weg wie „Kanten bearbeiten“) ────
  const EDGE_SHAPES = ['box', 'cylinder', 'cone', 'tube'];
  function edgeFrame(o) {
    const ud = o.userData;
    if (Math.abs(o.quaternion.x) + Math.abs(o.quaternion.y) + Math.abs(o.quaternion.z) > 1e-6)
      fail('Kanten gehen nur an ungedrehten Körpern — erst runden/fasen, dann drehen');
    if (ud._occtParams && ud.occtShape) {
      _occtBakeTransform(o);                                   // verschoben/skaliert → in die OCCT-Daten einbacken
      const P = o.userData._occtParams;
      return { o, occtShape: ud.occtShape, sx: P.sx, sy: P.sy, sz: P.sz, geoOff: P.geoOff, ops: P.ops || [] };
    }
    const st = ud.shapeType;
    if (!EDGE_SHAPES.includes(st) || !o.isMesh)
      fail('Runden/Fasen geht über die API nur an Quader, Zylinder, Kegel, Rohr (Körper ' + ud.id + ' ist "' + st + '"). Tipp: Kanten VOR dem Vereinen/Abziehen runden, oder bei Skizzen fillet_top/fillet_bottom nutzen');
    const sx = o.scale.x, sy = o.scale.y, sz = o.scale.z;
    const geoOff = st === 'box' ? { x: o.position.x - sx, y: o.position.y - sy, z: o.position.z - sz }
                                : { x: o.position.x, y: o.position.y - sy, z: o.position.z };
    return { o, occtShape: st, sx, sy, sz, geoOff, ops: [] };
  }
  const baseShape = (oc, F) => _buildOCCTBaseShape(oc, F.occtShape, F.sx, F.sy, F.sz, null, F.o.userData.coneTop || 0, F.o.userData.coneFlip);
  // Kanten des GRUNDKÖRPERS (vor Rundungen) — auf sie beziehen sich die Operationen
  function edgesOf(oc, F) {
    const shape = baseShape(oc, F), out = [], seen = new Set();
    const exp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (exp.More()) {
      const e = oc.TopoDS.Edge_1(exp.Current()); const fp = _efpOfEdge(oc, e); exp.Next();
      try { e.delete(); } catch (_) {}
      if (!fp || fp.kind === 'point' || !(fp.len > 1e-6)) continue;
      const k = fp.mid.map(v => Math.round(v * 1e4)).join('_') + '|' + Math.round(fp.len * 1e4);
      if (seen.has(k)) continue; seen.add(k);
      const W = q => toWorld(new THREE.Vector3(q[0] + F.geoOff.x, q[1] + F.geoOff.y, q[2] + F.geoOff.z));
      out.push({ fp, index: out.length, kind: fp.kind === 'circle' ? 'circle' : 'line',
                 a: W(fp.a), b: W(fp.b), mid: W(fp.mid), center: fp.cen ? W(fp.cen) : null,
                 r: fp.r ? r3(fp.r * S) : null, len: r3(fp.len * S) });
    }
    exp.delete();
    try { shape.delete(); } catch (_) {}
    return out;
  }
  const edgeInfo = e => e.kind === 'circle'
    ? { index: e.index, kind: 'circle', center: e.center, r: e.r, length: e.len }
    : { index: e.index, kind: 'line', a: e.a, b: e.b, mid: e.mid, length: e.len };
  function pickEdges(all, sel) {
    if (!all.length) fail('Keine Kanten gefunden');
    const zs = all.flatMap(e => e.kind === 'circle' ? [e.center[2]] : [e.a[2], e.b[2]]);
    const zMin = Math.min(...zs), zMax = Math.max(...zs), tol = 0.01;
    const zOf = e => e.kind === 'circle' ? [e.center[2]] : [e.a[2], e.b[2]];
    if (sel === 'all') return all;
    if (sel === 'top') return all.filter(e => zOf(e).every(z => Math.abs(z - zMax) < tol));
    if (sel === 'bottom') return all.filter(e => zOf(e).every(z => Math.abs(z - zMin) < tol));
    if (sel === 'vertical') return all.filter(e => e.kind === 'line' && Math.abs(e.a[0] - e.b[0]) < tol && Math.abs(e.a[1] - e.b[1]) < tol);
    if (Array.isArray(sel) && sel.length && sel.every(Number.isInteger)) {
      const bad = sel.filter(i => !all[i]); if (bad.length) fail('Kanten-index ' + bad.join(', ') + ' gibt es nicht (0–' + (all.length - 1) + ')');
      return sel.map(i => all[i]);
    }
    if (Array.isArray(sel) && sel.length && sel.every(isVec3)) {
      // Punkt → nächste Kante (Strecke bzw. Kreis)
      const dist = (q, e) => {
        if (e.kind === 'circle') {
          const dz = q[2] - e.center[2], rr = Math.hypot(q[0] - e.center[0], q[1] - e.center[1]);
          return Math.hypot(dz, rr - e.r);
        }
        const ab = [0, 1, 2].map(i => e.b[i] - e.a[i]), aq = [0, 1, 2].map(i => q[i] - e.a[i]);
        const L2 = ab.reduce((s, v) => s + v * v, 0) || 1;
        const t = Math.max(0, Math.min(1, ab.reduce((s, v, i) => s + v * aq[i], 0) / L2));
        return Math.hypot(...[0, 1, 2].map(i => aq[i] - t * ab[i]));
      };
      return sel.map(q => {
        const best = all.reduce((m, e) => { const d = dist(q, e); return d < m.d ? { e, d } : m; }, { e: null, d: Infinity });
        if (best.d > 5) fail('Keine Kante in der Nähe von [' + q.join(', ') + '] (nächste ' + r3(best.d) + ' mm entfernt) — siehe body.edges');
        return best.e;
      });
    }
    fail('edges: all, top, bottom, vertical, Liste von index-Zahlen oder Liste von Punkten [x,y,z]');
  }
  async function edgeOp(p, type, mm) {
    if (!(mm > 0)) fail((type === 'fillet' ? 'radius' : 'distance') + ' muss > 0 mm sein');
    const o = byId(p.id), F = edgeFrame(o);
    const oc = await _loadOCCT();
    const sel = pickEdges(edgesOf(oc, F), p.edges === undefined ? 'all' : p.edges);
    if (!sel.length) fail('Auswahl "' + p.edges + '" trifft keine Kante');
    const dim = { sx: F.sx, sy: F.sy, sz: F.sz };
    const neu = sel.map(e => ({ type, dist: mm / S, idx: 0, fp: e.fp, dim, wa: e.fp.a, wb: e.fp.b }));
    const ops = _mergeOCCTOps(F.ops, neu, dim);
    const base = baseShape(oc, F);
    const { shape, opOk, ops: live } = _replayOCCTOps(oc, base, ops, F.sx, F.sy, F.sz);
    if (!opOk) fail((type === 'fillet' ? 'Runden' : 'Fasen') + ' mit ' + mm + ' mm hat OCCT nicht geschafft — kleinerer Wert? (Wand/Kante zu kurz, oder Rundung und Fase an derselben Ecke)');
    const geo = _occtShapeToThreeGeo(oc, shape, F.geoOff);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(o.userData.color || '#0078ff'), roughness: 0.38, metalness: 0.05, side: THREE.DoubleSide });
    const res = new THREE.Mesh(geo, mat);
    res.castShadow = res.receiveShadow = true;
    res.userData = { ...o.userData, type: 'custom', shapeType: 'custom', occtShape: F.occtShape, fillet: 0, chamfer: 0,
                     _occtParams: { sx: F.sx, sy: F.sy, sz: F.sz, geoOff: F.geoOff, ops: live || ops } };
    delete res.userData.wasBox; delete res.userData.edgeBevels; delete res.userData._dynamicEdges; delete res.userData.capBevel;
    if (o.userData.isHole) setHole(res, true);
    const i = objects.indexOf(o); objects[i] = res;
    scene.remove(o); scene.add(res); _updateObjEdgeLines(res);
    return Object.assign(info(res, true), { edges_changed: sel.length });
  }

  // ── Generatoren (Kinder/Spielwelt, _kgReg) ─────────────────────────────
  function genParams(d, given) {
    const out = {};
    for (const [k, v] of Object.entries(given)) {
      const x = d.params.find(q => q.k === k);
      if (!x) fail('Generator ' + d.id + ' kennt den Parameter "' + k + '" nicht — siehe gen.list {id:"' + d.id + '"}');
      if (x.t === 'range') {
        if (typeof v !== 'number' || !isFinite(v)) fail(k + ' muss eine Zahl sein');
        if (v < x.min || v > x.max) fail(k + ' muss zwischen ' + x.min + ' und ' + x.max + (x.u ? ' ' + x.u : '') + ' liegen');
      } else if (x.o) {
        const hit = x.o.find(o => o[0] === v || String(o[0]) === String(v));
        if (!hit) fail(k + ': erlaubt sind ' + x.o.map(o => JSON.stringify(o[0])).join(', '));
        out[k] = hit[0]; continue;
      } else if (x.t === 'text') {
        if (typeof v !== 'string') fail(k + ' muss Text sein');
        if (x.max && v.length > x.max) fail(k + ': höchstens ' + x.max + ' Zeichen');
      } else if (x.t === 'farbe' && !/^#[0-9a-f]{6}$/i.test(v)) fail(k + ' als #rrggbb angeben');
      out[k] = v;
    }
    return out;
  }
  async function genBuild(d, params, editObj, center) {
    const keepPos = objects.map(o => [o, o.position.clone()]);
    _kgS.id = d.id; _kgS.p = params; _kgS.edit = editObj || null;
    const before = new Set(objects);
    await _kgCreate();
    const neu = objects.filter(o => !before.has(o));
    if (!neu.length) fail(d.name + ' konnte nicht gebaut werden');
    // _genAddParts rückt andere Körper zur Seite — für Agenten nicht erwünscht
    keepPos.forEach(([o, v]) => { if (objects.includes(o)) o.position.copy(v); });
    if (!editObj) {
      const box = new THREE.Box3(); neu.forEach(o => box.union(getMeshBox(o)));
      const c = toWorld(box.getCenter(new THREE.Vector3())), zMin = Math.min(...neu.map(o => boxWorld(o).min[2]));
      const want = center ? needVec3([center[0], center[1], 0], 'center') : [0, 0, 0];
      const mv = toApp([want[0] - c[0], want[1] - c[1], -zMin]);
      neu.forEach(o => { o.position.add(mv); o.updateMatrixWorld(true); });
    }
    return { generator: d.id, created: neu.map(o => info(o, true)) };
  }

