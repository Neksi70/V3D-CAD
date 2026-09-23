// Headless-Test Laservorlage (Draufsicht) gegen eigenen --dev-Server.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = process.env.LZ_PORT || '8841';
let srv = null;
const URL = process.env.LZ_URL || (srv = spawn('python3', ['volme3d_server.py', PORT, '--dev'], { stdio: 'inherit' }), `http://127.0.0.1:${PORT}/volme3d.html`);
await new Promise(r => setTimeout(r, 1500));
const errs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => typeof _lzOpen === 'function', null, { timeout: 30000 });
await page.evaluate(() => { hideStarter(); _newCreate(false); });
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };

const r = await page.evaluate(async () => {
  const out = {};
  const bbMm = o => { const b = new THREE.Box3().setFromObject(o); return { w: (b.max.x-b.min.x)*10, d: (b.max.z-b.min.z)*10 }; };
  addShape('box'); const box = objects[objects.length-1];
  const bx = bbMm(box);
  let p = await _lzOutline([box], true, 0);
  let b = _lzBounds(p);
  out.box = { n: p.length, w: b.w, h: b.h, exp: bx, nPts: p[0]?.pts.length };
  p = await _lzOutline([box], true, 0.2); b = _lzBounds(p);
  out.kerf = { w: b.w, h: b.h };
  box.rotation.y = Math.PI / 4; box.updateMatrixWorld(true);
  p = await _lzOutline([box], true, 0); b = _lzBounds(p);
  out.rot = { w: b.w, nPts: p[0]?.pts.length, exp: bx.w * Math.SQRT2 };
  box.rotation.y = 0; box.updateMatrixWorld(true);
  // Orientierung: Kugel HINTER der Box (Welt -Z) muss in der Draufsicht OBEN liegen (größeres y)
  addShape('sphere'); const sph = objects[objects.length-1];
  sph.position.set(box.position.x, box.position.y, box.position.z - 6); sph.updateMatrixWorld(true);
  p = await _lzOutline([box, sph], true, 0);
  const cy = poly => poly.pts.reduce((s, q) => s + q[1], 0) / poly.pts.length;
  const ps = p.map(q => ({ n: q.pts.length, cy: cy(q) })).sort((a, c) => c.n - a.n);
  out.orient = { n: p.length, sphereCy: ps[0]?.cy, boxCy: ps[1]?.cy };
  // Torus: Loch von oben sichtbar
  addShape('torus'); const tor = objects[objects.length-1]; tor.rotation.x = Math.PI / 2; tor.updateMatrixWorld(true);
  p = await _lzOutline([tor], true, 0);
  out.torus = { n: p.length, holes: p.filter(q => q.hole).length };
  p = await _lzOutline([tor], false, 0);
  out.torusNoHoles = { n: p.length, holes: p.filter(q => q.hole).length };
  out.svg = _lzSvg(await _lzOutline([tor], true, 0)).slice(0, 400);
  out.dxf = _lzDxf(await _lzOutline([tor], true, 0)).split('\r\n').slice(0, 24).join('|');
  return out;
});
console.log(JSON.stringify(r, null, 1).slice(0, 2500));
ok(r.box.n === 1 && Math.abs(r.box.w - r.box.exp.w) < 0.05 && Math.abs(r.box.h - r.box.exp.d) < 0.05 && r.box.nPts === 4, 'Box = Rechteck in Originalgröße');
ok(Math.abs(r.kerf.w - (r.box.w + 0.2)) < 0.02, 'Kerf 0,2 mm → +0,2 mm Breite');
ok(Math.abs(r.rot.w - r.rot.exp) < 0.1 && r.rot.nPts === 4, '45° gedrehte Box = Raute mit Diagonalbreite');
ok(r.orient.n === 2 && r.orient.sphereCy > r.orient.boxCy, 'Objekt hinten liegt in der Vorlage oben (wie Ansicht Oben)');
ok(r.torus.n === 2 && r.torus.holes === 1, 'Torus: Außenkontur + 1 Loch');
ok(r.torusNoHoles.n === 1 && r.torusNoHoles.holes === 0, 'Löcher abgeschaltet → nur Außenkontur');
ok(/width="[\d.]+mm"/.test(r.svg) && r.svg.includes('stroke="#ff0000"'), 'SVG in mm mit roter Haarlinie');
ok(r.dxf.includes('$INSUNITS|70|4') && r.dxf.includes('LWPOLYLINE'), 'DXF mit mm-Einheit und Polylinien');

// UI: Dialog öffnen, Download auslösen
await page.evaluate(() => { selectObjs([objects[2]]); });
await page.evaluate(() => _lzOpen());
await page.waitForFunction(() => !document.getElementById('lz-btn').disabled, null, { timeout: 20000 });
fs.writeFileSync('/tmp/claude-1000/-home-v3da/d2cfa025-aab1-4e45-b26a-37c1656fb4b8/scratchpad/lz_dialog.png', await page.locator('#lz-modal .g3box').screenshot());
const info = await page.evaluate(() => document.getElementById('lz-info').innerText);
console.log('Info:', info.split('\n')[0]);
for (const fmt of ['svg', 'dxf']) {
  await page.evaluate(f => _lzSet('fmt', f), fmt);
  if (fmt === 'dxf') await page.evaluate(() => _lzOpen()).then(() => page.waitForFunction(() => !document.getElementById('lz-btn').disabled));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.click('#lz-btn')]);
  ok(dl && dl.suggestedFilename().endsWith('_laser.' + fmt), 'Download ' + fmt + ': ' + (dl && dl.suggestedFilename()));
}
ok(!errs.length, 'keine Konsolenfehler ' + errs.join(' / '));
await browser.close(); if (srv) srv.kill();
console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK'); process.exit(fail ? 1 : 0);
