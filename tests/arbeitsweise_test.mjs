// Beginner | Advanced: nur Anordnung — Werkzeuggruppen in Fusion-Reihenfolge, Browser links, Modell bleibt, Wahl gemerkt
import { chromium } from '/home/v3da/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const PORT = 8984;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore','ignore','inherit'] });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _advSet === 'function' && typeof objects !== 'undefined');
  await p.evaluate(() => { try { hideStarter(); } catch (e) {} localStorage.removeItem('v3d_modus'); _advSet('beginner'); _newCreate(false); addShape('box'); addShape('cylinder'); });
  const vis = async () => p.evaluate(() => {
    const groups = [...document.querySelectorAll('#tb-r1 > .tbg')].filter(g => getComputedStyle(g).display !== 'none')
      .map(g => ({ l: g.querySelector('.tbg-l').textContent.trim(), x: g.getBoundingClientRect().left, y: g.getBoundingClientRect().top }))
      .sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(g => g.l);
    const btns = document.querySelectorAll('#tb-r1 button').length;
    const visBtns = [...document.querySelectorAll('#tb-r1 button')].filter(x => x.offsetParent).length;
    const br = document.getElementById('adv-browser'), tree = document.getElementById('tree');
    const rows = new Set([...document.querySelectorAll('#tb-r1 > .tbg')].filter(g => getComputedStyle(g).display !== 'none').map(g => Math.round(g.getBoundingClientRect().top / 10))).size;
    return { rows, tbH: document.getElementById('tb-r1').getBoundingClientRect().height, compact: document.querySelectorAll('#tb-r1 .btn.advc').length, groups, btns, visBtns, browser: br && getComputedStyle(br).display !== 'none', treeLeft: !!tree.closest('#adv-browser'), canvasW: canvas.clientWidth, vpW: vpEl.clientWidth, n: objects.length, mode: _advMode };
  });
  const html0 = await p.evaluate(() => [...document.querySelectorAll('#tb-r1 button')].filter(b => !b.closest('.adv-only')).map(b => b.innerHTML));
  const b0 = await vis();
  ok(!b0.browser && !b0.treeLeft && !b0.groups.includes('Erstellen') && b0.groups.length === 6, 'Beginner wie bisher: ' + b0.groups.join(' › '));
  await p.click('#mode-sw button[data-m="advanced"]'); await p.waitForTimeout(300);
  const a = await vis();
  ok(JSON.stringify(a.groups) === JSON.stringify(['Erstellen', 'Konstruieren', 'Form ändern', 'Kombinieren', 'Anordnen', 'Prüfen', 'Ansicht', 'Datei']), 'Advanced: ' + a.groups.join(' › '));
  ok(a.visBtns >= b0.visBtns + 10, `alle bisherigen Knöpfe weiter da + neue vorn (${b0.visBtns} → ${a.visBtns} sichtbar)`);
  ok(a.browser && a.treeLeft, 'Browser links mit der Elemente-Liste');
  ok(a.compact >= 40 && a.tbH < 140 && a.rows <= 3, `kompaktes Band: ${a.compact} Knöpfe Symbol/Text, ${a.rows} Zeilen, ${Math.round(a.tbH)} px hoch (Beginner ${Math.round(b0.tbH)} px)`);
  ok(Math.abs(a.canvasW - a.vpW) < 2 && a.vpW < b0.vpW, `Ansicht passt sich an (${b0.vpW} → ${a.vpW} px)`);
  ok(a.n === 2, 'Modell unverändert (2 Teile)');
  // Browser bedienen: Teil anklicken wählt es aus
  await p.click('#adv-browser .ti >> nth=1');
  ok(await p.evaluate(() => selectedObjs.length === 1 && selectedObjs[0] === objects[1]), 'Klick im Browser wählt das Teil');
  // Knopf aus „Erstellen" funktioniert
  await p.click('#adv-create button:has-text("Skizze")');
  ok(await p.evaluate(() => _sk.active), '„✏ Skizze“ aus Erstellen öffnet die Skizze');
  await p.evaluate(() => exitSketchMode());
  // gemerkt
  await p.reload(); await p.waitForFunction(() => typeof _advSet === 'function' && document.body.classList.contains('adv'), null, { timeout: 30000 }).catch(() => {});
  ok(await p.evaluate(() => _advMode === 'advanced' && document.body.classList.contains('adv') && !!document.getElementById('tree').closest('#adv-browser')), 'nach Neuladen weiter Advanced');
  await p.evaluate(() => _advSet('beginner')); await p.waitForTimeout(200);
  const b1 = await vis();
  const html1 = await p.evaluate(() => [...document.querySelectorAll('#tb-r1 button')].filter(b => !b.closest('.adv-only')).map(b => b.innerHTML));
  const diff = html0.filter((h, i) => h !== html1[i]);
  ok(diff.length === 0 && html0.length === html1.length, 'alle Knopf-Inhalte identisch zurück (' + diff.length + ' abweichend) ' + diff.slice(0, 2).join(' | '));
  ok(!b1.browser && !b1.treeLeft && JSON.stringify(b1.groups) === JSON.stringify(b0.groups) && b1.visBtns === b0.visBtns && b1.compact === 0 && Math.abs(b1.tbH - b0.tbH) <= 2, 'zurück zu Beginner: alles wie vorher (auch Knopf-Texte, Höhe ' + Math.round(b1.tbH) + ' px)');
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.slice(0, 3).join(' | '));
  await p.evaluate(() => _advSet('advanced')); await p.evaluate(() => { _newCreate(false); addShape('box'); }); await p.waitForTimeout(400);
  await p.screenshot({ path: '/tmp/adv.png' });
  await p.evaluate(() => localStorage.removeItem('v3d_modus'));
} finally { await b.close(); srv.kill(); }
console.log(fail ? `${fail} Fehler` : 'alles grün'); process.exit(fail ? 1 : 0);
