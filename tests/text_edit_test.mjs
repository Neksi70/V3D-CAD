// Ralf 19.9.26: "Ich mach mir Boxen für meine Ersatzteile und muss immer nur den
// Text ändern — alten Text löschen, neuen erstellen und positionieren. Ist es
// möglich, den Text anzuklicken und direkt zu ändern?"
// Prüft: Text auf Box-Wand heften → Doppelklick → neuer Wortlaut → Lage, Drehung,
// Buchstabenhöhe, Tiefe und Wandanlage bleiben; ✏️-Knopf; Rückgängig; Speichern/
// Laden; Bogen-Text; auf eine Rundung gewickelter Text.
import { chromium } from 'playwright';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { hideStarter?.(); document.getElementById('start-modal')?.classList.remove('show'); document.getElementById('auth-overlay')?.classList.add('hidden'); });
const fails = [];
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };

// Text über den echten Dialog anlegen
async function textAnlegen(txt, groesse, modus = 'free') {
  await pg.evaluate(() => addTextShape());
  await pg.evaluate(m => _text3dSetMode(m), modus);
  await pg.fill('#text3d-input', txt);
  await pg.evaluate(g => { const s = document.getElementById('text3d-size'); s.value = g; s.dispatchEvent(new Event('input')); }, groesse);
  await pg.click('#text3d-ok');
  await pg.waitForFunction(t => objects.some(o => o.userData.textEdit && o.userData.textEdit.str === t), txt, { timeout: 30000 });
}
// Maße eines Motivs in seinem eigenen Rahmen (Breite = lokal X, Höhe = Motiv-oben, Tiefe = Normale)
const mass = name => pg.evaluate(name => {
  const m = objects.find(o => o.userData.textEdit && o.userData.textEdit.str === name);
  if (!m) return null;
  m.updateMatrixWorld(true);
  const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(m.quaternion).normalize();
  const up = new THREE.Vector3(0, 0, -1).applyQuaternion(m.quaternion).normalize();
  const n  = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion).normalize();
  const p = m.geometry.attributes.position, v = new THREE.Vector3();
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
    [ax, up, n].forEach((a, k) => { const d = v.dot(a); if (d < lo[k]) lo[k] = d; if (d > hi[k]) hi[k] = d; });
  }
  const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
  const r = x => +(x * 10).toFixed(2);   // mm
  return { breite: r(hi[0] - lo[0]), hoehe: r(hi[1] - lo[1]), tiefe: r(hi[2] - lo[2]),
           mitteQuer: r((hi[0] + lo[0]) / 2), mitteHoch: r((hi[1] + lo[1]) / 2), aussen: r(hi[2]), innen: r(lo[2]),
           n: n.toArray().map(x => +x.toFixed(3)), quat: m.quaternion.toArray().map(x => +x.toFixed(4)),
           name: m.userData.name, c: c.toArray().map(r) };
}, name);

// ── 1. Box + Text, auf die Vorderwand heften ────────────────────────────
await pg.evaluate(() => {
  addShape('box'); const box = objects[objects.length - 1]; box.scale.set(5, 3, 3); box.userData.name = 'Box';
  box.position.set(0, 3, 0); box.updateMatrixWorld(true);
});
await textAnlegen('Schrauben', 8);
await pg.evaluate(() => {
  const m = objects.find(o => o.userData.textEdit);
  const box = objects.find(o => o.userData.name === 'Box');
  box.position.set(0, 3, 0); box.updateMatrixWorld(true);   // Neuanlage rückt Vorhandenes beiseite
  m.position.set(0, 0.15, 16); m.updateMatrixWorld(true);
  orbitTarget.set(0, 3, 0); sph.theta = 0; sph.phi = 1.25; sph.r = 44; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]);
});
const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const ctrW = () => pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.textEdit)).toArray());
async function drag(from, to, steps = 14) {
  await pg.mouse.move(from.x, from.y); await pg.mouse.down();
  for (let i = 1; i <= steps; i++) { await pg.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pg.waitForTimeout(20); }
  await pg.mouse.up(); await pg.waitForTimeout(200);
}
await pg.evaluate(() => {
  const box = objects.find(o => o.userData.name === 'Box'), m = objects.find(o => o.userData.textEdit);
  const rc = new THREE.Raycaster(new THREE.Vector3(0.5, 3.5, 30), new THREE.Vector3(0, 0, -1));
  _svgSnapHit = rc.intersectObject(box, true).find(h => h.face);
  _applySvgSnap(m, { obj: box, type: 'flat' });
  m.updateMatrixWorld(true);
});
const vorher = await mass('Schrauben');
const wandZ = await pg.evaluate(() => new THREE.Box3().setFromObject(objects.find(o => o.userData.name === 'Box')).max.z * 10);
console.log('1. geheftet:', JSON.stringify(vorher));
ok('Text liegt auf der Vorderwand', vorher.n[2] > 0.99 && vorher.innen < wandZ && vorher.aussen > wandZ, { wandZ, ...vorher });
ok('Buchstabenhöhe = 8 mm', Math.abs(vorher.hoehe - 8) < 0.05, vorher.hoehe);

