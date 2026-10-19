  // ── Formwerkzeuge: Drehen, Aushöhlen, Spiegeln, Muster, Import ──────────
  // Welt-Richtung (Z oben) → Editor-Richtung
  const dirApp = d => new THREE.Vector3(d[0], d[2], -d[1]);
  const DIRS = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], top: [0, 0, 1], '+z': [0, 0, 1], bottom: [0, 0, -1], '-z': [0, 0, -1] };

  // Rotationskörper aus einem Profil [[r, z], …] (mm), um die senkrechte Achse durch center.
  // Gleicher Aufbau wie „Drehen“ im Editor (normierte Punkte + Maßstab), damit der Körper
  // dort mit ✏ weiter bearbeitet werden kann.
  function revolve(p) {
    const prof = p.profile;
    if (!Array.isArray(prof) || prof.length < 2 || !prof.every(q => Array.isArray(q) && q.length === 2 && q.every(isFinite)))
      fail('profile: mindestens 2 Punkte [r, z] in mm');
    if (prof.some(q => q[0] < 0)) fail('profile: r (Abstand zur Achse) darf nicht negativ sein');
    const pts = prof.map(q => new THREE.Vector2(q[0] / S, q[1] / S));
    const maxR = Math.max(...pts.map(q => q.x)); if (!(maxR > 0)) fail('profile: mindestens ein Punkt mit r > 0');
    const ys = pts.map(q => q.y), minH = Math.min(...ys), maxH = Math.max(...ys);
    const totalH = maxH - minH; if (!(totalH > 0)) fail('profile: braucht eine Höhe (verschiedene z-Werte)');
    const centerH = (minH + maxH) / 2;
    const normPts = pts.map(q => new THREE.Vector2(q.x / maxR, (q.y - centerH) / (totalH / 2)));
    const isHole = !!p.hole, color = isHole ? '#f03030' : (p.color || currentColor);
    const mesh = new THREE.Mesh(_buildRevolveGeo(normPts, {}), new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 0.38, metalness: 0.05, transparent: isHole, opacity: isHole ? 0.52 : 1, side: THREE.DoubleSide }));
    mesh.scale.set(maxR, totalH / 2, maxR);
    mesh.position.y = centerH;
    mesh.castShadow = mesh.receiveShadow = true;
    typeCounts['revolve'] = (typeCounts['revolve'] || 0) + 1;
    mesh.userData = { id: idCtr++, type: 'revolve', shapeType: 'revolve', name: p.name ? String(p.name) : 'Drehen ' + typeCounts['revolve'],
      color, isHole, fillet: 0, chamfer: 0, revolveNormPts: normPts.map(q => ({ x: q.x, y: q.y })),
      revolveTwist: 0, revolveWall: 0, revolveCross: 'circle', revolvePolyN: 6, revolveWaveN: 8, revolveWaveAmp: 20,
      revolveSurface: 'none', revolveStripsN: 16, revolveStripsD: 20,
      _origGeo: _buildRevolveGeo(_revolveInterpolate(normPts, 48), { hires: true }) };
    objects.push(mesh); scene.add(mesh);
    if (p.wall > 0) { mesh.userData.revolveWall = +p.wall; _rebuildRevolveGeo(mesh); }
    _updateObjEdgeLines(mesh);
    const c = p.center ? needVec3([p.center[0], p.center[1], 0], 'center') : [0, 0, 0];
    mesh.position.x = c[0] / S; mesh.position.z = -c[1] / S;
    mesh.updateMatrixWorld(true);
    return info(mesh, true);
  }

  // Aushöhlen (OCCT-Shell): Wand nach innen, die genannten Seiten bleiben offen
  async function shell(p) {
    const t = +p.thickness; if (!(t > 0)) fail('thickness muss > 0 mm sein');
    const o = byId(p.id); edgeFrame(o);                         // gleiche Grenzen wie Runden (ungedreht, Grundkörper)
    const open = p.open === undefined ? ['top'] : Array.isArray(p.open) ? p.open : [p.open];
    if (!open.length) fail('open: mindestens eine Seite (top, bottom, +x, -x, +y, -y), die offen bleibt');
    const b = getMeshBox(o), c = b.getCenter(new THREE.Vector3()), half = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const faces = open.map(s => {
      const d = DIRS[String(s).toLowerCase()]; if (!d) fail('open: ' + s + ' — erlaubt top, bottom, +x, -x, +y, -y');
      const n = dirApp(d);
      const pt = c.clone().add(new THREE.Vector3(n.x * half.x, n.y * half.y, n.z * half.z));
      return { worldP: [pt.x, pt.y, pt.z], worldN: [n.x, n.y, n.z] };
    });
    const res = await _applyCSGShell(o, faces, t);
    if (!res) fail('Aushöhlen mit ' + t + ' mm hat OCCT nicht geschafft — Wand dünner wählen?');
    res.userData._shellThickness = t;
    if (o.userData.isHole) setHole(res, true);
    return info(res, true);
  }

  // Spiegeln: Geometrie wirklich spiegeln (Welt einbacken + Dreiecke umdrehen).
  // Negative Skalierung wie beim Editor-Spiegeln dreht beim Export die Normalen nach innen.
  function mirror(p) {
    const src = byId(p.id);
    if (!src.isMesh) fail('Spiegeln geht nur an einzelnen Körpern, nicht an Gruppen');
    const plane = String(p.plane || 'YZ').toUpperCase();
    const axis = { YZ: 0, XZ: 1, XY: 2 }[plane]; if (axis === undefined) fail('plane: YZ (spiegelt X), XZ (spiegelt Y) oder XY (spiegelt Z)');
    const bw = boxWorld(src);
    const at = p.at !== undefined ? +p.at : bw.center[axis];
    if (!isFinite(at)) fail('at muss eine Zahl (mm) sein');
    // Spiegelebene in Editor-Koordinaten: Welt X→x, Y→−z, Z→y
    const appAxis = [0, 2, 1][axis], appAt = axis === 1 ? -at / S : at / S;
    const s = new THREE.Vector3(1, 1, 1); s.setComponent(appAxis, -1);
    const off = new THREE.Vector3(); off.setComponent(appAxis, appAt);
    const M = new THREE.Matrix4().makeTranslation(off.x, off.y, off.z)
      .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z))
      .multiply(new THREE.Matrix4().makeTranslation(-off.x, -off.y, -off.z));
    src.updateMatrixWorld(true);
    let geo = src.geometry.clone().applyMatrix4(src.matrixWorld).applyMatrix4(M);
    geo = _ensureOutwardGeo(geo);                               // Dreiecke wieder nach außen
    const mat = src.material.clone();
    const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true;
    m.userData = { id: p.copy ? idCtr++ : src.userData.id, type: 'custom', shapeType: 'custom',
      name: (src.userData.name || 'Körper') + (p.copy ? ' gespiegelt' : ''), color: src.userData.color, isHole: !!src.userData.isHole,
      fillet: 0, chamfer: 0, _origGeo: geo };
    if (p.copy) { objects.push(m); scene.add(m); }
    else { const i = objects.indexOf(src); objects[i] = m; scene.remove(src); scene.add(m); }
    _updateObjEdgeLines(m);
    return info(m, true);
  }

  // Muster: Kopien linear versetzt oder im Kreis um eine Achse (Kopien drehen sich mit)
  async function pattern(p, log) {
    const src = byId(p.id);
    if (!!p.linear === !!p.circular) fail('genau eins angeben: linear {count, step} oder circular {count, axis?, center?, angle?}');
    const copy = () => {
      const d = objectToData(src); delete d.id;
      const o = buildObjectFromData(d); o.userData.id = idCtr++;
      scene.add(o); objects.push(o); return o;
    };
    const made = [];
    if (p.linear) {
      const n = Math.round(p.linear.count), st = needVec3(p.linear.step, 'linear.step');
      if (!(n >= 2) || n > 200) fail('linear.count: 2 bis 200 (inklusive Original)');
      for (let i = 1; i < n; i++) {
        const o = copy(); o.position.add(toApp([st[0] * i, st[1] * i, st[2] * i])); o.updateMatrixWorld(true); made.push(o);
      }
    } else {
      const c0 = p.circular, n = Math.round(c0.count);
      if (!(n >= 2) || n > 200) fail('circular.count: 2 bis 200 (inklusive Original)');
      const ang = c0.angle === undefined ? 360 : +c0.angle;
      const step = Math.abs(ang % 360) < 1e-9 ? ang / n : ang / (n - 1);    // voller Kreis: keine Doppelung am Ende
      const ax = String(c0.axis || 'Z').toUpperCase(); const ai = { X: 0, Y: 1, Z: 2 }[ax];
      if (ai === undefined) fail('circular.axis: X, Y oder Z');
      const cen = c0.center ? needVec3(c0.center, 'circular.center') : [0, 0, 0];
      const ca = toApp(cen);
      for (let i = 1; i < n; i++) {
        const o = copy();
        const rot = [0, 0, 0]; rot[ai] = step * i;
        const mw = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'ZYX'));
        const R = new THREE.Matrix4().multiplyMatrices(Cinv, mw).multiply(C);
        o.applyMatrix4(new THREE.Matrix4().makeTranslation(ca.x, ca.y, ca.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-ca.x, -ca.y, -ca.z)));
        o.updateMatrixWorld(true); made.push(o);
      }
    }
    if (p.union) return Object.assign(await CMDS['bool.union'].fn({ ids: [src.userData.id, ...made.map(o => o.userData.id)] }, log), { copies: made.length });
    return { created: made.map(o => info(o)), copies: made.length };
  }

  // Import: STL, 3MF, OBJ, STEP (Bytes als Base64) über die Import-Wege des Editors
  async function importFile(p) {
    if (typeof p.base64 !== 'string' || !p.name) fail('name und base64 nötig');
    const bin = atob(p.base64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const buf = u8.buffer, name = String(p.name), ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    const before = new Set(objects);
    if (ext === 'stl') _addImportedStl(buf, name, false);
    else if (ext === '3mf') await _importThreeMF(buf, name);
    else if (ext === 'obj') _addImportedGeo(_parseOBJ(new TextDecoder().decode(buf)), name, false, null, false);
    else if (ext === 'step' || ext === 'stp') await _importStepFile({ name, size: buf.byteLength, arrayBuffer: async () => buf });
    else fail('Format .' + ext + ' wird nicht unterstützt — stl, 3mf, obj, step');
    const neu = objects.filter(o => !before.has(o));
    if (!neu.length) fail('Import hat nichts geliefert');
    if (p.center) {
      const box = new THREE.Box3(); neu.forEach(o => box.union(getMeshBox(o)));
      const c = toWorld(box.getCenter(new THREE.Vector3()));
      const mv = toApp([p.center[0] - c[0], p.center[1] - c[1], 0]);
      neu.forEach(o => { o.position.add(mv); o.updateMatrixWorld(true); });
    }
    return { created: neu.map(o => info(o, true)) };
  }

