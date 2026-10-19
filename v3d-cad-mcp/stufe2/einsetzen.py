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
]
for alt, neu in ERSETZE:
    if neu in s:
        continue
    if s.count(alt) != 1:
        sys.exit('Ersetzung nicht eindeutig: ' + alt[:60])
    s = s.replace(alt, neu)
datei.write_text(s, encoding='utf-8')
print('eingesetzt in', datei)
