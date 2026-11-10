// Lichtbox: Menü (Weihnachten) → Fenster → alle 7 Vorlagen bauen (dicht, Teile ohne Überlappung) →
// Erstellen (Drucklage: Front unten, Rückwand daneben) → Rückwand passt in den Kasten → Undo
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8989, SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _lbxOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Lichtbox').first();
  ok(await item.count() > 0, 'Eintrag im Generator-Menü (Weihnachten)');
  await item.click();
  await p.waitForSelector('#lbx-modal.show');
  await p.waitForFunction(() => window._threeFont_greatvibes_local && window._threeFont_helvetiker_bold, null, { timeout: 30000 }).catch(() => {});
  for (const v of ['krippe', 'glanz', 'zeit', 'schwein', 'punkte', 'wichtel', 'wichtel2', 'hier', 'leotanne', 'leostern', 'lamtanne', 'lamstern']) {
    const r = await p.evaluate(async (v) => { _lbxVorlage(v); await new Promise(res => setTimeout(res, 300));
      const w = await _mfInit(), M = w.Manifold, t = _lbxBuild(w, _lbxP, _lbxText), teile = [t.kasten, t.dunkel, t.deckel, t.muster].filter(Boolean);
      let ov = 0; for (let i = 0; i < teile.length; i++) for (let j = i + 1; j < teile.length; j++) ov += M.intersection(teile[i], teile[j]).volume();
      const res = { n: teile.length, kasten: t.kasten.decompose().length, dunkel: t.dunkel ? t.dunkel.volume() : 0, deckel: t.deckel ? t.deckel.decompose().length : 0, ov, stat: teile.every(m => m.status() === 'NoError') };
      teile.forEach(m => m.delete()); return res; }, v);
    ok(r.stat && (r.kasten === 1 || /^lam/.test(v)) && (r.deckel === 1 || /^lam/.test(v)) && r.ov < 0.01 && (v === 'krippe' || r.dunkel > 20), `Vorlage ${v}: ${r.n} Teile, Motiv ${r.dunkel.toFixed(0)} mm³, Überlappung ${r.ov.toFixed(3)}`);
    if (v === 'glanz' || v === 'hier' || v === 'leostern' || v === 'lamstern') { await p.waitForTimeout(700); await p.screenshot({ path: `${SHOTS}/lbx-${v}.png`, clip: await p.locator('#lbx-modal .g3box').boundingBox() }); }
  }
  await p.evaluate(() => _lbxVorlage('krippe'));
  const r1 = await p.evaluate(async () => {
    await _lbxCreate();
    const w = await _mfInit(), res = objects.map(o => { const m = _mfUnionObjs(w, [o]), bb = getMeshBox(o); return { name: o.userData.name, shells: m.decompose().length, minY: bb.min.y, h: (bb.max.y - bb.min.y) * 10 }; });
    return res;
  });
  ok(r1.length === 2 && r1.every(t => t.shells === 1 && Math.abs(t.minY) < 1e-3), 'Krippenhaus: ' + r1.map(t => `${t.name} (${t.h.toFixed(1)} mm hoch)`).join(', '));
  ok(Math.abs(r1[0].h - 40) < 0.1, 'Kasten liegt mit der Front nach unten (40 mm hoch = Tiefe)');
  await p.evaluate(() => { selectObjs([]); fitToObjects(objects); }); await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/lbx-szene.png' });
  await p.evaluate(() => undo());
  ok(await p.evaluate(() => objects.length === 0), 'Rückgängig entfernt die Teile');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
