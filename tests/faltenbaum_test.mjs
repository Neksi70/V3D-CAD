// Faltenbaum-Testversion: Katalog → Dialog → Vorlagen/Regler → Einfügen →
// Speichern/Laden → Undo/Redo → Doppelklick-Bearbeiten → STL → Boolean-Hinweis.
// Start: node tests/faltenbaum_test.mjs   (startet eigenen Dev-Server auf 18808; seit 9.11.26 in der Live-Datei volme3d.html)
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.TEST_PORT || 18808);
const SHOTS = process.env.SHOTS || '/tmp';
const srv = spawn('python3', [path.join(HIER, '..', 'volme3d_server.py'), String(PORT), '--dev'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof objects !== 'undefined' && window.V3DFaltenbaum && typeof _ftbOpen === 'function', null, { timeout: 40000 });
  await p.evaluate(() => { hideStarter(); _newCreate(false); window._notes = []; const n = notify; window.notify = notify = (m, t, ms) => { _notes.push(m); return n(m, t, ms); }; });

  console.log('Katalog');
  await p.click('#gen-dd-btn');
  const item = p.locator('#gen-dd >> text=Faltenbaum (Weihnachten)').first();
  ok(await item.count() > 0, 'Eintrag „Faltenbaum (Weihnachten)“ im Generator-Menü');
  await item.click();
  await p.waitForSelector('#ftb-modal.show');
  ok(await p.locator('#ftb-rows .vrow').count() === 11, '11 Regler aus V3DFaltenbaum.UI');
  ok(await p.locator('#ftb-preset option').count() === 8, 'Vorlagen-Dropdown (Kleine Tanne + 6 + angepasst)');
  ok(await p.inputValue('#ftb-preset') === 'Kleine Tanne (gedreht)' && await p.evaluate(() => _ftbP.drehung === 75 && _ftbP.falten === 36), 'Start mit Vorlage „Kleine Tanne (gedreht)“');
  await p.waitForTimeout(400);
  await p.screenshot({ path: SHOTS + '/ftb-dialog.png', clip: await p.locator('#ftb-modal .g3box').boundingBox() });

  console.log('Watertight-Prüfung der Regler-Extreme');
  const geoCheck = () => p.evaluate(() => {
    const m = V3DFaltenbaum.generate(_ftbP), I = m.indices, P = m.positions, E = new Map();
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = I[t + k], c = I[t + (k + 1) % 3], key = a < c ? a + ',' + c : c + ',' + a;
      E.set(key, (E.get(key) || 0) + 1);
    }
    let open = 0; for (const v of E.values()) if (v !== 2) open++;
    let vol = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, bb = I[t + 1] * 3, c = I[t + 2] * 3;
      vol += (P[a] * (P[bb + 1] * P[c + 2] - P[bb + 2] * P[c + 1]) - P[a + 1] * (P[bb] * P[c + 2] - P[bb + 2] * P[c]) + P[a + 2] * (P[bb] * P[c + 1] - P[bb + 1] * P[c])) / 6;
    }
    return { open, vol, tris: I.length / 3 };
  });
  const setNum = async (k, v) => { await p.fill('#ftbn-' + k, v); await p.press('#ftbn-' + k, 'Enter'); await p.waitForTimeout(80); };
  for (const [k, vals] of [['etagen', ['1', '8']], ['falten', ['6', '60']], ['drehung', ['-180', '180', '0']]]) {
    for (const v of vals) {
      await setNum(k, v);
      const val = await p.evaluate(k => _ftbP[k], k);
      const g = await geoCheck();
      ok(val === parseFloat(v) && g.open === 0 && g.vol > 0, `${k}=${v}: wasserdicht, Volumen ${(g.vol / 1000).toFixed(0)} cm³, ${g.tris} Dreiecke`);
    }
  }
  await setNum('stufe', '0,45');
  ok(await p.evaluate(() => _ftbP.stufe) === 0.45, 'Dezimalkomma im Zahlenfeld (0,45 → 0.45)');
  ok(await p.inputValue('#ftbn-stufe') === '0,45', 'Anzeige mit Komma');
  await setNum('etagen', '99');
  ok(await p.evaluate(() => _ftbP.etagen) === 8, 'Eingabe über Max wird auf 8 begrenzt');
  // Slider (echtes input-Ereignis)
  await p.locator('#ftb-falten').fill('30');
  await p.waitForTimeout(120);
  ok(await p.evaluate(() => _ftbP.falten) === 30 && await p.inputValue('#ftbn-falten') === '30', 'Slider setzt Wert + Zahlenfeld');
  ok(await p.inputValue('#ftb-preset') === '', 'Vorlage springt auf „angepasst“');

  console.log('Alle Vorlagen einfügen');
  const presets = await p.evaluate(() => Object.keys(_ftbPresets()));
  for (const [i, name] of presets.entries()) {
    if (i) { await p.evaluate(() => _ftbOpen()); await p.waitForSelector('#ftb-modal.show'); }
    await p.selectOption('#ftb-preset', name);
    await p.waitForTimeout(120);
    const g = await geoCheck();
    await p.click('#ftb-ok');
    const r = await p.evaluate(() => { const o = objects[objects.length - 1]; o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
      return { n: objects.length, name: o.userData.name, minY: bb.min.y + o.position.y, h: (bb.max.y - bb.min.y) * 10, d: (bb.max.x - bb.min.x) * 10, sel: selectedObjs[0] === o, tris: o.geometry.attributes.position.count / 3 }; });
    const exp = await p.evaluate(n => Object.assign({}, V3DFaltenbaum.DEFAULTS, _ftbPresets()[n]), name);
    ok(r.n === i + 1 && r.sel && Math.abs(r.minY) < 1e-6 && Math.abs(r.h - exp.hoehe) < 0.01 && g.open === 0,
       `„${name}“: ${r.name}, Höhe ${r.h.toFixed(1)} mm, Ø ${r.d.toFixed(1)} mm, steht auf y=0, ausgewählt, ${r.tris} Dreiecke`);
  }
  await p.evaluate(() => fitToObjects(objects));
  await p.mouse.click(5, 940);
  await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/ftb-szene.png' });

  console.log('Speichern/Laden');
  const sl = await p.evaluate(() => {
    const snap = _sceneSnapshot(), js = JSON.stringify(snap);
    const before = objects.map(o => [o.userData.name, o.geometry.attributes.position.count, o.position.x.toFixed(4), JSON.stringify(o.userData.faltenbaumParams)]);
    const noGeo = snap.objects.every(d => d.faltenbaumParams && !d.geometry);
    _applySnapshot(JSON.parse(js));
    const after = objects.map(o => [o.userData.name, o.geometry.attributes.position.count, o.position.x.toFixed(4), JSON.stringify(o.userData.faltenbaumParams)]);
    return { kb: js.length / 1024, noGeo, same: JSON.stringify(before) === JSON.stringify(after), editable: objects.every(_ftbParamsOnly) };
  });
  ok(sl.noGeo, 'Gespeichert werden nur Parameter (kein Netz)');
  ok(sl.same && sl.editable, `Laden baut alle Bäume identisch neu, wieder bearbeitbar (Snapshot ${sl.kb.toFixed(1)} KB)`);

  console.log('Undo/Redo');
  const u = await p.evaluate(async () => {
    const n0 = objects.length;
    _ftbOpen(); _ftbP.etagen = 2; _ftbCreate();
    const n1 = objects.length;
    undo(); await new Promise(r => setTimeout(r, 300));
    const n2 = objects.length;
    redo(); await new Promise(r => setTimeout(r, 300));
    return { n0, n1, n2, n3: objects.length, ed: _ftbParamsOnly(objects[objects.length - 1]), et: objects[objects.length - 1].userData.faltenbaumParams.etagen };
  });
  ok(u.n1 === u.n0 + 1 && u.n2 === u.n0 && u.n3 === u.n1 && u.ed && u.et === 2, `Undo ${u.n1}→${u.n2}, Redo →${u.n3}, Baum danach bearbeitbar`);

  console.log('Doppelklick bearbeiten');
  await p.evaluate(() => { _newCreate(false); _ftbOpen(); _ftbCreate(); const o = objects[0]; o.position.x = 3; o.updateMatrixWorld(true); fitToObjects([o]); });
  await p.mouse.click(5, 940); await p.waitForTimeout(400);
  const xy = await p.evaluate(() => { const o = objects[0]; const v = new THREE.Vector3(0, 5, 0).applyMatrix4(o.matrixWorld).project(camera); const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; });
  await p.mouse.dblclick(xy.x, xy.y);
  await p.waitForTimeout(300);
  ok(await p.locator('#ftb-modal.show').count() === 1 && (await p.textContent('#ftb-ok')).includes('Übernehmen'), 'Doppelklick öffnet „Faltenbaum bearbeiten“');
  ok(await p.inputValue('#ftbn-etagen') === '4', 'Dialog zeigt die Werte des Baums');
  await setNum('etagen', '6');
  await p.click('#ftb-ok');
  const e = await p.evaluate(() => ({ n: objects.length, et: objects[0].userData.faltenbaumParams.etagen, x: objects[0].position.x, ed: _ftbParamsOnly(objects[0]) }));
  ok(e.n === 1 && e.et === 6 && e.x === 3 && e.ed, 'Übernehmen ändert denselben Baum (Lage bleibt)');
  await p.evaluate(() => undo()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => objects[0].userData.faltenbaumParams.etagen) === 4, 'Undo nach Bearbeiten → wieder 4 Etagen');

  console.log('STL-Export');
  const s = await p.evaluate(async () => {
    const o = objects[0];
    const r = _buildStlBlob([o]); const buf = await r.blob.arrayBuffer(); const dv = new DataView(buf);
    const n = dv.getUint32(80, true), bin = buf.byteLength === 84 + 50 * n;
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; const E = new Map(), q = v => Math.round(v * 1000);
    for (let t = 0; t < n; t++) {
      const V = [];
      for (let k = 0; k < 3; k++) { const off = 84 + t * 50 + 12 + k * 12; const pt = [dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true)];
        for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pt[a]); mx[a] = Math.max(mx[a], pt[a]); } V.push(pt.map(q).join(',')); }
      for (let k = 0; k < 3; k++) { const a = V[k], c = V[(k + 1) % 3]; if (a === c) continue; const key = a < c ? a + '|' + c : c + '|' + a; E.set(key, (E.get(key) || 0) + 1); }
    }
    let open = 0; for (const v of E.values()) if (v !== 2) open++;
    const ref = new DataView(V3DFaltenbaum.toSTL(o.userData.faltenbaumParams)).getUint32(80, true);
    return { n, ref, bin, open, h: mx[2] - mn[2], w: mx[0] - mn[0], z0: mn[2], soll: o.userData.faltenbaumParams.hoehe };
  });
  ok(s.bin && s.n === s.ref, `Binär-STL über den normalen Export: ${s.n} Dreiecke (toSTL: ${s.ref})`);
  ok(Math.abs(s.h - s.soll) < 0.05 && Math.abs(s.z0) < 0.05 && s.open === 0, `Z-up, mm: Höhe ${s.h.toFixed(2)} mm, Breite ${s.w.toFixed(2)} mm, offene Kanten ${s.open}`);

  console.log('Boolean-Hinweis');
  await p.evaluate(() => { addShape('box'); const bx = objects[objects.length - 1]; bx.position.copy(objects[0].position); bx.position.y = 3; bx.scale.set(4, 4, 4); bx.updateMatrixWorld(true); selectObjs(objects.slice()); _notes.length = 0; intersectSelected(); });
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => _notes.includes('Kann bei Faltenbäumen langsam sein')), 'Hinweis „Kann bei Faltenbäumen langsam sein“');
  await p.waitForFunction(() => objects.length === 1, null, { timeout: 120000 }).catch(() => {});
  ok(await p.evaluate(() => objects.length === 1 && !_ftbParamsOnly(objects[0])), 'Schnittmenge läuft durch; Ergebnis ist ein normales Netz');
  console.log('Rubrik Weihnachten');
  const xm = await p.evaluate(async () => {
    _ftbClose && _ftbClose();
    const th = _GEN_THEMEN.find(t => /Weihnachten/.test(t[0]));
    const fehlt = _GEN_WEIHNACHTEN.filter(t => !_STARTERS.some(s => s.t === t));
    const doppelt = _GEN_WEIHNACHTEN.filter(t => _GEN_THEMEN.filter(x => x[1].includes(t)).length !== 1);
    await _genGenList();
    const menue = [...document.querySelectorAll('#gen-dd-list .gen-xmas .sdd-name')].map(e => e.firstChild.textContent);
    return { erstes: _GEN_THEMEN[0][0], n: th && th[1].length, fehlt, doppelt, menue };
  });
  ok(xm.erstes === '🎄 Weihnachten' && xm.n >= 10 && !xm.fehlt.length && !xm.doppelt.length, 'Thema „🎄 Weihnachten“ zuerst, alle Einträge vorhanden, nur einmal einsortiert: ' + JSON.stringify(xm));
  ok(xm.menue.length === xm.n && xm.menue[0] === 'Faltenbaum (Weihnachten)', 'Generator-Menü: Weihnachten-Block oben mit allen Einträgen');
} catch (e) {
  console.error(e); fails++;
} finally {
  ok(errs.length === 0, 'Keine Konsolenfehler' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); srv.kill();
  console.log(fails ? `\n${fails} FEHLER` : '\nAlles grün');
  process.exit(fails ? 1 : 0);
}
