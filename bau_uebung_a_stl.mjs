// Übung A (Box mit Schiebedeckel) komplett in V3D CAD bauen und als STL ablegen:
// Box nach Folie 17 (Punkte 1–3, Griffkante nötig für erhabenen Namen) + Deckel mit erhabenem Namen.
// NAME=Volker ERHABEN=1 (mm) GROESSE=12 (mm) ZIEL=~/Ablage/Grundkurs
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
import fs from 'fs';

const PORT = 8864, NAME = process.env.NAME || 'Volker', ERH = process.env.ERHABEN || '1', GR = process.env.GROESSE || '12';
const ZIEL = process.env.ZIEL || '/home/v3da/Ablage/Grundkurs';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);
const warte = async (f, s = 90) => { for (let i = 0; i < s; i++) { if (await pg.evaluate(f)) return true; await pg.waitForTimeout(1000); } return false; };

try {
  await pg.goto(`http://localhost:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => {
    hideStarter(); _newCreate(false);
    window._k = {
      box(w, d, h) { addShape('box'); const o = objects[objects.length - 1]; selectObjs([o]); numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); return o; },
      bb(o) { o.updateMatrixWorld(true); const x = new THREE.Box3().setFromObject(o); return [x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z].map(v => +(v * 10).toFixed(2)); },
      ebene(off) { const bb = _k.bb(objects[0]); _wpBaseN = new THREE.Vector3(0, 1, 0); _wpBaseP = new THREE.Vector3((bb[0] + bb[3]) / 20, bb[4] / 10, (bb[2] + bb[5]) / 20); document.getElementById('wp-off').value = off; _wpAdjust(); },
    };
  });
  const eins = () => objects.length === 1 && !objects[0].userData.isHole;
  // 1: Hohlkörper
  await pg.evaluate(() => { setShapeMode('solid'); const A = _k.box(80, 60, 35); setShapeMode('hole'); const B = _k.box(74, 54, 33);
    selectObjs([A, B]); alignObjects('xcenter'); alignObjects('zcenter'); alignObjects('ymax'); setShapeMode('solid'); selectObjs(objects.slice()); subtractHoles(); });
  log('1 Hohlkörper:', await warte(eins));
  // 2: Nut
  await pg.evaluate(() => { const A = objects[0]; _k.ebene(-5.4); setShapeMode('hole'); const C = _k.box(78, 56, 3.4);
    selectObjs([A, C]); alignObjects('xcenter'); alignObjects('zmin'); resetWorkplane(); setShapeMode('solid'); selectObjs(objects.slice()); subtractHoles(); });
  log('2 Nut:', await warte(eins));
  // 3: Griffkante (sonst stößt der erhabene Name vorne am Steg an)
  await pg.evaluate(() => { const A = objects[0]; _k.ebene(-2); setShapeMode('hole'); const D = _k.box(78, 5, 4);
    selectObjs([A, D]); alignObjects('xcenter'); alignObjects('zmin'); resetWorkplane(); setShapeMode('solid'); selectObjs(objects.slice()); subtractHoles(); });
  log('3 Griffkante:', await warte(eins));
  const boxId = await pg.evaluate(() => { objects[0].userData.name = 'Box'; return objects[0].userData.id; });

  // 4: Deckel 78×56×3,4 → Spielraum −0,2
  const deckelId = await pg.evaluate(() => { setShapeMode('solid'); const L = _k.box(78, 56, 3.4); selectObjs([L]); _offsetApply(-0.2); L.userData.name = 'Deckel'; deselect(); return L.userData.id; });
  // Name: Text-Dialog „Auf Bauteil“, Größe, Erstellen → auf die Deckelmitte klicken
  await pg.evaluate(() => addTextShape()); await pg.waitForTimeout(400);
  await pg.fill('#text3d-input', NAME);
  await pg.evaluate(gr => { const r = document.getElementById('text3d-size'); r.value = gr; r.dispatchEvent(new Event('input')); }, GR);
  await pg.locator('#text3d-modal button', { hasText: 'Erstellen' }).last().click();
  await warte(() => !!_lblPick, 20);
  await pg.evaluate(() => { setView('iso'); fitView(); }); await pg.waitForTimeout(500);
  const p = await pg.evaluate(id => { const L = objects.find(o => o.userData.id === id); const x = new THREE.Box3().setFromObject(L);
    const v = new THREE.Vector3((x.min.x + x.max.x) / 2, x.max.y, (x.min.z + x.max.z) / 2).project(camera); const r = canvas.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, deckelId);
  await pg.mouse.move(p[0], p[1]); await pg.waitForTimeout(200); await pg.mouse.click(p[0], p[1]); await pg.waitForTimeout(500);
  // Erhaben anbringen
  await pg.evaluate(mm => { _lblSetArt('hoch'); document.getElementById('lbl-mm').value = mm; }, ERH);
  await pg.locator('#lbl-pop button', { hasText: 'Anbringen' }).click();
  log('4 Deckel + Name erhaben:', await warte(() => !objects.some(o => o.userData.shapeType === 'svg')));

  // Prüfen + STL
  const erg = await pg.evaluate(() => objects.map(o => {
    o.updateMatrixWorld(true); const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; const p = g.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const k = v => [v.x, v.y, v.z].map(x => Math.round(x * 1e4)).join(','); const ka = new Map(); let vol = 0;
    for (let i = 0; i < p.count; i += 3) { a.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, i + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, i + 2).applyMatrix4(o.matrixWorld);
      vol += a.dot(b.clone().cross(c)) / 6; for (const [u, v] of [[a, b], [b, c], [c, a]]) { const kk = [k(u), k(v)].sort().join('|'); ka.set(kk, (ka.get(kk) || 0) + 1); } }
    let offen = 0; ka.forEach(n => { if (n !== 2) offen++; });
    return { name: o.userData.name, id: o.userData.id, bb: _k.bb(o), vol_mm3: +(vol * 1000).toFixed(0), offen, dreiecke: p.count / 3 }; }));
  erg.forEach(e => log(JSON.stringify(e)));
  const dateien = {};
  for (const e of erg) {
    const istBox = e.bb[4] - e.bb[1] > 20;
    const datei = istBox ? 'UebungA_Box.stl' : `UebungA_Deckel_${NAME}.stl`;
    const b64 = await pg.evaluate(async id => { const o = objects.find(x => x.userData.id === id); const bl = _buildStlBlob([o]).blob;
      const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); }, e.id);
    fs.mkdirSync(ZIEL, { recursive: true });
    fs.writeFileSync(`${ZIEL}/${datei}`, Buffer.from(b64, 'base64'));
    dateien[datei] = e;
  }
  log('Geschrieben:', Object.keys(dateien).join(', '), '→', ZIEL);
  await pg.screenshot({ path: '/tmp/uebung_a_fertig.png' });
  log('Seitenfehler:', errs);
} finally { await b.close(); srv.kill(); }
