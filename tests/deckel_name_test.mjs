// Übung A, Punkt 4: Name in den Deckel – so wie die Kursteilnehmer es machen (echte Mausklicks).
// Deckel 78×56×3,4 → Spielraum −0,2 → „A Text“ → Namen tippen → ✓ Erstellen → dann
//   Weg K (Kursweg laut Hinweis): Stelle auf dem Deckel anklicken
//   Weg Z (wie im Kurs probiert): Text greifen und auf den Deckel ziehen
// SZENE=deckel (nur Deckel) | box (Box + Deckel daneben)   WEG=K|Z
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';

const PORT = +(process.env.PORT || 8861), SZENE = process.env.SZENE || 'deckel', WEG = process.env.WEG || 'K';
const URL = process.env.V3D_URL || `http://localhost:${PORT}/volme3d.html`;
let srv = null;
if (!process.env.V3D_URL) { srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' }); await new Promise(r => setTimeout(r, 1500)); }
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);
const shot = n => pg.screenshot({ path: `/tmp/deckel_${SZENE}_${WEG}_${n}.png` });
const zustand = () => pg.evaluate(() => {
  const t = objects.find(o => o.userData.shapeType === 'svg');
  const r = { objekte: objects.length, pick: !!_lblPick, pop: document.getElementById('lbl-pop').style.display === 'block',
    hinweis: document.getElementById('hint').classList.contains('show') ? document.getElementById('hint').innerText.slice(0, 90) : '' };
  if (t) { t.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(t);
    r.text = { mitte: bb.getCenter(new THREE.Vector3()).toArray().map(v => +(v * 10).toFixed(1)), unten: +(bb.min.y * 10).toFixed(2), oben: +(bb.max.y * 10).toFixed(2),
      geheftet: !!t.userData._snapNormal, ziel: t.userData._snapSolid ? t.userData._snapSolid.userData.name : null, ausgewaehlt: selectedObjs.includes(t) }; }
  return r;
});
// Weltpunkt (mm) → Bildschirm
const bild = (x, y, z) => pg.evaluate(([x, y, z]) => { const v = new THREE.Vector3(x / 10, y / 10, z / 10).project(camera); const r = canvas.getBoundingClientRect();
  return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, [x, y, z]);

try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
  const deckel = await pg.evaluate(async (SZENE) => {
    hideStarter(); _newCreate(false);
    const box = (w, d, h) => { addShape('box'); const o = objects[objects.length - 1]; selectObjs([o]); numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); return o; };
    setShapeMode('solid');
    if (SZENE === 'box') box(80, 60, 35);
    const L = box(78, 56, 3.4);
    selectObjs([L]); _offsetApply(-0.2); window._deckelId = L.userData.id;
    if (SZENE === 'seitlich') { L.position.x += 8; L.updateMatrixWorld(true); }
    deselect();
    const bbOf = o => { o.updateMatrixWorld(true); const x = new THREE.Box3().setFromObject(o); return [x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z].map(v => +(v * 10).toFixed(2)); };
    return { deckel: bbOf(L), alle: objects.map(o => o.userData.name + ' ' + JSON.stringify(bbOf(o))) };
  }, SZENE);
  log('Szene:', JSON.stringify(deckel.alle));
  const D = deckel.deckel, dm = [(D[0] + D[3]) / 2, D[4], (D[2] + D[5]) / 2];
  await pg.evaluate(() => { if (typeof fitAll === 'function') fitAll(); });
  await pg.mouse.move(5, 5); await pg.mouse.click(1490, 400); await pg.waitForTimeout(300);

  // „A Text“ wie im Kurs: Knopf → tippen → ✓ Erstellen
  const knopf = pg.locator('[onclick="addTextShape()"]').first();
  if (await knopf.isVisible()) await knopf.click(); else { log('(Text-Knopf nicht sichtbar → addTextShape())'); await pg.evaluate(() => addTextShape()); }
  await pg.waitForTimeout(400);
  log('Dialog-Modus vorgewählt:', await pg.evaluate(() => _text3dMode));
  await pg.fill('#text3d-input', 'Volker');
  await pg.locator('#text3d-modal button', { hasText: 'Erstellen' }).last().click();
  await pg.waitForFunction(() => objects.some(o => o.userData.shapeType === 'svg'), null, { timeout: 20000 });
  await pg.waitForTimeout(500);
  log('Nach Erstellen:', JSON.stringify(await zustand()));
  await shot('1_erstellt');

  // Deckel neu vermessen – wurde er beim Erstellen weggeschoben?
  const D2 = await pg.evaluate(() => { const L = objects.find(o => o.userData.id === window._deckelId); const x = new THREE.Box3().setFromObject(L); return [x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z].map(v => +(v * 10).toFixed(2)); });
  await pg.evaluate(() => { setView('iso'); fitView(); }); await pg.waitForTimeout(500);
  log('Deckel nach Text-Erstellen:', JSON.stringify(D2), D2[0] !== D[0] || D2[2] !== D[2] ? '→ VERSCHOBEN' : '(unverändert)');
  dm[0] = (D2[0] + D2[3]) / 2; dm[2] = (D2[2] + D2[5]) / 2;
  const ziel = await bild(dm[0] + 10, dm[1], dm[2]);
  if (WEG === 'K' || WEG === 'KZ') {
    await pg.mouse.move(ziel[0], ziel[1]); await pg.waitForTimeout(200);
    await pg.mouse.click(ziel[0], ziel[1]); await pg.waitForTimeout(600);
    log('Nach Klick auf Deckel:', JSON.stringify(await zustand()));
    if (WEG === 'KZ') {
    // zweiter Versuch: jetzt (Pick-Modus vorbei?) noch einmal ziehen
    const t2 = await pg.evaluate(() => { const t = objects.find(o => o.userData.shapeType === 'svg'); window._t=t; const c = new THREE.Box3().setFromObject(t).getCenter(new THREE.Vector3()); return [c.x * 10, c.y * 10, c.z * 10]; });
    let von2 = await bild(...t2);
    von2 = await pg.evaluate(([x0, y0]) => { const t = objects.find(o => o.userData.shapeType === 'svg'); const r = canvas.getBoundingClientRect();
      for (let d = 0; d < 40; d += 2) for (const [dx, dy] of [[d,0],[-d,0],[0,d],[0,-d]]) { const x = x0 + dx, y = y0 + dy;
        mousev.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); raycaster.setFromCamera(mousev, camera);
        const h = raycaster.intersectObjects(objects, true).filter(h => h.object.isMesh && !h.object.userData.isEdgeLines)[0]; if (h && h.object === t) return [x, y]; }
      return [x0, y0]; }, von2);
    const ziel2 = await bild(dm[0] - 15, dm[1], dm[2] + 10);
    log('unter dem Zeiger:', await pg.evaluate(([x,y]) => { const el = document.elementFromPoint(x,y); return el.tagName + '#' + el.id + '.' + el.className + ' ' + (el.title||'').slice(0,60); }, von2)); await pg.screenshot({ path: '/tmp/vor_zug2.png' });
    await pg.mouse.move(von2[0], von2[1]); await pg.mouse.down();
    for (let i = 1; i <= 15; i++) { await pg.mouse.move(von2[0] + (ziel2[0] - von2[0]) * i / 15, von2[1] + (ziel2[1] - von2[1]) * i / 15); await pg.waitForTimeout(30); }
    await pg.mouse.up(); await pg.waitForTimeout(600);
    log('Zweiter Zug:', JSON.stringify(await zustand()), JSON.stringify(await pg.evaluate(() => { const t = objects.find(o => o.userData.shapeType === 'svg'); return { scale: t.scale.toArray(), depth: t.userData.svgDepth, hole: t.userData.isHole, snapN: t.userData._snapNormal }; })));
    }
  } else {
    const t = await pg.evaluate(() => { const t = objects.find(o => o.userData.shapeType === 'svg'); window._t=t; const c = new THREE.Box3().setFromObject(t).getCenter(new THREE.Vector3()); return [c.x * 10, c.y * 10, c.z * 10]; });
    const von = await bild(...t);
    log('Text greifen bei', von.map(Math.round), '→ ziehen nach', ziel.map(Math.round));
    await pg.mouse.move(von[0], von[1]); await pg.mouse.down();
    for (let i = 1; i <= 15; i++) { await pg.mouse.move(von[0] + (ziel[0] - von[0]) * i / 15, von[1] + (ziel[1] - von[1]) * i / 15); await pg.waitForTimeout(30); }
    log('Während des Ziehens:', JSON.stringify(await zustand()));
    await pg.mouse.up(); await pg.waitForTimeout(600);
    log('Nach Loslassen:', JSON.stringify(await zustand()));
    // zweiter Versuch: jetzt (Pick-Modus vorbei?) noch einmal ziehen
    const t2 = await pg.evaluate(() => { const t = objects.find(o => o.userData.shapeType === 'svg'); window._t=t; const c = new THREE.Box3().setFromObject(t).getCenter(new THREE.Vector3()); return [c.x * 10, c.y * 10, c.z * 10]; });
    let von2 = await bild(...t2);
    von2 = await pg.evaluate(([x0, y0]) => { const t = objects.find(o => o.userData.shapeType === 'svg'); const r = canvas.getBoundingClientRect();
      for (let d = 0; d < 40; d += 2) for (const [dx, dy] of [[d,0],[-d,0],[0,d],[0,-d]]) { const x = x0 + dx, y = y0 + dy;
        mousev.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); raycaster.setFromCamera(mousev, camera);
        const h = raycaster.intersectObjects(objects, true).filter(h => h.object.isMesh && !h.object.userData.isEdgeLines)[0]; if (h && h.object === t) return [x, y]; }
      return [x0, y0]; }, von2);
    const ziel2 = await bild(dm[0] - 15, dm[1], dm[2] + 10);
    await pg.mouse.move(von2[0], von2[1]); await pg.mouse.down();
    for (let i = 1; i <= 15; i++) { await pg.mouse.move(von2[0] + (ziel2[0] - von2[0]) * i / 15, von2[1] + (ziel2[1] - von2[1]) * i / 15); await pg.waitForTimeout(30); }
    await pg.mouse.up(); await pg.waitForTimeout(600);
    log('Zweiter Zug:', JSON.stringify(await zustand()), JSON.stringify(await pg.evaluate(() => { const t = objects.find(o => o.userData.shapeType === 'svg'); return { scale: t.scale.toArray(), depth: t.userData.svgDepth, hole: t.userData.isHole, snapN: t.userData._snapNormal }; })));
  }
  await shot('2_danach');
  // Vertieft anbringen (0,6 mm) wie im Feld vorgeschlagen
  await pg.locator('#lbl-pop button', { hasText: 'Anbringen' }).click();
  for (let i = 0; i < 40 && await pg.evaluate(() => objects.some(o => o.userData.shapeType === 'svg')); i++) await pg.waitForTimeout(1000);
  const fertig = await pg.evaluate(() => { const hoch = o => { const x = new THREE.Box3().setFromObject(o); return x.max.y - x.min.y; }; const o = objects.slice().sort((a, b) => hoch(a) - hoch(b))[0]; o.updateMatrixWorld(true); const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; const p = g.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const k = v => [v.x, v.y, v.z].map(x => Math.round(x * 1e4)).join(','); const kanten = new Map(); let vol = 0;
    for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, i + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, i + 2).applyMatrix4(o.matrixWorld);
      vol += a.dot(b.clone().cross(c)) / 6; for (const [u, v] of [[a, b], [b, c], [c, a]]) { const kk = [k(u), k(v)].sort().join('|'); kanten.set(kk, (kanten.get(kk) || 0) + 1); } }
    let offen = 0; kanten.forEach(n => { if (n !== 2) offen++; });
    const bb = new THREE.Box3().setFromObject(o);
    return { objekte: objects.length, volumen_mm3: +(vol * 1000).toFixed(1), offeneKanten: offen, hoehe: +((bb.max.y - bb.min.y) * 10).toFixed(2) }; });
  log('Nach Anbringen (vertieft):', JSON.stringify(fertig), '| Deckel voll:', +(77.6 * 55.6 * 3).toFixed(1));
  log('Deckel-Oberseite bei y =', D[4], 'mm, Mitte', JSON.stringify(dm));
  log('Seitenfehler:', errs);
} finally { await b.close(); if (srv) srv.kill(); }
