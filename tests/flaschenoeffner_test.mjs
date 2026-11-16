// Flaschenöffner-Gravur (Laser): Vorlagen → Layout im Gravurfeld, Schablonen-Stege, Ausrichtung,
// Serie im Jig, SVG-Ebenen, 3D-Griff. Läuft gegen --dev (eigener Port). Screenshots nach $SHOTS.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
const PORT = 8997, SHOTS = process.env.SHOTS || '/home/v3da/tests/shots/flaschenoeffner';
mkdirSync(SHOTS, { recursive: true });
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {} });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _foeOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} localStorage.removeItem('v3d_foe'); _foeReset(); _foeOpen(); document.getElementById('umsteiger-hinweis')?.remove(); });
  await p.waitForFunction(() => typeof _mfWasm !== 'undefined' && _mfWasm, null, { timeout: 40000 }).catch(() => {});
  ok(await p.evaluate(() => _STARTERS.some(s => s.t === 'Flaschenöffner-Gravur (Laser)') && _GEN_THEMEN.some(([n, l]) => n === 'Laser & Werkstatt' && l.includes('Flaschenöffner-Gravur (Laser)'))), 'Generator in Liste + Rubrik „Laser & Werkstatt“');
  ok(await p.evaluate(() => document.querySelectorAll('#foe-vorlage option').length >= 7), 'Vorlagen-Auswahl gefüllt');
  // Schriften aller Vorlagen vorladen
  await p.evaluate(() => Object.values(_FOE_VORLAGEN).forEach(v => _foeFont(v.font)));
  await p.waitForFunction(() => Object.values(_FOE_VORLAGEN).every(v => window['_threeFont_' + v.font]), null, { timeout: 40000 }).catch(() => {});
  const SECHS = ['schluessel', 'polizei', 'kind', 'hebamme', 'hopfnung', 'gluecks'];
  for (const v of SECHS) {
    const r = await p.evaluate(async (v) => { _foeVorlage(v); await new Promise(res => setTimeout(res, 400)); const G = _foeGriff(_foeP, _foeP.text);
      let ax = 1e9, bx = -1e9, ay = 1e9, by = -1e9; for (const g of G.eng) for (const r of g) for (const [x, y] of r) { ax = Math.min(ax, x); bx = Math.max(bx, x); ay = Math.min(ay, y); by = Math.max(by, y); }
      const [fx, fy, fw, fh] = G.field; return { n: G.eng.length, in: ax >= fx - 0.05 && bx <= fx + fw + 0.05 && ay >= fy - 0.05 && by <= fy + fh + 0.05,
        voll: Math.max((bx - ax) / fw, (by - ay) / fh), cap: G.info.cap, w: G.info.fw, h: G.info.fh, ang: G.info.winkel }; }, v);
    ok(r.n >= 4 && r.in && r.voll > 0.97, `Vorlage ${v}: ${r.n} Glyphenformen, im Feld ${r.w}×${r.h} mm, füllt ${(r.voll * 100).toFixed(0)} %, Versalhöhe ${r.cap.toFixed(1)} mm${Math.abs(r.ang) > 0.1 ? ', ' + r.ang.toFixed(1) + '°' : ''}`);
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${SHOTS}/foe-${v}.png`, clip: await p.locator('#foe-cvwrap').boundingBox() });
  }
  // Ganzer Dialog einmal
  await p.evaluate(() => _foeVorlage('schluessel')); await p.waitForTimeout(200);
  await p.screenshot({ path: `${SHOTS}/foe-dialog.png`, clip: await p.locator('#foe-modal .g3box').boundingBox() });
  // Schablone: HOPFENHEBAMME mit Stegen hat mehr Teile als ohne
  const st = await p.evaluate(() => { _foeVorlage('hebamme'); const a = _foeGriff(_foeP, _foeP.text).eng.reduce((s, g) => s + g.length, 0);
    _foeP.schablone = false; const b = _foeGriff(_foeP, _foeP.text).eng.reduce((s, g) => s + g.length, 0); _foeP.schablone = true; return { a, b }; });
  ok(st.a !== st.b, `Schablonen-Stege verändern die Glyphen (${st.b} → ${st.a} Ringe)`);
  // Diagonal läuft von links oben nach rechts unten
  const dg = await p.evaluate(() => { _foeVorlage('gluecks'); return _foeGriff(_foeP, _foeP.text).info.winkel; });
  ok(dg > 3 && dg < 20, `Glückspils diagonal: ${dg.toFixed(1)}° (links oben → rechts unten)`);
  // Feste Größe: zu groß → Warnung, Einpassen aus
  const fx = await p.evaluate(() => { _foeVorlage('polizei'); _foeSet('groesse', 30); const G = _foeGriff(_foeP, _foeP.text); return { auto: _foeP.auto, over: G.info.over, cap: G.info.cap }; });
  ok(!fx.auto && fx.over && Math.abs(fx.cap - 30) < 0.01, `feste Schriftgröße 30 mm → zu groß erkannt (auto aus)`);
  await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.getElementById('foe-warn').classList.contains('show')), 'Warnung „größer als das Gravurfeld“ sichtbar');
  // Eigener Spruch, mehrzeilig, Griffmaße
  const eg = await p.evaluate(() => { _foeVorlage(''); _foeSet('text', 'Papas\nBieröffner'); _foeSet('auto', true); _foeSet('L', 110); _foeSet('B', 28); const G = _foeGriff(_foeP, _foeP.text); return { v: _foeP.vorlage, fw: G.info.fw, fh: G.info.fh, n: G.eng.length }; });
  ok(eg.v === '' && eg.fw === 100 && eg.fh === 24 && eg.n >= 15, `eigener Spruch 2-zeilig, Feld ${eg.fw}×${eg.fh} mm (Griff 110×28, Rand 5/2)`);
  // Spiegeln
  const sp = await p.evaluate(() => { const a = _foeGriff({ ..._foeP, align: 'links' }, 'AB').eng[0][0][0][0], b = _foeGriff({ ..._foeP, align: 'links', spiegeln: true }, 'AB').eng[0][0][0][0]; return Math.abs(a + b - _foeP.L) < 0.01; });
  ok(sp, 'Spiegeln spiegelt um die Griffmitte');
  // Serie: 3 × 2 mit eigener Liste, Kontur an → SVG
  const sv = await p.evaluate(async () => {
    _foeReset(); _foeSet('spalten', 3); _foeSet('reihen', 2); _foeSet('abstand', 8); _foeSet('kontur', true); _foeSet('serie', 'liste');
    _foeSet('liste', 'Prost!\nFlaschenkind\nMan darf die / Hopfnung niemals auf geben\nGlückspils\nBier Hol Dienst');
    await new Promise(r => setTimeout(r, 300));
    const svg = await _foeBuildSVG(_foeP), S = _foeBlatt(_foeP);
    const gr = svg.split('<g id="gravur"')[1].split('</g>')[0], ko = svg.split('<g id="kontur"')[1].split('</g>')[0];
    return { svg, SW: S.SW, SH: S.SH, gp: (gr.match(/<path/g) || []).length, kp: (ko.match(/<path/g) || []).length, z3: _foeGriff(_foeP, S.items[2].text).eng.length,
      warn: document.getElementById('foe-warn').textContent };
  });
  ok(Math.abs(sv.SW - (2 * 2 + 3 * 105 + 2 * 8)) < 0.01 && Math.abs(sv.SH - (2 * 2 + 2 * 30 + 8)) < 0.01, `Jig 3×2: Blatt ${sv.SW}×${sv.SH} mm`);
  ok(sv.gp === 5 && sv.kp === 6, `SVG: ${sv.gp} verschweißte Gravur-Pfade (5 Sprüche, 1 Platz leer), ${sv.kp} Konturen`);
  ok(/1 von 6 Plätzen ohne Spruch/.test(sv.warn), 'Hinweis auf leeren Platz');
  ok(/width="335mm" height="72mm" viewBox="0 0 335 72"/.test(sv.svg) && /inkscape:label="Gravur"/.test(sv.svg) && /inkscape:label="Kontur"/.test(sv.svg) && /stroke-width="0.1"/.test(sv.svg), 'SVG in mm mit Ebenen Gravur + Kontur (0,1 mm rot)');
  writeFileSync(`${SHOTS}/beispiel_serie_3x2.svg`, sv.svg);
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${SHOTS}/foe-serie-3x2.png`, clip: await p.locator('#foe-cvwrap').boundingBox() });
  // Einzel-SVG Standard (Kontur aus → Ebene leer)
  const e1 = await p.evaluate(async () => { _foeReset(); _foeVorlage('schluessel'); return await _foeBuildSVG(_foeP); });
  ok(/<g id="kontur"[^>]*>\s*<\/g>/.test(e1) && (e1.split('<g id="gravur"')[1].match(/<path/g) || []).length === 1, 'Standard: Kontur-Ebene leer, Gravur 1 Pfad');
  writeFileSync(`${SHOTS}/beispiel_0_33er_schluessel.svg`, e1);
  // 3D-Griff
  const d3 = await p.evaluate(async () => { _newCreate(false); _foeReset(); _foeVorlage('polizei'); _foeOpen(); await _foeCreate(); const m = objects[objects.length - 1];
    const bb = new THREE.Box3().setFromObject(m); return { n: objects.length, name: m && m.userData.name, x: (bb.max.x - bb.min.x) * 10, y: (bb.max.y - bb.min.y) * 10, z: (bb.max.z - bb.min.z) * 10, tris: m.geometry.attributes.position.count / 3 }; });
  ok(d3.n === 1 && Math.abs(d3.x - 105) < 0.1 && Math.abs(d3.y - 12) < 0.1 && Math.abs(d3.z - 30) < 0.1 && d3.tris > 500, `3D-Griff ${d3.x.toFixed(1)}×${d3.z.toFixed(1)}×${d3.y.toFixed(1)} mm, ${d3.tris} Dreiecke`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
