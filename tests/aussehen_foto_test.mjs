// Aussehen (nur Anzeige) + Foto erstellen
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 8977;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof setLook === 'function' && typeof objects !== 'undefined');
  const r1 = await p.evaluate(() => { try { hideStarter(); } catch (e) {}
    _newCreate(false); addShape('torus'); const o = objects[0]; o.scale.setScalar(1.5); o.updateMatrixWorld(true); o.position.y -= getMeshBox(o).min.y;
    addShape('cylinder'); const c = objects[1]; c.position.set(4, 0, 0); c.updateMatrixWorld(true); c.position.y -= getMeshBox(c).min.y;
    selectObjs([o]); setColor('#d4a017'); setLook('chrom');
    const m = o.material;
    return { look: o.userData.look, metal: m.metalness, rough: m.roughness, env: !!m.envMap, color: o.userData.color, sel: document.getElementById('look-sel').value };
  });
  ok(r1.look === 'chrom' && r1.metal === 1 && r1.rough < 0.1 && r1.env && r1.sel === 'chrom', 'Chrom gesetzt: Metall 1, Rauheit ' + r1.rough + ', Spiegelung an, Auswahlfeld zeigt Chrom');
  ok(r1.color === '#d4a017', 'Farbe bleibt (' + r1.color + ')');
  const r2 = await p.evaluate(() => {
    const o = objects[0], d = JSON.parse(JSON.stringify(objectToData(o))), o2 = buildObjectFromData(d);
    const res = { look: o2.userData.look, metal: o2.material.metalness };
    selectObjs([objects[1]]); setLook('glas');
    const g = objects[1].material; res.glas = { t: g.transparent, op: g.opacity };
    undo(); return res;
  });
  ok(r2.look === 'chrom' && r2.metal === 1, 'Speichern/Laden behält das Aussehen');
  ok(r2.glas.t && r2.glas.op < 0.5, 'Glas: durchsichtig (' + r2.glas.op + ')');
  const r3 = await p.evaluate(() => ({ look: objects[1].userData.look || 'standard', op: objects[1].material.opacity }));
  ok(r3.look === 'standard' && r3.op === 1, 'Rückgängig nimmt Glas zurück');
  // Foto
  await p.evaluate(() => { selectObjs([objects[0]]); sph.theta = 0.7; sph.phi = 1.0; sph.r = 14; orbitTarget.set(2, 1, 0); sph2cam(); _fotoOpen(); _fotoSet('groesse', '1920x1080'); _fotoSet('bg', 'verlauf'); _fotoSet('licht', 'studio'); });
  await p.click('#foto-go');
  await p.waitForFunction(() => _foto.url && !document.getElementById('foto-go').disabled, null, { timeout: 60000 });
  const f1 = await p.evaluate(() => new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.width, h: im.height, len: _foto.url.length, sel: selectedObjs.length }); im.src = _foto.url; }));
  ok(f1.w === 1920 && f1.h === 1080 && f1.len > 50000, `Foto 1920×1080 (${Math.round(f1.len / 1024)} KB)`);
  ok(f1.sel === 1, 'Auswahl danach wiederhergestellt');
  fs.writeFileSync('/tmp/foto1.png', Buffer.from((await p.evaluate(() => _foto.url)).split(',')[1], 'base64'));
  // transparenter Hintergrund: Ecke muss Alpha 0 haben
  await p.evaluate(() => _fotoSet('bg', 'transparent')); await p.click('#foto-go');
  await p.waitForFunction(() => !document.getElementById('foto-go').disabled, null, { timeout: 60000 });
  const a = await p.evaluate(() => new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); res([g.getImageData(3, 3, 1, 1).data[3], g.getImageData(im.width / 2 | 0, im.height / 2 | 0, 1, 1).data[3]]); }; im.src = _foto.url; }));
  ok(a[0] === 0 && a[1] > 200, 'transparenter Hintergrund: Ecke durchsichtig, Mitte (Teil) deckend ' + a);
  const vis = await p.evaluate(() => ({ grid: scene.children.filter(c => c.visible).length, n: objects.length, env: scene.environment === null || scene.environment === undefined, envM: objects[1].material.envMap === null }));
  ok(vis.env && vis.envM && vis.grid > vis.n, 'Szene danach unverändert (Raster/Platte wieder sichtbar, keine Umgebung hängen geblieben)');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
