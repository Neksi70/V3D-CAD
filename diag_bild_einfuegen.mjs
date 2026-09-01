// Test „Bild einfügen": Auswahl-Dialog, Weiterreichen an die Generatoren
// und die neue Zeichen-Vorlage in der Skizze.
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3000);


let ok = true;
const say = (label, cond, extra = '') => { if (!cond) ok = false; console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };

// 1) Knopf da, Dialog öffnet, Kacheln gebaut
const r1 = await page.evaluate(async () => {
  const m = document.getElementById('start-modal'); if (m) m.classList.remove('show');
  const btn = [...document.querySelectorAll('#tb-r1 button')].find(b => b.textContent.includes('Bild'));
  return { knopf: !!btn, ziele: _IMG_TARGETS.length, ersteWahl: _IMG_TARGETS[0].t };
});
say('Knopf „🖼️ Bild" in der Datei-Gruppe', r1.knopf);
say(`Auswahl hat ${r1.ziele} Wege, erste = „${r1.ersteWahl}"`, r1.ziele >= 7 && r1.ersteWahl === 'Zum Nachzeichnen');

const r2 = await page.evaluate(async () => {
  const cv = document.createElement('canvas'); cv.width = 240; cv.height = 120;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0,0,240,120);
  cx.fillStyle = '#000'; cx.beginPath(); cx.arc(120,60,45,0,7); cx.fill();
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  window.__probe = new File([blob], 'probe.png', { type: 'image/png' });
  _imgChoose(window.__probe);
  return { offen: document.getElementById('img-modal').classList.contains('show'),
           kacheln: document.getElementById('img-opts').childElementCount,
           name: document.getElementById('img-name').textContent };
}, {});
say('Dialog offen mit Vorschau + Kacheln', r2.offen && r2.kacheln >= 7, `${r2.kacheln} Kacheln, „${r2.name}"`);

// 2) Zum Nachzeichnen → Skizze mit Vorlage
const r3 = await page.evaluate(async () => {
  const f = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  _imgGo('trace'); await f(); await new Promise(r => setTimeout(r, 400));
  const mesh = _skRef.mesh;
  const bb = mesh ? new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()) : null;
  return { skizze: _sk.active, mesh: !!mesh, modalZu: !document.getElementById('img-modal').classList.contains('show'),
           ctl: document.getElementById('sk-ref-ctl').style.display !== 'none',
           breiteMm: bb ? +(bb.x * 10).toFixed(1) : 0, tiefeMm: bb ? +(bb.z * 10).toFixed(1) : 0,
           y: mesh ? +mesh.position.y.toFixed(3) : null, ro: mesh ? mesh.renderOrder : null };
});
say('Skizze aktiv + Vorlage liegt drin', r3.skizze && r3.mesh && r3.modalZu && r3.ctl);
say('Seitenverhältnis 2:1 erhalten', Math.abs(r3.breiteMm / r3.tiefeMm - 2) < 0.02, `${r3.breiteMm}×${r3.tiefeMm} mm`);
say('liegt unter den Skizzenlinien', r3.y < 0.02 && r3.ro < 996, `y=${r3.y}, renderOrder=${r3.ro}`);

// 2b) Seitenrichtig, nicht gespiegelt: Bild-Ecke oben-links (uv 0/1) muss in der
//     Draufsicht hinten-links liegen (-X / -Z). Sonst zeichnet man spiegelverkehrt nach.
const rOri = await page.evaluate(() => {
  const g = _skRef.mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv;
  let idx = -1;
  for (let i = 0; i < uv.count; i++)
    if (Math.abs(uv.getX(i)) < 1e-6 && Math.abs(uv.getY(i) - 1) < 1e-6) { idx = i; break; }
  if (idx < 0) return null;
  const bb = new THREE.Box3().setFromObject(_skRef.mesh).getSize(new THREE.Vector3());
  return { x: +pos.getX(idx).toFixed(4), y: +pos.getY(idx).toFixed(4), z: +pos.getZ(idx).toFixed(4),
           hw: +(bb.x / 2).toFixed(4), hd: +(bb.z / 2).toFixed(4) };
});
say('Bild liegt seitenrichtig (oben-links = hinten-links)',
    !!rOri && Math.abs(rOri.x + rOri.hw) < 1e-3 && Math.abs(rOri.z + rOri.hd) < 1e-3 && Math.abs(rOri.y) < 1e-3,
    rOri ? `Ecke 0/1 bei ${rOri.x}/${rOri.y}/${rOri.z}` : 'keine UV gefunden');

