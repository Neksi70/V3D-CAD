// Beschriftung „Lage“: 9er-Raster setzt den Text an Rand/Mitte der Fläche (Rand in mm),
// auch gedreht; auf der Rundung nur oben/Mitte/unten. Echte Klicks auf die Rasterknöpfe.
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
import https from 'node:https';
const PORT = 8946;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: 'inherit' });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const pg = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e)));
const log = []; pg.on('console', m => log.push(m.text()));
await pg.route('**/api/occt-*', async route => {
  const req = route.request(); const body = req.postData() || ''; const url = new URL(req.url());
  try { const res = await new Promise((res_, rej) => { const r = https.request({ host: '127.0.0.1', port: 3001, path: url.pathname, method: req.method(), rejectUnauthorized: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, resp => { const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => res_(Buffer.concat(c))); });
      r.on('error', rej); r.end(body); });
    await route.fulfill({ status: 200, contentType: 'application/json', body: res });
  } catch (e) { await route.abort(); } });
await pg.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', null, { timeout: 60000 });
await pg.waitForTimeout(1500);
await pg.evaluate(() => hideStarter());
const fails = [];
const ok_ = (n, c, x) => { ok(n, c, x); return c; };
const ok = (n, c, x) => { console.log((c ? '  OK   ' : 'FEHLER ') + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); if (!c) fails.push(n); };


const scr = v => pg.evaluate(v => { const p = new THREE.Vector3(...v).project(camera); const r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }; }, v);
const box = () => pg.evaluate(() => { const r = {}; for (const o of objects) { const b = new THREE.Box3().setFromObject(o);
  r[o.userData.textEdit ? 'text' : 'koerper'] = { min: b.min.toArray().map(x => +(x * 10).toFixed(2)), max: b.max.toArray().map(x => +(x * 10).toFixed(2)) }; } return r; });

async function textAuf(shape, ziel) {
  await pg.evaluate(shape => { _newCreate(false); addShape(shape); const o = objects[0]; o.userData.name = 'K'; window.__p = o.position.clone();
    orbitTarget.set(0, 1, 0); sph.theta = 0.5; sph.phi = 1.2; sph.r = 9; sph2cam(); camera.updateMatrixWorld(true); selectObjs([]); }, shape);
  await pg.waitForTimeout(400);
  await pg.evaluate(() => addTextShape());
  await pg.fill('#text3d-input', 'AB');
  await pg.evaluate(() => { const s = document.getElementById('text3d-size'); s.value = 6; s.dispatchEvent(new Event('input')); });
  await pg.click('#text3d-ok');
  await pg.waitForFunction(() => objects.some(o => o.userData.textEdit), null, { timeout: 30000 });
  await pg.waitForTimeout(200);
  await pg.evaluate(() => { const k = objects.find(o => o.userData.name === 'K'); k.position.copy(window.__p); k.updateMatrixWorld(true); });
  await pg.waitForTimeout(300);
  const pt = await scr(ziel);
  await pg.mouse.move(pt.x - 5, pt.y - 5); await pg.mouse.move(pt.x, pt.y); await pg.waitForTimeout(80);
  await pg.mouse.click(pt.x, pt.y); await pg.waitForTimeout(300);
  const z = await pg.evaluate(() => ({ pop: document.getElementById('lbl-pop').style.display, pick: !!_lblPick,
    n: objects.length, sel: selectedObjs.map(o => o.userData.name), hint: document.getElementById('hint').textContent.slice(0, 60) }));
  if (z.pop !== 'block') console.log('ZUSTAND', JSON.stringify(z));
  return z.pop;
}
const lage = async (h, v) => { await pg.click(`#lbl-lage [data-lage="${h},${v}"]`); await pg.waitForTimeout(120); return box(); };

