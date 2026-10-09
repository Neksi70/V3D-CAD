// Station 1 (Grundkurs, Folie 22) komplett über die Oberfläche, wie ein Teilnehmer:
// Generatoren → Namensschild (Text auf Platte, Öse aus) → Box 8×100×4 → Ausrichten mit dem Schild →
// Würfel als Spitze, 45° drehen, ausrichten, mit dem Pfeil nachschieben → Vereinen → Druck-Check → 3MF.
// SPITZE=8 (Würfel 8×8×4 wie auf der Folie) | 5.7 (Diagonale = Stabbreite)   NAME=Basilikum
// Gegen die ausgelieferte App (:8765, Cookie). Ergebnis-3MF: /tmp/st1_<NAME>.3mf
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';

const URL = process.env.V3D_URL || 'http://localhost:8765/volme3d.html';
const NAME = process.env.NAME || 'Basilikum', SP = process.env.SPITZE || '8';
const cookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('station1','test@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/' }]);
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
const log = (...a) => console.log(...a);
const shot = n => pg.screenshot({ path: `/tmp/st1_${n}.png` });
// Nutzer-Achsen: X = Breite, Y = Tiefe (intern z), Z = Höhe (intern y); Werte in mm
const lage = () => pg.evaluate(() => objects.map(o => { o.updateMatrixWorld(true); const x = new THREE.Box3().setFromObject(o);
  const f = []; o.traverse(n => { if (n.isMesh && !n.userData.isEdgeLines) f.push(n.userData.color || '#' + n.material.color.getHexString()); });
  return { name: o.userData.name, farben: [...new Set(f)], X: [x.min.x, x.max.x].map(v => +(v * 10).toFixed(1)), Y: [x.min.z, x.max.z].map(v => +(v * 10).toFixed(1)), Z: [x.min.y, x.max.y].map(v => +(v * 10).toFixed(1)) }; }));
const waehle = namen => pg.evaluate(namen => selectObjs(objects.filter(o => namen.includes(o.userData.name))), namen);
const ausrichten = async knoepfe => {
  await pg.evaluate(() => { const sel = selectedObjs.slice(); setView('iso'); fitView(); selectObjs(sel); }); await pg.waitForTimeout(300);
  await pg.locator('button[onclick="alignTool()"]').click(); await pg.waitForTimeout(300);
  for (const k of knoepfe) {
    const i = await pg.evaluate(k => [...document.querySelectorAll('#align-handles .al-tip')].findIndex(t => t.textContent === k), k);
    const dot = pg.locator('#align-handles .al-dot').nth(i);
    if (i < 0 || !(await dot.isVisible())) { await shot('ausrichten_' + k); throw new Error('Ausricht-Punkt „' + k + '“ nicht sichtbar'); }
    await dot.click(); await pg.waitForTimeout(200);
  }
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
};
const box = async (w, d, h, name) => {
  const vorher = await pg.evaluate(() => objects.length);
  await pg.locator('text=Körper hinzufügen').first().click(); await pg.waitForTimeout(300);
  await pg.locator('.shp:visible', { hasText: /^\s*Box\s*$/ }).first().click(); await pg.waitForTimeout(500);
  await pg.waitForFunction(n => objects.length > n, vorher);
  for (const [id, v] of [['fpw', w], ['fpd', d], ['fph', h]]) { const f = pg.locator(`#${id}`); if (!(await f.isVisible())) throw new Error(id + ' nicht sichtbar'); await f.fill(String(v)); await f.press('Enter'); await pg.waitForTimeout(150); }
  await pg.evaluate(n => { const o = objects[objects.length - 1]; o.userData.name = n; updateTree(); }, name);
};

