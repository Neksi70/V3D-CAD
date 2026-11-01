// Achim 1.11.: Lithophane nicht nur flach/Kugel. Prüft Zylinder, Kegel/Tüte, Laterne, Bogen:
// Netz dicht (Manifold), Wandstärke innerhalb Basis…Max, Maße, Bild prägt die Wand. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof _buildLithoMantelGeo === 'function', null, { timeout: 30000 });
const r = await pg.evaluate(async () => {
  hideStarter();
  // Testbild: links schwarz, rechts weiß (dunkel = dick)
  const c = document.createElement('canvas'); c.width = 120; c.height = 80; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 120, 80); x.fillStyle = '#000'; x.fillRect(0, 0, 60, 80);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const f = new File([blob], 'test.png', { type: 'image/png' });
  _openLithoModal(); await _lithoFile({ target: { files: [f], value: '' } });
  for (let i = 0; i < 50 && !_litho.lum; i++) await new Promise(r => setTimeout(r, 100));
  const w = await _mfInit(), out = {};
  for (const form of ['zylinder', 'kegel', 'laterne', 'bogen']) {
    Object.assign(_litho.p, { form, mD: 80, mH: 60, mOben: 70, mEcke: 12, mBogen: 120, mRand: 3, maxT: 3, minT: 0.8, kFit: 'strecken', invert: false });
    const g = _buildLithoGeo(false); g.computeBoundingBox();
    const P = g.attributes.position, I = g.index.array, t = new Float32Array(I.length * 3);
    for (let i = 0; i < I.length; i++) { t[i * 3] = P.getX(I[i]) * 10; t[i * 3 + 1] = P.getY(I[i]) * 10; t[i * 3 + 2] = P.getZ(I[i]) * 10; }
    let mf, dicht = true, vol = 0; try { mf = _mfFromSoup(w, t); vol = mf.volume(); } catch (e) { dicht = false; }
    const bb = g.boundingBox;
    out[form] = { dicht, vol: Math.round(vol), tris: I.length / 3, b: +((bb.max.x - bb.min.x) * 10).toFixed(1), t: +((bb.max.z - bb.min.z) * 10).toFixed(1), h: +((bb.max.y - bb.min.y) * 10).toFixed(1) };
  }
  // Bild prägt: Zylinder mit „Einpassen“ → Wand vorn links dicker als vorn rechts
  Object.assign(_litho.p, { form: 'zylinder', kFit: 'strecken' });
  const g = _buildLithoGeo(false), P = g.attributes.position; let links = 0, rechts = 0, nl = 0, nr = 0;
  for (let i = 0; i < P.count; i += 2) { const xo = P.getX(i), zo = P.getZ(i), xi = P.getX(i + 1), zi = P.getZ(i + 1), y = P.getY(i);
    if (y < 1.5 || y > 4.5) continue; const d = Math.hypot(xo - xi, zo - zi) * 10, ang = Math.atan2(xo, zo);
    if (ang > -Math.PI * 0.45 && ang < -0.1) { links += d; nl++; } if (ang > 0.1 && ang < Math.PI * 0.45) { rechts += d; nr++; } }
  out.praegung = { links: +(links / nl).toFixed(2), rechts: +(rechts / nr).toFixed(2) };
  // Flach mit Umriss
  out.umriss = {};
  for (const um of ['rechteck', 'abgerundet', 'kreis', 'oval', 'herz', 'stern', 'sechseck']) {
    Object.assign(_litho.p, { form: 'flach', umriss: um, width: 80, frame: 2, maxT: 3, minT: 0.8 });
    const g = _buildLithoGeo(false); g.computeBoundingBox();
    const P = g.attributes.position, I = g.index.array, t = new Float32Array(I.length * 3);
    for (let i = 0; i < I.length; i++) { t[i * 3] = P.getX(I[i]) * 10; t[i * 3 + 1] = P.getY(I[i]) * 10; t[i * 3 + 2] = P.getZ(I[i]) * 10; }
    let vol = 0, dicht = true; try { vol = _mfFromSoup(w, t).volume(); } catch (e) { dicht = false; }
    const bb = g.boundingBox;
    out.umriss[um] = { dicht, vol: Math.round(vol), b: +((bb.max.x - bb.min.x) * 10).toFixed(1), t: +((bb.max.z - bb.min.z) * 10).toFixed(1), d: +((bb.max.y - bb.min.y) * 10).toFixed(2) };
  }
  _litho.p.umriss = 'rechteck';
  // Erstellen in der Szene
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  _lithoForm('laterne'); out.laterneOben = _litho.p.mOben; _lithoForm('kegel'); out.kegelOben = _litho.p.mOben;
  await _createLitho(); out.erstellt = objects.map(o => o.userData.name + '|' + o.userData.type);
  _closeLithoModal();
  return out;
});
console.log(JSON.stringify(r, null, 1));
let fehler = 0; const ok = (n, c, x) => { console.log((c ? '  OK     ' : '  FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fehler++; };
for (const f of ['zylinder', 'kegel', 'laterne', 'bogen']) ok(`${f}: dicht, Volumen > 0`, r[f].dicht && r[f].vol > 1000, r[f]);
ok('Zylinder Ø80 × 60', Math.abs(r.zylinder.b - 80) < 1.5 && Math.abs(r.zylinder.h - 60) < 0.1, r.zylinder);
ok('Laterne 80 × 80', Math.abs(r.laterne.b - 80) < 1 && Math.abs(r.laterne.t - 80) < 1, r.laterne);
ok('Kegel unten 80 (oben schmaler)', Math.abs(r.kegel.b - 80) < 1.5, r.kegel);
ok('Bild prägt die Wand: schwarz (links) dick ≈ 3, weiß (rechts) dünn ≈ 0,8', r.praegung.links > 2.5 && r.praegung.rechts < 1.2, r.praegung);
ok('Laterne startet gerade (100 %), Kegel verjüngt (70 %)', r.laterneOben === 100 && r.kegelOben === 70, [r.laterneOben, r.kegelOben]);
ok('Erstellen legt „Lithophane-Tüte“ (Typ litho) an', r.erstellt.length === 1 && /Lithophane-Tüte/.test(r.erstellt[0]) && /\|litho$/.test(r.erstellt[0]), r.erstellt);
for (const [um, x] of Object.entries(r.umriss)) ok(`Umriss ${um}: dicht (Manifold), 80 mm breit, höchstens 3 mm dick`, x.dicht && x.vol > 1000 && Math.abs(x.b - 80) < 1 && x.d <= 3.01, x);
ok('Kreis ist rund (80 × 80)', Math.abs(r.umriss.kreis.t - 80) < 1, r.umriss.kreis);
ok('Sechseck regelmäßig (80 × 69,3)', Math.abs(r.umriss.sechseck.t - 69.3) < 1, r.umriss.sechseck);
ok('Herz/Stern füllen weniger als der Kreis (echter Umriss)', r.umriss.herz.vol < r.umriss.kreis.vol && r.umriss.stern.vol < r.umriss.herz.vol, [r.umriss.kreis.vol, r.umriss.herz.vol, r.umriss.stern.vol]);
console.log(fehler ? fehler + ' Fehler' : 'OK', errs); await b.close(); process.exit(fehler || errs.length ? 1 : 0);
