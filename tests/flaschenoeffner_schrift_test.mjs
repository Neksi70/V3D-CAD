// Flaschenöffner-Gravur + Geldgeschenk: Schriftliste mit Vorschau + eigene Schrift vom Rechner
// (DejaVu Sans aus /usr/share/fonts als Import über den echten Knopf/Dateidialog).
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
const PORT = 8996, SHOTS = process.env.SHOTS || '/home/v3da/tests/shots/flaschenoeffner';
const TTF = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
mkdirSync(SHOTS, { recursive: true });
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.addInitScript(() => { try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {} });
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _foeOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} localStorage.removeItem('v3d_foe'); localStorage.removeItem('v3d_userFonts'); _foeReset(); _foeOpen(); document.getElementById('umsteiger-hinweis')?.remove(); });
  await p.waitForFunction(() => document.querySelectorAll('#foe-flist .fli-row').length >= 14, null, { timeout: 10000 }).catch(() => {});
  const L = await p.evaluate(() => ({ n: document.querySelectorAll('#foe-flist .fli-row').length, on: [...document.querySelectorAll('#foe-flist .fli-row.on')].map(r => r.dataset.k), sel: getComputedStyle(document.getElementById('foe-font')).display }));
  ok(L.n === 14 && L.on.length === 1 && L.on[0] === 'pacifico_local' && L.sel === 'none', `Schriftliste: ${L.n} Zeilen, aktiv ${L.on}, natives Select versteckt`);
  // Proben gezeichnet (dunkle Pixel im Canvas) – auch CDN-Schriften
  await p.waitForTimeout(2500);
  const ink = await p.evaluate(() => [...document.querySelectorAll('#foe-flist canvas')].map(cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200 && d[i - 3] < 80) n++; return n; }));
  ok(ink.filter(n => n > 50).length >= 12, `Vorschau-Proben mit Schrift gefüllt: ${ink.filter(n => n > 50).length}/${ink.length}`);
  // Klick auf Zeile wählt Schrift
  await p.locator('#foe-flist .fli-row[data-k="helvetiker_bold"]').click();
  ok(await p.evaluate(() => _foeP.font === 'helvetiker_bold' && document.querySelector('#foe-flist .fli-row.on').dataset.k === 'helvetiker_bold'), 'Klick auf Zeile wählt Schrift + markiert sie');
  // Probe folgt dem Spruch
  await p.evaluate(() => { _foeVorlage(''); _foeSet('text', 'Hallo Welt'); });
  await p.waitForTimeout(500);
  ok(await p.evaluate(() => _FOE_FLI._s.startsWith('Hallo Welt|')), 'Probe zeigt den aktuellen Spruch');
  // Fehlende Zeichen melden (Helvetiker kennt kein ß/ü)
  await p.evaluate(() => _foeSet('text', 'Grüße'));
  await p.waitForTimeout(300);
  const fe = await p.evaluate(() => ({ t: document.getElementById('foe-fehlt').textContent, s: document.getElementById('foe-fehlt').classList.contains('show'), f: _fliFehlt(window._threeFont_helvetiker_bold, _foeP.text) }));
  ok(fe.s && fe.f.length > 0 && /kennt diese Zeichen nicht/.test(fe.t), `fehlende Zeichen gemeldet: ${fe.f.join(' ')}`);
  // Eigene Schrift über den Knopf
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#foe-modal button', { hasText: '＋ Schrift vom Rechner…' }).click()]);
  await fc.setFiles(TTF);
  await p.waitForFunction(() => /^user_/.test(_foeP.font), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(600);
  const u = await p.evaluate(() => { const k = _foeP.font, f = window['_threeFont_' + k];
    return { k, gl: f && ['ä','ö','ü','ß','Ä','Ö','Ü','€'].every(c => f.data.glyphs[c]), row: !!document.querySelector(`#foe-flist .fli-row.on[data-k="${k}"] .fli-del`), fehlt: document.getElementById('foe-fehlt').classList.contains('show'), ls: !!localStorage.getItem('v3d_userFonts') }; });
  ok(/^user_dejavu_sans/.test(u.k) && u.gl, `DejaVu importiert (${u.k}), Umlaute/ß/€ vorhanden`);
  ok(u.row && !u.fehlt && u.ls, 'eigene Schrift aktiv in Liste mit ✕, keine fehlenden Zeichen, im Browser gespeichert');
  // Gravur + SVG + 3D mit eigener Schrift
  const g = await p.evaluate(async () => { _foeSet('text', 'Größe Äpfel'); const G = _foeGriff(_foeP, _foeP.text); const svg = await _foeBuildSVG(_foeP); return { n: G.eng.length, svg: (svg.split('<g id="gravur"')[1].match(/<path/g) || []).length }; });
  ok(g.n >= 10 && g.svg >= 1, `Gravur mit eigener Schrift: ${g.n} Glyphenformen, SVG ${g.svg} Pfad(e)`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${SHOTS}/foe-schriften.png`, clip: await p.locator('#foe-modal .g3box').boundingBox() });
  const d3 = await p.evaluate(async () => { _newCreate(false); await _foeCreate(); const m = objects[objects.length - 1]; return { n: objects.length, tris: m.geometry.attributes.position.count / 3 }; });
  ok(d3.n === 1 && d3.tris > 500, `3D-Griff mit eigener Schrift: ${d3.tris} Dreiecke`);
  // Neu laden: Schrift bleibt
  await p.reload();
  await p.waitForFunction(() => typeof _foeOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _foeOpen(); });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ f: _foeP.font, rows: [...document.querySelectorAll('#foe-flist .fli-row')].map(x => x.dataset.k).filter(k => /^user_/.test(k)).length }));
  ok(/^user_dejavu/.test(r.f) && r.rows === 1, 'nach Neuladen: eigene Schrift weiter da und gewählt');
  // Geldgeschenk: dieselbe Liste, eigene Schrift dort auch verfügbar
  await p.evaluate(() => { _foeClose(); localStorage.removeItem('v3d_ggp'); _ggpReset(); _ggpOpen(); });
  await p.waitForTimeout(800);
  const gg = await p.evaluate(() => { const rows = [...document.querySelectorAll('#ggp-flist .fli-row')];
    return { n: rows.length, on: rows.filter(r => r.classList.contains('on')).map(r => r.dataset.k), user: rows.filter(r => /^user_dejavu/.test(r.dataset.k)).length, sel: getComputedStyle(document.getElementById('ggp-font')).display }; });
  ok(gg.n === 6 && gg.on.length === 1 && gg.user === 1 && gg.sel === 'none', `Geldgeschenk: ${gg.n} Schriften mit Vorschau (inkl. eigener DejaVu), aktiv ${gg.on}`);
  await p.locator('#ggp-flist .fli-row[data-k^="user_dejavu"]').click();
  await p.evaluate(() => { _ggpSet('text1', 'Für Jürgen'); _ggpSet('text2', 'Größe ✓'); });
  await p.waitForTimeout(500);
  const g2 = await p.evaluate(async () => { const svg = await _ggpBuildSVG(_ggpP); const L = _ggpLayout(_ggpP); return { t1: _ggpText(_ggpP.text1, _ggpP.font, 20, 50, 0, 150).shapes.length, eng: L.front.eng.length, f: _ggpP.font, svg: svg.length, fehlt: document.getElementById('ggp-fehlt').textContent, probe: _GGP_FLI._s }; });
  ok(g2.t1 >= 8 && g2.eng >= 13, `„Für Jürgen“ mit eigener Schrift gesetzt (${g2.t1} Formen, Vorderplatte ${g2.eng}) – leere Konturen (ü) abgefangen`);
  ok(/^user_dejavu/.test(g2.f) && g2.svg > 1000 && /Für Jürgen Größe/.test(g2.probe), 'Geldgeschenk mit eigener Schrift: Auswahl, Probe = Text, SVG erzeugt');
  ok(/✓/.test(g2.fehlt), `Geldgeschenk meldet fehlendes Zeichen: ${g2.fehlt.slice(0, 60)}`);
  await p.screenshot({ path: `${SHOTS}/ggp-schriften.png`, clip: await p.locator('#ggp-modal .g3box').boundingBox() });
  await p.evaluate(() => { _ggpClose(); _foeOpen(); }); await p.waitForTimeout(500);
  // Alte, vor dem Fix gespeicherte Schrift mit leerer Kontur wird beim Laden repariert
  const fx = await p.evaluate(() => { const j = JSON.parse(JSON.stringify(_ufFonts[0].json)); j.glyphs['ü'].o = 'm 1 2 ' + j.glyphs['ü'].o + ' m 5 5';
    const n = _ufFixLeer(j); const F = new THREE.FontLoader().parse(j); let c = -1; try { c = F.generateShapes('ü', 100).length; } catch (e) {} return { n, c }; });
  ok(fx.n === 1 && fx.c === 3, `Alt-Schrift mit leeren Konturen repariert (ü → ${fx.c} Formen)`);
  // Löschen
  await p.locator('#foe-flist .fli-del').first().click();
  await p.waitForTimeout(500);
  const del = await p.evaluate(() => ({ f: _foeP.font, rows: [...document.querySelectorAll('#foe-flist .fli-row')].filter(x => /^user_/.test(x.dataset.k)).length, ls: JSON.parse(_dsDecompress(localStorage.getItem('v3d_userFonts'))).length }));
  await p.waitForTimeout(100);
  ok(del.f === 'pacifico_local' && del.rows === 0 && del.ls === 0, 'Löschen: Schrift weg, zurück auf Standard, Speicher leer');
  const gd = await p.evaluate(() => ({ f: _ggpP.font, opt: !!document.querySelector('#ggp-font option[value^="user_"]') }));
  ok(!/^user_/.test(gd.f) && !gd.opt, `gelöscht auch im Geldgeschenk (Schrift dort jetzt ${gd.f})`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
