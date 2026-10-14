// Symbol-Leiste (Schalter „Symbole", 1.18.185): jeder Knopf bekommt ein Symbol,
// Umschalten zurück stellt Text + Tooltip exakt wieder her, Beginner/Advanced kombinierbar.
// Start: node tests/symbolleiste_test.mjs   (Screenshots nach /tmp/sym_*.png)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8947;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit', cwd: '/home/v3da' });
await new Promise(r => setTimeout(r, 1500));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK  ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
};
const snap = () => pg.evaluate(() => [..._symButtons()].map(b => [b.getAttribute('onclick'), b.innerHTML, b.getAttribute('title')]));
try {
  await pg.goto('http://127.0.0.1:' + PORT + '/volme3d.html');
  await pg.waitForFunction(() => typeof addShape === 'function', { timeout: 60000 });
  await pg.evaluate(() => { localStorage.removeItem('v3d_symbole'); hideStarter(); _advSet('beginner'); _symToggle(false); });
  await pg.mouse.click(700, 500);
  const before = await snap();

  for (const mode of ['beginner', 'advanced']) {
    console.log(`\n=== ${mode} + Symbole ===`);
    const r = await pg.evaluate(m => {
      _advSet(m); _symToggle(true);
      const btns = [..._symButtons()];
      const ohne = btns.filter(b => !b.querySelector('svg')).map(b => b.getAttribute('onclick') + ' ' + b.textContent.trim());
      const ohneTitel = btns.filter(b => b.querySelector('svg') && !(b.dataset.symName || '').trim()).length;
      const groups = [...document.querySelectorAll('#tb-r1 > .tbg')].filter(g => g.offsetParent).map(g => ({ g: g.dataset.g, c: getComputedStyle(g.querySelector('.tbg-row')).borderTopColor }));
      return { n: btns.length, ohne, ohneTitel, groups, h: document.getElementById('tb-r1').offsetHeight, sw: document.getElementById('sym-sw').classList.contains('on') };
    }, mode);
    ok('jeder Knopf hat ein Symbol', r.ohne.length === 0, r.ohne);
    ok('jedes Symbol hat einen Tooltip', r.ohneTitel === 0, r.ohneTitel);
    ok('Gruppen farbig gerahmt', r.groups.every(g => g.c && g.c !== 'rgba(0, 0, 0, 0)') && new Set(r.groups.map(g => g.c)).size === r.groups.length, r.groups);
    ok('Schalter leuchtet', r.sw);
    console.log('  Leistenhöhe', r.h, 'px, Knöpfe', r.n);
    await pg.mouse.move(5, 300);
    await pg.screenshot({ path: `/tmp/sym_${mode}.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });
  }

  console.log('\n=== Tooltip mit der Maus ===');
  await pg.evaluate(() => { _advSet('beginner'); _symToggle(true); });
  const bb = await pg.locator('#tb-r1 button[onclick="unionSelected()"]').boundingBox();
  await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await pg.waitForTimeout(500);
  const tip = await pg.evaluate(() => { const t = document.getElementById('sym-tip'); return t && t.style.display === 'block' ? t.innerText : null; });
  ok('Tooltip nach kurzem Verweilen: Name + Erklärung', !!tip && /^Vereinen/.test(tip) && tip.length > 15, tip);
  await pg.screenshot({ path: '/tmp/sym_tip.png', clip: { x: 0, y: 0, width: 1000, height: 200 } });
  await pg.mouse.move(700, 600); await pg.waitForTimeout(300);
  ok('Tooltip verschwindet beim Weggehen', await pg.evaluate(() => document.getElementById('sym-tip').style.display === 'none'));
  ok('kein Browser-title doppelt', await pg.evaluate(() => !document.querySelector('#tb-r1 .btn.symb[title]')));

  console.log('\n=== Funktion bleibt: Würfel + Rückgängig per Symbol ===');
  const n0 = await pg.evaluate(() => { _advSet('beginner'); _newCreate(false); addShape('box'); return objects.length; });
  await pg.click('#btn-undo');
  await pg.waitForTimeout(300);
  ok('Rückgängig-Symbol wirkt', await pg.evaluate(() => objects.length) === n0 - 1);

  console.log('\n=== Zurück auf Text ===');
  await pg.evaluate(() => { _symToggle(false); _advSet('beginner'); });
  const after = await snap();
  const diff = before.filter((x, i) => !after[i] || x[1] !== after[i][1] || x[2] !== after[i][2]).map(x => x[0]);
  ok('Text und Tooltips exakt wie vorher', diff.length === 0 && before.length === after.length, diff);

  console.log('\n=== gemerkt nach Neuladen ===');
  await pg.evaluate(() => _symToggle(true));
  await pg.reload();
  await pg.waitForFunction(() => typeof addShape === 'function', { timeout: 60000 });
  await pg.waitForTimeout(300);
  ok('Symbole bleiben eingeschaltet', await pg.evaluate(() => document.body.classList.contains('sym') && !!document.querySelector('#btn-undo svg')));
  await pg.evaluate(() => { hideStarter(); });
  await pg.setViewportSize({ width: 1280, height: 800 });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: '/tmp/sym_1280.png', clip: { x: 0, y: 0, width: 1280, height: 260 } });

  console.log('\n=== schmal (780 px): Überschriften bleiben ===');
  await pg.setViewportSize({ width: 780, height: 900 });
  await pg.waitForTimeout(300);
  const hd = await pg.evaluate(() => [...document.querySelectorAll('#tb-r1 > .tbg')].filter(g => g.offsetParent).map(g => getComputedStyle(g.querySelector('.tbg-l')).display));
  ok('alle Gruppen-Überschriften sichtbar', hd.length > 0 && hd.every(d => d !== 'none'), hd);
  await pg.screenshot({ path: '/tmp/sym_780.png', clip: { x: 0, y: 0, width: 780, height: 330 } });
  await pg.evaluate(() => _symToggle(false));

  ok('keine Seitenfehler', errs.length === 0, errs);
} catch (e) {
  console.log('ABBRUCH', e); fails++;
} finally {
  await b.close(); srv.kill();
}
console.log(fails ? `\n${fails} FEHLER` : '\nalles OK');
process.exit(fails ? 1 : 0);
