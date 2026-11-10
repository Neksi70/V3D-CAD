// ── Adventskalender: Fenster, Vorschau, Erstellen (formunabhängig) ──────────────
const _advP = { form: 'ball', ansicht: 'zusammen', mischen: 1, seed: 7, g: {}, f: {} };
let _advRT = null, _advLast = null;
function _advDefaults(){
  for (const q of _ADV_GEMEIN) _advP.g[q.k] = q.def;
  for (const F of _ADV_FORMEN) { _advP.f[F.id] = {}; for (const q of F.params) _advP.f[F.id][q.k] = q.def; }
  _advP.mischen = 1; _advP.seed = 7;
}
_advDefaults();
const _advForm = () => _ADV_FORMEN.find(F => F.id === _advP.form) || _ADV_FORMEN[0];
const _advParams = () => ({ ..._advP.g, ..._advP.f[_advForm().id], mischen: _advP.mischen, seed: _advP.seed });
function _advFont(){ const ck = '_threeFont_baloo_local';
  if (!window[ck]) try { _npLoadFont('baloo_local', () => { const m = document.getElementById('adv-modal'); if (m && m.classList.contains('show')) _advRepaint(); }); } catch (e) {}
  return window[ck] || null; }
function _advText(CS, keep, txt, fk, h, cx, yb, maxW){ if (!_advFont()) return null; try { return _lttText(CS, keep, txt, fk, h, cx, yb, maxW); } catch (e) { return null; } }
function _advPreviewGeo(){
  if (!_mfWasm) throw new Error('Manifold lädt noch');
  const p = _advParams(), r = _advForm().build(_mfWasm, p, _advText);
  // Bettprüfung + Gewicht, dann nur die Gebrauchslage zeigen
  const bett = p.bett, liste = []; let gramm = 0;
  for (const t of r.teile) { const s = _advBox(t.d); gramm += _advGramm(t.d); liste.push({ name: t.name, s, passt: s.every(x => x <= bett + 1e-6) }); }
  _advLast = { info: r.info, liste, gramm, n: r.teile.length };
  let n = 0; const geos = [];
  for (const t of r.teile) { if (t.m) { const g = _mfToGeo(t.m).toNonIndexed(); n += g.attributes.position.count; geos.push([g, t.farbe]); t.m.delete(); } t.d.delete(); }
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const [g, hex] of geos) { const a = g.attributes.position.array, c = new THREE.Color(hex); pos.set(a, o * 3);
    for (let i = 0; i < a.length / 3; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; } o += a.length / 3; g.dispose(); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.scale(0.1, 0.1, 0.1); geo.computeVertexNormals();
  setTimeout(_advInfo, 0);
  return geo;
}
function _advOpen(){ document.getElementById('adv-modal').classList.add('show'); _advFont(); _advUI(); _mfInit().then(_advBoot).catch(() => notify('Rechenkern konnte nicht geladen werden', 'w')); }
function _advBoot(){ const m = document.getElementById('adv-modal'); if (!m || !m.classList.contains('show')) return;
  if (!_gpv['adv']) _gpvInit('adv', () => _advPreviewGeo()); else { _gpvUpdate('adv'); if (!_gpv['adv'].anim) _gpvLoop('adv'); } }
function _advClose(){ document.getElementById('adv-modal').classList.remove('show'); _gpvStop('adv'); }
function _advRepaint(){ if (_advRT) clearTimeout(_advRT); const el = document.getElementById('adv-info'); if (el) el.style.opacity = 0.55;
  _advRT = setTimeout(() => { _advRT = null; if (!_mfWasm) return; if (_gpv['adv']) _gpvUpdate('adv'); else _advBoot(); }, 400); }