// 3) Breite / Deckkraft / Versatz
const r4 = await page.evaluate(async () => {
  _skRefSet('w', 60); _skRefSet('o', 80); _skRefSet('x', 15); _skRefSet('y', -20);
  const m = _skRef.mesh;
  const bb = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
  return { br: +(bb.x * 10).toFixed(1), ti: +(bb.z * 10).toFixed(1), op: +m.material.opacity.toFixed(2),
           x: +(m.position.x * 10).toFixed(1), z: +(m.position.z * 10).toFixed(1) };
});
say('Breite 60 mm, Höhe folgt', Math.abs(r4.br - 60) < 0.1 && Math.abs(r4.ti - 30) < 0.1, `${r4.br}×${r4.ti} mm`);
say('Deckkraft 80 %', Math.abs(r4.op - 0.8) < 0.01);
say('Versatz X/Y', Math.abs(r4.x - 15) < 0.1 && Math.abs(r4.z + 20) < 0.1, `${r4.x}/${r4.z} mm`);

// 4) Skizze schließen räumt auf
const r5 = await page.evaluate(async () => {
  exitSketchMode();
  return { mesh: !!_skRef.mesh, inScene: scene.children.some(c => c.userData && c.userData.isSketchRef),
           ctl: document.getElementById('sk-ref-ctl').style.display };
});
say('Skizze schließen entfernt die Vorlage', !r5.mesh && !r5.inScene && r5.ctl === 'none');

// 5) Weiterreichen an einen Generator (Lithophane) über dessen Datei-Feld
const r6 = await page.evaluate(async () => {
  const f = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  _imgChoose(window.__probe);
  _imgGo('litho'); await f(); await new Promise(r => setTimeout(r, 700));
  return { offen: document.getElementById('litho-modal').classList.contains('show'),
           bild: !!(typeof _litho !== 'undefined' && _litho.img),
           info: (document.getElementById('litho-info') || {}).textContent || '' };
});
say('Lithophane bekommt das Bild direkt', r6.offen && r6.bild, r6.info.slice(0, 40));

// 6) Kein Bild → freundliche Absage statt Absturz
const r7 = await page.evaluate(() => {
  _imgChoose(new File(['x'], 'text.txt', { type: 'text/plain' }));
  return document.getElementById('img-modal').classList.contains('show');
});
say('Nicht-Bild wird abgelehnt', !r7);

// 7) Bild ins 3D-Fenster ziehen
const r8 = await page.evaluate(() => {
  _imgClose();
  const dt = new DataTransfer(); dt.items.add(window.__probe);
  vpEl.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  const hinweis = document.getElementById('img-drop-hint').classList.contains('show');
  vpEl.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return { hinweis, hinweisWeg: !document.getElementById('img-drop-hint').classList.contains('show'),
           dialog: document.getElementById('img-modal').classList.contains('show') };
});
say('Bild ins Fenster ziehen: Hinweis + Dialog', r8.hinweis && r8.hinweisWeg && r8.dialog);

// 8) Nicht-Bild ziehen darf nichts anfassen
const r9 = await page.evaluate(() => {
  _imgClose();
  const dt = new DataTransfer(); dt.items.add(new File(['x'], 'modell.stl', { type: 'model/stl' }));
  vpEl.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  const still = !document.getElementById('img-drop-hint').classList.contains('show');
  vpEl.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return still && !document.getElementById('img-modal').classList.contains('show');
});
say('STL ziehen löst nichts aus', r9);

// 9) Regler schreiben in die Felder zurück
const r10 = await page.evaluate(async () => {
  enterSketchMode(); _skRefLoad(window.__probe);
  await new Promise(r => setTimeout(r, 400));
  _skRefSet('w', 75); _skRefSet('o', 60);
  const v = { w: document.getElementById('sk-ref-w').value, o: document.getElementById('sk-ref-o').value,
              lbl: document.getElementById('sk-ref-ov').textContent };
  exitSketchMode();
  return v;
});
say('Felder folgen den Werten', r10.w === '75' && r10.o === '60' && r10.lbl === '60%', `${r10.w}mm / ${r10.lbl}`);

say('keine Seitenfehler', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('=>', ok ? 'OK ✓' : 'FEHLGESCHLAGEN ✗');
await browser.close();
process.exit(ok ? 0 : 1);
