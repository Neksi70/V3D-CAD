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
// Ausschnitt: 3 Bilder füllen je 120°, Lage/Zoom je Bild verschiebt das Bildfenster; Mindest-Ø mit Teelicht
const au = await pg.evaluate(async () => {
  const mk = async () => { const c = document.createElement('canvas'); c.width = 400; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#999'; x.fillRect(0, 0, 400, 600);
    const img = new Image(); await new Promise(r => { img.onload = r; img.src = c.toDataURL(); }); return { img, url: img.src, aspect: 400 / 600, name: 'x' }; };
  _litho.bilder.length = 0; for (let i = 0; i < 3; i++) _litho.bilder.push(await mk());
  Object.assign(_litho.p, { form: 'kugel', kWinkel: 360, kWdh: 1, kFit: 'zuschneiden', kVon: -45, kBis: 60, kDeckel: true, tlD: 38, kD: 50, kFarbe: false });
  _lithoBilderNeu(); _lithoSyncUI();
  const f0 = _lithoKugelMap().felder[1];
  _litho.bilder[1].crop = { x: 0.5, y: 0.2, z: 2 };
  const f1 = _lithoKugelMap().felder[1];
  return { breiten: _lithoKugelMap().felder.map(f => Math.round(f.Hc * 180 / Math.PI)), v0vorher: +f0.v0.toFixed(3), hVorher: +(f0.v1 - f0.v0).toFixed(3),
    v0nachher: +f1.v0.toFixed(3), hNachher: +(f1.v1 - f1.v0).toFixed(3), kD: _litho.p.kD, dmin: _lithoKugelDmin() };
});
ok('Ausschnitt: 3 × 120°, Zoom 2 halbiert das Fenster, nach oben geschoben; Kugel-Ø mit Teelicht ≥ Minimum', au.breiten.join() === '120,120,120' && Math.abs(au.hNachher - au.hVorher / 2) < 1e-3 && au.v0nachher < au.v0vorher && au.kD === au.dmin && au.dmin >= 60, au);
// Bild direkt auf der Kugel-Vorschau nach unten ziehen → Ausschnitt wandert nach oben (Kopf kommt ins Bild)
await pg.evaluate(async () => { _litho.bilder.forEach(b => b.crop = { x: 0.5, y: 0.5, z: 1 }); _openLithoModal(); _gpvUpdate('litho'); await new Promise(r => setTimeout(r, 400)); });
const cvb = await pg.locator('#litho-canvas').boundingBox();
await pg.mouse.move(cvb.x + cvb.width / 2, cvb.y + cvb.height * 0.45); await pg.waitForTimeout(200);
await pg.evaluate(() => { _gpv['litho'].group.rotation.y = 0; });
await pg.mouse.down(); await pg.mouse.move(cvb.x + cvb.width / 2, cvb.y + cvb.height * 0.45 + 40, { steps: 6 }); await pg.mouse.up();
const zv = await pg.evaluate(() => ({ y: _litho.bilder[0].crop.y, halt: _gpv['litho'].halt }));
ok('Bild auf der Kugel nach unten ziehen schiebt den Ausschnitt nach oben, Kugel steht still', zv.y < 0.45 && zv.halt === true, zv);
await pg.mouse.move(5, 5); await pg.evaluate(() => _closeLithoModal());
// 🎨 Farbig: Palette aus dem Bild, Außenhaut bemalt, Grundfarbe Weiß, 3MF mit paint_color + Farbschicht-Tiefe
const fb = await pg.evaluate(async () => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  const c = document.createElement('canvas'); c.width = 300; c.height = 300; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 300, 300); x.fillStyle = '#1050c0'; x.fillRect(0, 0, 150, 300); x.fillStyle = '#d01020'; x.fillRect(150, 100, 150, 100);
  const img = new Image(); await new Promise(r => { img.onload = r; img.src = c.toDataURL(); });
  _litho.bilder.length = 0; _litho.bilder.push({ img, url: img.src, aspect: 1, name: 'f' });
  Object.assign(_litho.p, { form: 'kugel', kWinkel: 360, kWdh: 1, kFit: 'einpassen', kDeckel: false, kOese: true, kFarbe: true, kFarbN: 2, kFarbTiefe: 0.8 });
  _lithoBilderNeu(); _lithoPaletteAusBild(true);
  const pal = _litho.p.kPalette.slice();
  await _createLitho();
  const k = objects.find(o => /Kugel/.test(o.userData.name));
  const r3 = _build3mfBlob(objects), f = fflate.unzipSync(new Uint8Array(await r3.blob.arrayBuffer()));
  const model = fflate.strFromU8(f['3D/3dmodel.model']), cfg = fflate.strFromU8(f['Metadata/model_settings.config']);
  const codes = {}; for (const m of model.matchAll(/paint_color="([0-9A-F]+)"/g)) codes[m[1]] = (codes[m[1]] || 0) + 1;
  const res = { pal, legend: r3.legend, codes, tiefe: /mmu_segmented_region_max_width" value="0.8"/.test(cfg), mmu: k.userData._mmuPaint };
  _litho.p.kFarbe = false; objects.slice().forEach(o => scene.remove(o)); objects.length = 0; return res;
});
const nahe = (h, z) => { const a = parseInt(h.slice(1), 16), b = parseInt(z.slice(1), 16); return Math.abs((a >> 16) - (b >> 16)) + Math.abs((a >> 8 & 255) - (b >> 8 & 255)) + Math.abs((a & 255) - (b & 255)) < 60; };
ok('🎨 Palette = Blau + Rot aus dem Bild, Filament 1 Weiß, Bemalung F2+F3 im 3MF, Farbschicht 0,8 mm',
  fb.pal.length === 2 && fb.pal.some(h => nahe(h, '#1050c0')) && fb.pal.some(h => nahe(h, '#d01020')) && fb.legend[0] === '1=#FFFFFF'
  && fb.codes['8'] > 100 && fb.codes['0C'] > 100 && fb.tiefe && fb.mmu === 1, fb);
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
    traegt: x(dk.rotate([0, 60, 0]).translate([0, -M.platte - M.luft - M.rast - 0.04, 0])),
    // Einschieben von unten: Deckel Schritt für Schritt hoch, Nasen in den Kerben — der Weg muss frei sein
    // (die Endstellungen allein prüften nicht, dass der Standring der Kugel die Kerben unten zumachte)
    weg: (() => { let m = 0; for (let y = -M.hoch - 0.3; y <= -M.platte + 1e-9; y += 0.05) m = Math.max(m, x(dk.translate([0, y, 0]))); return +m.toFixed(5); })() };
});
ok('Deckel: Kugel und Deckel je ein Teil, Mulde = Teelicht + 2× Spiel', d.kTeile === 1 && d.dTeile === 1 && Math.abs(d.muldeDm - 38.8) < 0.01, d);
ok('Bajonett: von unten einschieben, drehen, einrasten ohne Kollision; Nasen tragen', d.weg === 0 && d.einsetzen === 0 && d.halbGedreht === 0 && d.eingerastet === 0 && d.traegt > 0, d);
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
await pg.screenshot({ path: '/tmp/litho_kugel_dialog.png' });   // Element-Screenshot wartet auf „stabil“ – nach den schweren Kugeln zu lange
ok('keine Seitenfehler', errs.length === 0, errs);
await b.close();
console.log(fehler ? `\n${fehler} FEHLER` : '\nalles grün'); process.exit(fehler ? 1 : 0);
