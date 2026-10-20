// Arbeitsumgebung V3D-ShapeCAD (Bedienung wie Shapr3D): Werkzeugspalte links, Leiste an
// der Auswahl, Kürzel wie V3D Direkt, Band über „Alle Werkzeuge“ erreichbar, Wahl gemerkt.
// Aufruf (im Worktree): node tests/shape_test.mjs
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
const HIER = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 18849;
const srv = spawn('python3', [path.join(HIER, 'umgebungen-test-server.py'), String(PORT), '--dev'], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d-umgebungen.html`);
  await p.waitForFunction(() => typeof _advSet === 'function' && typeof objects !== 'undefined', null, { timeout: 60000 });
  await p.evaluate(async () => { await _loadOCCT(); try { hideStarter(); } catch (e) {} localStorage.removeItem('v3d_modus'); _advSet('beginner'); _newCreate(false); return true; });
  const sichtbar = sel => p.evaluate(sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; }, sel);
  const taste = async (k) => { await p.mouse.move(700, 450); await p.keyboard.press(k); await p.waitForTimeout(200); };
  const esc = async () => { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(150); };

  await p.click('#mode-sw button[data-m="shape"]'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => _advMode === 'shape' && document.body.classList.contains('umgshape')), 'Schalter V3D-SHAPECAD aktiviert die Umgebung');
  ok(await sichtbar('#shp-spalte') && !(await sichtbar('#tb-r1')) && !(await sichtbar('#lp')), 'Werkzeugspalte da, Band und linke Leiste umgeordnet');
  const n = await p.evaluate(() => document.querySelectorAll('#shp-spalte .shp-b').length);
  ok(n === 17, `Spalte: ${n} Werkzeuge in 4 Gruppen`);
  ok(await p.evaluate(() => /Taste O/.test(document.querySelector('[onclick="enterPushPull()"]').title)), 'Tooltip „Fläche ziehen“ zeigt Taste O');

  // Körper anlegen und per Klick wählen → Leiste an der Auswahl über dem Körper
  await p.evaluate(() => { addShape('box'); const o = objects[0]; o.position.set(0, 1, 0); o.updateMatrixWorld(true); deselect(); setView('iso'); });
  await p.waitForTimeout(400);
  const pos = await p.evaluate(() => { const o = objects[0], v = o.position.clone().project(camera), r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; });
  await p.mouse.click(pos.x, pos.y); await p.waitForTimeout(400);
  const k1 = await p.evaluate(() => { const kx = document.getElementById('shp-kontext'), r = kx.getBoundingClientRect(); return { zeigen: kx.classList.contains('zeigen'), texte: [...kx.querySelectorAll('.shp-b span')].map(s => s.textContent), unten: r.bottom, sel: selectedObjs.length }; });
  // Körper füllt die Ansicht: Leiste muss trotzdem ganz sichtbar bleiben
  await p.evaluate(() => { sph.r = 4; sph2cam(); }); await p.waitForTimeout(300);
  const k1b = await p.evaluate(() => { const r = document.getElementById('shp-kontext').getBoundingClientRect(), v = document.getElementById('vp').getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom && r.left >= v.left && r.right <= v.right; });
  ok(k1b, 'Körper füllt die Ansicht: Leiste bleibt ganz im Bild');
  await p.evaluate(() => { setView('iso'); });
  ok(k1.sel === 1 && k1.zeigen, 'Klick auf Körper → Leiste an der Auswahl erscheint');
  ok(k1.texte.includes('Fläche ziehen') && k1.texte.includes('Abrunden') && k1.texte.includes('Löschen'), 'Leiste (1 Körper): ' + k1.texte.join(', '));
  ok(k1.unten <= pos.y, `Leiste sitzt über dem Körper (${Math.round(k1.unten)} ≤ ${Math.round(pos.y)})`);
  // Klick in der Leiste: Abrunden startet den Kanten-Modus, Leiste verschwindet solange
  await p.click('#shp-kontext .shp-b[data-shp="enterEdgeMode()"]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => _edgeMode && !document.getElementById('shp-kontext').classList.contains('zeigen')), 'Leiste „Abrunden“ → Kanten-Modus, Leiste weicht');
  await esc();

  // Kürzel wie V3D Direkt
  await p.evaluate(() => selectObjs([objects[0]]));
  await taste('o'); ok(await p.evaluate(() => _pp.active), 'O = Fläche versetzen'); await esc();
  await p.evaluate(() => selectObjs([objects[0]]));
  await taste('f'); ok(await p.evaluate(() => _edgeMode), 'F = Abrunden/Fase'); await esc();
  await p.evaluate(() => selectObjs([objects[0]]));
  await taste('m'); ok(await p.evaluate(() => editMode === 'move'), 'M = Verschieben');
  await taste('d'); ok(await p.evaluate(() => _sk.active), 'D = Skizze an');
  await taste('d'); ok(await p.evaluate(() => !_sk.active), 'D in der Skizze = Skizze aus');

  // Zwei Körper: Leiste zeigt Kombinieren; Strg+B subtrahiert ohne Bohrung markieren
  await p.evaluate(() => { _newCreate(false); addShape('box'); addShape('cylinder'); const [a, c] = objects; a.position.set(0, 1, 0); c.position.set(0.5, 1, 0); c.scale.set(0.5, 1.5, 0.5); a.updateMatrixWorld(true); c.updateMatrixWorld(true); selectObjs([a, c]); });
  await p.waitForTimeout(300);
  const k2 = await p.evaluate(() => [...document.querySelectorAll('#shp-kontext .shp-b span')].map(s => s.textContent));
  ok(k2.includes('Vereinigung') && k2.includes('Subtrahieren') && k2.includes('Schneiden'), 'Leiste (2 Körper): ' + k2.join(', '));
  await p.mouse.move(700, 450); await p.keyboard.press('Control+b');
  await p.waitForFunction(() => objects.length === 1 && objects[0].userData.isSubtract, null, { timeout: 60000 }).catch(() => {});
  const sub = await p.evaluate(() => ({ n: objects.length, sub: !!objects[0].userData.isSubtract, exakt: !!objects[0].userData.exakt }));
  ok(sub.n === 1 && sub.sub && sub.exakt, 'Strg+B = Subtrahieren (Quader − Zylinder, exakt)');
  await p.waitForTimeout(800);   // Fortschrittsanzeige sperrt die Tastatur bis 550 ms nach „fertig“
  await p.evaluate(() => { _newCreate(false); addShape('box'); addShape('box'); const [a, c] = objects; a.position.set(0, 1, 0); c.position.set(1, 1.5, 0); a.updateMatrixWorld(true); c.updateMatrixWorld(true); selectObjs([a, c]); });
  await p.mouse.move(700, 450); await p.keyboard.press('Control+u');
  await p.waitForFunction(() => objects.length === 1, null, { timeout: 60000 }).catch(() => {});
  ok(await p.evaluate(() => objects.length === 1), 'Strg+U = Vereinigung');
  await p.waitForTimeout(800);
  await p.mouse.move(700, 450); await p.keyboard.press('Control+f'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById('cmdk').classList.contains('show')), 'Strg+F = Befehl suchen'); await esc();
  await p.evaluate(() => { try { _cmdkClose(); } catch (e) {} });

  // Alle Werkzeuge: Band + linke Leiste zurück
  await p.click('#shp-spalte .shp-b[data-shp="_shpAlle()"]'); await p.waitForTimeout(300);
  ok(await sichtbar('#tb-r1') && await sichtbar('#lp'), '„Alle Werkzeuge“ holt Band und linke Leiste zurück');
  await p.click('#shp-spalte .shp-b[data-shp="_shpAlle()"]'); await p.waitForTimeout(300);
  ok(!(await sichtbar('#tb-r1')), 'nochmal klicken → wieder aufgeräumt');

  // Wahl gemerkt, zurück zu Beginner stellt alles her
  await p.reload(); await p.waitForFunction(() => typeof _advSet === 'function' && document.body.classList.contains('umgshape'), null, { timeout: 60000 }).catch(() => {});
  ok(await p.evaluate(() => _advMode === 'shape' && document.body.classList.contains('umgshape')), 'nach Neuladen weiter V3D-ShapeCAD');
  await p.click('#mode-sw button[data-m="beginner"]'); await p.waitForTimeout(300);
  ok(!(await sichtbar('#shp-spalte')) && await sichtbar('#tb-r1') && await sichtbar('#lp'), 'Beginner: Spalte weg, Band und linke Leiste wieder da');
  await p.evaluate(() => { _newCreate(false); addShape('box'); selectObjs([objects[0]]); });
  await taste('e'); ok(await p.evaluate(() => editMode === 'rotate'), 'Beginner: E = Rotieren wie bisher');

  ok(await p.evaluate(() => { _advSet('shape'); const r = document.querySelector('.r0-spacer') ? document.body.getBoundingClientRect() : null; return getComputedStyle(document.body).borderTopWidth === '0px' && Math.round(document.getElementById('mode-sw').getBoundingClientRect().top) < 40; }), 'Seite nicht verschoben/umrandet (Klassen-Kollision .shp)');
  // Laptop 1366×768: ganze Spalte sichtbar (unter 800 px Höhe nur Symbole)
  const kl = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await kl.goto(`http://127.0.0.1:${PORT}/volme3d-umgebungen.html`);
  await kl.waitForFunction(() => typeof _advSet === 'function', null, { timeout: 60000 });
  ok(await kl.evaluate(() => { try { hideStarter(); } catch (e) {} _advSet('shape'); const sp = document.getElementById('shp-spalte'), last = [...sp.querySelectorAll('.shp-b')].pop().getBoundingClientRect(); return last.bottom <= document.getElementById('vp').getBoundingClientRect().bottom; }), '1366×768: ganze Werkzeugspalte im Bild');
  await kl.close();
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLE OK');
process.exit(fail ? 1 : 0);
