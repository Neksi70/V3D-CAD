    'body.faces': { undo: false, doc: '{id} — ebene Flächen eines Körpers (größte zuerst): index, name (top, bottom, +x, -x, +y, -y für die äußeren), normal, center, area_mm2, bbox. Für sketch.extrude {face}', fn(p) {
      return { faces: facesOf(byId(p.id)) };
    } },
    'sketch.solve': { undo: false, doc: '{sketch: {entities, constraints}} — Skizze mit Bedingungen lösen, ohne zu bauen: liefert gelöste Elemente (mm), dof (Freiheitsgrade; 0 = voll bestimmt), ok und die Zahl geschlossener Konturen. Aufbau siehe sketch.extrude', fn(p) {
      const r = solveSketch(p.sketch);
      return { ok: r.ok, dof: r.dof, entities: r.entities, closed_loops: r.loops.length };
    } },
    'measure.min_distance': { undo: false, doc: '{a: id, b: id} — echter kleinster Abstand zwischen zwei Körpern (Manifold, mm); 0 = berühren/überlappen, dann overlap_mm3 = Volumen der Überschneidung', async fn(p) {
      return minDistance(byId(p.a), byId(p.b));
    } },
    'measure.interference': { undo: false, doc: '{ids?: [id, …]} — Kollisionsprüfung: alle Körperpaare, die sich überschneiden, mit Überschneidungs-Volumen (Bohrungen zählen nicht)', async fn(p) {
      const os = p.ids ? byIds(p.ids, 'ids') : objects.filter(o => !o.userData.isHole && o.visible !== false);
      if (os.length > 40) fail('Höchstens 40 Körper auf einmal prüfen (ids angeben)');
      const bw = os.map(boxWorld), hits = [];
      for (let i = 0; i < os.length; i++) for (let j = i + 1; j < os.length; j++) {
        if (![0, 1, 2].every(k => bw[i].min[k] < bw[j].max[k] && bw[j].min[k] < bw[i].max[k])) continue;   // BBox getrennt → sicher frei
        const r = await minDistance(os[i], os[j]);
        if (r.overlap_mm3 > 1e-3) hits.push({ a: os[i].userData.id, b: os[j].userData.id, overlap_mm3: r.overlap_mm3 });
      }
      return { checked: os.length, collisions: hits };
    } },
    'measure.section': { undo: false, doc: '{id, axis: X|Y|Z, at: mm} — Schnitt durch einen Körper bei axis = at: Querschnittsfläche (mm²), Zahl der Konturen (Löcher zählen mit), 2D-Grenzen. Für Wandstärken-/Querschnitts-Checks; Bild dazu: view.screenshot mit section', async fn(p) {
      const ax = String(p.axis || 'Z').toUpperCase(); if (!['X', 'Y', 'Z'].includes(ax)) fail('axis: X, Y oder Z');
      if (!isFinite(+p.at)) fail('at (mm) fehlt');
      return section(byId(p.id), ax, +p.at);
    } },
