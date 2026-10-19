  // ── Bauplan (Parametrik wie die Zeitleiste in SolidCraft) ───────────────
  // Jeder bauende API-Befehl wird mit seinen ORIGINAL-Parametern aufgezeichnet
  // (Formeln bleiben Formeln). Ändert sich ein Parameter (𝑥-Variablen = designVars),
  // wird ab dem Ausgangsstand neu gebaut — gleiche Reihenfolge, gleicher idCtr-Start
  // → die Körper behalten ihre ids. Wird die Szene zwischendurch von Hand geändert,
  // friert der Bauplan ein: der jetzige Stand wird neuer Ausgangspunkt, nichts geht verloren.
  let recipe = null;                     // { base: [objectToData], baseIdCtr, steps: [{command, params, ids}], fp }
  let bpUndo = [], bpRedo = [];          // Bauplan-Stände passend zu edit.undo/redo der API
  const BP_SKIP = new Set(['scene.new', 'scene.load', 'edit.undo', 'edit.redo', 'file.import']);
  const isRecorded = c => CMDS[c] && CMDS[c].undo !== false && !BP_SKIP.has(c) && !/^(param|timeline)\./.test(c);
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

  // Fingerabdruck der Szene: erkennt Handänderungen im Editor (Ziehen, Undo, Löschen …)
  function fingerprint() {
    return objects.map(o => [o.userData.id, o.geometry ? o.geometry.uuid : 'g',
      o.position.toArray().map(v => v.toFixed(5)).join(','), o.quaternion.toArray().map(v => v.toFixed(6)).join(','),
      o.scale.toArray().map(v => v.toFixed(5)).join(','), o.userData.isHole ? 1 : 0, o.visible ? 1 : 0, o.userData.color].join('|'))
      .join(';') + '#' + idCtr;
  }
  function bpFresh() {
    return { base: objects.map(o => objectToData(o)), baseIdCtr: idCtr, steps: [], fp: fingerprint() };
  }
  // Vor jedem bauenden Befehl: Bauplan anlegen bzw. bei Handänderung einfrieren
  function bpBefore(log) {
    if (!recipe) { recipe = bpFresh(); return; }
    if (recipe.fp !== fingerprint()) {
      const n = recipe.steps.length;
      recipe = bpFresh();
      if (n) log.push('Hinweis: Die Szene wurde von Hand geändert — der Bauplan (' + n + ' Schritte) ist eingefroren und beginnt ab dem jetzigen Stand neu. Bisherige Parameter wirken nur noch auf neue Schritte.');
    }
  }
  const createdIds = v => v && Array.isArray(v.created) ? v.created.map(o => o.id) : v && v.id !== undefined ? [v.id] : [];
  function bpRecord(command, params, value) {
    if (command === 'scene.new') recipe = bpFresh();
    else if (command === 'scene.load') {
      let d = null; try { d = JSON.parse(params.json); } catch (_) {}
      recipe = d && d.apiRecipe ? { ...d.apiRecipe, fp: null } : bpFresh();
    } else if (command === 'file.import') recipe = bpFresh();      // Importe = fester Ausgangsteil
    else if (isRecorded(command)) recipe.steps.push({ command, params: clone(params || {}), ids: createdIds(value) });
    if (recipe) recipe.fp = fingerprint();
  }

  // Formeln in Parametern auflösen. Texte (Namen, Farben, Ebenen, Kanten-Wahl …) bleiben Texte.
  const BP_TEXT = new Set(['name', 'color', 'type', 'plane', 'op', 'vorlage', 'axis', 'open', 'filter', 'format', 'view', 'json', 'base64', 'command', 'schrift', 'motiv', 'form', 'face', 'keep', 'refs', 'id', 't']);
  const BP_NUM = /^(size|center|move|radius|distance|thickness|height|offset|step|count|r|wall|at|angle|rotation|rotate|sides|corner_radius|fillet_top|fillet_bottom|chamfer_top|chamfer_bottom|profile|polygon|edges)$/;
  function bpEval(params) {
    const walk = (v, key) => {
      if (Array.isArray(v)) return v.map(x => walk(x, key));
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
      if (typeof v !== 'string' || BP_TEXT.has(key) || v.startsWith('#')) return v;
      const s = v.trim();
      if (!/^[\w\säöüÄÖÜß+\-*/().,]+$/.test(s)) return v;
      const num = _varEvalExpr(s);
      if (num != null) return num;
      // sieht nach Formel aus (Operator/Ziffer + Name), lässt sich aber nicht auflösen → klare Meldung
      if (/[+\-*/()]/.test(s) && /[A-Za-zäöüÄÖÜß_]/.test(s))
        fail('Formel „' + s + '“ nicht auflösbar — Parameter mit param.set anlegen (bekannt: ' + (designVars.map(d => d.name).join(', ') || 'keine') + ')');
      // einzelner Name an einer Stelle, wo eine Zahl hingehört → Tippfehler/fehlender Parameter
      if (key && BP_NUM.test(key) && /^[A-Za-zäöüÄÖÜß_][\wäöüÄÖÜß]*$/.test(s) && !['all', 'top', 'bottom', 'vertical'].includes(s))
        fail('„' + s + '“ ist kein bekannter Parameter — erst param.set {name:"' + s + '", value:…} (bekannt: ' + (designVars.map(d => d.name).join(', ') || 'keine') + ')');
      return v;
    };
    return walk(params || {}, null);
  }

  const totalVol = () => r3(objects.filter(o => !o.userData.isHole && o.visible !== false).reduce((s, o) => s + measureObj(o).volume_mm3, 0));
  async function bpRebuild(log) {
    if (!recipe || !recipe.steps.length) return { recomputed: 0, hinweis: 'Kein Bauplan — es gibt nichts neu zu rechnen' };
    const vorher = totalVol();
    restoreState(recipe.base);
    idCtr = recipe.baseIdCtr;
    for (let i = 0; i < recipe.steps.length; i++) {
      const st = recipe.steps[i];
      let v;
      try { v = await runOne(st.command, bpEval(st.params), log); }
      catch (e) { fail('Schritt ' + (i + 1) + ' (' + st.command + ') scheitert mit den neuen Werten: ' + e.message + ' — alles bleibt wie vorher'); }
      const ids = createdIds(v);
      if (st.ids && st.ids.length && ids.join() !== st.ids.join())
        log.push('Hinweis: Schritt ' + (i + 1) + ' lieferte andere ids (' + ids.join(', ') + ' statt ' + st.ids.join(', ') + ')');
    }
    recipe.fp = fingerprint();
    return { recomputed: recipe.steps.length, volume_before: vorher, volume_after: totalVol(), bodies: objects.map(o => info(o)) };
  }
  // Prüft vor param.set/timeline.*: Handänderung? Dann einfrieren statt fremden Stand zu überschreiben
  function bpGuard(log) {
    if (recipe && recipe.fp !== fingerprint()) { bpBefore(log); return false; }
    return true;
  }

  // Speichern/Laden: Bauplan reist mit der Szene (Design-Speicher, Datei, Mitsehen)
  {
    const snap0 = _sceneSnapshot, apply0 = _applySnapshot, load0 = _loadSceneFromJSON;
    _sceneSnapshot = function () {
      const d = snap0.apply(this, arguments);
      if (recipe && recipe.steps.length) d.apiRecipe = { base: recipe.base, baseIdCtr: recipe.baseIdCtr, steps: recipe.steps };
      return d;
    };
    const after = data => { recipe = data && data.apiRecipe ? { ...data.apiRecipe, fp: fingerprint() } : null; bpUndo = []; bpRedo = []; };
    _applySnapshot = function (data) { const r = apply0.apply(this, arguments); after(data); return r; };
    _loadSceneFromJSON = function (text) { const r = load0.apply(this, arguments); let d = null; try { d = JSON.parse(text); } catch (_) {} after(d); return r; };
    // 𝑥-Panel: ändert der Nutzer eine Variable, rechnet auch der Bauplan neu
    const varsEdit0 = _varsEdit;
    _varsEdit = function (i, key) {
      const alt = clone(designVars);
      const r = varsEdit0.apply(this, arguments);
      if (key === 'expr' && recipe && recipe.steps.length && JSON.stringify(alt) !== JSON.stringify(designVars)) {
        execute('timeline.rebuild', {}).then(res => {
          if (res.ok && res.result.recomputed) notify('Bauplan neu gerechnet (' + res.result.recomputed + ' Schritte) ✓', 'ok');
          else if (!res.ok) { designVars = alt; _varsRender(); notify(res.error, 'e'); }
          else if (res.messages) notify(res.messages.join(' '), 'w');
        });
      }
      return r;
    };
  }