// Text etwas zur Seite schieben (per Eingabe), damit „Lage bleibt" mehr als die Mitte prüft
await pg.evaluate(() => { const m = objects.find(o => o.userData.textEdit); m.position.x += 0.7; m.updateMatrixWorld(true); });
const lageVorher = await mass('Schrauben');

// ── 2. ✏️-Knopf erscheint bei Auswahl ────────────────────────────────────
await pg.evaluate(() => selectObjs([objects.find(o => o.userData.textEdit)]));
const knopf = await pg.evaluate(() => getComputedStyle(document.getElementById('ctx-textedit')).display !== 'none');
ok('✏️-Knopf in der Kontextleiste sichtbar', knopf);
await pg.evaluate(() => selectObjs([objects.find(o => o.userData.name === 'Box')]));
const knopfBox = await pg.evaluate(() => getComputedStyle(document.getElementById('ctx-textedit')).display !== 'none');
ok('✏️-Knopf bei der Box NICHT sichtbar', !knopfBox);

// ── 3. Doppelklick auf den Text öffnet den Dialog vorbefüllt ─────────────
const p = await scr((await pg.evaluate(() => _svgCenterWorld(objects.find(o => o.userData.textEdit)).toArray())).map(x => x));
// Punkt auf einem Buchstaben suchen
const treff = await pg.evaluate(({ x, y }) => {
  const m = objects.find(o => o.userData.textEdit);
  for (let d = 0; d <= 60; d += 2) for (const [ox, oy] of [[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,-d]]) {
    const h = pickObjects({ clientX: x + ox, clientY: y + oy });
    if (h.length && h[0].object === m) return { x: x + ox, y: y + oy };
  }
  return null;
}, p);
ok('Buchstabe im Bild getroffen', !!treff, treff);
await pg.mouse.dblclick(treff.x, treff.y); await pg.waitForTimeout(200);
const dlg = await pg.evaluate(() => ({
  offen: document.getElementById('text3d-modal').classList.contains('show'),
  wert: document.getElementById('text3d-input').value,
  titel: document.querySelector('#text3d-box h3').textContent,
  knopf: document.getElementById('text3d-ok').textContent,
  groesse: document.getElementById('text3d-size').value,
  modusLeiste: document.getElementById('text3d-mode-bg').style.display
}));
ok('Doppelklick öffnet „Text ändern" mit altem Text', dlg.offen && dlg.wert === 'Schrauben' && /ändern/.test(dlg.titel) && /Übernehmen/.test(dlg.knopf), dlg);
ok('Größe vorbefüllt (8)', +dlg.groesse === 8, dlg.groesse);

// ── 4. Neuer Wortlaut übernehmen ─────────────────────────────────────────
const nObj0 = await pg.evaluate(() => objects.length);
await pg.fill('#text3d-input', 'Muttern M8 + Scheiben');
await pg.click('#text3d-ok');
await pg.waitForFunction(() => objects.some(o => o.userData.textEdit && o.userData.textEdit.str === 'Muttern M8 + Scheiben'), null, { timeout: 30000 });
const nachher = await mass('Muttern M8 + Scheiben');
console.log('4. geändert:', JSON.stringify(nachher));
ok('kein zusätzliches Objekt', await pg.evaluate(() => objects.length) === nObj0);
ok('Drehung unverändert', nachher.quat.every((q, i) => Math.abs(q - lageVorher.quat[i]) < 1e-4), { vor: lageVorher.quat, nach: nachher.quat });
ok('Mitte in der Fläche unverändert', Math.abs(nachher.mitteQuer - lageVorher.mitteQuer) < 0.3 && Math.abs(nachher.mitteHoch - lageVorher.mitteHoch) < 1.5,
   { vor: [lageVorher.mitteQuer, lageVorher.mitteHoch], nach: [nachher.mitteQuer, nachher.mitteHoch] });
ok('Tiefe/Wandanlage unverändert', Math.abs(nachher.aussen - lageVorher.aussen) < 0.02 && Math.abs(nachher.innen - lageVorher.innen) < 0.02,
   { vor: [lageVorher.innen, lageVorher.aussen], nach: [nachher.innen, nachher.aussen] });
