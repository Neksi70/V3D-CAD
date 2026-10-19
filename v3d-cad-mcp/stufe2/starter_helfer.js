  // ── Generatoren mit eigenem Fenster (alle Einträge der Generator-Liste) ──
  // Allgemeiner Adapter statt eines je Generator: Fenster öffnen, Knopfgruppen und
  // Regler samt Beschriftung auslesen bzw. setzen, „✓ Erstellen“ klicken, die neuen
  // Teile einsammeln. Funktioniert, solange ein Generator dem üblichen Fenster-Aufbau
  // folgt (vsec/vbg/vrow, blauer .pri-Knopf); sonst eine klare Meldung.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const txt = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const starters = () => _STARTERS.filter(s => !s.blank && !s.kg && s.run);
  function findStarter(name) {
    const n = String(name || '').toLowerCase().trim(); if (!n) fail('name fehlt — siehe starter.list');
    const all = starters();
    const hit = all.find(s => s.t.toLowerCase() === n) || (all.filter(s => s.t.toLowerCase().includes(n)).length === 1 ? all.find(s => s.t.toLowerCase().includes(n)) : null);
    if (hit) return hit;
    const near = all.filter(s => s.t.toLowerCase().includes(n.slice(0, 4))).map(s => s.t).slice(0, 8);
    fail('Generator „' + name + '“ nicht eindeutig gefunden' + (near.length ? ' — meintest du: ' + near.join(', ') : ' — siehe starter.list'));
  }
  async function openStarter(st) {
    const vorher = new Set([...document.querySelectorAll('button.pri')].filter(shown));
    st.run();
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      const neu = [...document.querySelectorAll('button.pri')].filter(b => shown(b) && !vorher.has(b));
      const btn = neu.find(b => /erstell|✓|einfügen|bauen/i.test(txt(b))) || neu[0];
      if (btn) {
        let root = btn;
        while (root.parentElement && root.parentElement !== document.body && getComputedStyle(root).position !== 'fixed') root = root.parentElement;
        return { root, btn };
      }
    }
    fail('„' + st.t + '“ öffnet kein Generator-Fenster mit Erstellen-Knopf — über die API nicht nutzbar');
  }
  function closeStarter(root) {
    if (!shown(root)) return;
    const x = [...root.querySelectorAll('.vx, button')].find(b => b.classList.contains('vx') || /abbrechen|schließen/i.test(txt(b)));
    if (x) x.click(); else root.classList.remove('show');
    if (shown(root)) root.classList.remove('show');
  }
  function labelOf(el) {
    const row = el.closest('.vrow, .g3row, label, tr');
    const l = row && row.querySelector('label');
    if (l && l !== el && txt(l)) return txt(l);
    if (el.id) { const f = document.querySelector('label[for="' + el.id + '"]'); if (f) return txt(f); }
    let p = el.previousElementSibling;                          // Abschnitts-Überschrift davor (vsec)
    for (let k = 0; p && k < 4; k++, p = p.previousElementSibling) if (/vsec|sec|lbl/.test(p.className) || p.tagName === 'LABEL') return txt(p);
    if (el.parentElement && el.parentElement.previousElementSibling && /vsec/.test(el.parentElement.previousElementSibling.className)) return txt(el.parentElement.previousElementSibling);
    return el.title || el.placeholder || '';
  }
  const slug = s => s.toLowerCase().replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
  function controls(root) {
    const out = [], used = new Set();
    const key = (pref, el, label, i) => { let k = el.id || (label ? pref + slug(label) : pref + i); while (used.has(k)) k += '_'; used.add(k); return k; };
    [...root.querySelectorAll('.vbg')].filter(shown).forEach((g, i) => {
      const btns = [...g.querySelectorAll('button')].filter(shown); if (btns.length < 2) return;
      const label = labelOf(g);
      out.push({ key: key('wahl_', g, label, i), kind: 'wahl', label, options: btns.map(txt), value: txt(btns.find(b => b.classList.contains('on'))) || null, el: g });
    });
    [...root.querySelectorAll('input, select, textarea')].forEach((el, i) => {
      if (el.type === 'hidden' || !(shown(el) || (el.type === 'checkbox' && shown(el.parentElement)))) return;
      const label = labelOf(el);
      const c = { key: key('feld_', el, label, i), kind: el.tagName === 'SELECT' ? 'auswahl' : el.type || 'text', label, el };
      if (el.type === 'range' || el.type === 'number') Object.assign(c, { min: el.min !== '' ? +el.min : undefined, max: el.max !== '' ? +el.max : undefined, step: el.step || undefined, value: +el.value });
      else if (el.type === 'checkbox') c.value = el.checked;
      else if (el.tagName === 'SELECT') { c.options = [...el.options].map(o => o.value); c.value = el.value; }
      else if (el.type === 'file') c.hinweis = 'braucht eine Datei — über die API nicht setzbar';
      else c.value = el.value;
      out.push(c);
    });
    return out;
  }
  const ctlInfo = c => { const { el, ...rest } = c; return rest; };
  async function setControl(c, v) {
    if (c.kind === 'wahl') {
      const btns = [...c.el.querySelectorAll('button')].filter(shown);
      const s = String(v).toLowerCase().trim();
      const b = typeof v === 'number' && btns[v] ? btns[v] : btns.find(x => txt(x).toLowerCase() === s) || btns.find(x => txt(x).toLowerCase().includes(s));
      if (!b) fail(c.key + ': erlaubt sind ' + btns.map(txt).join(', '));
      b.click(); await sleep(30); return;
    }
    const el = c.el;
    if (c.kind === 'file') fail(c.key + ' braucht eine Datei — über die API nicht möglich');
    if (c.kind === 'checkbox') { if (el.checked !== !!v) { el.checked = !!v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.click && el.dispatchEvent(new Event('click')); } return; }
    if (c.kind === 'range' || c.kind === 'number') {
      if (typeof v !== 'number' || !isFinite(v)) fail(c.key + ' muss eine Zahl sein');
      if ((c.min !== undefined && v < c.min) || (c.max !== undefined && v > c.max)) fail(c.key + ' (' + c.label + ') muss zwischen ' + c.min + ' und ' + c.max + ' liegen');
    }
    if (c.kind === 'auswahl' && !c.options.includes(String(v))) fail(c.key + ': erlaubt sind ' + c.options.join(', '));
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(10);
  }
  async function starterInspect(name) {
    const st = findStarter(name);
    const { root, btn } = await openStarter(st);
    try { return { name: st.t, desc: st.d, button: txt(btn), params: controls(root).map(ctlInfo) }; }
    finally { closeStarter(root); }
  }
  async function starterRun(p, log) {
    const st = findStarter(p.name);
    const keepPos = objects.map(o => [o, o.position.clone()]);
    const before = new Set(objects);
    const { root, btn } = await openStarter(st);
    let neu = [];
    try {
      const want = Object.entries(p.params || {});
      // erst Knopfgruppen (sie blenden Regler ein/aus), dann neu einlesen und die Regler setzen
      for (const pass of ['wahl', 'rest']) {
        const ctl = controls(root);
        for (const [k, v] of want) {
          const c = ctl.find(x => x.key === k) || ctl.find(x => x.label && slug(x.label) === slug(k));
          if (!c) { if (pass === 'rest' && !controls(root).some(x => x.key === k)) fail('„' + st.t + '“ hat keinen Regler „' + k + '“ — siehe starter.inspect (vorhanden: ' + ctl.map(x => x.key).join(', ') + ')'); continue; }
          if ((pass === 'wahl') === (c.kind === 'wahl')) await setControl(c, v);
        }
      }
      await sleep(150);
      btn.click();
      // warten, bis neue Körper da sind und sich nicht mehr ändern (Generatoren rechnen teils sekundenlang)
      let stabil = 0, zuletzt = -1;
      const grenze = Math.max(5, Math.min(600, +p.timeout || 120)) * 10;   // Zehntelsekunden
      for (let i = 0; i < grenze && stabil < 4; i++) {
        await sleep(100);
        const n = objects.filter(o => !before.has(o)).length;
        if (n > 0 && n === zuletzt) stabil++; else stabil = 0;
        zuletzt = n;
        if (n === 0 && i > 50 && log.some(m => /^Fehler|fehlgeschlagen/.test(m))) break;
      }
      neu = objects.filter(o => !before.has(o));
    } finally { closeStarter(root); }
    if (!neu.length) fail('„' + st.t + '“ hat nichts erzeugt' + (log.length ? '' : ' (vielleicht braucht er eine Auswahl oder eine Datei)'));
    keepPos.forEach(([o, v]) => { if (objects.includes(o)) o.position.copy(v); });
    const box = new THREE.Box3(); neu.forEach(o => box.union(getMeshBox(o)));
    const c = toWorld(box.getCenter(new THREE.Vector3())), zMin = Math.min(...neu.map(o => boxWorld(o).min[2]));
    const ziel = p.center ? needVec3([p.center[0], p.center[1], 0], 'center') : [0, 0, 0];
    const mv = toApp([ziel[0] - c[0], ziel[1] - c[1], -zMin]);
    neu.forEach(o => { o.position.add(mv); o.updateMatrixWorld(true); });
    return { generator: st.t, created: neu.map(o => info(o, true)) };
  }

