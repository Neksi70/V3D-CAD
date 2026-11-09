// Ralf 9.11.2026: „Schön wäre eine Vorschau mit dem eingegebenen Text oder SVG“ (Dose mit
// Motiv rundherum). Prüft: Motiv erscheint in der Vorschau (eigene Farbe), liegt auf der
// Außenwand (Abstand zum abgerundeten Rechteck 0…Höhe), 4× = viermal so viele Punkte,
// SVG geht auch, leerer Text = nur Dose. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (/Vorschau:/.test(m.text())) errs.push(m.text()); });
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 60000 });
await pg.evaluate(() => { hideStarter(); _mdsOpen(); const t = document.getElementById('mds-text'); t.value = 'Ralf'; t.dispatchEvent(new Event('input')); });
await pg.waitForTimeout(3000);
const mess = () => pg.evaluate(() => {
  const g = _gpv.mds.group.children[0].geometry, p = g.attributes.position, c = g.attributes.color, P = _mdsP, d = _mdsDims(P);
  const sdf = (x, z) => { const qx = Math.abs(x) - (P.breite / 2 - d.rA), qz = Math.abs(z) - (P.tiefe / 2 - d.rA);
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - d.rA; };
  let n = 0, lo = 1e9, hi = -1e9, vorn = 0;
  for (let i = 0; i < p.count; i++) { if (c.getX(i) > 0.7 && c.getY(i) > 0.7) continue;          // Dose = hellgrau
    n++; const x = p.getX(i) * 10, z = p.getZ(i) * 10, e = sdf(x, z); lo = Math.min(lo, e); hi = Math.max(hi, e); if (z > 0) vorn++; }
  return { n, lo: +lo.toFixed(2), hi: +hi.toFixed(2), vorn: n ? +(vorn / n).toFixed(2) : 0 };
});
const r = {};
r.text = await mess();
await pg.evaluate(() => { _mdsSet('anzahl', 4); _mdsStr('art', 'hoch'); }); await pg.waitForTimeout(500); r.vier = await mess();
await pg.evaluate(() => { _mdsSet('anzahl', 1); _mdsSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L61 39 L97 39 L68 60 L79 95 L50 74 L21 95 L32 60 L3 39 L39 39 Z"/></svg>'; _mdsSvgName = 'stern'; _mdsStr('quelle', 'svg'); });
await pg.waitForTimeout(500); r.svg = await mess();
await pg.evaluate(() => { _mdsStr('quelle', 'text'); const t = document.getElementById('mds-text'); t.value = ''; t.dispatchEvent(new Event('input')); }); await pg.waitForTimeout(500); r.leer = await mess();
console.log(JSON.stringify(r));
const checks = [
  ['Text erscheint in der Vorschau', r.text.n > 100],
  ['vertieft: liegt auf der Außenwand', r.text.lo > -0.1 && r.text.hi < 0.5],
  ['1× vorne: Motiv vorne', r.text.vorn > 0.95],
  ['4× rundum: viermal so viele Punkte', r.vier.n === 4 * r.text.n],
  ['erhaben: steht bis zur Höhe heraus', r.vier.lo > -0.1 && r.vier.hi > 0.6 && r.vier.hi < 1.0],
  ['eigenes SVG erscheint', r.svg.n > 20 && r.svg.lo > -0.1],
  ['leerer Text: nur Dose', r.leer.n === 0],
  ['keine Fehler', errs.length === 0],
];
let ok = true; for (const [n, v] of checks) { console.log((v ? '✔ ' : '✘ ') + n); ok = ok && !!v; }
if (errs.length) console.log(errs);
await b.close(); process.exit(ok ? 0 : 1);