ok('Buchstaben gleich groß (Höhe 8 mm bei gleicher Ober-/Unterlänge)', Math.abs(nachher.hoehe - 8) < 0.3, nachher.hoehe);
ok('Text ist länger geworden', nachher.breite > lageVorher.breite * 1.8, { vor: lageVorher.breite, nach: nachher.breite });
ok('Name folgt dem Text', /^Muttern M8 \+ Scheiben/.test(nachher.name), nachher.name);
ok('Auswahl bleibt auf dem Text', await pg.evaluate(() => selectedObjs.length === 1 && selectedObjs[0].userData.textEdit.str === 'Muttern M8 + Scheiben'));

// Gravur-Weg (Abziehen) muss mit den neuen Pfaddaten arbeiten: Pfad-Mitte = Geometrie-Mitte
const konsistent = await pg.evaluate(() => {
  const m = objects.find(o => o.userData.textEdit);
  const g = _svgRebuildGeo(m.userData); g.computeBoundingBox();
  const h = m.geometry; h.computeBoundingBox();
  return g.boundingBox.min.distanceTo(h.boundingBox.min) + g.boundingBox.max.distanceTo(h.boundingBox.max);
});
ok('Geometrie = Neuaufbau aus Pfaddaten (Speichern/Gravur)', konsistent < 1e-5, konsistent);

// ── 5. Rückgängig holt den alten Text zurück ─────────────────────────────
await pg.evaluate(() => undo()); await pg.waitForTimeout(300);
const nachUndo = await pg.evaluate(() => objects.filter(o => o.userData.textEdit).map(o => o.userData.textEdit.str));
ok('Rückgängig → wieder „Schrauben"', nachUndo.length === 1 && nachUndo[0] === 'Schrauben', nachUndo);
const undoMass = await mass('Schrauben');
ok('… an alter Stelle und alter Größe', undoMass && Math.abs(undoMass.breite - lageVorher.breite) < 0.05 && Math.abs(undoMass.mitteQuer - lageVorher.mitteQuer) < 0.05, undoMass);

// ── 6. Speichern/Laden behält die Änderbarkeit ───────────────────────────
const rt = await pg.evaluate(() => {
  const m = objects.find(o => o.userData.textEdit);
  const d = JSON.parse(JSON.stringify(objectToData(m)));
  const o2 = buildObjectFromData(d);
  return { te: o2.userData.textEdit, editierbar: _textEditable(o2) };
});
ok('Speichern/Laden: textEdit bleibt', rt.editierbar && rt.te && rt.te.str === 'Schrauben' && rt.te.size === 8, rt);

// ── 7. Größe im Dialog ändern wirkt ──────────────────────────────────────
await pg.evaluate(() => editTextObj(objects.find(o => o.userData.textEdit)));
await pg.fill('#text3d-input', 'Dübel');
await pg.evaluate(() => { const s = document.getElementById('text3d-size'); s.value = 12; s.dispatchEvent(new Event('input')); });
await pg.click('#text3d-ok');
await pg.waitForFunction(() => objects.some(o => o.userData.textEdit && o.userData.textEdit.str === 'Dübel'), null, { timeout: 30000 });
const groesser = await mass('Dübel');
ok('neue Größe 12 mm übernommen', Math.abs(groesser.hoehe - 12) < 0.3, groesser.hoehe);
ok('… Wandanlage weiter unverändert', Math.abs(groesser.aussen - lageVorher.aussen) < 0.02 && Math.abs(groesser.innen - lageVorher.innen) < 0.02, [groesser.innen, groesser.aussen]);

// ── 8. Neues Erstellen ist danach wieder „Erstellen" (kein Ändern-Rest) ──
await pg.evaluate(() => addTextShape());
const neu = await pg.evaluate(() => ({ knopf: document.getElementById('text3d-ok').textContent,
  leiste: document.getElementById('text3d-mode-bg').style.display, wert: document.getElementById('text3d-input').value }));
ok('Erstellen-Dialog wieder normal', /Erstellen/.test(neu.knopf) && neu.leiste === '' && neu.wert === '', neu);
await pg.evaluate(() => _closeText3d());

