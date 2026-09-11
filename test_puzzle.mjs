// Headless-Test des Puzzle-Generators gegen den --dev-Server (rohe volme3d.html).
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const URL = process.env.PZ_URL || 'http://127.0.0.1:8766/volme3d.html';
const errs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });

await page.goto(URL, { waitUntil: 'load', timeout: 40000 });
await page.waitForTimeout(3500);

console.log('Globals:', JSON.stringify(await page.evaluate(() => ({
  open: typeof _pzlOpen, create: typeof _pzlCreate, mesh: typeof _pzlPieceMesh, P: typeof _pzlP,
}))));

await page.evaluate(() => _pzlOpen());
await page.waitForTimeout(900);

// 1) Vorschau da? Teile gezaehlt?
const prev = await page.evaluate(() => {
  const cv = document.getElementById('pzl-canvas');
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let nonBg = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 40 || d[i+1] > 40 || d[i+2] > 60) nonBg++;
  const o = _pzl.out;
  return { pieces: o ? o.pieces.length : 0, keep: o ? o.pieces.filter(p => p.keep).length : 0,
           nonBg, ptsPerPiece: o ? o.pieces[0].poly.length : 0 };
});
console.log('Vorschau:', JSON.stringify(prev));

// 2) Verzahnung: passen Nachbarkanten exakt aufeinander (gemeinsame Kante)?
const fit = await page.evaluate(() => {
  const G = _pzlGridEdges(_pzlP);
  const a = _pzlPiecePoly(G, 1, 1), b = _pzlPiecePoly(G, 2, 1);
  // gemeinsame Kante = vE[2][1]; Punkte muessen in beiden Polygonen vorkommen
  const e = G.vE[2][1];
  const key = q => q[0].toFixed(6) + '|' + q[1].toFixed(6);
  const sa = new Set(a.map(key)), sb = new Set(b.map(key));
  let both = 0;
  for (const q of e) if (sa.has(key(q)) && sb.has(key(q))) both++;
  // Nase vorhanden? (Kante darf nicht gerade sein)
  const straight = e.length <= 2;
  return { edgePts: e.length, shared: both, straight };
});
console.log('Verzahnung:', JSON.stringify(fit));

// 3) Formen durchprobieren
for (const f of ['rect', 'oval', 'herz']) {
  const r = await page.evaluate(async (form) => {
    _pzlSetForm(form); await new Promise(r => setTimeout(r, 250));
    const o = _pzl.out;
    return { form, keep: o.pieces.filter(p => p.keep).length, outline: o.outline ? o.outline.length : 0 };
  }, f);
  console.log(' Form', JSON.stringify(r));
}
await page.evaluate(() => _pzlSetForm('rect'));

// 4) Erstellen (ohne Bild) + Netz pruefen
const made = await page.evaluate(async () => {
  _pzlP.cols = 4; _pzlP.rows = 3; _pzlSyncUI(); _pzlRefresh(true);
  await new Promise(r => setTimeout(r, 200));
  const before = objects.length;
  await _pzlCreate();
  for (let i = 0; i < 120 && objects.length === before; i++) await new Promise(r => setTimeout(r, 100));
  const g = objects[objects.length - 1];
  const kids = g.children.filter(c => c.isMesh);
  let tris = 0, minY = 1e9, maxY = -1e9;
  const bb = new THREE.Box3();
  for (const k of kids) { tris += k.geometry.attributes.position.count / 3;
    k.geometry.computeBoundingBox();
    bb.setFromObject(k); minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y); }
  return { added: objects.length - before, name: g.userData.name, pieces: kids.length, tris,
           minY: +minY.toFixed(3), maxY: +maxY.toFixed(3),
           firstName: kids[0].userData.name, type: kids[0].userData.type };
});
console.log('Erstellt:', JSON.stringify(made));

// 5) Wasserdicht? Jede Kante genau zweimal (nicht-indiziertes Netz)
const tight = await page.evaluate(() => {
  const g = objects[objects.length - 1], m = g.children.find(c => c.isMesh);
  const pa = m.geometry.attributes.position.array, n = pa.length / 3;
  const K = 1e4, map = new Map();
  const vid = i => { const k = Math.round(pa[i*3]*K) + '_' + Math.round(pa[i*3+1]*K) + '_' + Math.round(pa[i*3+2]*K);
    let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } return id; };
  const em = new Map(); let bad = 0;
  for (let t = 0; t < n / 3; t++) {
    const v = [vid(t*3), vid(t*3+1), vid(t*3+2)];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e+1)%3]; if (a === b) { bad++; continue; }
      const key = a < b ? a + '_' + b : b + '_' + a;
      em.set(key, (em.get(key) || 0) + 1);
    }
  }
  let open = 0, over = 0;
  for (const c of em.values()) { if (c === 1) open++; else if (c > 2) over++; }
  return { tris: n / 3, verts: map.size, edges: em.size, offeneKanten: open, ueberzaehlig: over, entartet: bad };
});
console.log('Dichtheit Teil 1:', JSON.stringify(tight));

