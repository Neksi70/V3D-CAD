// Headless-Test des Muster-Generators gegen den --dev-Server (rohe volme3d.html).
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const URL = process.env.PG_URL || 'http://127.0.0.1:8766/volme3d.html';
const errs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3500);

const globals = await page.evaluate(() => ({
  open: typeof _pgOpen, build: typeof window._pgBuild,
  scene: typeof _pgToScene, svg: typeof _pgSvgText,
}));
console.log('Globals:', JSON.stringify(globals));

await page.evaluate(() => _pgOpen());
await page.waitForTimeout(1200);

const shots = {};
const pats = ['wabe', 'asanoha', 'dreieck', 'quadrat', 'raute', 'wellen', 'voronoi'];
for (const p of pats) {
  const r = await page.evaluate(async (pat) => {
    _pgSetPat(pat);
    for (let i = 0; i < 60 && (_pg.busy || _pgRT); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));
    const o = _pg.out;
    const svg = _pgSvgText();
    return {
      pat, loops: o ? o.polys.length : 0, cells: o ? o.nCells : 0, leer: o ? !!o.leer : true,
      svgLen: svg ? svg.length : 0,
      png: document.getElementById('pg-canvas').toDataURL('image/png'),
    };
  }, p);
  shots[p] = r.png;
  console.log(String(r.pat).padEnd(9), 'loops=' + String(r.loops).padStart(4),
    'zellen=' + String(r.cells).padStart(4), 'svg=' + String(r.svgLen).padStart(6) + 'B',
    r.leer ? 'LEER!' : '');
}

// Formen + Extras
const extra = await page.evaluate(async () => {
  const wait = async () => { for (let i = 0; i < 60 && (_pg.busy || _pgRT); i++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 200)); };
  const out = {};
  _pgSetPat('wabe'); _pgSetForm('ellipse');
  _pgSet('w', 110); _pgSet('h', 110); _pgSet('loch', 0);
  await wait();
  out.ellipse = { loops: _pg.out?.polys.length || 0, png: document.getElementById('pg-canvas').toDataURL('image/png') };
  _pgSetForm('rect'); _pgSet('w', 150); _pgSet('h', 52); _pgSet('loch', 5);
  _pgSet('fillet', 2.5); _pgSetPat('voronoi'); _pgSet('cell', 18);
  await wait();
  out.kehlen = { loops: _pg.out?.polys.length || 0, filEff: _pg.out?.filEff, png: document.getElementById('pg-canvas').toDataURL('image/png') };
  _pgSet('fillet', 0); _pgSetPat('quadrat'); _pgSet('rot', 45); _pgSet('cell', 10);
  await wait();
  out.rot45 = { loops: _pg.out?.polys.length || 0, png: document.getElementById('pg-canvas').toDataURL('image/png') };
  return out;
});
for (const [k, v] of Object.entries(extra)) { shots[k] = v.png; console.log(k.padEnd(9), 'loops=' + v.loops, v.filEff !== undefined ? 'kehle=' + v.filEff.toFixed(2) : ''); }

// Extremwerte: darf nicht abstürzen
const stress = await page.evaluate(async () => {
  const wait = async () => { for (let i = 0; i < 80 && (_pg.busy || _pgRT); i++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 200)); };
  const res = [];
  const cases = [
    ['Steg breiter als Zelle', { cell: 5, web: 12 }],
    ['Rand frisst alles', { cell: 12, web: 2, border: 20, w: 40, h: 40 }],
    ['sehr fein', { cell: 3, web: 0.4, w: 150, h: 52, border: 4 }],
  ];
  for (const [nm, ov] of cases) {
    _pgReset(); _pgSetPat('wabe');
    for (const [k, v] of Object.entries(ov)) _pgSet(k, v);
    const t0 = performance.now(); await wait();
    res.push({ nm, ms: Math.round(performance.now() - t0), loops: _pg.out?.polys.length ?? -1, leer: !!_pg.out?.leer });
  }
  return res;
});
for (const r of stress) console.log('stress:', r.nm.padEnd(24), r.ms + 'ms', 'loops=' + r.loops, r.leer ? '(leer, sauber abgefangen)' : '');

// In die Szene
const sc = await page.evaluate(async () => {
  _pgReset(); _pgSetPat('wabe');
  for (let i = 0; i < 60 && (_pg.busy || _pgRT); i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 300));
  const before = objects.length;
  await _pgToScene();
  await new Promise(r => setTimeout(r, 600));
  const o = objects[objects.length - 1];
  const g = o?.geometry; g?.computeBoundingBox();
  const bb = g?.boundingBox;
  return {
    added: objects.length - before, name: o?.userData?.name,
    tris: g ? g.attributes.position.count / 3 : 0,
    // App-Units → mm
    mm: bb ? [(bb.max.x - bb.min.x) * 10, (bb.max.y - bb.min.y) * 10, (bb.max.z - bb.min.z) * 10].map(v => +v.toFixed(2)) : null,
    modalOffen: document.getElementById('pg-modal').classList.contains('show'),
  };
});
console.log('Szene:', JSON.stringify(sc));

// Eigener Umriss aus einer SVG-Datei (Herz mit Kerbe + spitzem Auslauf)
fs.writeFileSync('/tmp/pg_test_herz.svg',
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="90mm" viewBox="0 0 100 90">'
  + '<path d="M50 88 C10 58 2 34 14 18 C24 5 44 6 50 22 C56 6 76 5 86 18 C98 34 90 58 50 88 Z" fill="#000"/></svg>');
await page.evaluate(() => _pgOpen());
await page.setInputFiles('#pg-svg-file', '/tmp/pg_test_herz.svg');
await page.waitForTimeout(400);
const imp = await page.evaluate(async () => {
  _pgSetPat('wabe'); _pgSet('cell', 9); _pgSet('w', 110); _pgSet('loch', 0);
  for (let i = 0; i < 80 && (_pg.busy || _pgRT); i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 300));
  return {
    form: _pgP.form, name: _pg.svgName, aspect: +_pg.svgAspect.toFixed(3),
    loops: _pg.out?.polys.length, bb: [+_pg.out?.bb.w.toFixed(1), +_pg.out?.bb.h.toFixed(1)],
    hoeheAusgeblendet: document.getElementById('pg-row-h').style.display === 'none',
    png: document.getElementById('pg-canvas').toDataURL('image/png'),
  };
});
shots.svgUmriss = imp.png;
console.log('SVG-Umriss:', JSON.stringify({ form: imp.form, name: imp.name, aspect: imp.aspect, loops: imp.loops, bb: imp.bb, hOff: imp.hoeheAusgeblendet }));

for (const [k, d] of Object.entries(shots))
  fs.writeFileSync('/tmp/pgapp_' + k + '.png', Buffer.from(d.split(',')[1], 'base64'));

await browser.close();
console.log('\npageErrors:', errs.length);
for (const e of errs.slice(0, 12)) console.log('  •', e.slice(0, 180));
