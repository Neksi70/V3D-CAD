// Hirsch-Deckel (🦌 _hid*): Menü, Vorschau, alle drei Modelle – Teile geschlossen, Farben ohne Überlappung,
// Zapfen/Sockel steckt ohne Kollision in der Aufnahme (und stößt 0,5 mm tiefer an), Schürze passt über den Deckel,
// Erstellen → Teile in Drucklage auf der Platte, Rückgängig
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8898;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _hidOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Hirsch-Deckel').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click(); await p.waitForSelector('#hid-modal.show');
  await p.waitForFunction(() => _gpv['hid'] && _gpv['hid'].group, null, { timeout: 60000 }).catch(() => {});
  ok(await p.evaluate(() => !!(_gpv['hid'] && _gpv['hid'].group)), 'Vorschau steht');
  for (const modell of ['tupfen', 'plastisch', 'schlicht']) {
    const r = await p.evaluate(async (modell) => { const w = await _mfInit(), M = w.Manifold, P = { ..._hidP, modell }, t0 = performance.now(), r = _hidBuild(w, P, 'fein'), ms = performance.now() - t0;
      const dicht = m => m.status() === 'NoError' || m.status() === 0;
      const top = ['schwarz', 'weiss', 'kopf'].filter(k => r[k]), o = { ms, info: r.info, teile: {}, ueber: 0, kol: 0, tiefer: 0 };
      for (const k of ['deckel', ...top]) o.teile[k] = { dicht: dicht(r[k]), stk: r[k].decompose().length, vol: r[k].volume() };
      if (r.schwarz) o.ueber = M.intersection(r.schwarz, r.weiss).volume();
      const zap = r.schwarz || r.kopf; o.kol = M.intersection(zap.translate([0, r.H, 0]), r.deckel).volume(); o.tiefer = M.intersection(zap.translate([0, r.H - 0.5, 0]), r.deckel).volume();
      const glas = M.cylinder(P.schuerze, P.deckelD / 2, P.deckelD / 2, 128).rotate([-90, 0, 0]); o.glas = M.intersection(glas, r.deckel).volume();
      return o; }, modell);
    const t = r.teile, alle = Object.values(t).every(x => x.dicht && x.vol > 0);
    ok(alle && t.deckel.stk === 1 && (t.schwarz ? t.schwarz.stk === 1 : t.kopf.stk === 1), `${modell}: Teile geschlossen (${Object.entries(t).map(([k, x]) => `${k} ${(x.vol / 1000).toFixed(1)} cm³/${x.stk} St.`).join(', ')}) in ${(r.ms / 1000).toFixed(1)} s`);
    ok(r.ueber < 0.01 && r.kol < 0.01 && r.tiefer > 0.5 && r.glas < 0.01, `${modell}: Überlappung ${r.ueber.toFixed(2)}, Kollision ${r.kol.toFixed(2)}, Glas ${r.glas.toFixed(2)} mm³ – Farben ohne Überlappung, Zapfen steckt frei (0,5 mm tiefer stößt an: ${r.tiefer.toFixed(1)} mm³), Glasdeckel Ø ${r.info.deckelD - 4.8} passt unter die Schürze`);
    if (modell === 'tupfen') ok(r.info.tupfen > 10 && r.teile.weiss.stk === r.info.tupfen + 1, `Tupfen: ${r.info.tupfen} weiße Punkte + Rand`);
  }
  const n = await p.evaluate(async () => { const out = {}; for (const m of ['tupfen', 'plastisch']) { _newCreate(false); _hidModell(m); _hidOpen(); await _hidCreate();
    out[m] = objects.map(o => { const bb = getMeshBox(o); return { n: o.userData.name, y0: +(bb.min.y * 10).toFixed(2) }; }); } return out; });
  ok(n.tupfen.length === 3 && n.tupfen.every(o => Math.abs(o.y0) < 0.05), 'Erstellen Tupfen: ' + n.tupfen.map(o => o.n).join(', ') + ' – alle auf der Platte');
  ok(n.plastisch.length === 2 && n.plastisch.every(o => Math.abs(o.y0) < 0.05), 'Erstellen plastisch: ' + n.plastisch.map(o => o.n).join(', ') + ' – auf der Platte');
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
