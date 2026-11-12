// Kugel-Anhänger (🎄 _kgl*): Menü → Vorschau → Erstellen (Käfig 1 Stück, Text eigenes Teil, keine Überlappung, flach)
// → alle Vorlagen bauen → ohne Text → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process'; import fs from 'fs';
const PORT = 8890, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _kglOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Kugel-Anhänger').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü');
  await item.click();
  await p.waitForSelector('#kgl-modal.show');
  await p.waitForFunction(() => window._threeFont_greatvibes_local, null, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => _gpv['kgl'] && _gpv['kgl'].group, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  ok(await p.evaluate(() => !!(_gpv['kgl'] && _gpv['kgl'].group)), 'Vorschau steht');
  await p.screenshot({ path: SHOTS + '/kgl-dialog.png', clip: await p.locator('#kgl-modal .g3box').boundingBox() });
  const vl = await p.evaluate(async () => { const w = await _mfInit(), o = {};
    for (const v of Object.keys(_KGL_VORLAGEN)) { const r = _kglBuild(w, { ..._kglP, text: _KGL_VORLAGEN[v] }, _kglText);
      const st = r.kaefig.decompose(), vols = st.map(q => q.volume()), haupt = st[vols.indexOf(Math.max(...vols))];   // Rippenstücke in Buchstabenschleifen liegen am Text an
      const lose = st.filter(q => q !== haupt && (!r.text || q.minGap(r.text, 1) > 0.01)).length;
      o[v] = { k: st.length, lose, t: r.text ? r.text.decompose().length : 0, ov: r.text ? w.Manifold.intersection(r.kaefig, r.text).volume() : 0, zeilen: r.info.textZeilen };
      if (v === 'frohe') { const bin = m => { const me = m.getMesh(), V = me.vertProperties, T = me.triVerts, np = me.numProp, a = []; for (let i = 0; i < T.length; i++) { const q = T[i] * np; a.push(V[q], V[q + 1], V[q + 2]); } return a; }; o.bin = [bin(r.kaefig), bin(r.text)]; }
      r.kaefig.delete(); r.text && r.text.delete(); }
    return o; });
  fs.writeFileSync('/tmp/kgl_k.bin', Buffer.from(new Float32Array(vl.bin[0]).buffer)); fs.writeFileSync('/tmp/kgl_t.bin', Buffer.from(new Float32Array(vl.bin[1]).buffer)); delete vl.bin;
  ok(Object.values(vl).every(v => v.lose === 0 && v.ov < 0.01) && vl.leer.k === 1, 'Käfig: kein loses Stück (Stücke in Buchstabenschleifen hängen am Text), keine Überlappung: ' + JSON.stringify(vl));
  ok(vl.frohe.zeilen === 2 && vl.fuer.zeilen === 2 && vl.leer.t === 0, 'Text: 2 Zeilen, „ohne Text“ ohne Textteil');
  const r1 = await p.evaluate(async () => { await _kglCreate(); return objects.map(o => { const bb = getMeshBox(o); return { n: o.userData.name, y0: bb.min.y * 10, y1: bb.max.y * 10, b: (bb.max.x - bb.min.x) * 10 }; }); });
  ok(r1.length === 2 && r1.every(t => Math.abs(t.y0) < 0.01) && Math.abs(r1[0].y1 - 3) < 0.01 && Math.abs(r1[1].y1 - 3.6) < 0.01, 'flach: ' + r1.map(t => `${t.n} ${t.y1.toFixed(1)} mm`).join(', '));
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
