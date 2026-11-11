// Wichtel: Menü (Weihnachten) → Fenster → Vorschau → Erstellen (Körper/Gesicht/2 Beine, dicht, ohne Überlappung,
// auf der Platte) → Beine passen in die Löcher → glatt + ohne Beine → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8988, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _wchOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Wichtel').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#wch-modal.show');
  await p.waitForFunction(() => _gpv['wch'] && _gpv['wch'].group, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!(_gpv['wch'] && _gpv['wch'].group)), 'Vorschau steht');
  await p.screenshot({ path: SHOTS + '/wch-dialog.png', clip: await p.locator('#wch-modal .g3box').boundingBox() });
  const pass = await p.evaluate(async () => { const w = await _mfInit(), M = w.Manifold, r = _wchBuild(w, _wchP);
    const res = { hohl: !!r.boden, ein: M.intersection(r.boden, r.koerper).volume(), dreh: M.intersection(r.boden.rotate([0, 0, 45]), r.koerper).volume(),
      haelt: M.intersection(r.boden.rotate([0, 0, 45]).translate([0, 0, -3]), r.koerper).volume(), ges: M.intersection(r.gesicht, r.koerper).volume(),
      led: M.intersection(M.cylinder(16, _wchP.ledD / 2, _wchP.ledD / 2, 64).translate([0, 0, 2.4]), M.union(r.koerper, r.boden)).volume(), ledPasst: r.info.ledPasst,
      teile: [r.koerper, r.gesicht, r.boden].map(m => m.decompose().length), vol: r.koerper.volume() };
    [r.koerper, r.gesicht, r.boden].forEach(m => m.delete()); return res; });
  ok(pass.hohl && pass.teile.every(n => n === 1), `hohl (Standard): Körper/Gesicht/Boden je ein Teil, Körper ${Math.round(pass.vol / 1000)} cm³`);
  ok(pass.ein < 0.01 && pass.dreh < 0.01 && pass.haelt > 1, `Bajonett: einstecken + 45° drehen frei, gedreht hält die Platte (${pass.haelt.toFixed(1)} mm³ Anschlag)`);
  ok(pass.ledPasst && pass.led < 0.01 && pass.ges < 0.01, `LED-Teelicht Ø${38} passt in Mulde + Innenraum, Gesicht-Stifte ohne Überschneidung`);
  const lt = await p.evaluate(async () => { const w = await _mfInit(), M = w.Manifold, r = _wchBuild(w, { ..._wchP, wand: 0.8, licht: 'sterne' });
    const res = { teile: r.koerper.decompose().length, loecher: r.info.lichtLoecher, haelt: M.intersection(r.boden.rotate([0, 0, 45]).translate([0, 0, -3]), r.koerper).volume(),
      gesichtFrei: M.intersection(r.gesicht, r.koerper).volume() };
    [r.koerper, r.gesicht, r.boden].forEach(m => m.delete()); return res; });
  ok(lt.teile === 1 && lt.loecher > 20 && lt.haelt > 1 && lt.gesichtFrei < 0.01, `Wand 0,8 + Sterne: ${lt.loecher} Lichtlöcher, Körper 1 Teil, Bajonett hält`);
  // Nase + Augen-Tiefe: große Nase steht weiter vor, bleibt ein Teil, frei vom Körper, Unterseite ohne Überhang > 45°; tiefe Augen = mehr Material weg
  const na = await p.evaluate(async () => { const w = await _mfInit(), M = w.Manifold, out = {};
    for (const [n, a] of [[100, 0.75], [220, 2]]) { const r = _wchBuild(w, { ..._wchP, nase: n, augen: a }), g = r.gesicht, bb = g.boundingBox(), me = g.getMesh(), V = me.vertProperties, T = me.triVerts, np = me.numProp;
      let ueber = 0; const zn = bb.min[2] + (bb.max[2] - bb.min[2]) * 0.6;   // Fläche, die steiler als 45° nach unten zeigt (nur vorn, wo die Nase sitzt)
      for (let t = 0; t < T.length; t += 3) { const P = [0, 1, 2].map(i => [V[T[t + i] * np], V[T[t + i] * np + 1], V[T[t + i] * np + 2]]);
        const u = P[1].map((x, i) => x - P[0][i]), v = P[2].map((x, i) => x - P[0][i]), c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], L = Math.hypot(...c);
        if (L > 0 && c[2] / L < -0.75 && P[0][1] < bb.min[1] + 6 && Math.abs(P[0][0]) < 12) ueber += L / 2; }
      out[n] = { vor: bb.min[1], teile: g.decompose().length, frei: M.intersection(g, r.koerper).volume(), vol: g.volume(), ueber };
      [r.koerper, r.gesicht, r.boden].forEach(m => m && m.delete()); }
    return out; });
  ok(na[220].vor < na[100].vor - 2 && na[220].teile === 1 && na[220].frei < 0.01, `Nase 220 %: steht ${(na[100].vor - na[220].vor).toFixed(1)} mm weiter vor, Gesicht 1 Teil, frei vom Körper`);
  ok(na[220].ueber < na[100].ueber + 2, `große Nase ohne zusätzlichen Überhang > 45° (${na[220].ueber.toFixed(1)} mm² steil nach unten, Standardnase ${na[100].ueber.toFixed(1)} mm² = Gesichtsschale)`);
  const au = await p.evaluate(async () => { const w = await _mfInit(), v = {}; for (const a of [0, 0.75, 2]) { const r = _wchBuild(w, { ..._wchP, hohl: 0, augen: a }); v[a] = r.gesicht.volume(); [r.koerper, r.gesicht, r.boden].forEach(m => m && m.delete()); } return v; });
  ok(au[0] > au[0.75] + 2 && au[0.75] > au[2] + 20, `Augen-Tiefe wirkt: Gesicht ${au[0].toFixed(0)} / ${au[0.75].toFixed(0)} / ${au[2].toFixed(0)} mm³ (0 / 0,75 / 2 mm)`);
  // Gesicht leuchtet durch (Standard bei hohl): kein Körpermaterial zwischen Innenraum und Gesichtsmitte, Gesicht dort ~1,2 mm, Stifte frei
  const gl = await p.evaluate(async () => { const w = await _mfInit(), M = w.Manifold, r = _wchBuild(w, _wchP), H = _wchP.hoehe, zc = H * _wchP.gesichtZ / 100;
    const stab = M.cylinder(60, 1.5, 1.5, 24).rotate([90, 0, 0]).translate([0, 0, zc]);   // von der Mitte nach vorn (−Y)
    const res = { koerperImWeg: M.intersection(stab, r.koerper).volume(), gesichtDicke: M.intersection(stab, r.gesicht).volume() / (Math.PI * 1.5 * 1.5),
      frei: M.intersection(r.gesicht, r.koerper).volume(), teile: [r.koerper.decompose().length, r.gesicht.decompose().length], fenster: r.info.fenster };
    const zu = _wchBuild(w, { ..._wchP, gesLicht: 0 }); res.zuImWeg = M.intersection(stab, zu.koerper).volume();
    // Naht-Kerbe hinten: Körper bei +Y auf halber Höhe dünner als vorn-seitlich gedreht
    const nutStab = M.cube([0.4, 3, 6]).translate([-0.2, 0, zc + 10]), rr = r.koerper.boundingBox().max[1];
    res.nut = M.intersection(M.cube([0.4, 1.2, 40]).translate([-0.2, rr - 1.2, 25]), r.koerper).volume();
    res.nebenNut = M.intersection(M.cube([0.4, 1.2, 40]).translate([3, rr - 1.6, 25]), r.koerper).volume();
    [r, zu].forEach(x => [x.koerper, x.gesicht, x.boden].forEach(m => m && m.delete())); return res; });
  ok(gl.koerperImWeg < 0.01 && gl.zuImWeg > 1 && Math.abs(gl.gesichtDicke - 1.2) < 0.35 && gl.frei < 0.01 && gl.teile.every(n => n === 1),
     `Gesicht leuchtet durch: Fenster ${gl.fenster.map(x => x.toFixed(0)).join('×')} mm, kein Körper im Lichtweg (vorher ${gl.zuImWeg.toFixed(0)} mm³), Gesicht dort ${gl.gesichtDicke.toFixed(2)} mm`);
  ok(gl.nut < gl.nebenNut * 0.8, `Naht-Kerbe hinten vorhanden (Material in der Kerbe ${gl.nut.toFixed(1)} mm³ vs. daneben ${gl.nebenNut.toFixed(1)} mm³)`);
  const r1 = await p.evaluate(async () => {
    await _wchCreate();
    return objects.map(o => ({ name: o.userData.name, minY: getMeshBox(o).min.y, linien: o.children.some(c => c.userData && c.userData.isEdgeLines) }));
  });
  ok(r1.find(t => /Gesicht/.test(t.name)).linien === false && r1.find(t => /Boden/.test(t.name)).linien === true, 'Gesicht ohne schwarze Kantenlinien (Bart bleibt weiß), Bodenplatte behält ihre');
  ok(r1.length === 3 && r1.every(t => Math.abs(t.minY) < 1e-3 || /Gesicht/.test(t.name)), 'Erstellt: ' + r1.map(t => t.name).join(', '));
  await p.evaluate(() => { _newCreate(false); _wchOpen(); _wchSet('hohl', 0); });
  const r1b = await p.evaluate(async () => { await _wchCreate(); const w = await _mfInit(); return objects.map(o => ({ name: o.userData.name, s: _mfUnionObjs(w, [o]).decompose().length })); });
  ok(r1b.length === 4 && r1b.every(t => t.s === 1), 'massiv: ' + r1b.map(t => t.name).join(', '));
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/wch-szene.png' });
  await p.evaluate(() => { _newCreate(false); _wchOpen(); _wchSet('hohl', 0); _wchSet('rillen', 0); _wchSet('beinL', 0); _wchStr('aufhaenger', 'oben'); _wchSet('bart', 0); });
  const r2 = await p.evaluate(async () => { await _wchCreate(); return objects.map(o => o.userData.name); });
  ok(r2.length === 2, 'glatt, ohne Beine: ' + r2.join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
