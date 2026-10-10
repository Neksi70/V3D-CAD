// Generatoren-Seite: dritter Reiter, Themen, A–Z, Suche (Wort + einzelner Buchstabe), Karte startet Generator, zurück im Modus
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8985;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _genPageOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} localStorage.removeItem('v3d_gen_recent'); _advSet('advanced'); });
  await p.click('#mode-sw button[data-m="gen"]');
  const r1 = await p.evaluate(() => ({ show: document.getElementById('gen-page').classList.contains('show'), secs: [...document.querySelectorAll('#gp-body .gp-sec')].map(x => x.textContent.trim()), cards: document.querySelectorAll('#gp-body .gp-card').length, focus: document.activeElement.id, on: document.querySelector('#mode-sw button.on').dataset.m, abc: document.querySelectorAll('#gp-abc button').length }));
  ok(r1.show && r1.on === 'gen' && r1.focus === 'gp-q', 'Reiter GENERATOREN öffnet die Seite, Suchfeld hat den Fokus');
  ok(r1.secs.length >= 6 && r1.cards >= 50, `Themen: ${r1.secs.join(' · ')} — ${r1.cards} Karten`);
  ok(!r1.secs.some(s => /^Weitere/.test(s)), 'alle Generatoren einem Thema zugeordnet');
  // Tippen: Wort
  await p.keyboard.type('lampe');
  const r2 = await p.evaluate(() => [...document.querySelectorAll('#gp-body .gp-card .stt')].map(x => x.textContent));
  ok(r2.length >= 2 && r2.every(t => /lamp|Lamp|Leucht/i.test(t) || true) && r2.includes('Lampe') && r2.includes('Pilzlampe'), 'Suche „lampe“: ' + r2.join(', '));
  // einzelner Buchstabe
  await p.fill('#gp-q', 'd'); await p.dispatchEvent('#gp-q', 'input');
  const r3 = await p.evaluate(() => [...document.querySelectorAll('#gp-body .gp-card .stt')].map(x => x.textContent));
  ok(r3.length >= 1 && r3.every(t => /^d/i.test(t)), 'Buchstabe „D“: ' + r3.join(', '));
  // A–Z-Leiste
  await p.click('#gp-abc button:has-text("S")');
  const r4 = await p.evaluate(() => ({ q: document.getElementById('gp-q').value, t: [...document.querySelectorAll('#gp-body .gp-card .stt')].map(x => x.textContent) }));
  ok(r4.q === 'S' && r4.t.length >= 5 && r4.t.every(t => /^S/.test(t)), 'Leiste „S“: ' + r4.t.join(', '));
  // Tippen ohne Fokus im Feld landet in der Suche
  await p.evaluate(() => { document.getElementById('gp-q').value = ''; _genPg.q = ''; _genPageRender(); document.getElementById('gp-q').blur(); });
  await p.keyboard.type('zahn');
  ok(await p.evaluate(() => document.getElementById('gp-q').value === 'zahn' && [...document.querySelectorAll('#gp-body .gp-card .stt')].some(x => x.textContent === 'Zahnrad')), 'Tippen ohne Fokus → Suche „zahn“ findet Zahnrad');
  // A–Z-Ansicht
  await p.evaluate(() => { document.getElementById('gp-q').value = ''; _genPg.q = ''; _genPg.ansicht = 'az'; _genPageRender(); });
  ok(await p.evaluate(() => document.querySelectorAll('#gp-body .gp-letter').length >= 12), 'A–Z-Ansicht mit Buchstaben-Überschriften');
  // Karte starten → Seite zu, Advanced wieder aktiv, Generator offen
  await p.click('#gp-body .gp-card:has-text("Zahnrad")');
  await p.waitForTimeout(400);
  const r5 = await p.evaluate(() => ({ show: document.getElementById('gen-page').classList.contains('show'), on: document.querySelector('#mode-sw button.on').dataset.m, modal: [...document.querySelectorAll('.show')].map(x => x.id).filter(Boolean), rec: JSON.parse(localStorage.getItem('v3d_gen_recent') || '[]') }));
  ok(!r5.show && r5.on === 'advanced' && r5.modal.some(id => /gear/i.test(id)), 'Karte „Zahnrad“: Seite zu, zurück in Advanced, Zahnrad-Fenster offen (' + r5.modal.join(',') + ')');
  ok(r5.rec[0] === 'Zahnrad', 'als „zuletzt benutzt“ gemerkt');
  await p.evaluate(() => { document.querySelectorAll('.show').forEach(x => { if (/gear/i.test(x.id)) x.classList.remove('show'); }); _genPageOpen(); });
  ok(await p.evaluate(() => document.querySelector('#gp-body .gp-sec').textContent.startsWith('Zuletzt benutzt')), '„Zuletzt benutzt“ oben');
  await p.waitForTimeout(1500); await p.screenshot({ path: '/tmp/genpage.png' });
  await p.keyboard.press('Escape');
  ok(await p.evaluate(() => !_genPg.open), 'Esc schließt die Seite');
  // Link im Ausklappmenü
  ok(await p.evaluate(() => [...document.querySelectorAll('#gen-dd .sdd-hd span')].some(s => /Alle groß/.test(s.textContent))), 'Ausklappmenü rechts bleibt, mit „Alle groß anzeigen →“');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
  await p.evaluate(() => { localStorage.removeItem('v3d_modus'); localStorage.removeItem('v3d_gen_recent'); });
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
