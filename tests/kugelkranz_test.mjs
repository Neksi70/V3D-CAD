// Kugelkranz (🔴 _kkz*): Menü → Vorschau → Erstellen: 1 Stück, flach auf der Platte, 4 Halter (Kerze passt), nichts
// flacher als 45° nach unten (außer Standfläche) → Teelicht-Variante → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8894;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _kkzOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Kugelkranz').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click(); await p.waitForSelector('#kkz-modal.show'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => !!(_gpv['kkz'] && _gpv['kkz'].group)), 'Vorschau steht');
  const pr = v => p.evaluate(async (v) => { const w = await _mfInit(), M = w.Manifold, P = { ..._kkzP, ...v }, r = _kkzBuild(w, P), m = r.kranz, bb = m.boundingBox(), me = m.getMesh(), V = me.vertProperties, T = me.triVerts, np = me.numProp;
    let ueber = 0; for (let t = 0; t < T.length; t += 3) { const A = [0, 1, 2].map(i => [V[T[t + i] * np], V[T[t + i] * np + 1], V[T[t + i] * np + 2]]);
      const u = A[1].map((x, i) => x - A[0][i]), q = A[2].map((x, i) => x - A[0][i]), c = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]], L = Math.hypot(...c);
      if (L > 0 && c[2] / L < -0.75 && Math.min(A[0][2], A[1][2], A[2][2]) > 0.3) ueber += L / 2; }
    // Kerze (Ø kerzeD) in Halter 0 stecken: darf nicht anstoßen
    const a0 = 0, x = r.info.R, top = bb.max[2], kz = M.cylinder(P.kerzeT - 0.5, P.kerzeD / 2, P.kerzeD / 2, 64).translate([x, 0, top - P.kerzeT + 0.4]);
    const res = { s: m.decompose().length, z0: bb.min[2], ueber, kerze: P.halter === 'stab' ? M.intersection(kz, m).volume() : 0, info: r.info }; m.delete(); return res; }, v);
  const r1 = await pr({});
  ok(r1.s === 1 && Math.abs(r1.z0) < 0.01, `Kranz 1 Stück, Ø ${Math.round(r1.info.durchmesser)} mm, liegt auf`);
  ok(r1.ueber < 1, `nichts flacher als 45° nach unten (${r1.ueber.toFixed(1)} mm²)`);
  ok(r1.info.halter === 4 && r1.kerze < 0.01, `4 Halter, Stabkerze Ø 22 passt (${r1.kerze.toFixed(2)} mm³ Anstoß)`);
  const r2 = await pr({ halter: 'teelicht', kugelD: 60, anzahl: 10 });
  ok(r2.s === 1 && r2.ueber < 1 && r2.info.ok, 'Teelicht-Variante (10 Kugeln Ø 60): 1 Stück, überhangfrei');
  const n = await p.evaluate(async () => { await _kkzCreate(); return objects.length; });
  ok(n === 1, 'Erstellen: ein Teil');
  await p.evaluate(() => undo()); ok(await p.evaluate(() => objects.length === 0), 'Rückgängig');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
