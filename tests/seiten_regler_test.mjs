// „Seiten"-Regler mit Raststufen (Ralf): kleine Eckenzahlen bekommen viel Spurweg.
// Spur mit echten Mausbewegungen abtasten → 3/4/5/6 je ≥ 8 % der Breite, Max am
// rechten Ende erreichbar; Zahlenfeld 4 → Quadrat; Pfeiltasten ±1; Undo; andere Formen.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8844;
const CWD = new URL('..', import.meta.url).pathname;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: CWD, stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof addPolyTube === 'function' && window._isReady);
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} });
  await p.evaluate(() => { _newCreate(false); addPolyTube(4); const o = objects[objects.length - 1]; selectObjs([o]); updateFP(); });
  await p.waitForSelector('#fp-seg-sl', { state: 'visible' });
  const st = () => p.evaluate(() => ({ seg: getFirst().userData.segments, fld: document.getElementById('fp-seg').value,
    pos: +document.getElementById('fp-seg-sl').value, polyN: getFirst().userData.tubePoly }));
  const s0 = await st();
  ok(s0.seg === 4 || s0.fld === '4', `Kantrohr startet mit 4 Seiten (Feld ${s0.fld})`);
  const range = await p.evaluate(() => { const s = document.getElementById('fp-seg-sl'); return [s.dataset.segMin, s.dataset.segMax, s.min, s.max]; });
  ok(range[0] === '3' && range[1] === '128' && range[3] === '1000', `Seiten-Spur intern 0…1000, Werte ${range[0]}…${range[1]}`);

  // ── Spur mit der Maus abtasten (Daumen anfassen, pixelweise nach rechts) ──
  const bb = await p.locator('#fp-seg-sl').boundingBox();
  const y = bb.y + bb.height / 2;
  await p.mouse.move(bb.x + 1, y);
  await p.mouse.down();
  const seen = new Map(); let last = null;
  for (let x = bb.x + 1; x <= bb.x + bb.width - 1; x += 1) {
    await p.mouse.move(x, y);
    const v = await p.evaluate(() => +document.getElementById('fp-seg').value);
    seen.set(v, (seen.get(v) || 0) + 1); last = v;
    if (x === bb.x + 1 + 60) await p.waitForTimeout(700);   // Pause mitten im Ziehen (> Undo-Takt 400 ms)
  }
  await p.mouse.move(bb.x + bb.width + 20, y);   // über das Ende hinaus
  const vEnd = await p.evaluate(() => getFirst().userData.segments);
  await p.mouse.up();
  const W = bb.width;
  const pct = v => (seen.get(v) || 0) / W * 100;
  console.log('     Spurbreite ' + W.toFixed(0) + ' px; Pixel je Wert: ' + [...seen].map(([v, n]) => `${v}:${n}`).join(' '));
  for (const v of [3, 4, 5, 6]) ok(pct(v) >= 8, `${v} Seiten belegen ${pct(v).toFixed(1)} % der Spur (≥ 8 %)`);
  ok(vEnd === 128 && last === 128, `Max 128 am rechten Ende erreichbar (Feld ${last}, Objekt ${vEnd})`);
  const geoOk = await p.evaluate(() => getFirst().userData.segments === +document.getElementById('fp-seg').value);
  ok(geoOk, 'Objekt-Segmente = Feldwert nach dem Ziehen');

  // ── Undo: ganze Ziehgeste = ein Schritt zurück auf 4 ──
  await p.waitForTimeout(500);
  const un = await p.evaluate(() => { undo(); const o = objects[objects.length - 1]; selectObjs([o]); updateFP();
    const sl = document.getElementById('fp-seg-sl');
    return { seg: o.userData.segments, fld: document.getElementById('fp-seg').value, slVal: _segValFromPos(sl) }; });
  ok(un.seg === 4 && un.fld === '4' && un.slVal === 4, `Undo (ein Schritt, trotz Pause beim Ziehen) → 4 Seiten, Feld ${un.fld}, Spur zeigt ${un.slVal}`);

  // ── Zahlenfeld: 3 tippen, dann 4 → Quadrat ──
  await p.locator('#fp-seg').fill('3');
  let s = await st(); ok(s.seg === 3, `Zahlenfeld 3 → Dreieck (${s.seg})`);
  await p.locator('#fp-seg').fill('4');
  s = await st();
  const posV = await p.evaluate(() => _segValFromPos(document.getElementById('fp-seg-sl')));
  ok(s.seg === 4 && posV === 4, `Zahlenfeld 4 → Quadrat (${s.seg}), Daumen steht im 4er-Band`);
  const sq = await p.evaluate(() => { const o = getFirst(); o.updateMatrixWorld(true);
    const P = o.geometry.attributes.position; let ys = new Set(); for (let i = 0; i < P.count; i++) ys.add(Math.round(Math.atan2(P.getZ(i), P.getX(i)) * 100)); return ys.size; });
  ok(sq > 0, `Geometrie neu gebaut (${sq} Winkelklassen)`);
  await p.locator('#fp-seg').fill('9');
  s = await st(); ok(s.seg === 9, `Zwischenwert 9 per Zahlenfeld exakt (${s.seg})`);

  // ── Pfeiltasten ±1 am Regler ──
  await p.locator('#fp-seg-sl').focus();
  await p.keyboard.press('ArrowRight'); s = await st(); ok(s.seg === 10 && s.fld === '10', `Pfeil → : 9 → ${s.seg}`);
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); s = await st(); ok(s.seg === 8, `2× Pfeil ← : → ${s.seg}`);
  await p.keyboard.press('End'); s = await st(); ok(s.seg === 128, `Ende → Max (${s.seg})`);
  await p.keyboard.press('Home'); s = await st(); ok(s.seg === 3, `Pos1 → Min (${s.seg})`);
  await p.keyboard.press('ArrowLeft'); s = await st(); ok(s.seg === 3, `Unter Min bleibt 3 (${s.seg})`);

  // ── Klick mitten in die Spur: Rastwert, kein Zwischenwert ──
  await p.mouse.click(bb.x + bb.width * 0.5, y);
  s = await st(); const stops = [3,4,5,6,7,8,10,12,16,20,24,32,48,64,96,128];
  ok(stops.includes(s.seg), `Klick in die Mitte → Raststufe ${s.seg}`);

  // ── Andere Formen mit „Seiten" ──
  for (const [ty, mn, mx] of [['polygon', 3, 64], ['cylinder', 3, 128], ['cone', 3, 128], ['pyramid', 3, 128], ['torus', 3, 128]]) {
    const r = await p.evaluate(ty => { _newCreate(false); addShape(ty); const o = objects[objects.length - 1]; selectObjs([o]); updateFP();
      const sl = document.getElementById('fp-seg-sl'); if (!sl) return null;
      const f = document.getElementById('fp-seg');
      f.value = '5'; f.dispatchEvent(new Event('input'));
      return { mn: sl.dataset.segMin, mx: sl.dataset.segMax, seg: o.userData.segments, band: _segValFromPos(sl) }; }, ty);
    ok(r && +r.mn === mn && +r.mx === mx && r.seg === 5 && r.band === 5, `${ty}: Raststufen-Spur ${r && r.mn}…${r && r.mx}, Feld 5 → ${r && r.seg}, Daumen im 5er-Band`);
  }
  // Kugel „Schritte" bleibt linear
  const sph = await p.evaluate(() => { _newCreate(false); addShape('sphere'); selectObjs([objects[0]]); updateFP();
    const sl = document.getElementById('fp-seg-sl'); return sl ? { max: sl.max, seg: sl.dataset.segMin } : null; });
  ok(sph && sph.max === '128' && sph.seg === undefined, 'Kugel-„Schritte" bleibt linear (nicht betroffen)');

  // ── Speichern/Laden: Wert unverändert gespeichert ──
  const rt = await p.evaluate(() => { _newCreate(false); addPolyTube(4); const o = objects[0]; selectObjs([o]); updateFP();
    const f = document.getElementById('fp-seg'); f.value = '6'; f.dispatchEvent(new Event('input'));
    const d = objectToData(o); const o2 = buildObjectFromData(JSON.parse(JSON.stringify(d))); return { saved: d.segments ?? (d.userData && d.userData.segments), loaded: o2.userData.segments }; });
  ok(rt.loaded === 6, `Speichern/Laden: segments ${rt.saved} → ${rt.loaded}`);

  ok(errs.length === 0, 'keine Seitenfehler' + (errs.length ? ': ' + errs.join(' | ') : ''));
} catch (e) { console.log('FAIL Ausnahme: ' + (e.stack || e)); fail++; }
finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLE OK');
process.exit(fail ? 1 : 0);
