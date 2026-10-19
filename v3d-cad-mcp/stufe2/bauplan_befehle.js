    'param.set': { doc: '{name, value: Zahl (mm) oder Formel ("breite/2 - wand"), comment?} — Parameter anlegen/ändern (erscheint im 𝑥-Panel). Gibt es einen Bauplan, wird das Modell damit neu gebaut (recomputed, Volumen vorher/nachher); scheitert ein Schritt, bleibt alles wie vorher. In allen Befehlen dürfen Zahlen Formeln mit Parametern sein', async fn(p, log) {
      const name = String(p.name || '').trim();
      if (!/^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_]*$/.test(name)) fail('name: Buchstaben, Ziffern, _ (nicht mit Ziffer beginnen)');
      if (p.value === undefined || p.value === null || p.value === '') fail('value fehlt');
      const expr = String(p.value);
      const test = designVars.filter(v => v.name !== name).concat([{ name, expr }]);
      const keep = designVars; designVars = test;
      const val = _varsValues()[name];
      if (val == null) { designVars = keep; fail('„' + expr + '“ lässt sich nicht ausrechnen (unbekannter Name oder Zeichen?)'); }
      designVars = keep;
      const vorhanden = designVars.find(v => v.name === name);
      const guard = bpGuard(log);
      if (vorhanden) { vorhanden.expr = expr; if (p.comment !== undefined) vorhanden.comment = String(p.comment); }
      else designVars.push({ name, expr, ...(p.comment ? { comment: String(p.comment) } : {}) });
      if (document.getElementById('vars-panel').classList.contains('show')) _varsRender();
      const res = guard ? await bpRebuild(log) : { recomputed: 0 };
      return { name, expr, value: r3(val), ...res };
    } },
    'param.list': { undo: false, doc: '{} — alle Parameter mit Formel und Wert', fn() {
      const vals = _varsValues();
      return { params: designVars.map(v => ({ name: v.name, expr: v.expr, value: vals[v.name] != null ? r3(vals[v.name]) : null, ...(v.comment ? { comment: v.comment } : {}) })) };
    } },
    'param.delete': { doc: '{name} — Parameter löschen (nur wenn kein Bauplan-Schritt und kein anderer Parameter ihn benutzt)', fn(p) {
      const i = designVars.findIndex(v => v.name === p.name); if (i < 0) fail('Parameter „' + p.name + '“ gibt es nicht');
      const re = new RegExp('(^|[^\\wäöüÄÖÜß])' + p.name + '($|[^\\wäöüÄÖÜß])');
      const inSteps = (recipe ? recipe.steps : []).map((s, k) => re.test(JSON.stringify(s.params)) ? k + 1 : 0).filter(Boolean);
      const inVars = designVars.filter(v => v.name !== p.name && re.test(String(v.expr))).map(v => v.name);
      if (inSteps.length || inVars.length) fail('„' + p.name + '“ wird noch benutzt' + (inSteps.length ? ' in Schritt ' + inSteps.join(', ') : '') + (inVars.length ? ' in ' + inVars.join(', ') : ''));
      designVars.splice(i, 1);
      if (document.getElementById('vars-panel').classList.contains('show')) _varsRender();
      return { deleted: p.name };
    } },
    'timeline.list': { undo: false, doc: '{} — Bauplan: alle aufgezeichneten Schritte (step ab 1, Befehl, Original-Parameter mit Formeln, erzeugte ids). eingefroren:true heißt: die Szene wurde von Hand geändert, der nächste Schritt beginnt einen neuen Bauplan', fn() {
      if (!recipe) return { steps: [], hinweis: 'Noch kein Bauplan — er entsteht mit dem ersten bauenden Befehl' };
      return { steps: recipe.steps.map((s, i) => ({ step: i + 1, command: s.command, params: s.params, ids: s.ids })),
               base_bodies: recipe.base.length, eingefroren: recipe.fp !== fingerprint() };
    } },
    'timeline.edit': { doc: '{step, params: {…} (werden mit den alten zusammengeführt), replace?: bool (statt zusammenführen ersetzen)} — Schritt ändern und neu bauen', async fn(p, log) {
      if (!bpGuard(log)) fail('Die Szene wurde von Hand geändert — der alte Bauplan ist eingefroren, es gibt nichts mehr zu bearbeiten');
      const st = recipe && recipe.steps[p.step - 1]; if (!st) fail('Schritt ' + p.step + ' gibt es nicht (1–' + (recipe ? recipe.steps.length : 0) + ')');
      if (!p.params || typeof p.params !== 'object') fail('params fehlt');
      st.params = p.replace ? clone(p.params) : { ...st.params, ...clone(p.params) };
      return { step: p.step, params: st.params, ...await bpRebuild(log) };
    } },
    'timeline.delete': { doc: '{step} — Schritt aus dem Bauplan löschen und neu bauen. Hängt ein späterer Schritt davon ab (benutzt seine ids), scheitert es mit Angabe des Schritts — dann den zuerst löschen', async fn(p, log) {
      if (!bpGuard(log)) fail('Die Szene wurde von Hand geändert — der alte Bauplan ist eingefroren');
      if (!recipe || !recipe.steps[p.step - 1]) fail('Schritt ' + p.step + ' gibt es nicht');
      const [weg] = recipe.steps.splice(p.step - 1, 1);
      return { deleted: { step: p.step, command: weg.command }, ...await bpRebuild(log) };
    } },
    'timeline.rebuild': { doc: '{} — Bauplan mit den aktuellen Parametern neu bauen (zur Kontrolle)', async fn(p, log) {
      if (!bpGuard(log)) return { recomputed: 0, hinweis: 'Szene von Hand geändert — Bauplan eingefroren, nichts neu gerechnet' };
      return bpRebuild(log);
    } },
    'timeline.reset': { doc: '{} — neuen Bauplan ab dem jetzigen Stand beginnen (bisherige Schritte werden fester Ausgangsteil)', fn() {
      const n = recipe ? recipe.steps.length : 0; recipe = bpFresh(); return { frozen_steps: n };
    } },
