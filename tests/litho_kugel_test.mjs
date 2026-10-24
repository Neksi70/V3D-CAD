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
// Mehrere Bilder: Felder rundum, Bild 1 vorn, Wiederholen wiederholt die Reihe
const mb = await pg.evaluate(async () => {
  const mk = async (t) => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const x = c.getContext('2d');
    x.fillStyle = '#ddd'; x.fillRect(0, 0, 300, 400); x.fillStyle = '#000'; x.font = 'bold 200px sans-serif'; x.fillText(t, 60, 280);
    const img = new Image(); await new Promise(r => { img.onload = r; img.src = c.toDataURL(); }); return { img, url: img.src, aspect: 0.75, name: t }; };
  _litho.bilder.length = 0; for (const t of ['A', 'B', 'C']) _litho.bilder.push(await mk(t));
  Object.assign(_litho.p, { form: 'kugel', kWinkel: 360, kWdh: 2, kFit: 'einpassen', kDeckel: false });
  _lithoBilderNeu();
  const M = _lithoKugelMap(), g = _buildLithoKugelGeo(false), w = await _mfInit(), mf = _mfFromSoup(w, _lithoTris(g));
  const r = { felder: M.felder.map(f => f.bi).join(''), vorn: M.felder[0].m, teile: mf.decompose().length, erste: _litho.img === _litho.bilder[0].img };
  _litho.bilder.length = 0; _lithoBilderNeu(); r.leer = !_litho.lum; return r;
});
ok('3 Bilder × 2: Felder 012012, Bild 1 vorn, Netz dicht; alle entfernt = kein Bild', mb.felder === '012012' && mb.vorn === 0 && mb.teile === 1 && mb.erste && mb.leer, mb);
// Teelicht-Deckel (Bajonett): zwei Teile, Passung per Schnittvolumen
await pg.reload(); await pg.waitForFunction(() => typeof _lithoDeckelGeo === 'function', null, { timeout: 30000 });
await pg.evaluate(async () => {
  hideStarter(); _newCreate(false);               // Auto-Speichern hat die alte Szene zurückgeholt
  const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
  x.fillStyle = '#888'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#000'; x.font = 'bold 160px sans-serif'; x.fillText('★', 120, 220);
  const img = new Image(); await new Promise(r => { img.onload = r; img.src = c.toDataURL(); });
  _litho.img = img; _litho.aspect = 400 / 300; _litho.p.res = 400; _lithoSample();
});
const d = await pg.evaluate(async () => {
  Object.assign(_litho.p, { form: 'kugel', kD: 80, kOben: 0, kOese: true, kDeckel: true, tlD: 38, tlSpiel: 0.4 });
  await _createLitho();
  const ku = objects.find(o => /Lithophane-Kugel/.test(o.userData.name)), de = objects.find(o => /Teelicht-Deckel/.test(o.userData.name));
  if (!ku || !de) return { fehlt: true };
  const w = await _mfInit(), M = _lithoDeckelMasse();
  const mk = _mfFromSoup(w, _lithoTris(ku.geometry)), dk = _mfFromSoup(w, _lithoTris(de.geometry));
  const x = (m) => +w.Manifold.intersection(mk, m).volume().toFixed(5);
  return { kTeile: mk.decompose().length, dTeile: dk.decompose().length, muldeDm: +(M.rCi * 20).toFixed(2),
    einsetzen: x(dk.translate([0, -M.platte, 0])),
    halbGedreht: x(dk.rotate([0, 30, 0]).translate([0, -M.platte - M.luft + 0.005, 0])),
    eingerastet: x(dk.rotate([0, 60, 0]).translate([0, -M.platte - M.luft - M.rast + 0.005, 0])),
    traegt: x(dk.rotate([0, 60, 0]).translate([0, -M.platte - M.luft - M.rast - 0.04, 0])) };
});
ok('Deckel: Kugel und Deckel je ein Teil, Mulde = Teelicht + 2× Spiel', d.kTeile === 1 && d.dTeile === 1 && Math.abs(d.muldeDm - 38.8) < 0.01, d);
ok('Bajonett: einsetzen, drehen, einrasten ohne Kollision; Nasen tragen', d.einsetzen === 0 && d.halbGedreht === 0 && d.eingerastet === 0 && d.traegt > 0, d);
// 3MF mit variabler Schichthöhe (automatisch bei Lithophanes)
const s3 = await pg.evaluate(() => {
  localStorage.removeItem('v3d_3mf_schicht');
  const r = _build3mfBlob(objects), aus = _build3mfBlob(objects, { schicht: false });
  return r.blob.arrayBuffer().then(buf => {
    const f = fflate.unzipSync(new Uint8Array(buf)), t = f['Metadata/layer_heights_profile.txt'] ? fflate.strFromU8(f['Metadata/layer_heights_profile.txt']) : '';
    const v = (t.split('|')[1] || '').split(';').map(Number);
    const cfg = fflate.strFromU8(f['Metadata/model_settings.config']);
    return aus.blob.arrayBuffer().then(b2 => ({ hinweis: r.schicht, erste: v[1], n: v.length, ohne: !fflate.unzipSync(new Uint8Array(b2))['Metadata/layer_heights_profile.txt'],
      waende: /key="wall_loops" value="12"/.test(cfg) && /key="sparse_infill_density" value="100%"/.test(cfg) }));
  });
});
ok('3MF: Schichtprofil (Erste Schicht 0,2) + 12 Wände/100 % bei Lithophane, Profil weg wenn abgeschaltet', s3.erste === 0.2 && s3.n > 100 && s3.ohne && s3.waende && /Schichthöhe eingetragen/.test(s3.hinweis || ''), s3);
// Vorschau-Bild
await pg.evaluate(async () => { Object.assign(_litho.p, { kWdh: 1 }); _openLithoModal(); _lithoSyncUI(); _gpvUpdate('litho'); await new Promise(r => setTimeout(r, 600)); });
await pg.locator('#litho-modal .g3box').screenshot({ path: '/tmp/litho_kugel_dialog.png' });
ok('keine Seitenfehler', errs.length === 0, errs);
await b.close();
console.log(fehler ? `\n${fehler} FEHLER` : '\nalles grün'); process.exit(fehler ? 1 : 0);
