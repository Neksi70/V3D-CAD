// Skandi-Wichtel (Stil „skandi" im _zwi): Menü → Vorschau → Erstellen: 4 Teile, je 1 Stück, ohne Überlappung,
// Höhe = Vorgabe, Überhänge > 45° nur am Mützen-Rand, Bart strukturiert, Stilwechsel zurück, Undo.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
const PORT = 8994, SHOTS = process.env.SHOTS || '/home/v3da/tests/shots/skandiwichtel';
mkdirSync(SHOTS, { recursive: true });
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _zwiOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  ok(await p.evaluate(() => _STARTERS.some(s => s.t === 'Skandi-Wichtel') && _GEN_WEIHNACHTEN.includes('Skandi-Wichtel')), 'Skandi-Wichtel im Menü (Weihnachten)');
  await p.click('#gen-dd-btn');
  await p.locator('#gen-dd >> text=Skandi-Wichtel').first().click();
  await p.waitForSelector('#zwi-modal.show');
  ok(await p.evaluate(() => _zwiP.stil === 'skandi' && document.querySelector('#zwi-stil .vtb.on').dataset.v === 'skandi' && document.getElementById('zwi-row-bart').style.display !== 'none'), 'öffnet im Stil Skandi, Bartstruktur-Regler sichtbar');
  await p.waitForFunction(() => _gpv['zwi'] && _gpv['zwi'].group, null, { timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.screenshot({ path: SHOTS + '/skw-dialog.png', clip: await p.locator('#zwi-modal .g3box').boundingBox() });
  const r = await p.evaluate(async () => {
    const t0 = performance.now(); await _zwiCreate(); const ms = performance.now() - t0, w = await _mfInit();
    const mf = objects.map(o => _mfUnionObjs(w, [o])), out = { ms, teile: [], ov: 0, y0: Infinity, y1: -Infinity };
    objects.forEach((o, i) => { const bb = mf[i].boundingBox(); out.teile.push({ n: o.userData.name.replace(/ #\d+/, ''), s: mf[i].decompose().length, vol: Math.round(mf[i].volume()) });
      out.y0 = Math.min(out.y0, bb.min[2]); out.y1 = Math.max(out.y1, bb.max[2]); });
    for (let i = 0; i < mf.length; i++) for (let j = i + 1; j < mf.length; j++) out.ov += w.Manifold.intersection(mf[i], mf[j]).volume();
    // Überhänge am Ganzen (Z oben im Manifold), Bart glatt (Noppen haben naturgemäß kleine Unterseiten):
    // Dreiecke mit Normale steiler als 45° nach unten, über der Platte
    const rk = _zwiBuild(w, { ..._zwiP, bart: 0 }, 'fein'), all = w.Manifold.union(['koerper', 'muetze', 'weiss', 'nase'].map(k => rk[k].rotate([90, 0, 0]))), m = all.getMesh(), V = m.vertProperties, T = m.triVerts, np = m.numProp, oh = {};
    let ohA = 0, rand = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * np, bb = T[t + 1] * np, c = T[t + 2] * np;
      const ux = V[bb] - V[a], uy = V[bb + 1] - V[a + 1], uz = V[bb + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz); if (!L) continue;
      const zc = (V[a + 2] + V[bb + 2] + V[c + 2]) / 3;
      if (nz / L < -0.72 && zc > 0.5) { const A = L / 2; ohA += A; if (Math.abs(zc - 0.44 * 160) < 1.5) rand += A; else { const k = Math.round(zc / 10) * 10; oh[k] = (oh[k] || 0) + A; } }
    }
    out.oh = { ges: Math.round(ohA), rand: Math.round(rand), rest: Object.fromEntries(Object.entries(oh).map(([k, v]) => [k, Math.round(v)])) };
    return out; });
  ok(r.teile.length === 4, 'Teile: ' + r.teile.map(t => `${t.n} (${t.vol} mm³)`).join(', ') + ` – ${(r.ms / 1000).toFixed(1)} s`);
  const st = await p.evaluate(async () => { const w = await _mfInit(), r = _zwiBuild(w, _zwiP, 'fein'), o = {};
    for (const k of ['koerper', 'muetze', 'weiss', 'nase']) { o[k] = r[k] ? r[k].decompose().length : 0; r[k] && r[k].delete(); } return o; });
  ok(st.koerper === 1 && st.muetze === 1 && st.nase === 1 && st.weiss === 1, 'je Teil genau ein Stück (Kern): ' + JSON.stringify(st));
  ok(r.ov < 1, `keine Überlappung zwischen den Teilen (${r.ov.toFixed(2)} mm³)`);
  ok(Math.abs(r.y0) < 0.3 && Math.abs(r.y1 - 160) < 1.5, `steht auf der Platte, ${r.y1.toFixed(0)} mm hoch (Vorgabe 160)`);
  const restA = Object.values(r.oh.rest).reduce((a, b) => a + b, 0);
  ok(r.oh.rand > 50 && restA < 60, `Überhänge > 45°: Mützenkante ${r.oh.rand} mm² (1,8 mm Kante, druckbar), sonst ${restA} mm² ${JSON.stringify(r.oh.rest)}`);
  // Bart: Struktur an → rauere Oberfläche (mehr Fläche) als glatt
  const bs = await p.evaluate(async () => { const w = await _mfInit(), area = q => { const r = _zwiBuild(w, { ..._zwiP, bart: q }, 'fein'), A = r.weiss.surfaceArea(); for (const k in r) if (r[k] && r[k].delete) r[k].delete(); return A; };
    return { glatt: area(0), str: area(100) }; });
  ok(bs.str > bs.glatt * 1.08, `Bartstruktur vergrößert die Oberfläche (${Math.round(bs.glatt)} → ${Math.round(bs.str)} mm²)`);
  // Szene-Ansicht schräg von vorn
  await p.evaluate(() => { const g = objects; selectObjs([]); fitToObjects(g); try { camera.position.set(camera.position.x + 6, camera.position.y + 2, camera.position.z + 14); camera.lookAt(0, 8, 0); controls.target.set(0, 8, 0); controls.update(); } catch (e) {} });
  await p.waitForTimeout(800);
  await p.screenshot({ path: SHOTS + '/skw-szene.png' });
  // Stil zurück auf klassisch
  ok(await p.evaluate(() => { _zwiOpen('klassisch'); const okk = _zwiP.stil === 'klassisch' && _zwiP.koerperFarbe === '#c99a6b' && document.getElementById('zwi-row-bart').style.display === 'none'; _zwiClose(); return okk; }), 'Menü „Zipfel-Wichtel“ schaltet zurück auf Klassisch');
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
