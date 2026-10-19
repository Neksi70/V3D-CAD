#!/usr/bin/env python3
"""Setzt die Stufe-2-Bausteine (helfer.js, befehle.js) in den V3D-API-Block einer volme3d.html ein.
Aufruf: einsetzen.py DATEI   (idempotent: bricht ab, wenn schon eingesetzt)"""
import sys, pathlib

hier = pathlib.Path(__file__).parent
datei = pathlib.Path(sys.argv[1])
s = datei.read_text(encoding='utf-8')
schon = "'sketch.extrude'" in s      # Bausteine schon drin → nur noch die Ersetzungen

anker_helfer = "  // ── Befehle ────────────────────────────────────────────────────────────\n  // doc: einzeilige"
anker_befehle = "    'measure': { undo: false, doc: '{id?} — Volumen"
if not schon:
    for a in (anker_helfer, anker_befehle):
        if s.count(a) != 1:
            sys.exit('Anker nicht eindeutig: ' + a[:50])
    s = s.replace(anker_helfer, (hier / 'helfer.js').read_text(encoding='utf-8') + anker_helfer)
    s = s.replace(anker_befehle, (hier / 'befehle.js').read_text(encoding='utf-8') + anker_befehle)
# Formwerkzeuge (Drehen, Aushöhlen, Spiegeln, Muster, Import) — eigener Satz Bausteine
if "'body.mirror'" not in s:
    for a in (anker_helfer, anker_befehle):
        if s.count(a) != 1:
            sys.exit('Anker nicht eindeutig: ' + a[:50])
    s = s.replace(anker_helfer, (hier / 'formen_helfer.js').read_text(encoding='utf-8') + anker_helfer)
    s = s.replace(anker_befehle, (hier / 'formen_befehle.js').read_text(encoding='utf-8') + anker_befehle)
# Bauplan (Parametrik) — eigener Satz Bausteine
if "'param.set'" not in s:
    for a in (anker_helfer, anker_befehle):
        if s.count(a) != 1:
            sys.exit('Anker nicht eindeutig: ' + a[:50])
    s = s.replace(anker_helfer, (hier / 'bauplan_helfer.js').read_text(encoding='utf-8') + anker_helfer)
    s = s.replace(anker_befehle, (hier / 'bauplan_befehle.js').read_text(encoding='utf-8') + anker_befehle)
# Rest: Flächen, Skizzen mit Bedingungen, genaues Messen, Kamera — eigener Satz Bausteine
if "'body.faces'" not in s:
    for a in (anker_helfer, anker_befehle):
        if s.count(a) != 1:
            sys.exit('Anker nicht eindeutig: ' + a[:50])
    s = s.replace(anker_helfer, (hier / 'rest_helfer.js').read_text(encoding='utf-8') + anker_helfer)
    s = s.replace(anker_befehle, (hier / 'rest_befehle.js').read_text(encoding='utf-8') + anker_befehle)
