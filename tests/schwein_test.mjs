// Schwein-Kerzenhalter (Rasse im Dackel-Kern): Katalog → Titel, ohne Mütze, 4 Kerzen mit Perlenkranz, Länge stimmt, Kerzenlöcher frei
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8997;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _dklOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Schwein-Kerzenhalter').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#dkl-modal.show');
  const r0 = await p.evaluate(() => ({ titel: document.getElementById('dkl-titel').textContent, muetze: _dklP.muetze, on: document.querySelector('#dkl-rasse-bg .vtb.on').dataset.v }));
  ok(r0.titel.includes('Schwein') && r0.muetze === 0 && r0.on === 'schwein', `Titel „${r0.titel}“, ohne Mütze, Umschalter auf Schwein`);
  const r1 = await p.evaluate(async () => { Object.assign(_dklP, { kerzen: 4, groesse: 260 }); const w = await _mfInit(), R = _dklBuild(w, _dklP, 'vorschau'), bb = R.hund.boundingBox(), d = R.d;
    // Kerze (Zylinder Ø kerzeD) in jedes Loch: darf den Körper nicht schneiden
    let ov = 0; for (let i = 0; i < d.xs.length; i++) { const c = w.Manifold.cylinder(d.yT - d.yLoch - 0.5, _dklP.kerzeD / 2, _dklP.kerzeD / 2, 32).rotate([-90, 0, 0]).translate([d.xs[i], d.yLoch + 0.3, d.zs[i]]); ov += w.Manifold.intersection(c, R.hund).volume(); c.delete(); }
    const res = { L: bb.max[0] - bb.min[0], n: d.xs.length, ov, teile: R.hund.decompose().length }; R.hund.delete(); if (R.bommel) R.bommel.delete(); return res; });
  ok(Math.abs(r1.L - 260) < 8 && r1.n === 4 && r1.teile === 1, `Länge ${r1.L.toFixed(0)} mm (gewünscht 260), 4 Tüllen, ein Teil`);
  ok(r1.ov < 1, `Kerzen passen in die Löcher (Überschneidung ${r1.ov.toFixed(2)} mm³)`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