// ── 9. Bogen-Text ────────────────────────────────────────────────────────
await textAnlegen('OBEN', 6, 'arc');
const bogenVor = await pg.evaluate(() => { const m = objects.find(o => o.userData.textEdit && o.userData.textEdit.str === 'OBEN'); return { mode: m.userData.textEdit.mode, pos: m.position.toArray() }; });
ok('Bogen-Text merkt Modus', bogenVor.mode === 'arc', bogenVor);
await pg.evaluate(() => editTextObj(objects.find(o => o.userData.textEdit && o.userData.textEdit.str === 'OBEN')));
const bogenDlg = await pg.evaluate(() => getComputedStyle(document.getElementById('text3d-arc-opts')).display);
ok('Bogen-Optionen im Ändern-Dialog sichtbar', bogenDlg !== 'none', bogenDlg);
await pg.fill('#text3d-input', 'UNTEN LINKS');
await pg.click('#text3d-ok');
await pg.waitForFunction(() => objects.some(o => o.userData.textEdit && o.userData.textEdit.str === 'UNTEN LINKS'), null, { timeout: 30000 });
const bogenNach = await pg.evaluate(() => { const m = objects.find(o => o.userData.textEdit && o.userData.textEdit.str === 'UNTEN LINKS'); return { mode: m.userData.textEdit.mode, pos: m.position.toArray() }; });
ok('Bogen bleibt Bogen, Lage bleibt', bogenNach.mode === 'arc' && bogenNach.pos.every((v, i) => Math.abs(v - bogenVor.pos[i]) < 1e-6), bogenNach);
ok('Auswahl-Modus fürs nächste Erstellen unverstellt', await pg.evaluate(() => _text3dMode) === 'arc');
await pg.evaluate(() => _text3dSetMode('free'));

// ── 10. Auf Rundung gewickelter Text ─────────────────────────────────────
const wr = await pg.evaluate(async () => {
  objects.slice().forEach(o => { scene.remove(o); }); objects.length = 0; selectObjs([]);
  addShape('cylinder'); const cyl = objects[objects.length - 1]; cyl.scale.set(3, 3, 3);
  cyl.position.set(0, 3, 0); cyl.updateMatrixWorld(true);
  return true;
});
await textAnlegen('Becher', 8);
const wrap = await pg.evaluate(() => {
  const cyl = objects.find(o => !o.userData.textEdit), m = objects.find(o => o.userData.textEdit);
  cyl.position.set(0, 3, 0); cyl.updateMatrixWorld(true);   // Neuanlage rückt Vorhandenes beiseite
  const bb = new THREE.Box3().setFromObject(cyl);
  const R = (bb.max.x - bb.min.x) / 2, yMid = (bb.min.y + bb.max.y) / 2;
  const pt = new THREE.Vector3(0, yMid, R);
  const probe = _svgWrapProbe(cyl, pt);
  if (!probe) return { fehler: 'keine Rundung' };
  const r = _svgWrapApply(m, probe, pt);
  m.updateMatrixWorld(true);
  return { ok: r !== false && !!m.userData._svgWrap, R };
});
ok('Text auf Zylinder gewickelt', wrap.ok, wrap);
const radial = name => pg.evaluate(name => {
  const m = objects.find(o => o.userData.textEdit && o.userData.textEdit.str === name);
  m.updateMatrixWorld(true);
  const p = m.geometry.attributes.position, v = new THREE.Vector3();
  let rMin = Infinity, rMax = -Infinity, yMin = Infinity, yMax = -Infinity, aMin = Infinity, aMax = -Infinity;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
    const r = Math.hypot(v.x, v.z), a = Math.atan2(v.x, v.z);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); yMin = Math.min(yMin, v.y); yMax = Math.max(yMax, v.y);
    aMin = Math.min(aMin, a); aMax = Math.max(aMax, a);
  }
  const f = x => +(x * 10).toFixed(2);
  return { rMin: f(rMin), rMax: f(rMax), hoehe: f(yMax - yMin), yMitte: f((yMax + yMin) / 2), winkel: +((aMax - aMin) * 180 / Math.PI).toFixed(1) };
}, name);
const wVor = await radial('Becher');
await pg.evaluate(() => editTextObj(objects.find(o => o.userData.textEdit)));
await pg.fill('#text3d-input', 'Kaffeebecher');
await pg.click('#text3d-ok');
await pg.waitForFunction(() => objects.some(o => o.userData.textEdit && o.userData.textEdit.str === 'Kaffeebecher'), null, { timeout: 30000 });
const wNach = await radial('Kaffeebecher');
console.log('10. gewickelt vorher/nachher:', JSON.stringify(wVor), JSON.stringify(wNach));
ok('gewickelt: bleibt gewickelt', await pg.evaluate(() => !!objects.find(o => o.userData.textEdit).userData._svgWrap));
ok('gewickelt: gleiche Wandlage (innen/außen)', Math.abs(wNach.rMin - wVor.rMin) < 0.1 && Math.abs(wNach.rMax - wVor.rMax) < 0.1, { wVor, wNach });
ok('gewickelt: gleiche Buchstabenhöhe', Math.abs(wNach.hoehe - wVor.hoehe) < 0.4 && Math.abs(wNach.yMitte - wVor.yMitte) < 1.5, { wVor, wNach });
ok('gewickelt: längerer Bogen', wNach.winkel > wVor.winkel * 1.5, { vor: wVor.winkel, nach: wNach.winkel });

ok('keine Seitenfehler', errs.length === 0, errs);
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
