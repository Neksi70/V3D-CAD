// Erzeugt Beispiel-Screenshots des Halterplatten-Generators (für Ralf).
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = '/home/v3da/screenshots/halterplatte';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
await pg.goto('http://127.0.0.1:8766/volme3d.html', { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});
await pg.evaluate(() => new Promise(r => _npLoadFont('baloo_local', r)));

const CANVAS = { x: 40, y: 165, width: 1340, height: 830 };   // nur der 3D-Bereich

// 0) Wo steckt der Generator? — Katalog mit der neuen Kachel
await pg.evaluate(() => showStarter());
await pg.waitForTimeout(3000);                       // Vorschau-Thumbnails abwarten
await pg.evaluate(() => {
  const c = [...document.querySelectorAll('.st-card')].find(e => e.textContent.includes('Halterplatte'));
  c?.scrollIntoView({ block: 'center' });
  if (c) { c.style.outline = '3px solid #ff7a1a'; c.style.borderRadius = '10px'; }
});
await pg.waitForTimeout(600);
await pg.screenshot({ path: `${OUT}/0-wo-zu-finden.png` });
await pg.evaluate(() => document.getElementById('start-modal')?.classList.remove('show'));
await pg.evaluate(() => document.querySelectorAll('.gen-menu,.sdd-menu,#gen-dd-menu').forEach(e => e.classList.remove('show', 'open')));
await pg.keyboard.press('Escape');
console.log('→ 0-wo-zu-finden');

// 1) Der Dialog mit Live-Vorschau
await pg.evaluate(() => { Object.assign(_hpP, _HP_DEFAULTS); _hpOpen(); });
await pg.waitForTimeout(2500);
await pg.locator('#hp-modal .g3box').screenshot({ path: `${OUT}/1-dialog.png` });
await pg.evaluate(() => _hpClose());
console.log('→ 1-dialog');

const bau = async (params, view = 'iso', zoom = 1.5) => {
  await pg.evaluate(([p, v, z]) => {
    [...objects].forEach(o => scene.remove(o));
    objects.length = 0; deselect(); updateTree();
    Object.assign(_hpP, _HP_DEFAULTS, p);
    _createHp();
    deselect();
    setView(v);
    const box = new THREE.Box3(); objects.forEach(o => box.expandByObject(o));
    box.getCenter(orbitTarget);
    const sz = box.getSize(new THREE.Vector3());
    sph.r = Math.max(sz.x, sz.y, sz.z) * z;
    sph2cam();
  }, [params, view, zoom]);
  await pg.waitForTimeout(800);
};
const shot = async name => { await pg.screenshot({ path: `${OUT}/${name}.png`, clip: CANVAS }); console.log('→', name); };

// 2) Bohrerhalter 3–10 mm, beschriftet
await bau({ shape: 'round', cols: 8, rows: 1, size: 3, step: 1, grade: 1, clr: 0.3, depth: 15, h: 22, label: 1 }, 'iso', 1.35);
await shot('2-bohrerhalter');
await bau({ shape: 'round', cols: 8, rows: 1, size: 3, step: 1, grade: 1, clr: 0.3, depth: 15, h: 22, label: 1 }, 'top', 1.15);
await shot('3-bohrerhalter-oben');

// 3) Inbus-Satz, Sechskant, 2 Reihen
await bau({ shape: 'hex', cols: 6, rows: 2, size: 2, step: 0.5, grade: 1, clr: 0.25, depth: 18, h: 26, gap: 9, label: 1 }, 'iso', 1.5);
await shot('4-inbus-sechskant');
await bau({ shape: 'hex', cols: 6, rows: 2, size: 2, step: 0.5, grade: 1, clr: 0.25, depth: 18, h: 26, gap: 9, label: 1 }, 'top', 1.2);
await shot('5-inbus-oben');

// 4) Tortentopper-Ständer: schmale Schlitze
await bau({ shape: 'rect', cols: 5, rows: 1, size: 2.5, size2: 45, grade: 0, clr: 0.4, depth: 12, h: 16, gap: 14, edge: 8, corner: 6, label: 0 }, 'iso', 1.5);
await shot('6-tortentopper-schlitze');

// 5) Raster, durchgehende Löcher
await bau({ shape: 'round', cols: 5, rows: 4, size: 9, grade: 0, clr: 0.5, through: 1, h: 12, gap: 7, corner: 5, label: 0 }, 'iso', 1.5);
await shot('7-raster-durchgehend');

// 6) Spar-Gitter — Blick auf die Unterseite
await bau({ shape: 'round', cols: 6, rows: 3, size: 6, grade: 0, depth: 14, h: 30, fill: 'grid', fillPct: 40, gap: 8, label: 0 }, 'iso', 1.6);
await pg.evaluate(() => {
  const o = objects[0];
  o.geometry.computeBoundingBox();
  const h = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y;
  o.rotation.x = Math.PI;          // auf den Rücken legen …
  o.position.y = h;                // … und anheben, sonst steckt es im Boden
  o.updateMatrixWorld(true);
  const box = new THREE.Box3(); objects.forEach(b => box.expandByObject(b));
  box.getCenter(orbitTarget); sph2cam();
});
await pg.waitForTimeout(700);
await shot('8-spargitter-unterseite');

console.log('pageErrors:', errs);
await b.close();