function _advSet(k, v, form){ if (form) _advP.f[_advP.form][k] = v; else _advP.g[k] = v; _advSyncWerte(); _advRepaint(); }
function _advFormWahl(id){ _advP.form = id; _advUI(); _advRepaint(); }
function _advReset(){ _advDefaults(); _advUI(); _advRepaint(); }
function _advWuerfeln(){ _advP.seed = 1 + Math.floor(Math.random() * 9999); _advRepaint(); }
function _advRegler(q, wert, form){
  const id = 'adv-' + (form ? 'f-' : 'g-') + q.k, a = form ? ',1' : '';
  if (q.typ === 'text') return `<div class="vrow"><label title="${q.t || ''}">${q.l}</label> <input type="text" id="${id}" value="${wert}" style="flex:1;min-width:0" oninput="_advSet('${q.k}',this.value${a || ',0'})"></div>`;
  if (q.typ === 'schalter') return `<div class="vrow"><label title="${q.t || ''}">${q.l}</label> <input type="checkbox" id="${id}" ${wert ? 'checked' : ''} onchange="_advSet('${q.k}',this.checked?1:0${a || ',0'})"></div>`;
  return `<div class="vrow"><label title="${q.t || ''}">${q.l}</label> <input type="range" id="${id}" min="${q.min}" max="${q.max}" step="${q.step}" value="${wert}" oninput="_advSet('${q.k}',parseFloat(this.value)${a || ',0'})"><span class="vv" id="${id}-v">${wert}</span><span class="vu">${q.u || ''}</span></div>`;
}
function _advUI(){
  const F = _advForm(), fb = document.getElementById('adv-form-bg'), gc = document.getElementById('adv-gemein'), fc = document.getElementById('adv-formp');
  if (!fb) return;
  fb.innerHTML = _ADV_FORMEN.map(X => `<button class="vtb${X.id === F.id ? ' on' : ''}" title="${X.hint}" onclick="_advFormWahl('${X.id}')">${X.icon} ${X.name}</button>`).join('');
  gc.innerHTML = _ADV_GEMEIN.map(q => _advRegler(q, _advP.g[q.k], false)).join('');
  fc.innerHTML = `<div style="font-weight:600;margin:6px 0 4px">${F.icon} ${F.name}</div>` + F.params.map(q => _advRegler(q, _advP.f[F.id][q.k], true)).join('');
  document.querySelectorAll('#adv-ansicht-bg .vtb').forEach(b => b.classList.toggle('on', b.dataset.v === _advP.ansicht));
  const mi = document.getElementById('adv-mischen'); if (mi) mi.checked = !!_advP.mischen;
  _advInfo();
}
function _advSyncWerte(){
  for (const q of _ADV_GEMEIN) { const t = document.getElementById('adv-g-' + q.k + '-v'); if (t) t.textContent = _advP.g[q.k]; }
  const F = _advForm(); for (const q of F.params) { const t = document.getElementById('adv-f-' + q.k + '-v'); if (t) t.textContent = _advP.f[F.id][q.k]; }
}
function _advAnsicht(v){ _advP.ansicht = v; document.querySelectorAll('#adv-ansicht-bg .vtb').forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
function _advInfo(){
  const el = document.getElementById('adv-info'); if (!el) return; el.style.opacity = 1;
  const F = _advForm(), L = _advLast;
  if (!L) { el.innerHTML = 'Vorschau wird berechnet…'; return; }
  const zu = L.liste.filter(t => !t.passt), groesste = L.liste.reduce((a, t) => Math.max(a, ...t.s), 0);
  el.innerHTML = L.info.zeilen.join('<br>') +
    (L.info.warn.length ? '<br>' + L.info.warn.map(x => `<span style="color:#e8a33d">⚠ ${x}</span>`).join('<br>') : '') +
    `<br><b>${L.n} Druckteile</b> (inkl. ${L.info.stifte} Steckstifte Ø ${_ADV_STIFT_D} × ${L.info.stiftL} mm), ca. <b>${(L.gramm / 1000).toFixed(1)} kg</b> Filament (15 % Füllung). ` +
    (zu.length ? `<span style="color:#e86a5a">⚠ Passt nicht aufs Bett (${_advP.g.bett} mm): ${zu.map(t => t.name + ' ' + t.s.map(x => Math.round(x)).join('×')).join(', ')}</span>`
               : `<span style="color:#7cc47c">✓ Alle Teile passen aufs Bett ${_advP.g.bett}³ (größtes Maß ${Math.round(groesste)} mm).</span>`) +
    `<br><b>Druck:</b> ${F.druck} PLA, 0,2 mm Schicht. Zuerst <b>ein Fach + ein Rahmenteil probedrucken</b> und „Spiel“/„Konus“ anpassen.`;
}
async function _advCreate(exportieren){
  const p = _advParams(), F = _advForm(), druck = exportieren || _advP.ansicht === 'druck';
  _progressShow('Adventskalender wird gebaut…'); _progressSet(8); _progressCreep(90, 0.6);
  try {
    if (!_advFont()) await Promise.race([new Promise(r => _npLoadFont('baloo_local', () => r())), new Promise(r => setTimeout(r, 4000))]);
    if (!_advFont()) notify('Schrift für die Zahlen fehlt — Fächer entstehen ohne Zahlen', 'w');
    const w = await _mfInit(); await new Promise(res => setTimeout(res, 30));
    const r = F.build(w, p, _advText);
    saveUndo();
    typeCounts['advent'] = (typeCounts['advent'] || 0) + 1;
    const nr = typeCounts['advent'], meshes = [];
    let x = 0, z = 0, zeileT = 0; const zeileB = 1100;                     // Druckteile in Reihen auslegen (mm)
    for (const t of r.teile) {
      let mf = druck ? t.d : t.m;
      if (!mf) { t.d.delete(); continue; }
      const geo = _mfToGeo(mf).toNonIndexed();
      if (druck) {
        geo.rotateX(-Math.PI / 2);                                         // Drucklage z oben → App y oben
        geo.computeBoundingBox(); const b = geo.boundingBox, bx = b.max.x - b.min.x, bz = b.max.z - b.min.z;
        if (x > 0 && x + bx > zeileB) { x = 0; z += zeileT + 15; zeileT = 0; }
        geo.translate(x - b.min.x, -b.min.y, z - b.min.z); x += bx + 15; zeileT = Math.max(zeileT, bz);
      }
      t.d.delete(); if (t.m) t.m.delete();
      geo.scale(0.1, 0.1, 0.1); _creaseNormals(geo, 40);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(t.farbe), roughness: 0.6, metalness: 0.02, side: THREE.DoubleSide }));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { id: idCtr++, type: 'custom', shapeType: 'custom', name: t.name + ' #' + nr, color: t.farbe, isHole: false, fillet: 0, chamfer: 0, displacementPattern: 'keine', adventParams: { ...p, form: F.id }, edgeAngle: 40 };
      scene.add(mesh); objects.push(mesh); _updateObjEdgeLines(mesh); meshes.push(mesh);
    }
    if (druck && meshes.length) {                                          // Auslage auf die Platte mitten
      const bb = new THREE.Box3(); meshes.forEach(m => bb.union(new THREE.Box3().setFromObject(m))); const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      meshes.forEach(m => { m.geometry.translate(-cx, 0, -cz); m.geometry.computeBoundingBox(); m.geometry.computeBoundingSphere(); _updateObjEdgeLines(m); });
    }
    selectObjs(meshes); updateTree(); fitToObjects(meshes);
    _progressDone();
    notify(`Adventskalender ${F.icon} ${F.name} erstellt ✓ ${meshes.length} ${druck ? 'Druckteile in Drucklage' : 'Teile zusammengebaut'}`, 'ok');
    _advClose();
    if (exportieren) setTimeout(() => exportPartsSTL(), 50);
  } catch (e) { console.error('Adventskalender:', e); _progressHide(); notify('Adventskalender fehlgeschlagen: ' + (e && e.message || e), 'w'); }
}
