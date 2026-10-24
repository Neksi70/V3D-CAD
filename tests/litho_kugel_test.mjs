// 🎄 Lithophane-Kugel (_buildLithoKugelGeo, 24.10.26): Netz dicht (Manifold), Wand zwischen
// Basis- und Max-Dicke, Durchmesser + flacher Standring, Öse fest angefügt (ein Teil).
// Start: python3 volme3d_server.py 8861 --dev  (oder V3D_URL setzen)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8861/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof _buildLithoKugelGeo === 'function', null, { timeout: 30000 });
let fehler = 0;
const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
// Testbild: Verlauf + dunkler Stern, 400×300
await pg.evaluate(async () => {
  hideStarter();
  const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 400, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#333');
  x.fillStyle = gr; x.fillRect(0, 0, 400, 300); x.fillStyle = '#000'; x.font = 'bold 160px sans-serif'; x.fillText('★', 120, 220);
  const img = new Image(); await new Promise(r => { img.onload = r; img.src = c.toDataURL(); });
  _litho.img = img; _litho.aspect = 400 / 300; _litho.p.res = 400; _lithoSample();
});
const faelle = [
  { name: 'Standard (unten 30, oben zu)', p: {} },
  { name: 'oben + unten offen', p: { kUnten: 40, kOben: 20 } },
  { name: 'ganz zu', p: { kUnten: 0, kOben: 0 } },
  { name: 'Relief außen, 3× auf 360°', p: { kInnen: false, kWdh: 3 } },
  { name: 'Zuschneiden 180°', p: { kFit: 'zuschneiden', kWinkel: 180 } },
  { name: 'Strecken, D 120, Rand 0', p: { kFit: 'strecken', kD: 120, kRand: 0 } },
];
for (const f of faelle) {
  const r = await pg.evaluate(async (fp) => {
    Object.assign(_litho.p, { form: 'kugel', kD: 80, kUnten: 30, kOben: 0, kVon: -45, kBis: 60, kWinkel: 360, kWdh: 1, kRand: 3, kFit: 'einpassen', kInnen: true, kOese: true, minT: 0.8, maxT: 3.2 }, fp);
    const g = _buildLithoKugelGeo(false), w = await _mfInit();
    const mf = _mfFromSoup(w, _lithoTris(g));
    g.computeBoundingBox(); const bb = g.boundingBox, P = g.attributes.position;
    let amBoden = 0; for (let i = 0; i < P.count; i++) if (Math.abs(P.getY(i)) < 1e-5) amBoden++;
    const R = _litho.p.kD / 20, tMin = 0.08, tMax = 0.32;
    const kugelV = r => 4 / 3 * Math.PI * r ** 3;
    return { vol: +mf.volume().toFixed(2), vMin: +(kugelV(R) - kugelV(R - tMin)).toFixed(2), vMax: +(kugelV(R) - kugelV(R - tMax)).toFixed(2),
      teile: mf.decompose().length, genus: mf.genus(), breite: +((bb.max.x - bb.min.x) * 10).toFixed(2), yMin: +bb.min.y.toFixed(4), amBoden, tris: g.index.count / 3 };
  }, f.p);
  ok(f.name + ': Manifold dicht, Volumen zwischen dünnster und dickster Wand', r.vol > 0 && r.vol < r.vMax && r.vol > r.vMin * 0.5, r);
  const D = f.p.kD || 80;
  ok(f.name + ': Breite = Durchmesser (Relief außen: höchstens)', f.p.kInnen === false ? (r.breite <= D + 0.01 && r.breite > D - 6.4) : Math.abs(r.breite - D) < 0.3, r.breite);
  if ((f.p.kUnten ?? 30) > 0) ok(f.name + ': flacher Standring auf y = 0', r.yMin === 0 && r.amBoden >= 128, r.amBoden);
}
// Ganz durch den Dialog: Kugel mit Öse → EIN Teil, Öse oben drauf
const c = await pg.evaluate(async () => {
  Object.assign(_litho.p, { form: 'kugel', kD: 80, kUnten: 30, kOben: 0, kVon: -45, kBis: 60, kWinkel: 360, kWdh: 1, kRand: 3, kFit: 'einpassen', kInnen: true, kOese: true, minT: 0.8, maxT: 3.2 });
  _openLithoModal(); await new Promise(r => setTimeout(r, 400));
  await _createLitho();
  const o = objects.find(x => /Lithophane-Kugel/.test(x.userData.name || ''));
  if (!o) return { fehlt: true };
  const w = await _mfInit(), mf = _mfFromSoup(w, _lithoTris(o.geometry));
  o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
  return { name: o.userData.name, teile: mf.decompose().length, hoehe: +((bb.max.y - bb.min.y) * 10).toFixed(1), vol: +mf.volume().toFixed(2) };
});
ok('Erstellen mit Öse: ein zusammenhängender Körper, höher als die Kugel', c.teile === 1 && c.hoehe > 80, c);
// Vorschau-Bild
await pg.evaluate(async () => { Object.assign(_litho.p, { kWdh: 1 }); _openLithoModal(); _lithoSyncUI(); _gpvUpdate('litho'); await new Promise(r => setTimeout(r, 600)); });
await pg.locator('#litho-modal .g3box').screenshot({ path: '/tmp/litho_kugel_dialog.png' });
ok('keine Seitenfehler', errs.length === 0, errs);
await b.close();
console.log(fehler ? `\n${fehler} FEHLER` : '\nalles grün'); process.exit(fehler ? 1 : 0);
