// Anschmiegen muss auch beim Ziehen an einem Gizmo-Pfeil greifen —
// mit den Pfeilen war der Magnet vorher gar nicht mehr erreichbar.
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1300, height: 850 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await p.waitForTimeout(3000);
const rect = await p.evaluate(() => { const r = vpEl.getBoundingClientRect(); return { x: r.left, y: r.top }; });
let ok = true;
const say = (l, c, e = '') => { if (!c) ok = false; console.log(`${c ? '✓' : '✗'} ${l}${e ? ' — ' + e : ''}`); };

// Zylinder + Text daneben
const st = await p.evaluate(async () => {
  const m = document.getElementById('start-modal'); if (m) m.classList.remove('show');
  while (objects.length) { const o = objects.pop(); scene.remove(o); }
  addShape('cylinder');
  const C = objects[0]; C.position.set(0, C.position.y, 0);
  selectObjs([C]);                       // Wickel-Modus braucht ein Ziel
  addTextShape();
  document.getElementById('text3d-input').value = 'Volker';
  document.getElementById('text3d-size').value = '8';
  _text3dSetMode('cylinder');
  _confirmText3d();
  await new Promise(r => setTimeout(r, 1500));
  const T = objects[objects.length - 1];
  return { typ: T.userData.shapeType, anzahl: objects.length };
});
say('echter 3D-Text angelegt', st.typ === 'text' && st.anzahl === 2, `${st.anzahl} Objekte, Typ ${st.typ}`);

const setup = await p.evaluate(() => {
  const C = objects[0], T = objects[1];
  const cb = new THREE.Box3().setFromObject(C);
  // Text seitlich neben den Zylinder, auf halber Hoehe
  T.position.set(cb.max.x + 1.4, (cb.min.y + cb.max.y) / 2, 0);
  selectObjs([T]); setMode('select'); setSnapGrid(0);
  fitToObjects(objects); sph.r *= 1.7; sph.theta = 0.55; sph.phi = 1.15; sph2cam();
  return { vorher: T.geometry.attributes.position.count, pos: T.position.toArray().map(v => +v.toFixed(2)) };
});
await p.waitForTimeout(400);

// Am ROTEN X-Pfeil ziehen, bis der Text den Zylinder ueberlappt
const ap = await p.evaluate(() => {
  const g = _mg.group, d = _mgAxisVec('x').multiplyScalar(g.scale.x * 0.6);
  const w = g.position.clone().add(d);
  return { s: _worldToScreen(w.x, w.y, w.z), sichtbar: _mg.arrows.x.visible };
});
say('X-Pfeil greifbar', ap.sichtbar);
const x = ap.s.x + rect.x, y = ap.s.y + rect.y;
await p.mouse.move(x, y);
await p.mouse.down();
let hinweis = null;
for (let i = 1; i <= 40; i++) {
  await p.mouse.move(x - 5 * i, y);
  const h = await p.evaluate(() => {
    const el = document.getElementById('text-snap-hint');
    return (el && el.style.display !== 'none') ? el.textContent : null;
  });
  if (h) { hinweis = h; break; }   // wie ein Nutzer: sobald der Magnet meldet, loslassen
}
say('Magnet-Hinweis erscheint beim Pfeil-Ziehen', !!hinweis, hinweis || 'kein Hinweis');
const ziel = await p.evaluate(() => _textSnapTarget ? _textSnapTarget.type : null);
say('Ziel beim Loslassen erkannt', ziel === 'cylinder', ziel || 'keins');
await p.mouse.up();
await p.waitForTimeout(1500);

const nach = await p.evaluate(() => {
  const T = objects[1];
  const bb = new THREE.Box3().setFromObject(T);
  const C = objects[0], cb = new THREE.Box3().setFromObject(C);
  const cx = (cb.min.x + cb.max.x) / 2, cz = (cb.min.z + cb.max.z) / 2;
  // Um den Zylinder gewickelt? Dann streut der Text in X UND Z um die Achse
  return { verts: T.geometry.attributes.position.count,
           breiteX: +((bb.max.x - bb.min.x) * 10).toFixed(1),
           tiefeZ: +((bb.max.z - bb.min.z) * 10).toFixed(1),
           radiusMm: +(Math.max(Math.abs(bb.max.x - cx), Math.abs(bb.max.z - cz)) * 10).toFixed(1),
           zylRadiusMm: +((cb.max.x - cb.min.x) / 2 * 10).toFixed(1) };
});
say('Text wurde um den Zylinder gewickelt',
    nach.tiefeZ > 3 && Math.abs(nach.radiusMm - nach.zylRadiusMm) < 6,
    `Text ${nach.breiteX}×${nach.tiefeZ} mm, Radius ${nach.radiusMm} vs. Zylinder ${nach.zylRadiusMm} mm`);
say('keine Seitenfehler', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('=>', ok ? 'OK ✓' : 'FEHLGESCHLAGEN ✗');
await b.close();
process.exit(ok ? 0 : 1);
