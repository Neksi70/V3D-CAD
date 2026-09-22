// Topper-Pin: sitzt er sauber im Buchstabenmaterial? Zeichnet Umriss + Stege + Pin
// in Draufsicht (PNG) für mehrere Schriften.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 8879;
const srv = spawn('python3', ['/home/v3da/volme3d_server.py', String(PORT), '--dev'], { cwd:'/home/v3da', stdio:'inherit' });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch();
const pg = await br.newPage({ viewport:{width:1000,height:700} });
await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
await pg.waitForFunction(() => typeof _ttGeo === 'function' && typeof hideStarter === 'function', null, {timeout:30000});
await pg.evaluate(() => hideStarter());
const fonts = (process.argv[2] || 'lobster_local,greatvibes_local,pacifico_local').split(',');
const txt = process.argv[3] || 'Mathilda';
const res = await pg.evaluate(async ({fonts, txt, pins}) => {
  const out = [];
  for (const fk of fonts) {
    const font = await new Promise(r => _npLoadFont(fk, r));
    const o = { txt, fontKey:fk, sizeMM:30, thickMM:3, overlap:8, lineGap:85, webMM:2, roundMM:0, nPins:pins, pinLen:50, pinW:4, motifSize:40, motifGap:2 };
    const r = _ttGeo(font, o, true);
    // Draufsicht: Geometrie liegt flach (Y hoch), Blick von oben → x/z
    const c = document.createElement('canvas'); c.width = 900; c.height = 700;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,900,700);
    const groups = [[r.pieces.map(p=>p.geo), '#29a3ff'], [r.bridgeGeos, '#ff9800'], [r.pinGeos, 'rgba(220,0,0,0.55)']];
    const bb = new THREE.Box3();
    for (const [gs] of groups) for (const g of gs) { g.computeBoundingBox(); bb.union(g.boundingBox); }
    const s = Math.min(860/(bb.max.x-bb.min.x), 660/(bb.max.z-bb.min.z));
    for (const [gs, col] of groups) for (const g of gs) {
      const p = g.attributes.position, idx = g.index;
      x.fillStyle = col;
      const n = idx ? idx.count : p.count;
      for (let i = 0; i < n; i += 3) {
        x.beginPath();
        for (let k = 0; k < 3; k++) { const v = idx ? idx.getX(i+k) : i+k;
          const X = 20 + (p.getX(v)-bb.min.x)*s, Y = 20 + (p.getZ(v)-bb.min.z)*s;
          k ? x.lineTo(X,Y) : x.moveTo(X,Y); }
        x.fill();
      }
    }
    out.push({ fk, png: c.toDataURL('image/png') });
  }
  return out;
}, {fonts, txt, pins:+(process.env.PINS||1)});
for (const r of res) fs.writeFileSync(`/tmp/tt_pin_${r.fk}${process.argv[4]||''}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
console.log(res.map(r=>'/tmp/tt_pin_'+r.fk+(process.argv[4]||'')+'.png').join('\n'));
await br.close(); srv.kill();
