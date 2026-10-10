// Generatoren alphabetisch + Buchstabenleiste (Ralf 10.10.26)
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8845, DIR = process.env.V3D_DIR || process.cwd();
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: DIR, stdio: 'inherit' });
let fail = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };
try {
  await new Promise(r => setTimeout(r, 1500));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`); await p.waitForFunction(() => typeof _STARTERS !== 'undefined');
  await p.evaluate(() => { hideStarter(); const o = document.getElementById('auth-overlay'); if (o) o.style.display = 'none'; });
  await p.click('#gen-dd-btn'); await p.waitForTimeout(400);
  const names = await p.$$eval('#gen-dd-list .shp[data-abc] .sdd-name', els => els.map(e => e.firstChild.textContent));
  const sorted = [...names].sort((a, b) => {
    const L = t => /^[0-9]/.test(t) ? 1 : 0; return L(a) - L(b) || a.localeCompare(b, 'de', { sensitivity: 'base' }); });
  ok(names.length > 50, `Liste hat ${names.length} Generatoren`);
  ok(JSON.stringify(names) === JSON.stringify(sorted), 'Dropdown alphabetisch: ' + names.slice(0, 4).join(', ') + ' …');
  const letters = await p.$$eval('#gen-dd-abc button', bs => bs.map(x => x.dataset.l));
  ok(letters.length >= 15 && letters.includes('S') && letters.includes('#'), 'Buchstabenleiste: ' + letters.join(''));
  await p.click('#gen-dd-abc button[data-l="S"]'); await p.waitForTimeout(200);
  const top = await p.evaluate(() => { const l = document.getElementById('gen-dd-list'); const r = l.getBoundingClientRect();
    const el = [...l.querySelectorAll('.shp[data-abc]')].find(x => x.getBoundingClientRect().top >= r.top - 1); return el.dataset.abc; });
  ok(top === 'S', 'Klick auf S → erster sichtbarer Eintrag beginnt mit ' + top);
  ok(await p.isVisible('#gen-dd'), 'Menü bleibt nach Buchstaben-Klick offen');
  await p.keyboard.press('k'); await p.waitForTimeout(200);
  const top2 = await p.evaluate(() => { const l = document.getElementById('gen-dd-list'); const r = l.getBoundingClientRect();
    return [...l.querySelectorAll('.shp[data-abc]')].find(x => x.getBoundingClientRect().top >= r.top - 1).dataset.abc; });
  ok(top2 === 'K', 'Taste k springt zu ' + top2);
  // Klick auf Eintrag startet den richtigen Generator
  const t = await p.evaluate(() => { const el = [...document.querySelectorAll('#gen-dd-list .shp[data-abc]')].find(x => x.textContent.includes('Dinosaurier')); el.click();
    return document.querySelector('#gen-dd').classList.contains('show'); });
  await p.waitForTimeout(500);
  ok(!t, 'Eintrag-Klick schließt Menü');
  const dnoOpen = await p.evaluate(() => document.getElementById('dno-modal').classList.contains('show'));
  ok(dnoOpen, 'Dinosaurier-Dialog offen (Index-Zuordnung stimmt)');
  await p.evaluate(() => document.getElementById('dno-modal').classList.remove('show'));
  // Galerie
  await p.evaluate(() => { document.querySelectorAll('.show').forEach(x => x.classList.remove('show')); showStarter(); }); await p.waitForTimeout(300);
  const g = await p.$$eval('#start-grid .st-card .stt', els => els.map(e => e.textContent));
  ok(g[0] === 'Leeres Design', 'Galerie: Leeres Design vorn');
  const gs = g.slice(1); ok(JSON.stringify(gs) === JSON.stringify([...gs].sort((a, b) => (/^[0-9]/.test(a) - /^[0-9]/.test(b)) || a.localeCompare(b, 'de', { sensitivity: 'base' }))), 'Galerie alphabetisch');
  ok((await p.$$('#start-abc button')).length >= 15, 'Galerie hat Buchstabenleiste');
  await p.keyboard.press('p'); await p.waitForTimeout(200);
  const gt = await p.evaluate(() => { const l = document.getElementById('start-grid'); const r = l.getBoundingClientRect();
    const f = [...l.querySelectorAll('.st-card.st-flash')]; const q = f[0] && f[0].getBoundingClientRect();
    return f.length && f.every(x => x.dataset.abc === 'P') && q.top >= r.top - 1 && q.bottom <= r.bottom + 1; });
  ok(gt, 'Galerie: Taste p markiert die P-Karten sichtbar');
  await p.screenshot({ path: '/tmp/gen_abc_galerie.png' });
  await p.evaluate(() => { hideStarter(); }); await p.click('#gen-dd-btn'); await p.waitForTimeout(300);
  await p.screenshot({ path: '/tmp/gen_abc_dd.png' });
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 2).join(' | '));
  await b.close();
} catch (e) { console.error(e); fail++; } finally { srv.kill(); }
console.log(fail ? `FEHLER: ${fail}` : 'ALLES OK'); process.exit(fail ? 1 : 0);
