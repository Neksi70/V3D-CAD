// Arbeitsumgebungen: Advanced heißt jetzt V3D-SionCAD und hat Fusion-Tastenkürzel,
// Beginner behält die bisherige Belegung. Tooltips + Kürzel-Übersicht je Umgebung,
// Shift+mittlere Taste = Drehen in V3D-SionCAD.
// Aufruf (im Worktree): node tests/umgebungen_test.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
const HIER = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 18819;
const srv = spawn('python3', [path.join(HIER, 'umgebungen-test-server.py'), String(PORT), '--dev'], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d-umgebungen.html`);
  await p.waitForFunction(() => typeof _advSet === 'function' && typeof objects !== 'undefined', null, { timeout: 60000 });
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} localStorage.removeItem('v3d_modus'); _advSet('beginner'); _newCreate(false); addShape('box'); });
  const taste = async (k, opt = {}) => { await p.mouse.move(700, 450); await p.keyboard.press(k); await p.waitForTimeout(opt.warte || 150); };
  const zustand = () => p.evaluate(() => ({ edit: editMode, pp: !!(_pp && _pp.active), edge: !!_edgeMode, cmdk: document.getElementById('cmdk').classList.contains('show'), n: objects.length, sk: !!_sk.active }));
  const esc = async () => { await p.evaluate(() => { try { _cmdkClose(); } catch (e) {} }); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(150); };

  ok(await p.evaluate(() => document.querySelector('#mode-sw button[data-m="advanced"]').textContent.trim() === 'V3D-SIONCAD'), 'Schalter heißt V3D-SIONCAD');

  // Beginner: bisherige Belegung unverändert
  await p.evaluate(() => selectObjs([objects[0]]));
  await taste('e'); ok((await zustand()).edit === 'rotate', 'Beginner: E = Rotieren');
  await taste('w'); ok((await zustand()).edit === 'move', 'Beginner: W = Bewegen');
  await taste('q'); ok((await zustand()).edit === 'select', 'Beginner: Q = Auswahl');
  await taste('f'); ok(!(await zustand()).edge, 'Beginner: F = Einpassen (kein Abrunden)');
  ok(await p.evaluate(() => !/Taste Q/.test(document.querySelector('[onclick="enterPushPull()"]').title)), 'Beginner: Tooltip ohne Vusion-Taste');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#pane-keys .umg-vus')).display === 'none'), 'Beginner: Vusion-Kürzel in der Übersicht ausgeblendet');

  // V3D-SionCAD
  await p.click('#mode-sw button[data-m="advanced"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => _advMode === 'advanced' && document.body.classList.contains('adv')), 'V3D-SionCAD aktiv (intern advanced)');
  ok(await p.evaluate(() => /Taste Q/.test(document.querySelector('[onclick="enterPushPull()"]').title)), 'Vusion: Tooltip „Drücken/Ziehen“ zeigt Taste Q');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#pane-keys .umg-vus')).display !== 'none' && getComputedStyle(document.querySelector('#pane-keys .umg-beg')).display === 'none'), 'Vusion: Kürzel-Übersicht zeigt die Fusion-Belegung');

  // Symbol-Leiste + Vusion: kein doppelter Browser-Tooltip, Taste steht im eigenen Tooltip
  await p.evaluate(() => _symToggle()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => { const b = document.querySelector('#tb-r1 [onclick="enterPushPull()"]'); return !document.querySelector('#tb-r1 .btn.symb[title]') && (!b || !b.dataset.symOrig || /Taste Q/.test(b.dataset.symDesc)); }), 'Symbol-Leiste: kein doppelter Tooltip, Taste Q im eigenen Tooltip');
  await p.evaluate(() => _symToggle()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => /Taste Q/.test(document.querySelector('[onclick="enterPushPull()"]').title)), 'Symbol-Leiste aus: Tooltip mit Taste Q wieder da');
  await p.evaluate(() => selectObjs([objects[0]]));
  await taste('q'); ok((await zustand()).pp, 'Vusion: Q = Drücken/Ziehen'); await esc();
  await p.evaluate(() => selectObjs([objects[0]]));
  await taste('f'); ok((await zustand()).edge, 'Vusion: F = Abrunden/Fase (Kanten-Modus)'); await esc();
  await p.evaluate(() => selectObjs([objects[0]]));
  await taste('m'); ok((await zustand()).edit === 'move', 'Vusion: M = Bewegen');
  await taste('s'); ok((await zustand()).cmdk, 'Vusion: S = Befehl suchen'); await esc();
  const n0 = (await zustand()).n;
  await taste('h', { warte: 400 }); ok((await zustand()).n === n0 + 1, `Vusion: H = Bohrung (${n0} → ${(await zustand()).n} Teile)`); await esc();
  await taste('e', { warte: 400 }); const sk = await zustand(); ok(sk.sk, 'Vusion: E = Extrudieren (öffnet die Skizze)');
  // In der Skizze: Rechteck zeichnen geht weiter mit R, D = Bemaßung statt V3D-Funktion, Q startet NICHT Drücken/Ziehen
  await taste('r'); ok(await p.evaluate(() => _sk.tool === 'rect'), 'Vusion-Skizze: R = Rechteck');
  await taste('d'); ok(await p.evaluate(() => _sk.active), 'Vusion-Skizze: D (Bemaßung) ohne Fehler, Skizze bleibt offen');
  await taste('q'); ok(!(await zustand()).pp, 'Vusion-Skizze: Q startet kein Drücken/Ziehen');
  await p.evaluate(() => { try { exitSketchMode(); } catch (e) {} });

  // Maus: Shift+mittlere Taste = Drehen in Vusion, mittlere Taste allein = Verschieben
  const maus = (shift) => p.evaluate((shift) => { const r = vpEl.getBoundingClientRect(); window.dispatchEvent(new MouseEvent('mousedown', { button: 1, shiftKey: shift, clientX: r.left + 200, clientY: r.top + 200, bubbles: true })); const z = { orbit: isOrbit, pan: isPan }; isOrbit = false; isPan = false; return z; }, shift);
  // mousedown muss vom Viewport kommen (target-Prüfung) → direkt am Canvas auslösen
  const maus2 = (shift) => p.evaluate((shift) => { const r = vpEl.getBoundingClientRect(); canvas.dispatchEvent(new MouseEvent('mousedown', { button: 1, shiftKey: shift, clientX: r.left + 200, clientY: r.top + 200, bubbles: true })); const z = { orbit: isOrbit, pan: isPan }; isOrbit = false; isPan = false; return z; }, shift);
  const mS = await maus2(true), mM = await maus2(false);
  ok(mS.orbit && !mS.pan, 'Vusion: Shift+mittlere Taste = Drehen');
  ok(mM.orbit && mM.pan, 'Vusion: mittlere Taste = Verschieben');
  await p.click('#mode-sw button[data-m="beginner"]'); await p.waitForTimeout(200);
  const bS = await maus2(true); ok(bS.pan, 'Beginner: Shift+mittlere Taste bleibt Verschieben');
  void maus;

  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLE OK');
process.exit(fail ? 1 : 0);