try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof _createNameplate === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => { hideStarter(); const a = document.getElementById('auth-overlay'); if (a) a.style.display = 'none'; _newCreate(false); });
  log('Version:', await pg.evaluate(() => VOLME3D_VERSION), '| Spitze', SP, 'mm');

  // 1) Namensschild
  await pg.locator('text=Generatoren').first().click(); await pg.waitForTimeout(300);
  await pg.locator('text=Namensschild').first().click(); await pg.waitForTimeout(400);
  await pg.selectOption('#name-style', 'plate'); await pg.fill('#name-text', NAME);
  if (await pg.locator('#name-eyelet').isChecked()) await pg.locator('#name-eyelet').click();
  await pg.waitForTimeout(600);
  await pg.locator('#name-modal button', { hasText: 'Erstellen' }).click();
  await pg.waitForFunction(() => objects.length === 1, null, { timeout: 60000 }); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { objects[0].userData.name = 'Schild'; });

  // 2) Stab 8 × 100 × 4 und Spitze (Würfel SP × SP × 4, 2× „↻ Drehen“ = 45°) – erst fertig machen, dann ans Schild
  await box(8, 100, 4, 'Stab');
  await box(SP, SP, 4, 'Spitze');
  await waehle(['Spitze']);
  for (let i = 0; i < 2; i++) { await pg.locator('button[onclick="rotate225(\'y\',1)"]').first().click(); await pg.waitForTimeout(250); }
  log('Spitze gedreht (Grad um Z):', await pg.evaluate(() => { const o = objects.find(o => o.userData.name === 'Spitze'); return +(o.rotation.y * 180 / Math.PI).toFixed(1); }));
  await waehle(['Stab', 'Spitze']);
  await ausrichten(['Horizontal mittig', 'Hinten']);
  log('Spitze mittig + Hinten:', JSON.stringify(await lage()));
  // mit dem Tiefen-Pfeil um die halbe Diagonale nach hinten schieben
  const halbDiag = +(SP * Math.SQRT2 / 2).toFixed(1);
  await pg.evaluate(() => { const s = objects.find(o => o.userData.name === 'Spitze'); s.updateMatrixWorld(true); orbitTarget.copy(new THREE.Box3().setFromObject(s).getCenter(new THREE.Vector3())); sph.theta = 0.5; sph.phi = 0.9; sph.r = 12; sph2cam(); camera.updateMatrixWorld(true); });
  await pg.mouse.click(5, 900); await waehle(['Spitze']); await pg.waitForTimeout(300);
  const tipZ = await pg.evaluate(() => { _mgUpdate(); const g = _mg.group; const v = _mgAxisVec('z'); const p = g.position.clone().addScaledVector(v, 0.8 * g.scale.x).project(camera); const r = renderer.domElement.getBoundingClientRect();
    const q = g.position.clone().addScaledVector(v, 0.8 * g.scale.x + 1).project(camera);
    return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height, dx: (q.x - p.x) * 0.5 * r.width, dy: -(q.y - p.y) * 0.5 * r.height }; });
  const pxmm = Math.hypot(tipZ.dx, tipZ.dy) / 10, ux = tipZ.dx / Math.hypot(tipZ.dx, tipZ.dy), uy = tipZ.dy / Math.hypot(tipZ.dx, tipZ.dy);
  await pg.mouse.move(tipZ.x, tipZ.y); await pg.mouse.down();
  let anzeige = '';
  for (let i = 1; i <= 30; i++) { await pg.mouse.move(tipZ.x + ux * pxmm * halbDiag * i / 30, tipZ.y + uy * pxmm * halbDiag * i / 30); await pg.waitForTimeout(15);
    anzeige = await pg.evaluate(() => (document.getElementById('mg-tip') || {}).textContent || ''); }
  await pg.mouse.up(); await pg.waitForTimeout(300);
  log(`Pfeil-Zug (Soll +${halbDiag} mm): Anzeige zuletzt „${anzeige}“`);
  await waehle(['Stab', 'Spitze']);
  await pg.locator('button', { hasText: 'Vereinen' }).first().click();
  await pg.waitForFunction(() => objects.length === 2, null, { timeout: 60000 }); await pg.waitForTimeout(800);
  await pg.evaluate(() => { objects.find(o => o.userData.name !== 'Schild').userData.name = 'Stab'; });
  log('Stab + Spitze vereint:', JSON.stringify(await lage()));
  await shot('4_stab');

  // 3) Stab ans Schild: beide wählen → Horizontal mittig + Vorne
  await waehle(['Schild', 'Stab']);
  await ausrichten(['Horizontal mittig', 'Vorne']);
  log('Stab am Schild (mittig + Vorne):', JSON.stringify(await lage()));
  const mitte = await pg.evaluate(() => objects.map(o => { const x = new THREE.Box3().setFromObject(o); return +((x.min.x + x.max.x) * 5).toFixed(2); }));
  log('Mitte X Schild/Stab (mm):', JSON.stringify(mitte));

  // Kontrolle: berührt der Stab das Schild? Überlappung Stab/Schild in Y
  const ueb = await pg.evaluate(() => { const [a, c] = objects; const A = new THREE.Box3().setFromObject(a), C = new THREE.Box3().setFromObject(c); const i = A.clone().intersect(C);
    return i.isEmpty() ? 0 : +((i.max.z - i.min.z) * 10).toFixed(1); });
  log('Überlappung Stab ↔ Schild in Y (mm):', ueb);

  // 5) Druck-Check + 3MF über das Export-Menü
  await pg.evaluate(() => deselect());
  const check = await pg.evaluate(async () => { _printCheckOpen(); await new Promise(r => setTimeout(r, 1800)); const t = document.getElementById('printcheck-modal').innerText.replace(/\s+/g, ' '); _printCheckClose(); return t.slice(0, 600); });
  log('Druck-Check:', check);
  await pg.locator('#stl-wrap button.spl').click(); await pg.waitForTimeout(300);
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }).catch(() => null), pg.locator('#stl-menu .sli-item[onclick="export3MF()"]').click()]);
  if (dl) { const p = `/tmp/st1_${NAME}_${SP}.3mf`; await dl.saveAs(p); log('3MF heruntergeladen:', p, fs.statSync(p).size, 'Bytes', '| Vorschlag Name:', dl.suggestedFilename()); }
  else log('3MF: KEIN Download ausgelöst');
  await pg.waitForTimeout(500);
  await shot('5_ende');
  log('Seitenfehler:', errs);
} finally { await b.close(); }
