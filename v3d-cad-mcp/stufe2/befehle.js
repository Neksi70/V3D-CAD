    'sketch.extrude': { doc: '{outer: Kontur, holes?: [Kontur, …], height: mm, plane?: XY|XZ|YZ (XY), offset?: mm (Abstand der Skizze von der Ebene), op?: new|join|cut, target?: id (für join/cut), fillet_top?/fillet_bottom?/chamfer_top?/chamfer_bottom?: mm, name?, color?} — Kontur = {rect:{center:[x,y], size:[w,h], corner_radius?}} | {circle:{center:[x,y], r}} | {ngon:{center:[x,y], r, sides}} | {polygon:[[x,y], …]} (mm in Skizzen-Koordinaten). XY: Draufsicht, x→X, y→Y, nach oben (+Z) extrudiert; XZ: Vorderansicht, x→X, y→Z, nach −Y; YZ: Seitenansicht, x→Y, y→Z, nach +X', async fn(p, log) {
      return sketchExtrude(p, log);
    } },
    'body.edges': { undo: false, doc: '{id, filter?: all|top|bottom|vertical} — Kanten eines Grundkörpers (Quader, Zylinder, Kegel, Rohr bzw. schon gerundete) mit index, Art, Endpunkten/Mitte, Länge (mm)', async fn(p) {
      const o = byId(p.id), F = edgeFrame(o);
      const all = edgesOf(await _loadOCCT(), F);
      return { edges: pickEdges(all, p.filter || 'all').map(edgeInfo) };
    } },
    'body.fillet': { doc: '{id, radius: mm, edges?: all|top|bottom|vertical | [index, …] | [[x,y,z], …] (Punkt = nächste Kante), Standard all} — Kanten runden (OCCT). Geht an Quader, Zylinder, Kegel, Rohr und schon gerundeten Körpern; nicht an gedrehten (erst runden, dann drehen) und nicht an Bool-Ergebnissen. Wiederholen ändert den Radius derselben Kanten', async fn(p) {
      return edgeOp(p, 'fillet', p.radius);
    } },
    'body.chamfer': { doc: '{id, distance: mm, edges?: wie body.fillet} — Kanten fasen (45°, OCCT); gleiche Grenzen wie body.fillet. An einer Ecke nur Rundungen ODER nur Fasen, gemischt scheitert OCCT meist', async fn(p) {
      return edgeOp(p, 'chamfer', p.distance);
    } },
    'gen.list': { undo: false, doc: '{id?} — Generatoren (Kinder/Spielwelt): ohne id die Liste, mit id alle Parameter (Typ, Bereich, Auswahl, Vorgabe) und Vorlagen', fn(p) {
      if (p.id === undefined) return { generators: Object.values(_KG).map(d => ({ id: d.id, name: d.name, desc: d.desc, vorlagen: d.vorlagen ? Object.keys(d.vorlagen) : [] })) };
      const d = _KG[p.id]; if (!d) fail('Unbekannter Generator "' + p.id + '" — siehe gen.list');
      return { id: d.id, name: d.name, desc: d.desc,
        vorlagen: d.vorlagen ? Object.fromEntries(Object.entries(d.vorlagen).map(([k, v]) => [k, { name: v.name, tip: v.tip, params: v.p }])) : {},
        params: d.params.filter(x => x.k).map(x => ({ k: x.k, label: x.l, type: x.t,
          ...(x.t === 'range' ? { min: x.min, max: x.max, step: x.step, unit: x.u } : {}),
          ...(x.o ? { options: x.o.map(o => o[0]) } : {}), ...(x.t === 'text' && x.max ? { maxlen: x.max } : {}),
          default: d.DEF[x.k] })) };
    } },
    'gen.run': { doc: '{id, vorlage?, params?: {k: wert}, center?: [x,y] mm} — Generator bauen (Parameter siehe gen.list mit id); liefert die neuen Teile. Ohne center mittig auf der Platte', async fn(p, log) {
      const d = _KG[p.id]; if (!d) fail('Unbekannter Generator "' + p.id + '" — siehe gen.list');
      const base = { ...d.DEF };
      if (p.vorlage !== undefined) {
        if (!d.vorlagen || !d.vorlagen[p.vorlage]) fail('Vorlage "' + p.vorlage + '" gibt es nicht — ' + Object.keys(d.vorlagen || {}).join(', '));
        Object.assign(base, d.vorlagen[p.vorlage].p || {}, { vorlage: p.vorlage });
      }
      return genBuild(d, { ...base, ...genParams(d, p.params || {}) }, null, p.center);
    } },
    'gen.edit': { doc: '{id: Körper-id eines Generator-Teils, params: {k: wert}} — Generator-Modell mit geänderten Parametern neu bauen; ersetzt alle Teile des Satzes (neue ids)', async fn(p) {
      const o = byId(p.id), kp = o.userData.kgParams;
      if (!kp || !_KG[kp.gen]) fail('Körper ' + p.id + ' stammt nicht aus einem Generator');
      const d = _KG[kp.gen]; const { gen, ...alt } = kp;
      return genBuild(d, { ...alt, ...genParams(d, p.params || {}) }, o, null);
    } },
