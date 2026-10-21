// Hilfe-Seite: ❓-Knopf + F1, Bereiche, Suche, „Jetzt öffnen“, Druckfassung, PDF ausgeliefert
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8989;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _hlfOpen === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} localStorage.setItem('v3d_hinweis_genseite', '1'); _newCreate(false); });
  ok(await p.isVisible('#hilfe-tb'), '❓ Hilfe oben sichtbar');
  await p.click('#hilfe-tb'); await p.waitForSelector('#hilfe-page.show');
  const r1 = await p.evaluate(() => ({ n: document.querySelectorAll('.hl-e').length, nav: document.querySelectorAll('.hl-nv').length, focus: document.activeElement.id }));
  ok(r1.n >= 120 && r1.nav === 13 && r1.focus === 'hl-q', `${r1.n} Einträge in ${r1.nav} Bereichen, Suchfeld hat den Fokus`);
  await p.keyboard.type('loch');
  const r2 = await p.evaluate(() => [...document.querySelectorAll('.hl-e .hl-t')].map(x => x.textContent.trim()));
  ok(r2.some(t => /Loch ziehen/.test(t)) && r2.some(t => /Abziehen|Bohrung/.test(t)), 'Suche „loch“: ' + r2.slice(0, 6).join(' · '));
  await p.fill('#hl-q', 'xyzquatsch'); await p.dispatchEvent('#hl-q', 'input');
  ok(await p.evaluate(() => /Nichts gefunden/.test(document.getElementById('hl-body').innerText)), 'kein Treffer → freundlicher Hinweis');
  // Jetzt öffnen: Messen
  await p.fill('#hl-q', 'messen'); await p.dispatchEvent('#hl-q', 'input');
  // Karte über den TITEL wählen: seit 1.18.188 enthält auch „Loch vertiefen“ das Wort „messen“
  // und steht in der Trefferliste vorne → has-text("Messen") klickte die falsche Karte
  await p.locator('.hl-e').filter({ has: p.locator('.hl-t', { hasText: /^\W*Messen\s*$/ }) }).locator('button:has-text("Jetzt öffnen")').click();
  ok(await p.evaluate(() => !_hlf.open && (typeof _measureMode !== 'undefined' ? !!_measureMode : true)), '„Jetzt öffnen“ startet Messen und schließt die Hilfe');
  await p.keyboard.press('Escape');
  // F1
  await p.keyboard.press('F1'); ok(await p.evaluate(() => _hlf.open), 'F1 öffnet die Hilfe');
  await p.keyboard.press('Escape'); ok(await p.evaluate(() => !_hlf.open), 'Esc schließt');
  // Druckfassung
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.evaluate(() => { window.print = () => {}; _hlfOpen(); setTimeout(() => _hlfDruck(), 50); })]);
  await pop.waitForLoadState(); const h = await pop.evaluate(() => ({ t: document.title, h2: document.querySelectorAll('h2').length, e: document.querySelectorAll('.e').length }));
  ok(h.t === 'V3D CAD – Hilfe' && h.h2 === 13 && h.e >= 120, `Druckfassung: ${h.h2} Bereiche, ${h.e} Einträge`);
  const pdf = await p.evaluate(async () => { const r = await fetch('V3D-CAD-Hilfe.pdf'); return { s: r.status, t: r.headers.get('content-type') }; });
  ok(pdf.s === 200 && /pdf/.test(pdf.t), 'PDF wird ausgeliefert (' + pdf.t + ')');
  await p.evaluate(() => _hlfOpen('')); await p.waitForTimeout(400); await p.screenshot({ path: '/tmp/hilfe.png' });
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