# Drehen: relativ („rotate“) für alle Körper; absolut („rotation“) nur bei Grundformen.
# Bool-/Skizzen-/Generator-Ergebnisse tragen oft eine innere Grunddrehung — absolut
# gesetzt landete der Deckel aus dem Rezept hochkant statt umgedreht.
ERSETZE = [
("""    'body.transform': { doc: '{id, center?: [x,y,z] mm, move?: [dx,dy,dz] mm, size?: [x,y,z] mm (null = Achse lassen), rotation?: [rx,ry,rz] ° absolut, drop?: bool (auf die Platte legen)}', fn(p) {
      const o = byId(p.id);
      if (p.size) { if (!Array.isArray(p.size) || p.size.length !== 3) fail('size muss [x,y,z] sein'); setSize(o, p.size); }
      if (p.rotation) { const c = boxWorld(o).center; setRotation(o, needVec3(p.rotation, 'rotation')); setCenter(o, c); }""",
"""    'body.transform': { doc: '{id, center?: [x,y,z] mm, move?: [dx,dy,dz] mm, size?: [x,y,z] mm (null = Achse lassen), rotate?: [rx,ry,rz] ° (um so viel drehen, um die Welt-Achsen X, dann Y, dann Z, um die Körpermitte; geht bei allen Körpern), rotation?: [rx,ry,rz] ° absolut (nur Grundformen), drop?: bool (auf die Platte legen)}', fn(p) {
      const o = byId(p.id);
      if (p.size) { if (!Array.isArray(p.size) || p.size.length !== 3) fail('size muss [x,y,z] sein'); setSize(o, p.size); }
      if (p.rotation) {
        if (!isPrimitive(o)) fail('rotation (absolut) nur bei Grundformen — für diesen Körper rotate (relativ) nehmen');
        const c = boxWorld(o).center; setRotation(o, needVec3(p.rotation, 'rotation')); setCenter(o, c);
      }
      if (p.rotate) { const c = boxWorld(o).center; rotateBy(o, needVec3(p.rotate, 'rotate')); setCenter(o, c); }"""),
("""      rotation: getRotation(o) };""",
"""      ...(isPrimitive(o) ? { rotation: getRotation(o) } : {}) };"""),
("""  function getRotation(o) {""",
"""  const isPrimitive = o => o.isMesh && (o.userData.shapeType in typeNames) && o.userData.type !== 'custom';
  function rotateBy(o, deg) {
    const mw = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(deg[0] * DEG, deg[1] * DEG, deg[2] * DEG, 'ZYX'));
    const qa = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(Cinv, mw).multiply(C));
    o.quaternion.premultiply(qa); o.updateMatrixWorld(true);
  }
  function getRotation(o) {"""),
("""    if (p.grid === false) { hide(gridMesh); hide(_wpGrid); }""",
"""    if (p.grid === false) { hide(gridMesh); hide(_wpGrid); }
    if (!p.axes) hide(window._bpCross);                     // Achsenkreuz stört im Produktbild"""),
("""grid?: bool=true} — PNG als data-URL'""",
"""grid?: bool=true, axes?: bool=false (Achsenkreuz)} — PNG als data-URL'"""),
# Bauplan in den Ablauf einhängen: aufzeichnen, Formeln auswerten, Rückrollen, Undo
("""        const { log, value } = await withLog(log => runOne(command, params, log));""",
"""        const { log, value } = await withLog(async log => {
          if (isRecorded(command)) bpBefore(log);
          const v = await runOne(command, isRecorded(command) ? bpEval(params) : params, log);
          if (mut) bpRecord(command, params, v);
          return v;
        });"""),
("""          const { log, value } = await withLog(log => runOne(st.command, st.params, log));""",
"""          const { log, value } = await withLog(async log => {
            if (isRecorded(st.command)) bpBefore(log);
            const v = await runOne(st.command, isRecorded(st.command) ? bpEval(st.params) : st.params, log);
            bpRecord(st.command, st.params, v);
            return v;
          });"""),
("""  function takeSnap() { return { objs: objects.map(o => objectToData(o, 'undo')), undoLen: undoStack.length, idCtr }; }""",
"""  function takeSnap() { return { objs: objects.map(o => objectToData(o, 'undo')), undoLen: undoStack.length, idCtr,
                                  recipe: clone(recipe), vars: clone(designVars) }; }"""),
("""    restoreState(s.objs);
    undoStack.length = Math.min(undoStack.length, s.undoLen); redoStack = [];""",
"""    restoreState(s.objs);
    idCtr = s.idCtr; designVars = s.vars; recipe = s.recipe;
    if (recipe) recipe.fp = fingerprint();                  // Szene passt wieder zum Bauplan-Stand
    undoStack.length = Math.min(undoStack.length, s.undoLen); redoStack = [];"""),
("""    undoStack.push(s.objs); if (undoStack.length > 50) undoStack.shift();""",
"""    undoStack.push(s.objs); if (undoStack.length > 50) undoStack.shift();
    bpUndo.push(s.recipe); if (bpUndo.length > 50) bpUndo.shift(); bpRedo = [];"""),
("""      if (!undoStack.length) fail('Nichts zum Zurücknehmen'); undo(); return { bodies: objects.length };""",
"""      if (!undoStack.length) fail('Nichts zum Zurücknehmen'); undo();
      bpRedo.push(clone(recipe)); recipe = bpUndo.length ? bpUndo.pop() : null; if (recipe) recipe.fp = fingerprint();
      return { bodies: objects.length };"""),
("""      if (!redoStack.length) fail('Nichts zum Wiederholen'); redo(); return { bodies: objects.length };""",
"""      if (!redoStack.length) fail('Nichts zum Wiederholen'); redo();
      bpUndo.push(clone(recipe)); recipe = bpRedo.length ? bpRedo.pop() : null; if (recipe) recipe.fp = fingerprint();
      return { bodies: objects.length };"""),
# sketch.extrude: Skizze mit Bedingungen + auf einer Fläche skizzieren
("""    if (op !== 'new') byId(p.target);
    // Skizzen-mm""",
"""    // Auf einer Fläche skizzieren: Rahmen aus der Fläche, Ziel ist automatisch ihr Körper
    const F = p.face ? faceFrame(pickFace(byId(p.face.id), p.face.face === undefined ? 'top' : p.face.face)) : null;
    if (F && op !== 'new' && p.target === undefined) p = { ...p, target: p.face.id };
    if (op !== 'new') byId(p.target);
    // Skizzen-mm"""),
("""    const shape = { outer: uv(contour(p.outer, 'outer')), holes: (p.holes || []).map((c, i) => uv(contour(c, 'holes[' + i + ']'))) };""",
"""    let shapes;
    if (p.sketch) {
      const sol = solveSketch(p.sketch);
      if (!sol.loops.length) fail('Die Skizze hat keine geschlossene Kontur — Enden aufeinanderlegen oder mit coin verbinden');
      if (!sol.ok) log.push('Hinweis: Bedingungen nicht alle erfüllbar (Rest ' + r3(sol.residual) + ') — widersprüchlich?');
      if (sol.dof) log.push('Hinweis: Skizze hat noch ' + sol.dof + ' Freiheitsgrad(e), ist also nicht voll bemaßt');
      shapes = loopsToShapes(sol.loops.map(lp => lp.map(q => ({ u: q.u, v: -q.v }))));   // Löser rechnet mit v = y
    } else shapes = [{ outer: uv(contour(p.outer, 'outer')), holes: (p.holes || []).map((c, i) => uv(contour(c, 'holes[' + i + ']'))) }];
    // Auf Flächen: Abziehen ragt 0,5 mm heraus, Anfügen taucht 0,2 mm ein (keine deckungsgleichen Flächen)
    const sink = F ? (op === 'cut' ? h : op === 'join' ? 0.2 : 0) : 0, extra = F ? (op === 'cut' ? 0.5 : op === 'join' ? 0.2 : 0) : 0;"""),
("""    try { mesh = _skMakeBodyFromShapes([shape], h, 0, top || bot ? { top, bot } : null); }""",
"""    try { mesh = _skMakeBodyFromShapes(shapes, h + extra, 0, top || bot ? { top, bot } : null); }"""),
("""    mesh.position.add(toApp([0, 0, +p.offset || 0]));
    mesh.updateMatrix();
    mesh.applyMatrix4(new THREE.Matrix4().multiplyMatrices(Cinv, PLANES[plane]).multiply(C));""",
"""    if (F) {
      const t = F.o.clone().addScaledVector(F.n, (+p.offset || 0) - sink);
      const ta = toApp(t.toArray());
      mesh.updateMatrix();
      mesh.applyMatrix4(new THREE.Matrix4().makeTranslation(ta.x, ta.y, ta.z)
        .multiply(new THREE.Matrix4().multiplyMatrices(Cinv, new THREE.Matrix4().makeBasis(F.x, F.y, F.n)).multiply(C)));
    } else {
      mesh.position.add(toApp([0, 0, +p.offset || 0]));
      mesh.updateMatrix();
      mesh.applyMatrix4(new THREE.Matrix4().multiplyMatrices(Cinv, PLANES[plane]).multiply(C));
    }"""),
("""    'sketch.extrude': { doc: '{outer: Kontur, holes?: [Kontur, …], height: mm,""",
"""    'sketch.extrude': { doc: '{outer: Kontur ODER sketch: {entities, constraints} (Skizze mit Bedingungen, s. u.), holes?: [Kontur, …], height: mm, face?: {id, face: index|top|bottom|+x|-x|+y|-y|[x,y,z]} (auf einer Fläche skizzieren: Skizzen-Ursprung = Flächenmitte, x = Welt-X bzw. -Y auf der Fläche, nach außen extrudiert, cut geht nach innen; Ziel = Körper der Fläche; siehe body.faces),"""),
("""YZ: Seitenansicht, x→Y, y→Z, nach +X', async fn(p, log) {""",
"""YZ: Seitenansicht, x→Y, y→Z, nach +X. Skizze mit Bedingungen: entities [{id:"l1", type:"line", a:[x,y], b:[x,y]} | {id, type:"circle", c:[x,y], r} | {id, type:"arc", c, r, a0, a1 (°)}] als ungefähre Startlage, constraints [{type: h|v|par|perp|eq|coin|on|tan|conc|mid|col|sym|fix|len|dia|rad|dist|ang, refs: ["l1", "l1.a", "l2.b", "c1.c", "a1.s"], value?: mm bzw. °}]; aufeinanderliegende Enden gelten als verbunden; dist von Punkt zu Linie = Abstand senkrecht. Vorher prüfen mit sketch.solve (dof 0 = voll bestimmt)', async fn(p, log) {"""),
# Screenshot: freie Kamera + Schnittansicht
("""    const dir = VIEWS[p.view || 'iso']; if (!dir) fail('view: ' + Object.keys(VIEWS).join(', '));""",
"""    if (p.view && p.camera) fail('view ODER camera angeben, nicht beides');
    const dir = VIEWS[p.camera ? 'iso' : (p.view || 'iso')]; if (!dir) fail('view: ' + Object.keys(VIEWS).join(', '));"""),
("""      const cam = new THREE.PerspectiveCamera(35, w / h, rad * 0.02, rad * 100 + 200);""",
"""      let cam = new THREE.PerspectiveCamera(35, w / h, rad * 0.02, rad * 100 + 200);"""),
("""      cam.lookAt(center);
      renderer.setPixelRatio(1);""",
"""      cam.lookAt(center);
      if (p.camera) cam = customCam(p.camera, w, h);
      renderer.setPixelRatio(1);"""),
("""      renderer.render(scene, cam);
      return { png: canvas.toDataURL('image/png'), width: w, height: h, view: p.view || 'iso' };""",
"""      const undoClip = p.section ? clipScene(p.section) : null;
      try { renderer.render(scene, cam); } finally { if (undoClip) undoClip(); }
      return { png: canvas.toDataURL('image/png'), width: w, height: h, view: p.camera ? 'camera' : (p.view || 'iso') };"""),
("""axes?: bool=false (Achsenkreuz)} — PNG als data-URL'""",
"""axes?: bool=false (Achsenkreuz), camera?: {target: [x,y,z] mm, yaw: ° (0 = von vorn, 90 = von rechts, 180 = von hinten), pitch: ° (90 = von oben), distance: mm, fov?: ° (0 = orthografisch)} statt view, section?: {axis: X|Y|Z, at: mm, keep?: "-"|"+" (welche Seite bleibt, Standard die kleinere)} = Schnittansicht} — PNG als data-URL'"""),
("""  const BP_TEXT = new Set(['name', 'color', 'type', 'plane', 'op', 'vorlage', 'axis', 'open', 'filter', 'format', 'view', 'json', 'base64', 'command', 'schrift', 'motiv', 'form']);""",
"""  const BP_TEXT = new Set(['name', 'color', 'type', 'plane', 'op', 'vorlage', 'axis', 'open', 'filter', 'format', 'view', 'json', 'base64', 'command', 'schrift', 'motiv', 'form', 'face', 'keep', 'refs', 'id', 't']);"""),
("""          const v = await runOne(command, isRecorded(command) ? bpEval(params) : params, log);""",
"""          const v = await runOne(command, bpWantsEval(command) ? bpEval(params) : params, log);"""),
("""            const v = await runOne(st.command, isRecorded(st.command) ? bpEval(st.params) : st.params, log);""",
"""            const v = await runOne(st.command, bpWantsEval(st.command) ? bpEval(st.params) : st.params, log);"""),
]
for alt, neu in ERSETZE:
    if neu in s:
        continue
    if s.count(alt) == 0:              # von einer späteren Ersetzung schon weiterverändert
        print('übersprungen (schon umgebaut):', alt.strip()[:60])
        continue
    if s.count(alt) != 1:
        sys.exit('Ersetzung nicht eindeutig: ' + alt[:60])
    s = s.replace(alt, neu)
datei.write_text(s, encoding='utf-8')
print('eingesetzt in', datei)
