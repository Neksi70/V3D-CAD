import { chromium } from '@playwright/test';
import { writeFileSync } from 'fs';

// Binäres STL: Würfel 60×60×60 mm
function cubeSTL(s) {
  const faces = [];
  const q = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const quads = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[3,0,4,7]];
  for (const [a,b,c,d] of quads) { faces.push([q[a],q[b],q[c]]); faces.push([q[a],q[c],q[d]]); }
  const buf = Buffer.alloc(84 + faces.length * 50);
  buf.writeUInt32LE(faces.length, 80);
  let o = 84;
  for (const f of faces) {
    o += 12;
    for (const v of f) { buf.writeFloatLE(v[0], o); buf.writeFloatLE(v[1], o+4); buf.writeFloatLE(v[2], o+8); o += 12; }
    o += 2;
  }
  return buf;
}
const stlPath = '/tmp/claude-1000/-home-v3da/66064a8d-f655-4c73-827c-c884f0790e36/scratchpad/cube60.stl';
writeFileSync(stlPath, cubeSTL(60));

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + msg); if (!cond) fails++; };
const approx = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:8766/volmeslice/volmeslice.html', { waitUntil: 'networkidle' });

await page.setInputFiles('#fileInp', stlPath);
await page.waitForFunction(() => window._VS.state.parts && window._VS.state.parts.mode === 'stack', null, { timeout: 30000 });
const r = await page.evaluate(() => {
  const s = window._VS.state;
  const b = [];
  for (const part of s.parts.parts) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, n = 0;
    for (const path of part.final) { n++; for (const pt of path) {
      x0 = Math.min(x0, pt.X); x1 = Math.max(x1, pt.X);
      y0 = Math.min(y0, pt.Y); y1 = Math.max(y1, pt.Y); } }
    b.push({ w: (x1 - x0) / 1000, h: (y1 - y0) / 1000, nPaths: n });
  }
  return { height: +document.getElementById('pHeight').value, layers: s.parts.parts.length,
           pins: s.parts.pins, b0: b[0], allSame: b.every(x => Math.abs(x.w - b[0].w) < 0.01), warn: s.warnings };
});
console.log(JSON.stringify(r));
ok(r.height === 60, `Zielhöhe aus STL übernommen (${r.height})`);
ok(r.layers === 20, `60mm / 3mm = 20 Lagen (ist ${r.layers})`);
ok(approx(r.b0.w, 60.15, 0.02) && approx(r.b0.h, 60.15, 0.02),
   `Kerf-Aufmaß: Lage misst 60,15 mm (ist ${r.b0.w.toFixed(3)} × ${r.b0.h.toFixed(3)})`);
ok(r.allSame, 'alle Lagen gleich groß');
ok(r.pins.length === 2, `2 Passstifte gesetzt (ist ${r.pins.length})`);
ok(r.b0.nPaths === 3, `Lage = Außenkontur + 2 Stiftlöcher (ist ${r.b0.nPaths} Pfade)`);
if (r.pins.length === 2) {
  const d = Math.hypot(r.pins[0][0] - r.pins[1][0], r.pins[0][1] - r.pins[1][1]);
  ok(d > 30, `Stifte weit auseinander (${d.toFixed(1)} mm)`);
}

// Waffel am Würfel: Schlitze müssen exakt t+Spiel−Kerf breit sein
await page.click('#modeWaffle');
await page.waitForFunction(() => window._VS.state.parts && window._VS.state.parts.mode === 'waffle', null, { timeout: 30000 });
const w = await page.evaluate(() => {
  const s = window._VS.state;
  return { ribs: s.parts.parts.length, joints: s.parts.joints,
           slots: s.parts.parts.map(p => p.slots.length) };
});
console.log(JSON.stringify(w));
ok(w.ribs === 8, `8 Rippen (ist ${w.ribs})`);
ok(w.joints === 16, `4×4 = 16 Steckungen (ist ${w.joints})`);
ok(w.slots.every(n => n === 4), 'jede Rippe hat 4 Schlitze');

await browser.close();
console.log(fails ? `>>> ${fails} FEHLER` : '>>> ALLE TESTS BESTANDEN');
process.exit(fails ? 1 : 0);