// Quader, Vorderseite (+Z)
if (!ok_('Feld offen nach Klick', (await textAuf('box', [0.3, 1.2, 1])) === 'block')) await browser_ende();
await pg.fill('#lbl-rand', '2');
const E = 0.15;
for (const [h, v] of [[-1, 1], [0, 1], [1, 1], [-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1], [1, -1]]) {
  const b = await lage(h, v), t = b.text, k = b.koerper;
  const xs = h < 0 ? Math.abs(t.min[0] - (k.min[0] + 2)) < E : h > 0 ? Math.abs(t.max[0] - (k.max[0] - 2)) < E : Math.abs((t.min[0] + t.max[0]) / 2 - (k.min[0] + k.max[0]) / 2) < E;
  const ys = v < 0 ? Math.abs(t.min[1] - (k.min[1] + 2)) < E : v > 0 ? Math.abs(t.max[1] - (k.max[1] - 2)) < E : Math.abs((t.min[1] + t.max[1]) / 2 - (k.min[1] + k.max[1]) / 2) < E;
  const flach = Math.abs(t.max[2] - k.max[2]) < 1.0;                                   // bleibt auf der Vorderseite
  ok(`Quader ${h},${v}: Text an der richtigen Stelle (2 mm Rand)`, xs && ys && flach, { text: t, koerper: k });
}
await pg.fill('#lbl-rand', '0,5');
let b = await lage(1, -1);
ok('Rand 0,5 mm rechts unten', Math.abs(b.text.max[0] - (b.koerper.max[0] - 0.5)) < E && Math.abs(b.text.min[1] - (b.koerper.min[1] + 0.5)) < E, b);
// gedreht (90°): jetzt hochkant, trotzdem bündig
await pg.fill('#lbl-rand', '2');
await pg.evaluate(() => _lblRotate(90)); await pg.waitForTimeout(150);
b = await lage(-1, 1);
ok('gedreht 90°: oben links bündig', Math.abs(b.text.min[0] - (b.koerper.min[0] + 2)) < E && Math.abs(b.text.max[1] - (b.koerper.max[1] - 2)) < E && (b.text.max[1] - b.text.min[1]) > (b.text.max[0] - b.text.min[0]), b);
// Rückgängig
const vorUndo = (await box()).text;
await pg.evaluate(() => undo()); await pg.waitForTimeout(150);
ok('nach Rückgängig ist das Feld zu (zeigte sonst auf den alten Text)', await pg.evaluate(() => document.getElementById('lbl-pop').style.display === 'none'));
await pg.evaluate(() => { selectObjs([objects.find(o => o.userData.textEdit)]); _lblOpen(); });
ok('Rückgängig nimmt die letzte Lage zurück', JSON.stringify((await box()).text) !== JSON.stringify(vorUndo));
// Anbringen danach geht weiter
await pg.click('#lbl-tief'); await pg.fill('#lbl-mm', '0,6'); await pg.click('#lbl-pop .btn.pri');
await pg.waitForFunction(() => objects.length === 1 && !objects[0].userData.textEdit, null, { timeout: 60000 }).catch(() => {});
ok('danach vertieft angebracht: ein Körper', await pg.evaluate(() => objects.length === 1), await pg.evaluate(() => ({ n: objects.length, sel: selectedObjs.length })));
// Zylinder: oben / unten auf der Rundung
ok('Zylinder: Feld offen', (await textAuf('cylinder', [0, 1.2, 1])) === 'block');
b = await lage(0, 1);
ok('Zylinder oben (2 mm unter der Oberkante)', Math.abs(b.text.max[1] - (b.koerper.max[1] - 2)) < 0.3, b);
b = await lage(0, -1);
ok('Zylinder unten (2 mm über dem Boden)', Math.abs(b.text.min[1] - (b.koerper.min[1] + 2)) < 0.3, b);
ok('keine Seitenfehler', errs.length === 0, errs);
if (fails.length) console.log(log.filter(t => /fehl|error|warn/i.test(t)).slice(-12).join('\n'));
console.log(fails.length ? 'FEHLER: ' + fails.join(' | ') : 'ALLES OK');
await browser_ende();
async function browser_ende(){ await browser.close(); srv.kill(); process.exit(fails.length ? 1 : 0); }
