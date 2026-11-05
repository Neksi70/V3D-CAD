/*
 * Strebe → Spline — Werkzeug-Panel in V3D CAD.
 * Leitkurven (Splines) für Leisten aus einem 3D-Scan, Schritt für Schritt mit Kontrollbild:
 *   0 Ausrichten · 1 Streben · 2 Kammlinie · 3 Spline · 4 Symmetrie · 5 Kontrolle · 6 Export
 * Rechenkern: lib/strebenspline-kern.js (Schritte 0–2 im Worker lib/strebenspline-worker.js).
 *
 * Koordinaten: Der Kern rechnet in mm, Z oben, im AUSGERICHTETEN System (Fahrzeugmitte X=0,
 * Spitze im Ursprung). Alle Overlays hängen in einer Gruppe, deren Matrix jedes Bild
 * = mesh.matrixWorld · G0 ist (G0 = ausgerichtet-mm → Netz-lokal). So bleiben Overlays am Scan,
 * auch wenn der Scan danach verschoben wird.
 * Andockung an volme3d.html: globale scene, camera, canvas, objects, selectedObjs, notify,
 * saveUndo, fitToObjects, sph, sph2cam, orbitTarget. Einstieg: openStrebenSpline().
 */
(function () {
  'use strict';
  const K = window.StrebenKern;
  const PRM_KEY = 'v3d_strebespline_prm';
  const FARBE = { links: 0xF97316, rechts: 0x0EA5E9, gemittelt: 0xD946EF };
  const SEITEN = ['links', 'rechts'];

  // ── Zustand ─────────────────────────────────────────────────────────────────
  const S = {
    aktiv: false, panel: null, gruppe: null, worker: null, rufe: new Map(), rufId: 1,
    meshId: null, meshName: '', nTri: 0, geladen: false,
    prm: ladePrm(),
    al: null,              // Ergebnis Schritt 0 (matrix = Welt-mm → ausgerichtet)
    G0: null,              // THREE.Matrix4: ausgerichtet-mm → Netz-lokal
    streben: null,         // Schritt 1 (Kurzform aus dem Worker)
    kamm: { links: null, rechts: null },
    modus: 'ausgleich',    // 'ausgleich' | 'stuetz' | 'gemittelt'
    sp: { links: null, rechts: null },
    stuetz: { links: null, rechts: null },
    vorMittel: null,       // Sicherung vor "gemittelt"
    sym: null, abw: { links: null, rechts: null }, zeigAbw: false,
    edits: [],             // Bearbeitungs-Rückgängig
    obj: {},               // Overlay-Objekte
    drag: null, wahl: null, beschaeftigt: false,
  };

  function ladePrm() {
    const p = Object.assign({}, K.PARAM_DEFAULT);
    try { Object.assign(p, JSON.parse(localStorage.getItem(PRM_KEY) || '{}')); } catch (e) { /* egal */ }
    return p;
  }
  function speicherePrm() { try { localStorage.setItem(PRM_KEY, JSON.stringify(S.prm)); } catch (e) { /* egal */ } }

  // mm (Z oben) ↔ Szene (Y oben, 1 Einheit = 10 mm) — wie beim STL-Import
  const C = new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.1, 0.1, 0.1));
  const Cinv = C.clone().invert();
  const rowMajor = m => { const e = m.elements; return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14], e[3], e[7], e[11], e[15]]; };
  const fromRowMajor = a => new THREE.Matrix4().set(...a);

  // ── Worker ──────────────────────────────────────────────────────────────────
  function worker() {
    if (S.worker) return S.worker;
    S.worker = new Worker('lib/strebenspline-worker.js');
    S.worker.onmessage = e => {
      const r = S.rufe.get(e.data.id); if (!r) return; S.rufe.delete(e.data.id);
      e.data.ok ? r.ok(e.data.res) : r.err(new Error(e.data.fehler));
    };
    S.worker.onerror = e => { for (const r of S.rufe.values()) r.err(new Error(e.message || 'Worker-Fehler')); S.rufe.clear(); };
    return S.worker;
  }
  function ruf(cmd, args, transfer) {
    return new Promise((ok, err) => { const id = S.rufId++; S.rufe.set(id, { ok, err }); worker().postMessage({ id, cmd, args }, transfer || []); });
  }

  // ── Netz finden / laden ─────────────────────────────────────────────────────
  function aktuellesNetz() {
    if (S.meshId == null) return null;
    return objects.find(o => o.userData && o.userData.id === S.meshId) || null;   // nach Undo neu aufgebaut → über id
  }
  async function netzLaden(mesh) {
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry;
    let pos = g.attributes.position.array;
    if (g.index) {   // indiziert → Dreiecksliste
      const idx = g.index.array, out = new Float32Array(idx.length * 3);
      for (let i = 0; i < idx.length; i++) { const j = idx[i] * 3; out[3 * i] = pos[j]; out[3 * i + 1] = pos[j + 1]; out[3 * i + 2] = pos[j + 2]; }
      pos = out;
    } else pos = new Float32Array(pos);
    const Wm = Cinv.clone().multiply(mesh.matrixWorld);   // lokal → Welt-mm
    const info = await ruf('laden', { pos, matrix: rowMajor(Wm) }, [pos.buffer]);
    S.meshId = mesh.userData.id; S.meshName = mesh.userData.name || 'Scan'; S.nTri = info.nTri; S.geladen = true;
    scanGrau(true);
    S.Wm0 = Wm;                     // Welt-mm zum Zeitpunkt des Ladens
    S.G0 = Wm.clone().invert();     // ohne Ausrichtung: ausgerichtet = Welt-mm
    S.al = null; S.streben = null; S.kamm = { links: null, rechts: null }; S.sp = { links: null, rechts: null }; S.stuetz = { links: null, rechts: null };
    S.sym = null; S.abw = { links: null, rechts: null }; S.edits = []; S.vorMittel = null;
    alleOverlaysWeg();
  }

  // ── Overlays ────────────────────────────────────────────────────────────────
  function gruppe() {
    if (!S.gruppe) { S.gruppe = new THREE.Group(); S.gruppe.name = 'strebespline-overlay'; S.gruppe.matrixAutoUpdate = false; }
    if (!S.gruppe.parent) scene.add(S.gruppe);
    return S.gruppe;
  }
  function weg(name) {
    const o = S.obj[name]; if (!o) return;
    o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose()); });
    if (o.parent) o.parent.remove(o); delete S.obj[name];
  }
  function alleOverlaysWeg() { Object.keys(S.obj).forEach(weg); }
  function setze(name, o) { weg(name); S.obj[name] = o; gruppe().add(o); return o; }
  const v3 = p => new THREE.Vector3(p[0], p[1], p[2]);

  function tick() {
    if (!S.aktiv) return;
    requestAnimationFrame(tick);
    const m = aktuellesNetz();
    if (!m) { if (S.gruppe) S.gruppe.visible = false; return; }
    if (S.gruppe && S.G0) { S.gruppe.visible = true; m.updateMatrixWorld(true); S.gruppe.matrix.copy(m.matrixWorld).multiply(S.G0); S.gruppe.matrixWorldNeedsUpdate = true; }
    griffGroesse();
  }
  // Griffe immer gleich groß auf dem Bildschirm (~7 px), egal wie weit gezoomt
  function griffGroesse() {
    if (!S.gruppe) return;
    const sk = S.gruppe.matrix.getMaxScaleOnAxis() || 0.1;
    const vh = (canvas.clientHeight || 800);
    SEITEN.forEach(s => {
      const g = S.obj['griffe-' + s]; if (!g) return;
      g.children.forEach(h => {
        const w = h.getWorldPosition(new THREE.Vector3());
        const d = camera.isPerspectiveCamera ? w.distanceTo(camera.position) * 2 * Math.tan(camera.fov * Math.PI / 360) : (camera.top - camera.bottom) / camera.zoom;
        const px = S.zeigAbw ? 3.5 : S.modus === 'stuetz' ? 7 : 4.5;   // Kontrollpunkte kleiner, bei Farbanzeige noch kleiner
        const r = d / vh * px / sk;   // gewünschter Radius im Gruppen-System (mm)
        h.scale.setScalar(Math.max(0.05, r / 9));
      });
    });
  }

  function punkteWolke(arr, farbe, groesse) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: farbe, size: groesse || 2, sizeAttenuation: false, depthTest: true }));
  }
  function linie(pts, farbe, gestrichelt) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(v3));
    const mat = gestrichelt ? new THREE.LineDashedMaterial({ color: farbe, dashSize: 15, gapSize: 10, depthTest: false }) : new THREE.LineBasicMaterial({ color: farbe, depthTest: false });
    const l = new THREE.Line(g, mat); if (gestrichelt) l.computeLineDistances(); l.renderOrder = 998; return l;
  }

  function zeigeAusrichtung() {
    const g = new THREE.Group();
    // Symmetrieebene X=0 (halb durchsichtig) + Achsenkreuz an der Spitze
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    pl.rotation.y = Math.PI / 2; pl.scale.set(2400, 1600, 1); pl.position.set(0, -300, 1050); g.add(pl);
    const ax = [[[0, 0, 0], [300, 0, 0], 0xef4444], [[0, 0, 0], [0, 300, 0], 0x22c55e], [[0, 0, 0], [0, 0, 300], 0x3b82f6]];
    ax.forEach(([a, b, c]) => g.add(linie([a, b], c)));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), new THREE.MeshBasicMaterial({ color: 0x8b5cf6, depthTest: false })); tip.renderOrder = 999; g.add(tip);
    setze('ausrichtung', g);
  }
  function zeigeStreben() {
    weg('strebe-links'); weg('strebe-rechts');
    if (!S.streben) return;
    for (const s of SEITEN) {
      const st = S.streben[s]; if (!st) continue;
      const g = new THREE.Group();
      g.add(punkteWolke(st.punkte, FARBE[s], 2));
      g.add(linie(st.pfad, FARBE[s]));
      setze('strebe-' + s, g);
    }
  }
  const GRUND_FARBE = { ok: 0x16a34a, loch: 0x9ca3af, ausreisser: 0xdc2626, unvollstaendig: 0xeab308, fehlform: 0xeab308, flach: 0xeab308 };
  function zeigeKamm() {
    for (const s of SEITEN) {
      weg('kamm-' + s);
      const k = S.kamm[s]; if (!k) continue;
      const pos = [], col = [], c = new THREE.Color();
      // in Schritt 5: gültige Kammpunkte nach Abweichung färben (dort wurde gemessen)
      const abwS = (S.zeigAbw && S.abw[s]) ? new Map(S.abw[s].werte.map(w => [w.sKamm, w.wert])) : null, sk = abwS ? skala() : 1;
      k.forEach(q => {
        const p = q.ok ? q.p : q.leit; pos.push(p[0], p[1], p[2]);
        if (q.ok && abwS && abwS.has(q.s)) { const f = K.farbe(abwS.get(q.s), sk); col.push(f[0], f[1], f[2]); return; }
        c.setHex(GRUND_FARBE[q.ok ? 'ok' : q.grund] || 0xeab308); col.push(c.r, c.g, c.b);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: S.zeigAbw ? 5 : 4.5, sizeAttenuation: false, vertexColors: true, depthTest: false }));
      pts.renderOrder = 999; pts.userData.seite = s;
      setze('kamm-' + s, pts);
    }
  }
  // Spline als Röhre (sichtbar auch bei 2 m Objektgröße), Farben je Abtastpunkt
  function zeigeSpline(s) {
    weg('spline-' + s); weg('griffe-' + s); weg('polygon-' + s);
    const sp = S.sp[s]; if (!sp) return;
    const pts = K.bsSample(sp, 400);
    const kurve = new THREE.CatmullRomCurve3(pts.map(v3));
    const geo = new THREE.TubeGeometry(kurve, 400, 7, 6, false);
    let mat;
    if (S.zeigAbw && S.abw[s]) {
      const cols = abwFarben(s, 401), radial = 7, arr = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i <= 400; i++) for (let j = 0; j < radial; j++) { const k = i * radial + j; if (3 * k + 2 < arr.length) { arr[3 * k] = cols[i][0]; arr[3 * k + 1] = cols[i][1]; arr[3 * k + 2] = cols[i][2]; } }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      mat = new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false });
    } else mat = new THREE.MeshBasicMaterial({ color: S.modus === 'gemittelt' ? FARBE.gemittelt : FARBE[s], depthTest: false });
    const tube = new THREE.Mesh(geo, mat); tube.renderOrder = 998;
    setze('spline-' + s, tube);
    // Griffe: Stützpunkte bzw. Kontrollpunkte
    const griffe = new THREE.Group(); griffe.userData.seite = s;
    const gp = griffPunkte(s);
    gp.forEach((p, i) => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), new THREE.MeshBasicMaterial({ color: (S.wahl && S.wahl.seite === s && S.wahl.i === i) ? 0xfacc15 : 0xffffff, depthTest: false }));
      h.position.copy(v3(p)); h.renderOrder = 999; h.userData = { griff: true, seite: s, i };
      const rand = new THREE.Mesh(new THREE.SphereGeometry(11.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0x111827, depthTest: false, side: THREE.BackSide }));
      rand.renderOrder = 998.5; h.add(rand);
      griffe.add(h);
    });
    setze('griffe-' + s, griffe);
    if (S.modus !== 'stuetz') setze('polygon-' + s, linie(sp.ctrl, 0x64748b, true));
  }
  function griffPunkte(s) { return S.modus === 'stuetz' ? (S.stuetz[s] || []) : (S.sp[s] ? S.sp[s].ctrl : []); }
  function zeigeSymmetrie() {
    weg('spiegel');
    if (!S.sym || !S.sp.rechts) return;
    const g = new THREE.Group();
    g.add(linie(K.bsSample(K.splineSpiegeln(S.sp.rechts), 400), 0x0ea5e9, true));
    if (S.sym.maxAt) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdc2626, depthTest: false }));
      m.position.copy(v3(S.sym.maxAt.p)); m.renderOrder = 999; g.add(m);
    }
    setze('spiegel', g);
  }
  function skala() {
    if (S.prm.farbSkalaMm > 0) return S.prm.farbSkalaMm;
    let m = 0.5; SEITEN.forEach(s => { const a = S.abw[s]; if (a && a.max) m = Math.max(m, Math.abs(a.max.wert), Math.abs(a.min.wert)); });
    return Math.ceil(m * 10) / 10;
  }
  function abwFarben(s, n) {
    const a = S.abw[s], sk = skala(), w = a.werte.slice().sort((x, y) => x.t - y.t), out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      if (!w.length || t < w[0].t - 0.01 || t > w[w.length - 1].t + 0.01) { out.push([0.6, 0.6, 0.6]); continue; }
      let j = 0; while (j < w.length - 1 && w[j + 1].t < t) j++;
      const a0 = w[j], a1 = w[Math.min(j + 1, w.length - 1)], f = a1.t > a0.t ? Math.min(1, Math.max(0, (t - a0.t) / (a1.t - a0.t))) : 0;
      out.push(K.farbe(a0.wert * (1 - f) + a1.wert * f, sk));
    }
    return out;
  }

  // ── Kontrollbild: passende Ansicht je Schritt ───────────────────────────────
  function ansicht(art) {
    const m = aktuellesNetz(); if (!m) return;
    fitToObjects([m]);
    const V = { vorne: [0, Math.PI / 2], iso: [0.6, 0.9], seite: [Math.PI / 2, Math.PI / 2], innen: [Math.PI, 1.2] }[art] || [0.6, 0.9];
    sph.theta = V[0]; sph.phi = V[1]; sph.r *= 0.42; sph2cam();
  }
  function kontrollbildSpeichern() {
    try {
      renderer.render(scene, camera);
      const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = dateiName('kontrollbild', 'png'); a.click();
    } catch (e) { notify('Kontrollbild fehlgeschlagen: ' + e.message, 'e'); }
  }

  // ── Schritte ────────────────────────────────────────────────────────────────
  async function lauf(name, fn) {
    if (S.beschaeftigt) { notify('Rechnet noch …', 'w'); return false; }
    S.beschaeftigt = true; status(name, '⏳ rechnet …'); setzeKnoepfe(true);
    const t0 = performance.now();
    try { await fn(); return true; }
    catch (e) { console.error('[strebespline]', e); status(name, '✗ ' + e.message); notify('Strebe→Spline: ' + e.message, 'e'); return false; }
    finally { S.beschaeftigt = false; setzeKnoepfe(false); console.log('[strebespline]', name, Math.round(performance.now() - t0), 'ms'); }
  }
  async function sicherGeladen() {
    let m = aktuellesNetz();
    if (!m || !S.geladen) {
      m = (selectedObjs || []).find(o => o.isMesh) || m;
      if (!m) throw new Error('Bitte zuerst den Scan (importierte STL) auswählen und das Werkzeug neu öffnen');
      await netzLaden(m);
      if (typeof deselect === 'function') deselect();
      kopf();
    }
    return m;
  }

  async function schritt0() {
    await lauf('s0', async () => {
      const m = await sicherGeladen();
      const al = await ruf('ausrichten', { opt: { nickWinkel: S.prm.nickWinkel } });
      // Scan selbst ausrichten: neue Welt = C · A · Wm0 (ein Undo-Schritt)
      saveUndo();
      const A = fromRowMajor(al.matrix);
      const neu = C.clone().multiply(A).multiply(S.Wm0);
      const par = m.parent && m.parent !== scene ? m.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
      par.multiply(neu).decompose(m.position, m.quaternion, m.scale);
      m.updateMatrixWorld(true);
      S.al = al;
      S.G0 = A.clone().multiply(S.Wm0).invert();   // ausgerichtet → lokal
      S.streben = null; S.kamm = { links: null, rechts: null }; S.sp = { links: null, rechts: null }; S.stuetz = { links: null, rechts: null }; S.sym = null; S.abw = { links: null, rechts: null };
      alleOverlaysWeg(); zeigeAusrichtung(); ansicht('vorne');
      const zeilen = [0, 1, 2, 3].map(r => al.matrix.slice(4 * r, 4 * r + 4).map(v => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(r < 3 ? 5 : 0)).join('  '));
      status('s0', `✓ Symmetrieebene gefunden · Restfehler ${al.rms.toFixed(2)} mm · ${(al.anteil * 100).toFixed(0)} % der Punkte haben einen Spiegelpartner` +
        (al.rms > 2 ? ' — <b style="color:#f59e0b">Restfehler hoch, Ausrichtung prüfen</b>' : '') +
        `<pre class="ssp-mat">Scan-mm → ausgerichtet (Zeilen, mm):\n${zeilen.join('\n')}</pre>` +
        `<span class="ssp-k">Spitze im Ursprung, Fahrzeugmitte = violette Ebene (X=0). Rückgängig: Strg+Z. Nicken (Drehung um X) legt die Symmetrie nicht fest → Parameter „Nickwinkel“.</span>`);
      zeigeSchritt(1);
    });
  }
  async function schritt0ohne() {
    await lauf('s0', async () => {
      await sicherGeladen();
      await ruf('matrixSetzen', { matrix: K.M4.ident() });
      S.al = { matrix: K.M4.ident(), rms: NaN, anteil: NaN, ohne: true };
      S.G0 = S.Wm0.clone().invert();
      alleOverlaysWeg();
      status('s0', '– ohne Ausrichtung (Scan-Koordinaten werden direkt benutzt)');
      zeigeSchritt(1);
    });
  }
  async function schritt1() {
    await lauf('s1', async () => {
      await sicherGeladen();
      if (!S.al) throw new Error('Erst Schritt 0 (Ausrichten oder „ohne“)');
      S.streben = await ruf('streben', { prm: S.prm });
      nachStreben();
    });
  }
  function nachStreben() {
    S.kamm = { links: null, rechts: null }; S.sp = { links: null, rechts: null }; S.stuetz = { links: null, rechts: null }; S.sym = null; S.abw = { links: null, rechts: null };
    ['kamm-links', 'kamm-rechts', 'spline-links', 'spline-rechts', 'griffe-links', 'griffe-rechts', 'polygon-links', 'polygon-rechts', 'spiegel'].forEach(weg);
    zeigeStreben(); ansicht('iso');
    const z = s => { const st = S.streben[s]; return st ? `<b style="color:#${FARBE[s].toString(16).padStart(6, '0')}">${s}</b>: Z ${st.zMin.toFixed(0)} … ${st.zMax.toFixed(0)} mm · Länge ≈ ${st.laenge.toFixed(0)} mm · ${st.nTri.toLocaleString('de')} Dreiecke` : `<b>${s}</b>: nicht gefunden`; };
    status('s1', `✓ ${z('links')}<br>${z('rechts')}<br><span class="ssp-k">Die längere Strebe gilt als links (Vorgabe: links bis Z ≈ 2100). Falsch? → ⇄ tauschen.</span>`);
    zeigeSchritt(2);
  }
  async function tauschen() {
    await lauf('s1', async () => { S.streben = await ruf('tauschen', {}); nachStreben(); });
  }
  async function schritt2() {
    await lauf('s2', async () => {
      await sicherGeladen();
      if (!S.streben) throw new Error('Erst Schritt 1');
      for (const s of SEITEN) S.kamm[s] = S.streben[s] ? await ruf('kamm', { prm: S.prm, seite: s }) : null;
      zeigeKamm(); weg('strebe-links'); weg('strebe-rechts'); ansicht('iso');
      if (S.modus === 'gemittelt') { S.modus = 'ausgleich'; S.vorMittel = null; modusKnoepfe(); }
      const z = s => {
        const k = S.kamm[s]; if (!k) return `<b>${s}</b>: –`;
        const n = {}; k.forEach(q => { const g = q.ok ? 'ok' : q.grund; n[g] = (n[g] || 0) + 1; });
        return `<b>${s}</b>: ${k.length} Schnitte · <span style="color:#16a34a">● ${n.ok || 0} Kamm</span> · <span style="color:#9ca3af">● ${n.loch || 0} Loch</span> · <span style="color:#dc2626">● ${n.ausreisser || 0} Ausreißer</span> · <span style="color:#eab308">● ${(n.unvollstaendig || 0) + (n.fehlform || 0) + (n.flach || 0)} unklar</span>`;
      };
      status('s2', `✓ ${z('links')}<br>${z('rechts')}<br><span class="ssp-k">Klick auf einen Punkt im Bild zeigt den Querschnitt. Graue/rote/gelbe Schnitte fließen nicht in den Spline ein.</span>`);
      schritt3(true);
      zeigeSchritt(3);
    });
  }
  // Schritt 3 (leicht, Hauptthread). neu=true → Stützpunkte neu vorschlagen
  function schritt3(neu) {
    try {
      for (const s of SEITEN) {
        const k = S.kamm[s]; if (!k) { S.sp[s] = null; continue; }
        const ok = k.filter(q => q.ok);
        if (ok.length < 4) { S.sp[s] = null; continue; }
        if (S.modus === 'stuetz') {
          if (neu || !S.stuetz[s]) S.stuetz[s] = K.stuetzpunkteVorschlagen(k, S.prm).map(v => v.p);
          S.sp[s] = K.interpolSpline(S.stuetz[s]);
        } else if (S.modus === 'ausgleich') {
          S.sp[s] = K.ausgleichSpline(ok.map(q => q.p), S.prm);
        }
      }
      if (S.modus === 'gemittelt') { /* bleibt, bis neu gemittelt wird */ }
      S.edits = [];
      nachSplineAenderung(true);
      const L = SEITEN.map(s => S.sp[s] ? `${s} ${K.bogenlaengen(K.bsSample(S.sp[s], 600)).pop().toFixed(0)} mm` : `${s} –`).join(' · ');
      const art = { ausgleich: `Ausgleichsspline, ${S.prm.kontrollpunkte} Kontrollpunkte, Glättungslänge ${K.glaettungsLaenge(S.prm.glaettung).toFixed(0)} mm`, stuetz: `durch ${S.prm.stuetzpunkte} Stützpunkte an ungestörten Stellen`, gemittelt: 'gemittelt und gespiegelt' }[S.modus];
      status('s3', `✓ ${art} · ${L}<br><span class="ssp-k">Weiße Punkte mit der Maus ziehen → Spline folgt live. Für genaue Lage in die Vorder-/Seitenansicht wechseln.</span>`);
    } catch (e) { status('s3', '✗ ' + e.message); }
  }
  function nachSplineAenderung(alles) {
    SEITEN.forEach(s => { S.abw[s] = (S.sp[s] && S.kamm[s]) ? K.abweichung(S.sp[s], S.kamm[s]) : null; });
    if (S.sym && S.sp.links && S.sp.rechts) S.sym = K.symmetrie(S.sp.links, S.sp.rechts, S.prm);
    SEITEN.forEach(zeigeSpline);
    if (S.zeigAbw) zeigeKamm();
    if (S.sym) zeigeSymmetrie();
    if (alles !== 'still') { if (S.zeigAbw) abwText(); if (S.sym) symText(); waehlText(); }
  }
  function schritt4() {
    if (!S.sp.links || !S.sp.rechts) { status('s4', '✗ Erst beide Splines (Schritt 3)'); return; }
    S.sym = K.symmetrie(S.sp.links, S.sp.rechts, S.prm);
    zeigeSymmetrie(); symText(); ansicht('vorne');
    zeigeSchritt(5);
  }
  function symText() {
    const st = S.sym && S.sym.stat;
    if (!st) { status('s4', '✗ kein gemeinsamer Bereich – Splines liegen nicht gegenüber'); return; }
    status('s4', `✓ Rechts an X=0 gespiegelt (blau gestrichelt) gegen links verglichen.<br>` +
      `Vergleich nur im gemeinsamen Bereich: s = ${st.von.toFixed(0)} … ${st.bis.toFixed(0)} mm von ${st.laengeL.toFixed(0)} mm (rechts ${st.laengeR.toFixed(0)} mm, nichts abgeschnitten).<br>` +
      `Abweichung: <b>max ${st.max.toFixed(2)} mm</b> (roter Punkt) · mittel ${st.mittel.toFixed(2)} · RMS ${st.rms.toFixed(2)} mm` +
      (S.modus === 'gemittelt' ? '<br><b style="color:#d946ef">Gemittelter Spline aktiv</b> (beide Seiten identisch gespiegelt)' : ''));
  }
  function mitteln() {
    try {
      if (!S.sp.links || !S.sp.rechts) throw new Error('Erst beide Splines');
      if (S.modus !== 'gemittelt') S.vorMittel = { modus: S.modus, sp: { links: S.sp.links, rechts: S.sp.rechts }, stuetz: { links: S.stuetz.links, rechts: S.stuetz.rechts } };
      const gm = K.gemittelt(S.sp.links, S.sp.rechts, S.prm);
      S.sp.links = gm.links; S.sp.rechts = gm.rechts; S.modus = 'gemittelt'; S.edits = [];
      S.sym = K.symmetrie(S.sp.links, S.sp.rechts, S.prm);
      modusKnoepfe(); nachSplineAenderung(true); symText();
      notify('Gemittelter Spline auf beide Seiten gespiegelt (volle Länge der längeren Strebe)', 'ok');
    } catch (e) { notify(e.message, 'e'); }
  }
  function originale() {
    if (!S.vorMittel) { notify('Keine Originale gesichert', 'w'); return; }
    S.modus = S.vorMittel.modus; S.sp = Object.assign({}, S.vorMittel.sp); S.stuetz = Object.assign({}, S.vorMittel.stuetz); S.vorMittel = null; S.edits = [];
    if (S.sym) S.sym = K.symmetrie(S.sp.links, S.sp.rechts, S.prm);
    modusKnoepfe(); nachSplineAenderung(true); if (S.sym) symText();
  }
  function schritt5() {
    if (!S.sp.links && !S.sp.rechts) { status('s5', '✗ Erst Schritt 3'); return; }
    S.zeigAbw = true; nachSplineAenderung(true); ansicht('iso');
    zeigeSchritt(6);
  }
  function abwText() {
    const sk = skala();
    const z = s => {
      const a = S.abw[s]; if (!a || !a.max) return `<b>${s}</b>: –`;
      const wo = w => `s ${w.sSpline.toFixed(0)} mm, Z ${w.p[2].toFixed(0)}`;
      return `<b>${s}</b>: Beule max <b style="color:#dc2626">+${a.max.wert.toFixed(2)} mm</b> (${wo(a.max)}) · Delle max <b style="color:#2563eb">${a.min.wert.toFixed(2)} mm</b> (${wo(a.min)}) · RMS ${a.rms.toFixed(2)}`;
    };
    setTimeout(abwDiagramm, 0);
    status('s5', `<canvas id="ssp-abw" width="640" height="260" style="width:100%;height:130px;border-radius:6px;background:#0f1115;margin:4px 0"></canvas><div class="ssp-leg"><span>−${sk} mm Delle</span><i></i><span>Beule +${sk} mm</span></div>${z('links')}<br>${z('rechts')}<br><span class="ssp-k">Abstand Scan-Kamm ↔ Spline in Wulstrichtung. Grau = keine Messung (Loch / außerhalb).</span>`);
  }

  // Abweichung über der Bogenlänge, je Seite eine Zeile (Balken in der Farbskala)
  function abwDiagramm() {
    const cv = S.panel && S.panel.querySelector('#ssp-abw'); if (!cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, sk = skala();
    ctx.fillStyle = '#0f1115'; ctx.fillRect(0, 0, W, H);
    const Lmax = Math.max(...SEITEN.map(s => S.abw[s] ? S.abw[s].laenge : 0), 1);
    const x0 = 70, x1 = W - 12, zh = (H - 34) / 2;
    ctx.font = '20px system-ui';
    SEITEN.forEach((s, r) => {
      const a = S.abw[s], yc = 14 + r * zh + zh / 2;
      ctx.fillStyle = '#9aa0a8'; ctx.fillText(s, 6, yc + 7);
      ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(x0, yc); ctx.lineTo(x1, yc); ctx.stroke();
      if (!a) return;
      const bx = (x1 - x0) / Lmax * 10 * 0.8;
      a.werte.forEach(w => {
        const x = x0 + (x1 - x0) * w.sSpline / Lmax, h = Math.max(-1, Math.min(1, w.wert / sk)) * (zh / 2 - 4), f = K.farbe(w.wert, sk);
        ctx.fillStyle = `rgb(${f.map(v => Math.round(v * 255)).join(',')})`; ctx.fillRect(x - bx / 2, h > 0 ? yc - h : yc, Math.max(1.5, bx), Math.max(1, Math.abs(h)));
      });
    });
    ctx.fillStyle = '#9aa0a8';
    for (let s = 0; s <= Lmax; s += 500) { const x = x0 + (x1 - x0) * s / Lmax; ctx.fillText(s, x - 10, H - 4); }
    ctx.fillText('±' + sk + ' mm', 4, H - 4);
  }

  // ── Export / Laden ──────────────────────────────────────────────────────────
  function dateiName(was, ext) { return (S.meshName || 'scan').replace(/[^\w\-äöüÄÖÜß]+/g, '_') + '_' + was + '.' + ext; }
  function herunterladen(text, name, typ) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: typ || 'text/plain' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function exportSplines() {
    const sys = S.panel.querySelector('#ssp-sys').value;
    let M = null;
    if (sys === 'scan') M = rowMajor(S.G0);   // ausgerichtet → Netz-lokal (= Koordinaten der STL-Datei)
    const out = {};
    SEITEN.forEach(s => { if (S.sp[s]) out[s] = M ? K.inSystem(S.sp[s], M) : S.sp[s]; });
    return { out, sys };
  }
  function exportieren(art) {
    if (!S.sp.links && !S.sp.rechts) { notify('Noch keine Splines', 'w'); return; }
    const { out, sys } = exportSplines();
    const sysTxt = sys === 'scan' ? 'scan' : 'ausgerichtet';
    if (art === 'json') {
      const daten = {
        format: 'v3d-strebe-spline', version: 1, datum: new Date().toISOString(), scan: S.meshName, dreiecke: S.nTri,
        koordinaten: sys === 'scan' ? 'Scan (Koordinaten der STL-Datei, mm)' : 'ausgerichtet (Fahrzeugmitte X=0, Spitze im Ursprung, Z oben, mm)',
        parameter: S.prm, modus: S.modus,
        ausrichtung: S.al ? { matrix_scan_zu_ausgerichtet: S.al.matrix, matrix_ausgerichtet_zu_dateikoordinaten: rowMajor(S.G0), restfehler_mm: S.al.rms, anteil: S.al.anteil, spitze_scan: S.al.spitze, ebene_scan: S.al.ebene } : null,
        splines: out,
        stuetzpunkte_ausgerichtet: S.stuetz,
        splines_ausgerichtet: S.sp,
        kamm: Object.fromEntries(SEITEN.map(s => [s, S.kamm[s] ? S.kamm[s].map(q => ({ s: q.s, ok: q.ok, grund: q.grund || undefined, p: q.ok ? q.p : undefined, hoehe: q.hoehe, b: q.ok ? q.b : undefined })) : null])),
        symmetrie: S.sym ? S.sym.stat : null,
        abweichung: Object.fromEntries(SEITEN.map(s => [s, S.abw[s] && S.abw[s].max ? { max_beule_mm: S.abw[s].max.wert, max_delle_mm: S.abw[s].min.wert, rms_mm: S.abw[s].rms } : null])),
      };
      herunterladen(K.exportJSON(daten), dateiName('leitkurven_' + sysTxt, 'json'), 'application/json');
    } else if (art === 'csv') herunterladen(K.exportCSV(out), dateiName('stuetzpunkte_' + sysTxt, 'csv'), 'text/csv');
    else if (art === 'poly') herunterladen(K.exportPolylinie(out, 2), dateiName('polylinie_' + sysTxt, 'csv'), 'text/csv');
    else if (art === 'step') herunterladen(K.exportSTEP(out, { name: dateiName('leitkurven', 'step'), beschreibung: 'Leitkurven Streben (' + sysTxt + ')' }), dateiName('leitkurven_' + sysTxt, 'step'), 'application/step');
  }
  async function jsonLaden(file) {
    await lauf('s6', async () => {
      const d = JSON.parse(await file.text());
      if (d.format !== 'v3d-strebe-spline') throw new Error('keine Strebe-Spline-Datei');
      await sicherGeladen();
      Object.assign(S.prm, d.parameter || {}); speicherePrm(); prmFelder();
      if (d.ausrichtung && d.ausrichtung.matrix_scan_zu_ausgerichtet) {
        S.al = { matrix: d.ausrichtung.matrix_scan_zu_ausgerichtet, rms: d.ausrichtung.restfehler_mm, anteil: d.ausrichtung.anteil, spitze: d.ausrichtung.spitze_scan, ebene: d.ausrichtung.ebene_scan };
        await ruf('matrixSetzen', { matrix: S.al.matrix });
        S.G0 = fromRowMajor(d.ausrichtung.matrix_ausgerichtet_zu_dateikoordinaten);
      }
      S.modus = d.modus || 'ausgleich'; S.sp = d.splines_ausgerichtet || { links: null, rechts: null };
      S.stuetz = d.stuetzpunkte_ausgerichtet || { links: null, rechts: null };
      S.kamm = { links: null, rechts: null };
      alleOverlaysWeg(); zeigeAusrichtung(); modusKnoepfe(); nachSplineAenderung(true);
      status('s6', `✓ ${file.name} geladen (Splines; Kammpunkte nicht – für Kontrolle Schritt 1+2 neu rechnen)`);
    });
  }

  // ── Maus: Griffe ziehen, Kammpunkt anklicken ────────────────────────────────
  const ray = new THREE.Raycaster();
  function strahl(e) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    // r128 rechnet die Punkt-Toleranz im lokalen System OHNE Eltern-Skalierung → hier in Gruppen-mm umrechnen (≈ 6 px)
    const welt1px = (camera.isPerspectiveCamera ? sph.r * 2 * Math.tan(camera.fov * Math.PI / 360) : (camera.top - camera.bottom) / camera.zoom) / (r.height || 800);
    ray.params.Points = { threshold: 6 * welt1px / ((S.gruppe && S.gruppe.matrix.getMaxScaleOnAxis()) || 0.1) };
    return ray;
  }
  function onDown(e) {
    if (!S.aktiv || e.button !== 0 || !S.gruppe || e.target !== canvas) return;
    griffGroesse();
    const r = strahl(e);
    const griffe = []; SEITEN.forEach(s => { const g = S.obj['griffe-' + s]; if (g) g.children.forEach(h => griffe.push(h)); });
    const hit = r.intersectObjects(griffe, false)[0];
    if (hit) {
      e.preventDefault(); e.stopImmediatePropagation();
      const h = hit.object, { seite, i } = h.userData;
      const welt = h.getWorldPosition(new THREE.Vector3());
      const n = camera.getWorldDirection(new THREE.Vector3());
      S.drag = { seite, i, ebene: new THREE.Plane().setFromNormalAndCoplanarPoint(n, welt), vorher: snapshot(), bewegt: false };
      S.wahl = { seite, i }; waehlText();
      canvas.style.cursor = 'grabbing';
      window.addEventListener('mousemove', onMove, true); window.addEventListener('mouseup', onUp, true);
      return;
    }
    // Kammpunkt? (nur merken – Kamera-Drehen bleibt möglich)
    const kp = []; SEITEN.forEach(s => { if (S.obj['kamm-' + s]) kp.push(S.obj['kamm-' + s]); });
    const hk = kp.length ? r.intersectObjects(kp, false)[0] : null;
    if (hk) {   // Kammpunkt angeklickt → Querschnitt zeigen, Klick nicht an die App (sonst wählt sie den Scan aus)
      e.preventDefault(); e.stopImmediatePropagation();
      profilZeigen(hk.object.userData.seite, hk.index);
    }
  }
  let rafPending = false;
  function onMove(e) {
    if (!S.drag) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const r = strahl(e), p = new THREE.Vector3();
    if (!r.ray.intersectPlane(S.drag.ebene, p)) return;
    p.applyMatrix4(S.gruppe.matrixWorld.clone().invert());
    setzeGriff(S.drag.seite, S.drag.i, [p.x, p.y, p.z]);
    S.drag.bewegt = true;
    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; nachSplineAenderung('still'); waehlText(); }); }
  }
  function onUp(e) {
    window.removeEventListener('mousemove', onMove, true); window.removeEventListener('mouseup', onUp, true);
    canvas.style.cursor = '';
    if (S.drag) { e.preventDefault(); e.stopImmediatePropagation(); if (S.drag.bewegt) S.edits.push(S.drag.vorher); S.drag = null; nachSplineAenderung(true); }
  }
  function setzeGriff(s, i, p) {
    if (S.modus === 'stuetz') { S.stuetz[s][i] = p; S.sp[s] = K.interpolSpline(S.stuetz[s]); }
    else {
      S.sp[s].ctrl[i] = p; S.sp[s].bearbeitet = true;
      if (S.modus === 'gemittelt') { const o = s === 'links' ? 'rechts' : 'links'; if (S.sp[o]) { S.sp[o].ctrl[i] = [-p[0], p[1], p[2]]; S.sp[o].bearbeitet = true; } }
    }
  }
  function snapshot() { return JSON.stringify({ sp: S.sp, stuetz: S.stuetz }); }
  function rueckgaengig() {
    const v = S.edits.pop(); if (!v) { notify('Keine Bearbeitung zum Zurücknehmen', 'w'); return; }
    const d = JSON.parse(v); S.sp = d.sp; S.stuetz = d.stuetz; nachSplineAenderung(true);
  }
  function waehlText() {
    const el = S.panel && S.panel.querySelector('#ssp-wahl'); if (!el) return;
    if (!S.wahl || !griffPunkte(S.wahl.seite)[S.wahl.i]) { el.innerHTML = ''; return; }
    const p = griffPunkte(S.wahl.seite)[S.wahl.i];
    const art = S.modus === 'stuetz' ? 'Stützpunkt' : 'Kontrollpunkt';
    el.innerHTML = `<b>${S.wahl.seite} · ${art} ${S.wahl.i + 1}</b> ` + ['X', 'Y', 'Z'].map((a, k) => `${a} <input type="number" step="0.5" data-ax="${k}" value="${p[k].toFixed(2)}">`).join(' ') + ' mm';
    el.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
      const q = griffPunkte(S.wahl.seite)[S.wahl.i].slice(); q[+inp.dataset.ax] = parseFloat(inp.value) || 0;
      S.edits.push(snapshot()); setzeGriff(S.wahl.seite, S.wahl.i, q); nachSplineAenderung(true);
    }));
  }

  // Querschnitt eines Kammpunkts als kleines Bild
  async function profilZeigen(s, i) {
    const k = S.kamm[s] && S.kamm[s][i]; if (!k) return;
    let r; try { r = await ruf('profil', { prm: S.prm, seite: s, p: k.leit, t: k.tan }); } catch (e) { notify(e.message, 'e'); return; }
    const cv = S.panel.querySelector('#ssp-profil'); cv.style.display = 'block';
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.fillStyle = '#0f1115'; ctx.fillRect(0, 0, W, H);
    let e1 = k.quer, e2 = k.b;
    if (!e1 || !e2) { const T = k.tan; const a = Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; e1 = norm3(cross3(T, a)); e2 = cross3(T, e1); }
    const c = k.leit, pr = r.prof.map(q => [dot3(sub3(q, c), e1), dot3(sub3(q, c), e2)]);
    const R = S.prm.suchRadius, sc = (W - 20) / (2 * R), cx = W / 2, cy = H / 2;
    ctx.strokeStyle = '#334155'; ctx.beginPath(); ctx.moveTo(10, cy); ctx.lineTo(W - 10, cy); ctx.moveTo(cx, 6); ctx.lineTo(cx, H - 6); ctx.stroke();
    ctx.fillStyle = '#e5e7eb'; pr.forEach(([x, y]) => ctx.fillRect(cx + x * sc - 1, cy - y * sc - 1, 2, 2));
    if (k.ok) { const q = [dot3(sub3(k.p, c), e1), dot3(sub3(k.p, c), e2)]; ctx.fillStyle = '#16a34a'; ctx.beginPath(); ctx.arc(cx + q[0] * sc, cy - q[1] * sc, 5, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#9aa0a8'; ctx.font = '11px system-ui';
    ctx.fillText(`${s} · s = ${k.s.toFixed(0)} mm · ${k.ok ? 'Kamm, Höhe ' + k.hoehe.toFixed(1) + ' mm' : 'verworfen: ' + k.grund} · ${pr.length} Pkt`, 8, 14);
    ctx.fillText(`Fenster ±${R} mm`, 8, H - 6);
  }
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };

  // ── Panel ───────────────────────────────────────────────────────────────────
  const PRM_FELDER = [
    ['nickWinkel', 'Nickwinkel', '°', 0.5], ['strebenStartZ', 'Strebenbeginn Z', 'mm', 10], ['schnittAbstand', 'Schnittabstand', 'mm', 1],
    ['suchRadius', 'Schnittfenster ±', 'mm', 5], ['kammHalbbreite', 'Kamm-Halbbreite', 'mm', 0.5], ['kappenHoehe', 'Kappenhöhe', 'mm', 0.5],
    ['maxKammRadius', 'max. Kammradius', 'mm', 5], ['minWulstHoehe', 'min. Wulsthöhe', 'mm', 0.5], ['lueckenBruecke', 'Lückenbrücke', 'mm', 10],
    ['ausreisserMm', 'Ausreißer ab', 'mm', 0.5], ['kontrollpunkte', 'Kontrollpunkte', '', 1], ['stuetzpunkte', 'Stützpunkte', 'Anz.', 1],
    ['symmetrieUebergang', 'Symm.-Überblendung', 'mm', 10], ['farbSkalaMm', 'Farbskala ± (0=auto)', 'mm', 0.5],
  ];
  const CSS = `
#ssp-panel{position:fixed;top:70px;right:14px;width:352px;max-height:calc(100vh - 90px);overflow:auto;z-index:6000;background:#1f2329;border:1px solid #3a3f47;border-radius:9px;padding:12px 14px;color:#e6e8eb;font:12px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45)}
#ssp-panel h4{margin:10px 0 4px;font-size:12.5px;display:flex;align-items:center;gap:6px}
#ssp-panel h4 .n{display:inline-flex;width:18px;height:18px;border-radius:50%;background:#374151;align-items:center;justify-content:center;font-size:11px}
#ssp-panel .ssp-step{border-top:1px solid #2f343c;padding-top:4px;margin-top:6px}
#ssp-panel .ssp-step.dran h4 .n{background:#F97316}
#ssp-panel button{background:#2a2f37;border:1px solid #3a3f47;color:#e6e8eb;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:11.5px;margin:2px 3px 2px 0}
#ssp-panel button.h{background:#F97316;border-color:#F97316;color:#fff;font-weight:600}
#ssp-panel button.an{background:#7c3aed;border-color:#7c3aed}
#ssp-panel button:disabled{opacity:.45;cursor:default}
#ssp-panel .ssp-st{color:#cbd5e1;font-size:11.5px;margin:3px 0 2px}
#ssp-panel .ssp-k{color:#9aa0a8;font-size:11px}
#ssp-panel .ssp-mat{background:#111418;border-radius:5px;padding:5px 6px;margin:4px 0;font:10.5px/1.35 ui-monospace,monospace;color:#d1d5db;white-space:pre;overflow:auto}
#ssp-panel .ssp-prm{display:grid;grid-template-columns:1fr 64px 26px;gap:3px 6px;align-items:center;margin:6px 0}
#ssp-panel .ssp-prm input{width:60px;background:#111418;border:1px solid #3a3f47;color:#e6e8eb;border-radius:4px;padding:2px 4px}
#ssp-panel #ssp-wahl input{width:58px;background:#111418;border:1px solid #3a3f47;color:#e6e8eb;border-radius:4px;padding:1px 3px}
#ssp-panel .ssp-leg{display:flex;align-items:center;gap:6px;margin:4px 0;font-size:11px}
#ssp-panel .ssp-leg i{flex:1;height:9px;border-radius:5px;background:linear-gradient(90deg,#2b5bff,#fff,#ff2b2b)}
#ssp-panel select{background:#111418;border:1px solid #3a3f47;color:#e6e8eb;border-radius:4px;padding:3px}
#ssp-panel summary{cursor:pointer;color:#cbd5e1;margin-top:6px}
#ssp-profil{display:none;width:100%;height:150px;border-radius:6px;margin-top:4px}
`;
  function baue() {
    if (!document.getElementById('ssp-css')) { const st = document.createElement('style'); st.id = 'ssp-css'; st.textContent = CSS; document.head.appendChild(st); }
    const p = document.createElement('div'); p.id = 'ssp-panel';
    p.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b style="font-size:13.5px">〰 Strebe → Spline</b>
        <span data-a="zu" style="cursor:pointer;color:#9aa0a8;font-size:16px;line-height:1" title="Schließen (Ergebnisse bleiben erhalten)">✕</span>
      </div>
      <div id="ssp-kopf" class="ssp-k" style="margin:3px 0 4px"></div>
      <button class="h" data-a="alle" title="Schritte 0–5 nacheinander">▶ Alle Schritte 0–5</button>
      <button data-a="bild" title="Aktuelle Ansicht als PNG speichern">📷 Kontrollbild</button>
      <button data-a="durch" title="Scan halb durchsichtig, damit Kamm und Spline besser zu sehen sind">◐ Scan durchsichtig</button>
      <details id="ssp-prm-d"><summary>⚙ Parameter (zentral)</summary>
        <div class="ssp-prm" id="ssp-prm"></div>
        <button data-a="std">Standardwerte</button>
      </details>

      <div class="ssp-step" data-s="0"><h4><span class="n">0</span> Ausrichtung</h4>
        <button class="h" data-a="s0">Symmetrie ausrichten</button><button data-a="s0ohne" title="Scan-Koordinaten unverändert benutzen">ohne</button>
        <div class="ssp-st" id="ssp-s0"></div></div>

      <div class="ssp-step" data-s="1"><h4><span class="n">1</span> Streben erkennen</h4>
        <button class="h" data-a="s1">Erkennen</button><button data-a="tausch">⇄ links/rechts tauschen</button>
        <div class="ssp-st" id="ssp-s1"></div></div>

      <div class="ssp-step" data-s="2"><h4><span class="n">2</span> Mittellinie (Kammpunkte)</h4>
        <button class="h" data-a="s2">Schnitte + Kamm</button>
        <div class="ssp-st" id="ssp-s2"></div>
        <canvas id="ssp-profil" width="320" height="150"></canvas></div>

      <div class="ssp-step" data-s="3"><h4><span class="n">3</span> Spline</h4>
        <div><button data-m="ausgleich">Ausgleichsspline</button><button data-m="stuetz">Stützpunkte</button><button data-m="gemittelt" disabled title="über Schritt 4">gemittelt</button></div>
        <div style="display:flex;align-items:center;gap:6px;margin:4px 0">
          <span style="width:62px;color:#9aa0a8">Glättung</span>
          <input id="ssp-gl" type="range" min="0" max="10" step="0.1" style="flex:1">
          <span id="ssp-gl-v" style="width:62px;text-align:right"></span>
        </div>
        <button data-a="vorschlag" title="Stützpunkte an den ungestörtesten Stellen neu setzen">Stützpunkte vorschlagen</button>
        <button data-a="undo" title="Letzte Griff-Bearbeitung zurück">↶ Bearbeitung</button>
        <div id="ssp-wahl" class="ssp-k" style="margin:3px 0"></div>
        <div class="ssp-st" id="ssp-s3"></div></div>

      <div class="ssp-step" data-s="4"><h4><span class="n">4</span> Symmetrie</h4>
        <button class="h" data-a="s4">Links ↔ rechts vergleichen</button>
        <button data-a="mitteln">Gemittelt auf beide Seiten</button><button data-a="orig">Originale</button>
        <div class="ssp-st" id="ssp-s4"></div></div>

      <div class="ssp-step" data-s="5"><h4><span class="n">5</span> Kontrolle</h4>
        <button class="h" data-a="s5">Abweichung als Farbe</button><button data-a="s5aus">aus</button>
        <div class="ssp-st" id="ssp-s5"></div></div>

      <div class="ssp-step" data-s="6"><h4><span class="n">6</span> Export</h4>
        <div style="margin:2px 0 4px">Koordinaten <select id="ssp-sys"><option value="al">ausgerichtet (Mitte X=0)</option><option value="scan">wie Scan-Datei</option></select></div>
        <button data-a="json">JSON</button><button data-a="csv">Stützpunkte CSV</button><button data-a="step">STEP (B-Spline)</button><button data-a="poly">Polylinie CSV</button>
        <button data-a="laden">📂 JSON laden</button><input type="file" id="ssp-datei" accept=".json" style="display:none">
        <div class="ssp-st" id="ssp-s6"></div>
        <div class="ssp-k">Noch keine Leisten – erst nach Freigabe der Splines.</div></div>`;
    document.body.appendChild(p); S.panel = p;
    prmFelder();
    const A = {
      zu: schliessen, alle: alleSchritte, bild: kontrollbildSpeichern, durch: durchsichtig, std: () => { S.prm = Object.assign({}, K.PARAM_DEFAULT); speicherePrm(); prmFelder(); },
      s0: schritt0, s0ohne: schritt0ohne, s1: schritt1, tausch: tauschen, s2: schritt2,
      vorschlag: () => { if (S.modus !== 'stuetz') { S.modus = 'stuetz'; modusKnoepfe(); } schritt3(true); },
      undo: rueckgaengig, s4: schritt4, mitteln, orig: originale, s5: schritt5, s5aus: () => { S.zeigAbw = false; zeigeKamm(); nachSplineAenderung(true); status('s5', ''); },
      json: () => exportieren('json'), csv: () => exportieren('csv'), step: () => exportieren('step'), poly: () => exportieren('poly'),
      laden: () => p.querySelector('#ssp-datei').click(),
    };
    p.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => A[b.dataset.a]()));
    p.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { if (b.dataset.m === 'gemittelt') return; S.modus = b.dataset.m; S.vorMittel = null; modusKnoepfe(); schritt3(false); }));
    p.querySelector('#ssp-datei').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) jsonLaden(f); });
    const gl = p.querySelector('#ssp-gl');
    gl.addEventListener('input', () => { S.prm.glaettung = parseFloat(gl.value); glText(); if (S.modus === 'ausgleich') schritt3(false); });
    gl.addEventListener('change', speicherePrm);
    p.addEventListener('mousedown', e => e.stopPropagation());
    p.addEventListener('keydown', e => e.stopPropagation());
    modusKnoepfe(); kopf();
    zeigeSchritt(S.sp.links ? 5 : S.streben ? 2 : S.al ? 1 : 0);
  }
  function glText() {
    const el = S.panel.querySelector('#ssp-gl-v'), L = K.glaettungsLaenge(S.prm.glaettung);
    el.textContent = L ? (L >= 1000 ? (L / 1000).toFixed(1) + ' m' : L.toFixed(0) + ' mm') : 'aus';
    el.title = 'Unebenheiten kürzer als etwa diese Länge werden ausgeglichen';
  }
  function prmFelder() {
    if (!S.panel) return;
    const box = S.panel.querySelector('#ssp-prm');
    box.innerHTML = PRM_FELDER.map(([k, l, e, st]) => `<label for="ssp-p-${k}">${l}</label><input id="ssp-p-${k}" type="number" step="${st}" value="${S.prm[k]}"><span class="ssp-k">${e}</span>`).join('');
    PRM_FELDER.forEach(([k]) => S.panel.querySelector('#ssp-p-' + k).addEventListener('change', ev => {
      const v = parseFloat(ev.target.value); if (!Number.isFinite(v)) return;
      S.prm[k] = v; speicherePrm();
      if (['kontrollpunkte', 'stuetzpunkte'].includes(k) && S.kamm.links) schritt3(k === 'stuetzpunkte');
      if (k === 'farbSkalaMm' && S.zeigAbw) nachSplineAenderung(true);
    }));
    S.panel.querySelector('#ssp-gl').value = S.prm.glaettung; glText();
  }
  function modusKnoepfe() {
    if (!S.panel) return;
    S.panel.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('an', b.dataset.m === S.modus));
    S.panel.querySelector('#ssp-gl').disabled = S.modus !== 'ausgleich';
  }
  function kopf() {
    if (!S.panel) return;
    const m = aktuellesNetz();
    S.panel.querySelector('#ssp-kopf').textContent = S.geladen ? `Scan: ${S.meshName} · ${S.nTri.toLocaleString('de')} Dreiecke`
      : m ? `Scan: ${m.userData.name || 'Netz'} · bereit – „Alle Schritte“ oder Schritt 0` : 'Erst den Scan (importierte STL) anklicken, dann dieses Werkzeug öffnen.';
  }
  function status(id, html) { const el = S.panel && S.panel.querySelector('#ssp-' + id); if (el) el.innerHTML = html; }
  function zeigeSchritt(n) { if (S.panel) S.panel.querySelectorAll('.ssp-step').forEach(d => d.classList.toggle('dran', +d.dataset.s === n)); }
  function setzeKnoepfe(aus) { if (S.panel) S.panel.querySelectorAll('button[data-a]').forEach(b => { if (!['zu', 'bild', 'durch'].includes(b.dataset.a)) b.disabled = aus; }); }
  // Scan hellgrau, solange das Werkzeug offen ist (Kontrast zu Kamm/Spline/Farbskala); beim Schließen zurück
  function scanGrau(an) {
    const m = aktuellesNetz(); if (!m || !m.material || !m.material.color) return;
    const mat = m.material;
    if (an && mat.userData.sspFarbe === undefined) { mat.userData.sspFarbe = mat.color.getHex(); mat.color.setHex(0xc9ced6); }
    else if (!an && mat.userData.sspFarbe !== undefined) { mat.color.setHex(mat.userData.sspFarbe); delete mat.userData.sspFarbe; }
  }
  function durchsichtig() {
    const m = aktuellesNetz() || (selectedObjs || [])[0]; if (!m || !m.material) return;
    const mat = m.material;
    if (mat.userData.sspAlt === undefined) { mat.userData.sspAlt = { t: mat.transparent, o: mat.opacity, d: mat.depthWrite }; mat.transparent = true; mat.opacity = 0.45; mat.depthWrite = false; }
    else { const a = mat.userData.sspAlt; mat.transparent = a.t; mat.opacity = a.o; mat.depthWrite = a.d; delete mat.userData.sspAlt; }
    mat.needsUpdate = true;
  }
  async function alleSchritte() {
    await schritt0(); if (!S.al) return;
    await schritt1(); if (!S.streben) return;
    await schritt2(); if (!S.kamm.links && !S.kamm.rechts) return;
    schritt4(); schritt5();
  }

  // ── öffnen / schließen ──────────────────────────────────────────────────────
  function oeffnen() {
    if (S.aktiv) { schliessen(); return; }
    if (typeof _sculpt !== 'undefined' && _sculpt.active && typeof _sculptClose === 'function') _sculptClose();
    S.aktiv = true;
    const sel = (selectedObjs || []).find(o => o.isMesh);
    if (sel && sel.userData.id !== S.meshId) { S.geladen = false; S.meshId = sel.userData.id; alleOverlaysWeg(); }   // (anderer) Scan gewählt
    // Auswahl aufheben: Auswahlrahmen, Verschiebe-Pfeile und Eigenschaften-Fenster lägen sonst über den Griffen
    if (typeof deselect === 'function') deselect();
    baue();
    if (S.gruppe) scene.add(S.gruppe);
    scanGrau(true);
    if (S.geladen) { if (S.al && !S.al.ohne) zeigeAusrichtung(); zeigeStreben(); zeigeKamm(); nachSplineAenderung(true); }
    window.addEventListener('mousedown', onDown, true);
    tick();
    if (!sel && S.meshId == null) notify('Strebe → Spline: bitte den Scan auswählen, dann „Alle Schritte“ oder Schritt 0', 'i');
  }
  function schliessen() {
    S.aktiv = false;
    if (S.panel) { S.panel.remove(); S.panel = null; }
    if (S.gruppe && S.gruppe.parent) S.gruppe.parent.remove(S.gruppe);
    window.removeEventListener('mousedown', onDown, true);
    const m = aktuellesNetz(); if (m && m.material && m.material.userData.sspAlt !== undefined) durchsichtig();
    scanGrau(false);
  }

  window.openStrebenSpline = oeffnen;
  window._strebenSpline = S;   // für Tests/Fehlersuche
})();
