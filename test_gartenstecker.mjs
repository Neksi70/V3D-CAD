// Station 1 (Grundkurs 09.10.2026, Folie 22): Gartenstecker – Namensschild-Generator „Text auf Platte“,
// darunter Stab mit Spitze anfügen, zweifarbig als 3MF. Gegen die ausgelieferte App (:8765) mit Cookie.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'child_process';

const URL = process.env.V3D_URL || 'http://localhost:8765/volme3d.html';
const cookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('gartenstecker','test@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/' }]);
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);
const OUT = process.env.OUT || '/tmp';

try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof _createNameplate === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => {
    hideStarter(); _newCreate(false);
    window._g = {
      bb(o) { o.updateMatrixWorld(true); const x = new THREE.Box3().setFromObject(o); return [x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z].map(v => +(v * 10).toFixed(1)); },
      baum() { return objects.map(o => { const k = []; o.traverse(n => { if (n !== o && n.isMesh && !n.userData.isEdgeLines) k.push((n.userData.color || (n.material && n.material.color && '#' + n.material.color.getHexString())) || '?'); });
        return { name: o.userData.name, typ: o.userData.type, farbe: o.userData.color, kinder: k, bb: _g.bb(o) }; }); },
    };
  });

  // 1) Namensschild „Text auf Platte“, Pflanzenname
  await pg.evaluate((OESE) => { _openNameModal(); const s = document.getElementById('name-style'); s.value = 'plate'; _npStyleChange(); document.getElementById('name-text').value = 'Basilikum'; if (OESE === '0') document.getElementById('name-eyelet').checked = false; _namePreview(); }, process.env.OESE || '1');
  await pg.waitForTimeout(1500);
  const optionen = await pg.evaluate(() => { const v = id => { const e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : '–'; };
    return { stil: v('name-style'), groesse: v('name-size'), platte: v('name-plate'), erhaben: v('name-raise'), oese: v('name-eyelet'), mehrfarbig: v('name-multicol'), farben: (document.getElementById('name-colors') || {}).innerText }; });
  log('Dialog-Optionen:', JSON.stringify(optionen));
  const n0 = await pg.evaluate(() => objects.length);
  await pg.evaluate(() => _createNameplate());
  await pg.waitForFunction(n => objects.length > n, n0, { timeout: 60000 });
  await pg.waitForTimeout(1500);
  log('Nach Erstellen:', JSON.stringify(await pg.evaluate(() => _g.baum())));
  await pg.screenshot({ path: OUT + '/stecker_1.png' });
  var kanten = () => pg.evaluate(() => { const r = []; objects.forEach(o => o.traverse(n => { if (!n.isMesh || n.userData.isEdgeLines) return; const g = n.geometry, p = g.attributes.position, ix = g.index;
      const key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e4)).join(','); const m = new Map(); const cnt = ix ? ix.count : p.count;
      for (let t = 0; t < cnt; t += 3) { const k = [0, 1, 2].map(j => key(ix ? ix.getX(t + j) : t + j)); for (let j = 0; j < 3; j++) { const a = k[j], c = k[(j + 1) % 3]; const e = a < c ? a + '|' + c : c + '|' + a; m.set(e, (m.get(e) || 0) + 1); } }
      let off = 0; for (const c of m.values()) if (c !== 2) off++; r.push((n.userData.color || n.userData.name || '?') + ': ' + off + ' offene/mehrfache Kanten, ' + cnt / 3 + ' Dreiecke'); })); return r; });
  log('Kanten Namensschild:', JSON.stringify(await kanten()));
  log('Raster-Vergleich:', JSON.stringify(await pg.evaluate(() => { const r = []; objects.forEach(o => o.traverse(n => { if (!n.isMesh || n.userData.isEdgeLines) return; n.updateMatrixWorld(true);
    const zaehl = q => { const g = n.geometry, p = g.attributes.position, ix = g.index, v = new THREE.Vector3(); const key = i => { v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld); return Math.round(v.x * q) + '_' + Math.round(v.y * q) + '_' + Math.round(v.z * q); };
      const m = new Map(); const cnt = ix ? ix.count : p.count; let entartet = 0;
      for (let t = 0; t < cnt; t += 3) { const k = [0, 1, 2].map(j => key(ix ? ix.getX(t + j) : t + j)); if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) entartet++; for (let j = 0; j < 3; j++) { const a = k[j], c = k[(j + 1) % 3]; const e = a < c ? a + '|' + c : c + '|' + a; m.set(e, (m.get(e) || 0) + 1); } }
      let rand = 0, mehr = 0; for (const c of m.values()) { if (c === 1) rand++; else if (c > 2) mehr++; } return { rand, mehr, entartet }; };
    r.push({ farbe: n.userData.color, raster_0_01mm: zaehl(1000), raster_0_001mm: zaehl(10000) }); })); return r; })));

  // Keil-Ausrichtung ansehen (für die Spitze)
  log('Keil:', JSON.stringify(await pg.evaluate(() => { addShape('wedge'); const w = objects[objects.length - 1]; selectObjs([w]);
    const p = w.geometry.attributes.position, v = new THREE.Vector3(), pts = new Set(); w.updateMatrixWorld(true);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(w.matrixWorld); pts.add([v.x, v.y, v.z].map(x => +(x * 10).toFixed(1)).join(',')); }
    const r = { bb: _g.bb(w), ecken: [...pts] }; deleteSelected(); return r; })));
  // 2) Stab 8 × 100 × 4 mm (liegend) + Spitze: Würfel 8 × 8 × 4, Drehung Y 45° – beide in der Plattenfarbe
  const st = await pg.evaluate(async () => {
    const box = (w, d, h) => { setShapeMode('solid'); addShape('box'); const o = objects[objects.length - 1]; selectObjs([o]); numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); return o; };
    const setMin = (o, x, y, z) => { selectObjs([o]); o.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(o); o.position.x += x / 10 - bx.min.x; o.position.y += y / 10 - bx.min.y; o.position.z += z / 10 - bx.min.z; o.updateMatrixWorld(true); };
    const schild = objects[0];
    const stab = box(8, 100, 4);
    const spitze = box(8, 8, 4); selectObjs([spitze]); updateTFInputs(); document.getElementById('ry').value = 45; applyTF();
    const sb = _g.bb(schild), mx = (sb[0] + sb[3]) / 2;
    // Stab an die UNTERKANTE der Schrift (+Z = zum Betrachter): Spitze nach unten → Text richtig herum lesbar
    setMin(stab, mx - 4, 0, sb[5] - 5);
    const tb = _g.bb(spitze); setMin(spitze, mx - (tb[3] - tb[0]) / 2, 0, (sb[5] + 95) - (tb[5] - tb[2]) / 2);
    // Farbe der Platte übernehmen (wie Farbwahl im UI)
    let plattenFarbe = null; schild.traverse(n => { if (n.isMesh && !n.userData.isEdgeLines && !plattenFarbe) plattenFarbe = n.userData.color || ('#' + n.material.color.getHexString()); });
    const farbe = c => { for (const o of [stab, spitze]) { selectObjs([o]); if (typeof setColor === 'function') setColor(c); else { o.userData.color = c; o.material.color.set(c); } } };
    farbe(plattenFarbe);
    selectObjs([stab, spitze]); await unionSelected();
    return { plattenFarbe, stab: _g.bb(stab), spitze: tb, nachher: _g.baum() };
  });
  log('Stab + Spitze vereint:', JSON.stringify(st));
  log('Kanten danach:', JSON.stringify(await kanten()));
  await pg.waitForTimeout(800);
  const exp = await pg.evaluate(() => { const r = _build3mfBlob(objects); return r ? { teile: r.parts, farben: r.colors, legende: r.legend, kB: Math.round(r.blob.size / 1024) } : null; });
  log('3MF:', JSON.stringify(exp));
  const check = await pg.evaluate(async () => { _printCheckOpen(); await new Promise(r => setTimeout(r, 1500)); const t = document.getElementById('printcheck-modal').innerText.replace(/\s+/g, ' ').slice(0, 420); _printCheckClose(); return t; });
  log('Druck-Check:', check);
  await pg.evaluate(() => { selectObjs([]); if (typeof zoomToFit === 'function') zoomToFit(); });
  await pg.mouse.click(5, 900);
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: OUT + '/stecker_2.png' });
  // Gegenprobe: echtes Loch im Netz muss der Druck-Check weiterhin finden
  log('Gegenprobe Loch:', JSON.stringify(await pg.evaluate(() => { _newCreate(false); addShape('box'); const o = objects[0];
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); const p = g.attributes.position;
    const neu = new THREE.BufferGeometry(); neu.setAttribute('position', new THREE.BufferAttribute(p.array.slice(9), 3)); o.geometry = neu;   // ein Dreieck weg
    const r = _printCheckAnalyze(); return { offeneKanten: r.boundaryEdges, nichtManifold: r.nonManifold }; })));
  log('Seitenfehler:', errs);
} finally { await b.close(); }
