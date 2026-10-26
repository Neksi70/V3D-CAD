// 🩺 Druckfehler-Doktor (_dfd*): Menüpfad, jede Kachel → Ursachen + Abhilfen, Rückfragen sortieren um,
// alle Einstellungsnamen 1:1 aus BambuStudio.mo (de), Geometrie-Hinweise, Befehlssuche, Screenshots.
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn, execFileSync } from 'child_process';
const PORT = 8872;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { try { localStorage.setItem('v3d_umsteiger_hinweis', '1'); } catch (e) {} });   // einmalige Sprechblase liegt sonst über allem
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _dfdOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} _newCreate(false); });

  // 1) echter Menüpfad: ☰ Menü → Lernen & Hilfe → 🩺 Druckfehler-Doktor
  await p.click('#btn-burger');
  await p.click('#burger-menu .sli-item:has-text("Druckfehler-Doktor")');
  await p.waitForSelector('#dfd-modal.show .dfd-tile');
  const tiles = await p.$$eval('#dfd-modal .dfd-tile', els => els.map(e => e.dataset.dfd));
  ok(tiles.length === 17, 'Dialog über ☰-Menü geöffnet, ' + tiles.length + ' Kacheln mit Skizze');
  ok(await p.$$eval('#dfd-modal .dfd-tile svg', s => s.length) === 17, 'jede Kachel hat eine Inline-SVG-Skizze');
  await p.screenshot({ path: '/tmp/dfd_uebersicht.png' });

  // 2) jede Kachel liefert Ursachen und Abhilfen
  for (const id of tiles) {
    await p.click(`#dfd-modal .dfd-tile[data-dfd="${id}"]`);
    const r = await p.evaluate(() => ({
      causes: document.querySelectorAll('#dfd-causes .dfd-c').length,
      fixes: [...document.querySelectorAll('#dfd-causes .dfd-c')].map(c => c.querySelectorAll('.dfd-f li').length),
      terms: document.querySelectorAll('#dfd-causes .dfd-t').length,
      wo: document.querySelectorAll('.dfd-chip[data-q="wo"]').length,
      mat: document.querySelectorAll('.dfd-chip[data-q="mat"]').length }));
    ok(r.causes >= 3 && r.fixes.every(n => n >= 1) && r.terms >= 1 && r.wo >= 2 && r.mat === 4,
       `${id}: ${r.causes} Ursachen, Abhilfen ${r.fixes.join('/')}, ${r.terms} Einstellungsnamen, ${r.wo} Wo-Fragen`);
    await p.click('#dfd-back');
    await p.waitForSelector('#dfd-modal .dfd-tile');
  }

  // 3) Rückfragen ändern die Reihenfolge
  const order = () => p.$$eval('#dfd-causes .dfd-c', els => els.map(e => e.dataset.c).join(','));
  await p.click('#dfd-modal .dfd-tile[data-dfd="warping"]');
  const o0 = await order();
  await p.click('.dfd-chip[data-q="mat"][data-v="abs"]'); await p.click('.dfd-chip[data-q="encl"][data-v="open"]');
  const o1 = await order();
  const top1 = await p.$eval('#dfd-causes .dfd-c.top .dfd-ct', e => e.textContent);
  ok(o0 !== o1 && /schrumpft/.test(top1), `Warping: ABS + offen → Reihenfolge ${o0} → ${o1}, oben „${top1.replace(/^\d+/, '')}"`);
  await p.click('.dfd-chip[data-q="mat"][data-v="abs"]');   // abwählen
  await p.click('.dfd-chip[data-q="mat"][data-v="pla"]'); await p.click('.dfd-chip[data-q="encl"][data-v="closed"]');
  await p.click('.dfd-chip[data-q="wo"][data-v="lang"]');
  const o2 = await order();
  ok(o2 !== o1, `Warping: PLA + geschlossen + lange Teile → ${o2}`);
  await p.click('#dfd-back');
  await p.click('#dfd-modal .dfd-tile[data-dfd="clog"]');
  // Material/Drucker bleiben über Fehlerbilder hinweg gemerkt: PLA + geschlossen → Heat Creep oben
  const htop = await p.$eval('#dfd-causes .dfd-c.top .dfd-ct', e => e.textContent);
  ok(/Heat Creep/.test(htop), `Verstopfung mit gemerktem PLA + geschlossen → oben „${htop.replace(/^\d+/, '')}"`);
  await p.click('.dfd-chip[data-q="mat"][data-v="pla"]'); await p.click('.dfd-chip[data-q="encl"][data-v="closed"]');   // abwählen
  const c0 = await order(); await p.click('.dfd-chip[data-q="wo"][data-v="retract"]');
  const c1 = await order(); const ctop = await p.$eval('#dfd-causes .dfd-c.top .dfd-ct', e => e.textContent);
  ok(c0 !== c1 && /Rückzug/.test(ctop), `Verstopfung: „nach vielen Rückzügen" → oben „${ctop.replace(/^\d+/, '')}"`);
  await p.screenshot({ path: '/tmp/dfd_detail.png' });

  // 4) jeder Einstellungsname im Datenbestand steht in BambuStudio.mo (de) — per Python gegengeprüft
  const data = await p.evaluate(() => {
    const all = [];
    const pick = s => { String(s).replace(/\[\[([^\]]+)\]\]/g, (m, t) => { all.push(t); return m; }); };
    _DFD_F.forEach(f => f.c.forEach(c => { pick(c.d); c.f.forEach(pick); }));
    pick(_dfdGeo.toString());   // Hinweis-Texte der Geometrie
    return { terms: [...new Set(all)], T: _DFD_T };
  });
  const mo = JSON.parse(execFileSync('python3', ['-I', '/home/v3da/tests/druckfehler_doktor_terms.py'], { input: JSON.stringify(data.terms) }).toString());
  const bad = data.terms.filter(t => !mo[t] || mo[t] !== data.T[t]);
  ok(data.terms.length > 40 && !bad.length, `${data.terms.length} Einstellungsnamen, alle als msgstr in der .mo und identisch in _DFD_T` + (bad.length ? ' — ABWEICHEND: ' + bad.join(', ') : ''));
  const shown = await p.evaluate(() => _dfdTxt('[[Retraction Length]] / [[Pressure advance]] / [[Wall loops]]'));
  ok(/Rückzugslänge<\/b> <span class="dfd-en">\(Retraction Length\)/.test(shown) && /Pressure advance<\/b>(?! <span)/.test(shown),
     'Darstellung: deutsch + (englisch), englisch bleibt allein, wenn Studio nicht übersetzt');

  // 5) Geometrie-Hinweise: hoher schmaler Quader ausgewählt
  await p.click('#dfd-modal .vx');
  await p.evaluate(() => { addShape('box'); const o = objects[objects.length - 1]; o.scale.set(0.4, 4, 0.4); o.updateMatrixWorld(true);
    o.position.y -= getMeshBox(o).min.y; o.updateMatrixWorld(true); selectObjs([o]); });
  await p.click('#btn-burger');
  await p.click('#burger-menu .sli-item:has-text("Druckfehler-Doktor")');
  const geo = await p.evaluate(() => _dfd.geo && { keys: _dfd.geo.keys, h: Math.round(_dfd.geo.hMm), c: Math.round(_dfd.geo.contactMm2) });
  ok(geo && geo.keys.includes('tall') && geo.keys.includes('smallbase'), 'Geometrie: ' + JSON.stringify(geo));
  await p.click('#dfd-modal .dfd-tile[data-dfd="spaghetti"]');
  const gtxt = await p.$eval('#dfd-body .dfd-geo', e => e.innerText).catch(() => '');
  const gtop = await p.$eval('#dfd-causes .dfd-c.top .dfd-ct', e => e.textContent);
  ok(/Aus deinem Modell/.test(gtxt) && /Hoch und schmal/.test(gtxt) && /(Bett|schwingt)/.test(gtop), `Spaghetti zeigt Modell-Hinweis, oben „${gtop.replace(/^\d+/, '')}"`);
  await p.screenshot({ path: '/tmp/dfd_geometrie.png' });
  await p.click('#dfd-modal .vx');

  // 6) Befehlssuche
  await p.keyboard.press('Control+k'); await p.fill('#cmdk-inp', 'druckfehler'); await p.keyboard.press('Enter');
  ok(await p.isVisible('#dfd-modal.show'), 'Befehlssuche „druckfehler" öffnet den Doktor');
  await p.click('#dfd-modal .vx');

  // 7) Handy-Breite
  await p.setViewportSize({ width: 390, height: 820 });
  await p.evaluate(() => { deselect(); _dfdOpen(); });
  const w = await p.$eval('#dfd-modal .g3box', e => e.getBoundingClientRect().width);
  const sw = await p.$eval('#dfd-body', e => e.scrollWidth <= e.clientWidth + 1);
  ok(w <= 390 && sw, `Handy: Dialog ${Math.round(w)} px breit, kein waagerechtes Scrollen`);
  await p.screenshot({ path: '/tmp/dfd_handy.png' });
  await p.click('#dfd-modal .dfd-tile[data-dfd="zits"]');
  await p.screenshot({ path: '/tmp/dfd_handy_detail.png' });

  ok(!errs.length, 'keine Seitenfehler' + (errs.length ? ': ' + errs.join(' | ') : ''));
} catch (e) { console.error(e); fail++; }
finally { await b.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nALLES GRÜN');
process.exit(fail ? 1 : 0);
