// Josy 30.10.: zweites Relief-Motiv auf das erste — innerhalb des oberen sollen die Linien des
// unteren verschwinden. Prüft „🫥 Verdeckt, was darunter liegt“ flach (Quader) und gewickelt (Zylinder):
// innen keine Streifen mehr, Wand nicht angeschnitten, außen bleiben die Streifen. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
let streifen = ''; for (let k = 0; k < 10; k++) streifen += `<rect x="0" y="${k * 6}" width="60" height="2"/>`;
const SVG_A = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">${streifen}</svg>`;
const SVG_C = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path fill-rule="evenodd" d="M0,15 a15,15 0 1,0 30,0 a15,15 0 1,0 -30,0 Z M2.5,15 a12.5,12.5 0 1,1 25,0 a12.5,12.5 0 1,1 -25,0 Z"/></svg>`;
const SVG_B = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path fill-rule="evenodd" d="M0,15 a15,15 0 1,0 30,0 a15,15 0 1,0 -30,0 Z M1.5,15 a13.5,13.5 0 1,1 27,0 a13.5,13.5 0 1,1 -27,0 Z"/></svg>`;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.on('console', m => { const t = m.text(); if (/Verdeck|union\]/.test(t)) console.log('  [log]', t.slice(0, 160)); });
await pg.goto(URL); await pg.waitForFunction(() => typeof _svgVerdeckMaske === 'function', null, { timeout: 30000 });
const lauf = (form, verdecken, zusammen, drei) => pg.evaluate(async ([A, B, C, form, verdecken, zusammen, drei]) => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0; hideStarter(); setShapeMode('solid'); window._bez = null;
  addShape(form === 'zylinder' ? 'cylinder' : 'box'); let K = objects[0]; selectObjs([K]);
  if (form === 'zylinder') { numChanged('sw', 90); numChanged('sd', 90); numChanged('sh', 80); } else { numChanged('sw', 80); numChanged('sd', 20); numChanged('sh', 80); }
  K.updateMatrixWorld(true);
  const kb = new THREE.Box3().setFromObject(K), c = kb.getCenter(new THREE.Vector3());
  const heften = (m, ziel, dx = 0) => { ziel.updateMatrixWorld(true); const zb = new THREE.Box3().setFromObject(ziel), zc0 = zb.getCenter(new THREE.Vector3()), zc = window._bez ? new THREE.Vector3(window._bez.p.x, window._bez.p.y, zc0.z) : zc0;
    const rc = new THREE.Raycaster(new THREE.Vector3(zc.x + dx / 10, zc.y, zb.max.z + 3), new THREE.Vector3(0, 0, -1)); const h = rc.intersectObject(ziel, false)[0];
    raycaster.set(rc.ray.origin, rc.ray.direction); _svgSnapHit = h; const nW = h.face.normal.clone().transformDirection(ziel.matrixWorld).normalize();
    const pr = _svgWrapProbe(ziel, h.point, { normalW: nW }); if (pr && form === 'zylinder') _svgWrapApply(m, pr, h.point); else { _svgSnapAtHit = dx !== 0; try { _applySvgSnap(m, { obj: ziel, type: 'surface' }); } finally { _svgSnapAtHit = false; } }
    if (!window._bez) window._bez = { p: h.point.clone(), zc: zc0.clone() }; };
  const warte = async n => { for (let i = 0; i < 300 && objects.length !== n; i++) await new Promise(r => setTimeout(r, 200)); };
  const a = _importSvgConfirm({ svgText: A, mode: 'extrude', depthMM: 2, targetMM: 60, name: 'Streifen' });
  heften(a, K); _svgRaise(a, 1.0, K);
  if (!zusammen) { selectObjs([K, a]); await unionSelected(); await warte(1); K = objects[0]; }
  const bm = _importSvgConfirm({ svgText: B, mode: 'extrude', depthMM: 2, targetMM: 30, name: 'Ring' });
  heften(bm, K); _svgRaise(bm, 2.0, K); bm.userData.svgVerdecken = verdecken;
  let cm = null;
  if (drei) { cm = _importSvgConfirm({ svgText: C, mode: 'extrude', depthMM: 2, targetMM: 16, name: 'Ring klein' }); heften(cm, K, 14); _svgRaise(cm, 1.5, K); cm.userData.svgVerdecken = true; }
  selectObjs(zusammen ? [K, a, bm, ...(cm ? [cm] : [])] : [K, bm]); await unionSelected(); await warte(1);
  const R = objects[0]; R.updateMatrixWorld(true);
  // Höhen über der Wand (mm) entlang senkrechter Linien: innen x=0, außen x=±24 mm (neben dem Ring)
  // Bezug: erster Treffer auf der Wand (Körper wird beim Anlegen eines Motivs zur Seite gerückt — dort messen, wo er jetzt ist)
  const P0 = window._bez.p, Z0 = window._bez.zc, rZyl = 4.5;
  const hoehe = (xmm, ymm) => { const x = P0.x + xmm / 10, y = P0.y + ymm / 10;
    const h = new THREE.Raycaster(new THREE.Vector3(x, y, P0.z + 5), new THREE.Vector3(0, 0, -1)).intersectObject(R, false)[0];
    if (!h) return null; const wz = form === 'zylinder' ? Z0.z + Math.sqrt(Math.max(0, rZyl * rZyl - (x - P0.x) ** 2)) : P0.z; return (h.point.z - wz) * 10; };
  const linie = xmm => { let mx = -1e9, mn = 1e9; for (let y = -9; y <= 9; y += 0.25) { const v = hoehe(xmm, y); if (v == null) continue; mx = Math.max(mx, v); mn = Math.min(mn, v); } return [+mx.toFixed(2), +mn.toFixed(2)]; };
  // im kleinen Ring (Mitte x=14, innen bis 6,3 mm): dort läuft der große Ring durch — muss weg sein
  const klein = (() => { let mx = -1e9; for (let dx = -4; dx <= 4; dx += 0.5) for (let dy = -4; dy <= 4; dy += 0.5) { if (dx * dx + dy * dy > 16) continue; const v = hoehe(14 + dx, dy); if (v != null) mx = Math.max(mx, v); } return +mx.toFixed(2); })();
  return { objekte: objects.length, innen: linie(0), innen2: linie(-6), aussen: linie(24), ring: linie(14.25), ringLinks: linie(-14.25), klein };
}, [SVG_A, SVG_B, SVG_C, form, verdecken, !!zusammen, !!drei]);
let fehler = 0; const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
for (const [form, zusammen] of [['quader', false], ['quader', true], ['zylinder', true]]) {
  const r = await lauf(form, true, zusammen), r0 = await lauf(form, false, zusammen);
  const nm = form + (zusammen ? ' (zusammen vereint)' : ' (untere Schicht schon vereint)');
  console.log(nm, 'mit:', JSON.stringify(r), '| ohne:', JSON.stringify(r0));
  ok(`${nm}: ohne Häkchen sind die Streifen innen sichtbar (Gegenprobe)`, r0.innen[0] > 0.8, r0.innen);
  ok(`${nm}: mit Häkchen innen keine Streifen mehr (≤ 0,1 mm)`, r.innen[0] <= 0.1 && r.innen2[0] <= 0.1, [r.innen, r.innen2]);
  // am Zylinder misst die Rechnung gegen den idealen Kreis, die Facetten liegen bis 0,2 mm darunter → mit Gegenprobe vergleichen
  ok(`${nm}: Wand innen nicht angeschnitten`, r.innen[1] >= Math.min(r0.innen[1], r0.innen2[1], 0) - 0.05 && r.innen2[1] >= Math.min(r0.innen[1], r0.innen2[1], 0) - 0.05, [r.innen, r.innen2, r0.innen, r0.innen2]);
  ok(`${nm}: außen bleiben die Streifen (≈ 1 mm)`, Math.abs(r.aussen[0] - 1) < 0.15, r.aussen);
  ok(`${nm}: der Ring selbst steht 2 mm`, Math.abs(r.ring[0] - 2) < 0.2, r.ring);
}
for (const form of ['quader', 'zylinder']) {
  const r3 = await lauf(form, true, true, true);
  console.log(form, 'drei Schichten:', JSON.stringify(r3));
  ok(`${form} (drei Schichten): späteres Motiv verdeckt auch das frühere verdeckende (großer Ring im kleinen weg)`, r3.klein <= 0.15, r3.klein);
  ok(`${form} (drei Schichten): großer Ring außerhalb des kleinen bleibt (links)`, Math.abs(r3.ringLinks[0] - 2) < 0.25, r3.ringLinks);
}
// Häkchen auch an gewickelten Motiven im Eigenschaften-Feld
const hk = await pg.evaluate(async () => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0; addShape('cylinder'); const K = objects[0]; selectObjs([K]); numChanged('sw', 90); numChanged('sd', 90); numChanged('sh', 80);
  const m = _importSvgConfirm({ svgText: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', mode: 'extrude', depthMM: 2, targetMM: 20, name: 'Q' });
  K.updateMatrixWorld(true); const zb = new THREE.Box3().setFromObject(K), zc = zb.getCenter(new THREE.Vector3());
  const h = new THREE.Raycaster(new THREE.Vector3(zc.x, zc.y, zb.max.z + 3), new THREE.Vector3(0, 0, -1)).intersectObject(K, false)[0];
  const nW = h.face.normal.clone().transformDirection(K.matrixWorld).normalize(); _svgWrapApply(m, _svgWrapProbe(K, h.point, { normalW: nW }), h.point); _svgRaise(m, 1.5, K);
  selectObjs([m]); _fpCurType = null; updateFP(); await new Promise(r => setTimeout(r, 300));
  return !!m.userData._svgWrap && [...document.querySelectorAll('#fp input[type=checkbox]')].some(x => /Verdeckt/.test(x.parentElement.textContent));
});
ok('Häkchen auch am gewickelten Motiv', hk);
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
