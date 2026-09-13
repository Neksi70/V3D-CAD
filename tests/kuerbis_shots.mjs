// Bildbelege für den Kürbis-Generator: Vorschau je Vorlage + der fertige
// Körper in der Szene. Start: npm run dev (Port 8766).
import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const OUT = process.env.OUT || '/tmp/kbs';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
pg.on('pageerror', e => console.log('PAGEERROR', String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => { document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden'); });

// WebGL ohne preserveDrawingBuffer: erst rendern, dann im GLEICHEN Schritt lesen
const save = async (name, sel) => {
  const d = await pg.evaluate(s => {
    const g = _gpv['kbs'];
    if (s === '#kbs-canvas' && g) g.r.render(g.sc, g.cam);
    else if (typeof renderer !== 'undefined') renderer.render(scene, camera);
    return document.querySelector(s)?.toDataURL('image/png');
  }, sel);
  if (!d) { console.log('kein Canvas für ' + name); return; }
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(d.split(',')[1], 'base64'));
  console.log('→ ' + OUT + '/' + name + '.png');
};

for (const v of ['halloween', 'deko', 'schale']) {
  await pg.evaluate(k => { _openKbsModal(); _kbsPreset(k); }, v);
  await pg.waitForTimeout(1000);
  await pg.evaluate(a => { if (_gpv['kbs'] && _gpv['kbs'].group) _gpv['kbs'].group.rotation.y = a; }, 0.35);
  await save('vorschau_' + v, '#kbs-canvas');
  await pg.evaluate(() => _closeKbsModal());
}

// fertige Deko-Dose in der Szene, Deckel zur Seite gelegt
await pg.evaluate(async () => {
  Object.assign(_kbsP, _KBS_DEFAULTS, _KBS_PRESETS.deko);
  await _kbsCreate();
  const grp = objects[objects.length - 1];
  const lid = grp.children && grp.children[1];
  if (lid) { lid.position.x += 16; lid.position.y += 2; }
  fitToObjects([grp]);
});
await pg.waitForTimeout(1500);
await save('szene_deko', '#c3d');
await b.close();
