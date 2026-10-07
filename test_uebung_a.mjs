// Übung A (Grundkurs 08.10.2026, Folie 17): Box mit Schiebedeckel – Schritt für Schritt wie im Kurs.
// Läuft gegen die AUSGELIEFERTE App (Port 8765, dist) mit selbst ausgestelltem Sitzungs-Cookie,
// damit genau das geprüft wird, was die Teilnehmer morgen bedienen. V3D_URL=… für anderen Stand.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'child_process';

const URL = process.env.V3D_URL || 'http://localhost:8765/volme3d.html';
const cookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('uebung-a','test@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
const OUT = process.env.OUT || '/tmp';

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/' }]);
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const meldungen = [];
pg.on('console', m => { const t = m.text(); if (/fehler|error|warn/i.test(m.type() + t)) meldungen.push(m.type() + ': ' + t.slice(0, 160)); });
const log = (...a) => console.log(...a);

try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof addShape === 'function' && typeof numChanged === 'function', null, { timeout: 30000 });
  log('Version:', await pg.evaluate(() => (typeof APP_VERSION !== 'undefined' ? APP_VERSION : (document.title || '?'))));
  await pg.evaluate(() => { hideStarter(); _newCreate(false); });

  // Hilfen im Seitenkontext: Bauteil anlegen wie im UI (Form → Maße in mm), Bounding-Box in mm lesen
  await pg.evaluate(() => {
    window._ua = {
      box(w, d, h) { addShape('box'); const o = objects[objects.length - 1]; selectObjs([o]); numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); return o; },
      bb(o) { o.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(o); return { min: bx.min.toArray().map(v => +(v * 10).toFixed(2)), max: bx.max.toArray().map(v => +(v * 10).toFixed(2)), size: bx.getSize(new THREE.Vector3()).toArray().map(v => +(v * 10).toFixed(2)) }; },
      // so wie der Nutzer: Positionsfelder ausfüllen und Enter (applyTF)
      pos(o, x, y, z) { selectObjs([o]); updateTFInputs(); const s = (id, v) => { document.getElementById(id).value = v; }; s('px', x); s('py', y); s('pz', z); applyTF(); },
      // Unterkante/Lage in mm setzen (Hilfsrechnung, um Ergebnis-Geometrie zu prüfen)
      setMin(o, xmm, ymm, zmm) { selectObjs([o]); o.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(o); const w = o.getWorldPosition(new THREE.Vector3()); w.x += xmm / 10 - bx.min.x; w.y += ymm / 10 - bx.min.y; w.z += zmm / 10 - bx.min.z; o.position.copy(o.parent ? o.parent.worldToLocal(w) : w); o.updateMatrixWorld(true); },
      bohrung(o) { selectObjs([o]); setObjMode('hole'); return !!o.userData.isHole; },
      bbNetz(o) { o.updateMatrixWorld(true); const g = o.geometry; g.computeBoundingBox(); const bx = g.boundingBox.clone().applyMatrix4(o.matrixWorld); return { min: bx.min.toArray().map(v => +(v * 10).toFixed(2)), max: bx.max.toArray().map(v => +(v * 10).toFixed(2)) }; },
      kinder(o) { const r = []; o.traverse(n => { if (n !== o) { const bx = new THREE.Box3().setFromObject(n); r.push(n.type + (n.userData && n.userData.isEdgeLines ? '(Kanten)' : '') + ':' + (bx.isEmpty() ? '-' : bx.min.toArray().concat(bx.max.toArray()).map(v => +(v * 10).toFixed(1)).join(','))); } }); return r; },
      vol(o) { const g = o.geometry, p = g.attributes.position, ix = g.index; o.updateMatrixWorld(true); const m = o.matrixWorld; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(); let v = 0; const n = ix ? ix.count : p.count;
        for (let t = 0; t < n; t += 3) { A.fromBufferAttribute(p, ix ? ix.getX(t) : t).applyMatrix4(m); B.fromBufferAttribute(p, ix ? ix.getX(t + 1) : t + 1).applyMatrix4(m); C.fromBufferAttribute(p, ix ? ix.getX(t + 2) : t + 2).applyMatrix4(m); v += A.dot(B.clone().cross(C)) / 6; } return +(v * 1000).toFixed(0); },
      dicht(o) { const g = o.geometry, p = g.attributes.position, ix = g.index; const key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e4)).join(','); const kanten = new Map(); const n = ix ? ix.count : p.count;
        for (let t = 0; t < n; t += 3) { const k = [0, 1, 2].map(j => key(ix ? ix.getX(t + j) : t + j)); for (let j = 0; j < 3; j++) { const a = k[j], c = k[(j + 1) % 3]; const e = a < c ? a + '|' + c : c + '|' + a; kanten.set(e, (kanten.get(e) || 0) + 1); } }
        let offen = 0; for (const c of kanten.values()) if (c !== 2) offen++; return offen; },
    };
  });

  // ---- Schritt 0: Einheiten der Felder prüfen (Stolperstein?)
  const einheiten = await pg.evaluate(() => {
    const o = _ua.box(20, 20, 20); _ua.setMin(o, 0, 0, 0);
    selectObjs([o]); updateTFInputs();
    const vorher = _ua.bb(o).min[1];
    _ua.pos(o, document.getElementById('px').value, 2, document.getElementById('pz').value);   // „2“ eingetippt
    const nachher = _ua.bb(o);
    const erg = { feldPy: document.getElementById('py').value, unterkanteVorher: vorher, unterkanteNachher: nachher.min[1], mitte: nachher.min[1] + nachher.size[1] / 2 };
    deleteSelected ? (selectObjs([o]), deleteSelected()) : null;
    return erg;
  });
  log('Einheiten-Check (Position Y = 2 eingetippt):', JSON.stringify(einheiten));
  await pg.evaluate(() => { _newCreate(false); });

  // ---- Schritt 1: Box 80 × 60 × 35, Hohlraum 74 × 54 × 33 als Bohrung von oben
  const s1 = await pg.evaluate((BH) => {
    const A = _ua.box(80, 60, 35); _ua.setMin(A, -40, 0, -30);
    setShapeMode('hole'); const B = _ua.box(74, 54, BH); _ua.bohrung(B); setShapeMode('solid');
    // ausrichten wie im Kurs: beide wählen → mittig X / mittig Z, dann Höhe 2 mm
    selectObjs([A, B]);
    const al = typeof alignObjects === 'function';
    if (al) { alignObjects('xcenter'); alignObjects('zcenter'); }
    const dx = -40 - _ua.bb(A).min[0], dz = -30 - _ua.bb(A).min[2];   // Ausrichten verschiebt ggf. beide → zurück auf Ursprung
    for (const o of [A, B]) { const bb = _ua.bb(o); _ua.setMin(o, bb.min[0] + dx, bb.min[1], bb.min[2] + dz); }
    const bb0 = _ua.bb(B);
    _ua.setMin(B, bb0.min[0], 2, bb0.min[2]);
    return { A: _ua.bb(A), B: _ua.bb(B), B_netz: _ua.bbNetz(B), B_kinder: _ua.kinder(B), ausrichten: al, istBohrung: !!B.userData.isHole };
  }, +(process.env.B_H || 33));
  log('Schritt 1:', JSON.stringify(s1)); 

  // ---- Schritt 2: Nut 78 × 56 × 3,4 als Bohrung, 2 mm unter der Oberkante, nach vorne (+Z) offen
  // ---- Schritt 3: Stirnwand oberhalb der Nut auf Nutbreite abziehen
  const s23 = await pg.evaluate((DZ) => {
    setShapeMode('hole'); const C = _ua.box(78, 56, 3.4); _ua.bohrung(C);
    _ua.setMin(C, -39, 35 - 2 - 3.4, 30 - 56);      // hinten 56 mm von vorn, vorn bündig mit der Front (z = +30)
    const D = _ua.box(78, 4, 4); _ua.bohrung(D); setShapeMode('solid');
    _ua.setMin(D, -39, 33, DZ);                      // Front-Wand (z 27…30) oberhalb der Nut (y 33…35), etwas Übermaß
    return { C: _ua.bb(C), D: _ua.bb(D) };
  }, +(process.env.D_Z || 27));
  log('Schritt 2+3 Bohrungen:', JSON.stringify(s23));

  // alles wählen → Abziehen (fire-and-forget → pollen)
  const t0 = Date.now();
  log('Vor dem Abziehen (Netz):', JSON.stringify(await pg.evaluate(() => objects.map(o => (o.userData.isHole ? 'H ' : 'K ') + JSON.stringify(_ua.bbNetz(o))))));
  log('Nach Auswahl aller (Netz):', JSON.stringify(await pg.evaluate(() => { selectObjs(objects.slice()); return objects.map(o => (o.userData.isHole ? 'H ' : 'K ') + JSON.stringify(_ua.bbNetz(o))); })));
  log('Snap:', await pg.evaluate(() => typeof snapGrid !== 'undefined' ? snapGrid : '?'));
  await pg.evaluate(() => { selectObjs(objects.slice()); subtractHoles(); });
  for (let i = 0; i < 36; i++) {
    await pg.waitForTimeout(5000);
    const st = await pg.evaluate(() => ({ n: objects.length, holes: objects.filter(o => o.userData.isHole).length,
      modale: [...document.querySelectorAll('.modal.show, [id$="-modal"].show, .show')].map(e => e.id || e.className).slice(0, 5),
      toast: [...document.querySelectorAll('#notif, .notif, .toast, #toast')].map(e => e.textContent.trim().slice(0, 120)).filter(Boolean).slice(-3),
      busy: typeof _boolBusy !== 'undefined' ? _boolBusy : '?' }));
    log('  warte', (i + 1) * 5, 's', JSON.stringify(st));
    if (st.n === 1 && !st.holes) break;
  }
  await pg.waitForTimeout(500);
  const box = await pg.evaluate(() => { const o = objects[0]; return { bb: _ua.bb(o), vol: _ua.vol(o), offeneKanten: _ua.dicht(o), engine: o.userData._boolEngine || o.userData.opJournal?.engine || '?' }; });
  // Erwartung (mm³): Außen − Hohlraum − Nut-Anteil in den Wänden − Stirnwand-Ausschnitt
  const ix = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
  const vBox = (x, y, z) => ix(x[0], x[1]) * ix(y[0], y[1]) * ix(z[0], z[1]);
  const aussen = { x: [-40, 40], y: [0, 35], z: [-30, 30] };
  const holes = [{ x: [-37, 37], y: [2, 35], z: [-27, 27] }, { x: [-39, 39], y: [29.6, 33], z: [-26, 30] }, { x: [-39, 39], y: [33, 37], z: [27, 31] }];
  const clip = h => ({ x: [Math.max(h.x[0], aussen.x[0]), Math.min(h.x[1], aussen.x[1])], y: [Math.max(h.y[0], aussen.y[0]), Math.min(h.y[1], aussen.y[1])], z: [Math.max(h.z[0], aussen.z[0]), Math.min(h.z[1], aussen.z[1])] });
  const vol = h => Math.max(0, h.x[1] - h.x[0]) * Math.max(0, h.y[1] - h.y[0]) * Math.max(0, h.z[1] - h.z[0]);
  const schnitt = (a, b) => ({ x: [Math.max(a.x[0], b.x[0]), Math.min(a.x[1], b.x[1])], y: [Math.max(a.y[0], b.y[0]), Math.min(a.y[1], b.y[1])], z: [Math.max(a.z[0], b.z[0]), Math.min(a.z[1], b.z[1])] });
  const H = holes.map(clip);
  let weg = 0; // Inklusion–Exklusion über 3 Boxen
  for (let i = 0; i < 3; i++) weg += vol(H[i]);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) weg -= vol(schnitt(H[i], H[j]));
  weg += vol(schnitt(schnitt(H[0], H[1]), H[2]));
  const soll = 80 * 60 * 35 - weg;
  const ebenen = await pg.evaluate(() => { const o = objects[0]; o.updateMatrixWorld(true); const p = o.geometry.attributes.position, v = new THREE.Vector3(); const ys = new Set(), xs = new Set(), zs = new Set();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); ys.add(+(v.y * 10).toFixed(2)); xs.add(+(v.x * 10).toFixed(2)); zs.add(+(v.z * 10).toFixed(2)); }
    const so = s => [...s].sort((a, b) => a - b); return { y: so(ys), x: so(xs), z: so(zs) }; });
  log('Ebenen der fertigen Box (mm):', JSON.stringify(ebenen));
  log('Box nach Abziehen:', JSON.stringify(box), '| Soll-Volumen', soll.toFixed(0), 'mm³ | Abweichung', ((box.vol - soll) / soll * 100).toFixed(2) + ' %');

  // ---- Schritt 4: Deckel – Kopie der Nut mit Spielraum −0,2 mm (Werkzeug ⧈) vs. Folienmaß 77,8 × 55,6 × 3
  const s4 = await pg.evaluate(() => {
    const L = _ua.box(78, 56, 3.4); _ua.setMin(L, -39, 50, -26);   // frei daneben/darüber
    selectObjs([L]);
    _offsetApply(-0.2);
    return { nachSpielraum: _ua.bb(L), offeneKanten: _ua.dicht(L) };
  });
  log('Schritt 4 Deckel (Nut-Kopie, Spielraum −0,2):', JSON.stringify(s4));

  // ---- Schritt 4b: Name als Text vertieft in den Deckel (Text als Bohrung, 0,8 mm tief)
  const vorText = await pg.evaluate(() => { const L = objects[objects.length - 1]; return { n: objects.length, vol: _ua.vol(L) }; });
  await pg.evaluate(() => { setShapeMode('hole'); addTextShape(); document.getElementById('text3d-input').value = 'ANNA'; _text3dSetMode('free'); document.getElementById('text3d-size').value = 10; _confirmText3d(); });
  for (let i = 0; i < 8; i++) { await pg.waitForTimeout(2000); const st = await pg.evaluate(() => ({ n: objects.length, modus: typeof _text3dMode !== 'undefined' ? _text3dMode : '?', modal: document.getElementById('text3d-modal').className, hint: (document.getElementById('hint') || {}).textContent, toast: [...document.querySelectorAll('#notif, .notif, .toast, #toast')].map(e => e.textContent.trim().slice(0, 140)).filter(Boolean).slice(-2) })); log('  Text', (i + 1) * 2, 's', JSON.stringify(st)); if (st.n > vorText.n) break; }
  await pg.waitForFunction(n => objects.length > n, vorText.n, { timeout: 5000 });
  const txt = await pg.evaluate(() => { setShapeMode('solid'); const T = objects[objects.length - 1], L = objects[objects.length - 2];
    const lb = _ua.bb(L), tb = _ua.bb(T);
    _ua.setMin(T, (lb.min[0] + lb.max[0]) / 2 - tb.size[0] / 2, lb.max[1] - 0.8, (lb.min[2] + lb.max[2]) / 2 - tb.size[2] / 2);
    return { textGroesse: tb.size, istBohrung: !!T.userData.isHole };
  });
  log('Text platziert:', JSON.stringify(txt), JSON.stringify(await pg.evaluate(() => objects.map(o => (o.userData.isHole ? 'H ' : 'K ') + (o.userData.type || '') + ' ' + JSON.stringify(_ua.bbNetz(o))))));
  await pg.evaluate(() => { const T = objects[objects.length - 1], L = objects[objects.length - 2]; selectObjs([L, T]); _engravePreset = { depth: 0.8, wantInlay: false, through: false }; subtractHoles().finally(() => { _engravePreset = null; }); });
  for (let i = 0; i < 24; i++) { await pg.waitForTimeout(5000); const st = await pg.evaluate(() => ({ n: objects.length, holes: objects.filter(o => o.userData.isHole).length, toast: [...document.querySelectorAll('#notif, .notif, .toast, #toast')].map(e => e.textContent.trim().slice(-160)).filter(Boolean).slice(-1) })); log('  Textabzug', (i + 1) * 5, 's', JSON.stringify(st)); if (st.n === vorText.n && !st.holes) break; }
  await pg.waitForTimeout(500);
  const deckel = await pg.evaluate(() => { const L = objects.find(o => _ua.bb(o).min[1] > 40); return { bb: L && _ua.bb(L), vol: L && _ua.vol(L), offeneKanten: L && _ua.dicht(L) }; });
  log('Schritt 4b Text vertieft:', JSON.stringify(txt), '| Deckel vorher', vorText.vol, 'mm³ → nachher', JSON.stringify(deckel));

  // ---- Schritt 5: Schnittansicht, Druck-Check
  const s5 = await pg.evaluate(async () => {
    const box = objects.find(o => _ua.bb(o).min[1] < 1); selectObjs([box]);
    let schnitt = 'ok'; try { sectionTool(); await new Promise(r => setTimeout(r, 600)); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) { schnitt = 'Fehler: ' + e.message; }
    let check = null; try { _printCheckOpen(); await new Promise(r => setTimeout(r, 1500)); const m = document.getElementById('printcheck-modal'); check = m ? m.innerText.replace(/\s+/g, ' ').slice(0, 600) : 'kein Dialog'; _printCheckClose && _printCheckClose(); } catch (e) { check = 'Fehler: ' + e.message; }
    return { schnitt, check };
  });
  log('Schritt 5 Schnitt:', s5.schnitt);
  log('Schritt 5 Druck-Check:', s5.check);

  log('Seitenfehler:', errs.slice(0, 5), '| Konsole:', meldungen.filter(m => !/GL Driver|GPU stall/.test(m)).slice(0, 6));
  await pg.screenshot({ path: OUT + '/uebung_a_1.png' });
} finally { await b.close(); }
