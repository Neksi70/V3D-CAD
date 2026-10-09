// Namensschild-Generator: Farbwahl im Fenster (v1.18.137). Platte/Text getrennt, Text zieht mit bis er von Hand
// gewählt wird, Freistehend ein Farbfeld, Mehrfarbig blendet es aus. Gegen den Dev-Server (:8766, rohe volme3d.html).
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { execFileSync } from 'child_process';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const cookie = execFileSync('python3', ['-c', "import v3d_auth;print(v3d_auth.make_cookie('farbwahl','test@lokal'))"], { cwd: '/home/v3da' }).toString().trim();
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addCookies([{ name: 'v3dsess', value: cookie, domain: 'localhost', path: '/' }]);
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fehler = 0; const ok = (b, t) => { console.log((b ? '✔ ' : '✘ ') + t); if (!b) fehler++; };
try {
  await pg.goto(URL);
  await pg.waitForFunction(() => typeof _createNameplate === 'function', null, { timeout: 30000 });
  await pg.evaluate(() => { hideStarter(); _newCreate(false); });
  // Text auf Platte
  const r1 = await pg.evaluate(async () => {
    const v = id => document.getElementById(id);
    _openNameModal(); v('name-style').value = 'plate'; _npStyleChange(); v('name-text').value = 'Basilikum'; v('name-eyelet').checked = false;
    const start = { platte: v('name-col-plate').value, text: v('name-col-text').value, aktiv: currentColor, sichtbar: getComputedStyle(v('name-row-col')).display !== 'none', textSichtbar: getComputedStyle(v('name-col-text-wrap')).display !== 'none' };
    v('name-col-plate').value = '#ffe000'; v('name-col-plate').dispatchEvent(new Event('input'));
    const mitgezogen = v('name-col-text').value;
    v('name-col-text').value = '#008000'; v('name-col-text').dispatchEvent(new Event('input'));
    v('name-col-plate').value = '#0078ff'; v('name-col-plate').dispatchEvent(new Event('input'));
    const handText = v('name-col-text').value;
    _namePreview(); await new Promise(r => setTimeout(r, 300));
    const cv = v('name-preview') || document.querySelector('#name-modal canvas'); const c = cv.getContext('2d').getImageData(cv.width / 2 - 60, cv.height / 2 - 8, 1, 1).data; // Rand der Platte, neben dem Text
    const n0 = objects.length; _createNameplate();
    for (let i = 0; i < 100 && objects.length === n0; i++) await new Promise(r => setTimeout(r, 100));
    const farben = {}; objects[objects.length - 1].traverse(n => { if (n.isMesh && !n.userData.isEdgeLines) farben[n.userData.name] = n.userData.color; });
    return { start, mitgezogen, handText, vorschauPixel: [c[0], c[1], c[2]], farben, aktivDanach: currentColor };
  });
  console.log(JSON.stringify(r1));
  ok(r1.start.platte === r1.start.aktiv.toLowerCase(), 'Platte startet mit aktiver Farbe');
  ok(r1.start.sichtbar && r1.start.textSichtbar, 'bei „Text auf Platte“ zwei Farbfelder sichtbar');
  ok(r1.mitgezogen === '#1a1a1a', 'Text zieht bei heller Platte auf Kontrast (dunkel) mit');
  ok(r1.vorschauPixel.join() === '0,128,0' || r1.vorschauPixel[1] > 100 && r1.vorschauPixel[0] < 30, 'Vorschau zeichnet den Text in der gewählten Farbe');
  ok(r1.handText === '#008000', 'von Hand gewählter Text bleibt beim Ändern der Platte');
  ok(r1.farben.Platte === '#0078ff' && r1.farben.Text === '#008000', 'erstelltes Schild hat Platte/Text in den gewählten Farben');
  // Freistehend
  const r2 = await pg.evaluate(async () => {
    const v = id => document.getElementById(id);
    _openNameModal(); v('name-style').value = 'free'; _npStyleChange(); v('name-multicol').checked = false; _npColorsRebuild();
    const vis = { zeile: getComputedStyle(v('name-row-col')).display !== 'none', text: getComputedStyle(v('name-col-text-wrap')).display !== 'none', label: v('name-col-plate-label').textContent };
    v('name-col-plate').value = '#ff3366'; v('name-col-plate').dispatchEvent(new Event('input'));
    const n0 = objects.length; _createNameplate();
    for (let i = 0; i < 150 && objects.length === n0; i++) await new Promise(r => setTimeout(r, 100));
    const o = objects[objects.length - 1];
    v('name-multicol').checked = true; _npColorsRebuild();
    const multiZeile = getComputedStyle(v('name-row-col')).display !== 'none';
    v('name-multicol').checked = false; _closeNameModal();
    return { vis, farbe: o.userData.color, multiZeile };
  });
  console.log(JSON.stringify(r2));
  ok(r2.vis.zeile && !r2.vis.text && r2.vis.label === 'Schild', 'Freistehend: ein Farbfeld „Schild“');
  ok(r2.farbe === '#ff3366', 'freistehendes Schild in der gewählten Farbe');
  ok(!r2.multiZeile, 'Mehrfarbig blendet das Farbfeld aus (Buchstabenfarben übernehmen)');
  ok(errs.length === 0, 'keine Seitenfehler ' + JSON.stringify(errs));
} finally { await b.close(); }
console.log(fehler ? `${fehler} Fehler` : 'alles grün'); process.exit(fehler ? 1 : 0);
