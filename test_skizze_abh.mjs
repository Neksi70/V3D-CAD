// Funktionstest Skizzen-Abhängigkeiten + Bemaßung (v1.18.192) — echte Mausklicks
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8857;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(3000);
await page.evaluate(() => { try { hideStarter(); } catch (_) {} });

let fail = 0;
try {
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const scr = (u, v) => page.evaluate(([u, v]) => _skScreen(u, v), [u, v]);
const click = async (u, v, opt) => { const s = await scr(u, v); await page.mouse.move(s.x - 24, s.y + 24); await page.mouse.move(s.x, s.y, { steps: 8 }); await page.mouse.click(s.x, s.y, opt); await page.waitForTimeout(60); };
const key = async k => { await page.keyboard.press(k); await page.waitForTimeout(60); };

await page.evaluate(() => enterSketchMode());
await page.waitForTimeout(300);
// Rechteck 4×2 Units (40×20 mm)
await key('r'); await click(0, 0); await click(4, 2);
let st = await page.evaluate(() => ({ n: _sk.ents.length, cons: _sk.cons.map(c => c.t).join(',') }));
ok(st.n === 4 && st.cons === 'h,v,h,v', `Rechteck: 4 Linien mit H/V automatisch (${st.n}, ${st.cons})`);

// Bemaßen: untere Linie (v=0) → 60 mm
await key('s'); await key('m'); await click(2, 0);
const edOpen = await page.evaluate(() => !!_sk.dimEd && document.getElementById('sk-cdim').style.display !== 'none');
ok(edOpen, 'Maß-Feld öffnet nach Klick auf Linie');
await page.fill('#sk-cdim-v', '60'); await page.press('#sk-cdim-v', 'Enter'); await page.waitForTimeout(150);
const geo = () => page.evaluate(() => {
  const L = _sk.ents.map(en => ({ a: en.a, b: en.b, L: Math.hypot(en.b.u - en.a.u, en.b.v - en.a.v) }));
  // Rechteck geschlossen? jede Ecke genau zweimal
  const keys = new Map(); for (const l of L) for (const p of [l.a, l.b]) { const k = p.u.toFixed(5) + ',' + p.v.toFixed(5); keys.set(k, (keys.get(k) || 0) + 1); }
  return { L: L.map(l => Math.round(l.L * 1000) / 100), closed: [...keys.values()].every(n => n === 2) && keys.size === 4, dof: _sk.dof, cons: _sk.cons.length };
});
st = await geo();
ok(st.closed && st.L.filter(x => Math.abs(x - 60) < 0.01).length === 2, `Breite 60 mm, Rechteck geschlossen (${st.L}, dof ${st.dof})`);
// Höhe: rechte Linie (u≈6) → 25 mm
await click(6, 1);
await page.fill('#sk-cdim-v', '25'); await page.press('#sk-cdim-v', 'Enter'); await page.waitForTimeout(150);
st = await geo();
ok(st.closed && st.L.filter(x => Math.abs(x - 25) < 0.01).length === 2 && st.dof === 2, `Höhe 25 mm, noch 2 Freiheitsgrade (${st.L}, dof ${st.dof})`);
const labels = await page.evaluate(() => [...document.querySelectorAll('#sk-cons-lay div')].map(d => d.textContent));
ok(labels.includes('60') && labels.includes('25'), `Maßzahlen in der Skizze: ${labels.join(' ')}`);

// Ziehen an einer Ecke (6, 2.5) → bleibt Rechteck mit 60×25, wird nur verschoben
await key('Escape');
const a0 = await page.evaluate(() => ({ ..._sk.ents[0].a }));
const c0 = await scr(6, 2.5);
await page.mouse.move(c0.x, c0.y); await page.mouse.down(); 
for (let i = 1; i <= 6; i++) { await page.mouse.move(c0.x + i * 15, c0.y + i * 8); await page.waitForTimeout(30); }
await page.mouse.up(); await page.waitForTimeout(150);
st = await geo();
ok(st.closed && st.L.filter(x => Math.abs(x - 60) < 0.02).length === 2 && st.L.filter(x => Math.abs(x - 25) < 0.02).length === 2, `Ecke gezogen: Maße bleiben, Rechteck zu (${st.L})`);
const moved = await page.evaluate(a0 => Math.hypot(_sk.ents[0].a.u - a0.u, _sk.ents[0].a.v - a0.v) > 0.05, a0);
ok(moved, 'Rechteck ist beim Ziehen mitgewandert');

// Strg+Z → zurück an alte Stelle
await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
const back = await page.evaluate(a0 => Math.hypot(_sk.ents[0].a.u - a0.u, _sk.ents[0].a.v - a0.v) < 1e-9, a0);
ok(Math.hypot(a0.u, a0.v) < 1e-6, `Maße ändern ließ den Startpunkt liegen (${a0.u.toExponential(1)}, ${a0.v.toExponential(1)})`);
ok(back, 'Strg+Z nimmt das Ziehen zurück');

// Ecke fixieren → vollständig bestimmt
await page.evaluate(() => _skcApply('fix')); await click(0, 0); await page.waitForTimeout(150);
st = await geo();
ok(st.dof === 0, `Ecke fixiert → vollständig bestimmt (dof ${st.dof})`);
const stTxt = await page.textContent('#sk-cons-st');
ok(/vollständig bestimmt/.test(stTxt), 'Panel zeigt „vollständig bestimmt"');

// Widerspruch: Länge der oberen Linie auf 70 → muss abgelehnt werden
await key('m'); await click(3, 2.5);
await page.fill('#sk-cdim-v', '70'); await page.press('#sk-cdim-v', 'Enter'); await page.waitForTimeout(150);
st = await geo();
ok(st.L.filter(x => Math.abs(x - 60) < 0.02).length === 2, `Widersprüchliches Maß abgelehnt (${st.L})`);

// Maßzahl anklicken und ändern: 60 → 80
const lab = await page.evaluate(() => { const d = [...document.querySelectorAll('#sk-cons-lay div')].find(x => x.textContent === '60'); const r = d.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.click(lab.x, lab.y); await page.waitForTimeout(100);
await page.fill('#sk-cdim-v', '80'); await page.press('#sk-cdim-v', 'Enter'); await page.waitForTimeout(150);
st = await geo();
ok(st.closed && st.L.filter(x => Math.abs(x - 80) < 0.02).length === 2, `Maßzahl geändert → Breite 80 (${st.L})`);

// Kreis + Linie tangential
await key('Escape');
await key('c'); await click(3, -3); await click(4, -3);
await key('l'); await click(1, -1.5); await click(6, -1.2); await key('Escape');
await key('s');
await click(3, -2); await page.keyboard.down('Shift'); await click(3.5, -1.38); await page.keyboard.up('Shift');
await page.evaluate(() => _skcApply('tan')); await page.waitForTimeout(150);
const tan = await page.evaluate(() => { const c = _sk.ents.find(e => e.type === 'circle'), l = _sk.ents[_sk.ents.length - 1];
  return Math.abs(Math.abs(_skcLineDist(l, c.c)) - c.r); });
ok(tan < 1e-6, `Linie tangential am Kreis (Fehler ${tan.toExponential(1)})`);
await page.screenshot({ path: '/tmp/skc/shot1.png' });
const pw = await page.evaluate(() => { const p = document.getElementById('sk-cons').getBoundingClientRect(); return [...document.querySelectorAll('#sk-cons .skc')].every(b => b.getBoundingClientRect().right <= p.right + 0.5 && b.scrollWidth <= b.clientWidth + 1); });
ok(pw, 'Panel-Knöpfe passen vollständig hinein');

// Extrudieren → Verlauf speichert Abhängigkeiten, wieder öffnen bringt sie zurück
const n0 = await page.evaluate(() => _sk.cons.length);
await page.evaluate(async () => { _skExtrude(); await new Promise(r => setTimeout(r, 300)); await _skxApply(); });
await page.waitForTimeout(1500);
const saved = await page.evaluate(() => { const o = objects[objects.length - 1]; const f = o && o.userData.feat && o.userData.feat.list[0]; return f ? (f.cons || []).length : -1; });
ok(saved === n0, `Abhängigkeiten im Verlauf gespeichert (${saved}/${n0})`);
await page.evaluate(() => { const o = objects[objects.length - 1]; _featEditSketch(o.userData.id, 0); });
await page.waitForTimeout(300);
const re = await page.evaluate(() => ({ n: _sk.cons.length, res: _skcSolve().ok }));
ok(re.n === n0 && re.res, `Skizze wieder geöffnet: ${re.n} Abhängigkeiten, lösbar`);

ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + (e.message || e).split('\n')[0]); fail++; }
await browser.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
process.exit(fail ? 1 : 0);
