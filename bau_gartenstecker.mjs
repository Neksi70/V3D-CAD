// Gartenstecker für Station 1 (Grundkurs 09.10.2026, Bambu H2C + AMS, ASA zweifarbig) als fertige Musterdatei.
// Klickweg wie im Kurs (test_gartenstecker.mjs): Namensschild „Text auf Platte“ ohne Öse, Stab 8 × 100 × 4 + Spitze
// (Würfel 8 × 8 × 4, Y 45°) in Plattenfarbe → vereinen. 3MF: Platte+Stab = Filament 1, Schrift = Filament 2.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';

const URL = process.env.V3D_URL || 'http://localhost:8765/volme3d.html';
const ZIEL = process.env.ZIEL || '/home/v3da/kurs-grundkurs';
const TEXT = process.env.TEXT || 'Basilikum';
fs.mkdirSync(ZIEL, { recursive: true });
const cookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('gartenstecker','test@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/' }]);
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);

try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof _createNameplate === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => {
    hideStarter(); _newCreate(false);
    window._g = { bb(o) { o.updateMatrixWorld(true); const x = new THREE.Box3().setFromObject(o); return [x.min.x, x.min.y, x.min.z, x.max.x, x.max.y, x.max.z].map(v => +(v * 10).toFixed(1)); } };
  });

  // 1) Namensschild „Text auf Platte“, ohne Öse
  await pg.evaluate((t) => { _openNameModal(); const s = document.getElementById('name-style'); s.value = 'plate'; _npStyleChange(); document.getElementById('name-text').value = t; document.getElementById('name-eyelet').checked = false; _namePreview(); }, TEXT);
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => _createNameplate());
  await pg.waitForFunction(() => objects.length > 0, null, { timeout: 60000 });
  await pg.waitForTimeout(1500);

  // 2) Stab + Spitze in Plattenfarbe, vereinen
  const st = await pg.evaluate(async () => {
    const box = (w, d, h) => { setShapeMode('solid'); addShape('box'); const o = objects[objects.length - 1]; selectObjs([o]); numChanged('sw', w); numChanged('sd', d); numChanged('sh', h); return o; };
    const setMin = (o, x, y, z) => { selectObjs([o]); o.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(o); o.position.x += x / 10 - bx.min.x; o.position.y += y / 10 - bx.min.y; o.position.z += z / 10 - bx.min.z; o.updateMatrixWorld(true); };
    const schild = objects[0];
    const stab = box(8, 100, 4);
    const spitze = box(8, 8, 4); selectObjs([spitze]); updateTFInputs(); document.getElementById('ry').value = 45; applyTF();
    const sb = _g.bb(schild), mx = (sb[0] + sb[3]) / 2;
    setMin(stab, mx - 4, 0, sb[2] - 95);
    const tb = _g.bb(spitze); setMin(spitze, mx - (tb[3] - tb[0]) / 2, 0, (sb[2] - 95) - (tb[5] - tb[2]) / 2);
    let plattenFarbe = null; schild.traverse(n => { if (n.isMesh && !n.userData.isEdgeLines && !plattenFarbe) plattenFarbe = n.userData.color || ('#' + n.material.color.getHexString()); });
    for (const o of [stab, spitze]) { selectObjs([o]); setColor(plattenFarbe); }
    selectObjs([stab, spitze]); await unionSelected();
    return { plattenFarbe, objekte: objects.length };
  });
  log('Stab + Spitze:', JSON.stringify(st));
  await pg.waitForTimeout(800);
  const gesamt = await pg.evaluate(() => { const bx = new THREE.Box3(); objects.forEach(o => { o.updateMatrixWorld(true); bx.expandByObject(o); }); return [bx.max.x - bx.min.x, bx.max.y - bx.min.y, bx.max.z - bx.min.z].map(v => +(v * 10).toFixed(1)); });
  log('Gesamtmaß (mm, x/y/z):', JSON.stringify(gesamt));
  const check = await pg.evaluate(async () => { _printCheckOpen(); await new Promise(r => setTimeout(r, 1500)); const t = document.getElementById('printcheck-modal').innerText.replace(/\s+/g, ' ').slice(0, 420); _printCheckClose(); return t; });
  log('Druck-Check:', check);

  // 3) 3MF speichern
  const exp = await pg.evaluate(async () => { const r = _build3mfBlob(objects); const buf = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), teile: r.parts, farben: r.colors, legende: r.legend }; });
  const datei = `${ZIEL}/Gartenstecker_${TEXT}_ASA-zweifarbig.3mf`;
  fs.writeFileSync(datei, Buffer.from(exp.b64, 'base64'));
  log('3MF:', JSON.stringify({ teile: exp.teile, farben: exp.farben, legende: exp.legende }), '→', datei);

  await pg.evaluate(() => { selectObjs([]); try { setView('iso'); } catch (e) {} if (typeof zoomToFit === 'function') zoomToFit(); });
  await pg.mouse.move(700, 500);
  await pg.waitForTimeout(1200);
  // Anmelde-Overlay (nur fürs Speichern in der Cloud) fürs Vorschaubild ausblenden
  await pg.evaluate(() => { let e = document.querySelector('input[type=password]'); while (e && e.parentElement && getComputedStyle(e).position !== 'fixed') e = e.parentElement; if (e && e !== document.body) e.style.display = 'none'; });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${ZIEL}/Gartenstecker_Vorschau.png` });
  log('Seitenfehler:', errs);
} finally { await b.close(); }