// 6) Mit Foto: Raster, Farben, MMU-Daten
const photo = await page.evaluate(async () => {
  // Testbild: Farbverlauf mit klaren Flaechen
  const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#1e88e5'; cx.fillRect(0, 0, 400, 300);
  cx.fillStyle = '#e53935'; cx.beginPath(); cx.arc(200, 150, 110, 0, 7); cx.fill();
  cx.fillStyle = '#fdd835'; cx.fillRect(20, 20, 90, 60);
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = cv.toDataURL('image/png'); });
  _pzl.img = img; _pzl.dirty = true; _pzlP.cols = 4; _pzlP.rows = 3; _pzlP.farben = 4; _pzlP.raster = 1.5;
  _pzlSyncUI(); _pzlRefresh(true);
  await new Promise(r => setTimeout(r, 400));
  const before = objects.length;
  await _pzlCreate();
  for (let i = 0; i < 200 && objects.length === before; i++) await new Promise(r => setTimeout(r, 100));
  const g = objects[objects.length - 1], kids = g.children.filter(c => c.isMesh);
  const m = kids[0];
  const col = m.geometry.getAttribute('color');
  // Anzahl verschiedener Dreiecksfarben + sind sie je Dreieck einheitlich?
  const set = new Set(); let mixed = 0;
  const ca = col.array;
  for (let t = 0; t < col.count / 3; t++) {
    const o = t * 9;
    const k = [ca[o], ca[o+1], ca[o+2]].map(v => v.toFixed(3)).join(',');
    for (let v = 1; v < 3; v++) {
      const k2 = [ca[o+v*3], ca[o+v*3+1], ca[o+v*3+2]].map(x => x.toFixed(3)).join(',');
      if (k2 !== k) mixed++;
    }
    set.add(k);
  }
  return { ras: { nx: _pzl.ras.nx, ny: _pzl.ras.ny, pal: _pzl.ras.pal.length, hex: _pzl.ras.hex },
    pieces: kids.length, tris: col.count / 3, farben: set.size, uneinheitlich: mixed,
    mmu: m.userData._mmuPaint, base: m.userData._mmuBase, slots: m.userData._mmuSlots };
});
console.log('Foto:', JSON.stringify(photo));

// 7) 3MF-Export laeuft durch?
const exp = await page.evaluate(() => {
  try { const r = _build3mfBlob(objects.slice(-1)); return { parts: r.parts, colors: r.colors, size: r.blob.size }; }
  catch (e) { return { err: String(e).slice(0, 200) }; }
});
console.log('3MF:', JSON.stringify(exp));

// 8) Tablett
const tray = await page.evaluate(async () => {
  _pzlOpen(); _pzlSetRahmen(1); _pzlP.cols = 3; _pzlP.rows = 3; _pzl.img = null; _pzl.ras = null; _pzl.dirty = true;
  _pzlSyncUI(); _pzlRefresh(true);
  await new Promise(r => setTimeout(r, 300));
  const before = objects.length;
  await _pzlCreate();
  for (let i = 0; i < 150 && objects.length === before; i++) await new Promise(r => setTimeout(r, 100));
  const g = objects[objects.length - 1], kids = g.children.filter(c => c.isMesh);
  const t = kids.find(k => k.userData.name === 'Tablett');
  if (!t) return { err: 'kein Tablett' };
  t.geometry.computeBoundingBox();
  const s = new THREE.Vector3(); t.geometry.boundingBox.getSize(s);
  return { pieces: kids.length - 1, tablett: [s.x * 10, s.y * 10, s.z * 10].map(v => +v.toFixed(1)) };
});
console.log('Tablett:', JSON.stringify(tray));

await page.screenshot({ path: 'screenshots/puzzle_scene.png' });
await page.evaluate(() => _pzlOpen());
await page.waitForTimeout(600);
await page.screenshot({ path: 'screenshots/puzzle_dialog.png' });

console.log(errs.length ? '\nFEHLER:\n' + errs.slice(0, 12).join('\n') : '\nkeine Konsolenfehler');
await browser.close();
