// Ralf 10.11.2026: Adventskalender als Rakete und als Piratenschiff (24 Fächer ca. 40 × 50 mm).
// App-Test: Formknöpfe da, Vorschau rechnet, zusammengebaut + Drucklage legen alle Teile an,
// Drucklage liegt flach auf der Platte. Kern-Tests: tools/adventskalender/test_core.mjs + test_passung.mjs
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (/Adventskalender:|Vorschau:/.test(m.text())) errs.push(m.text()); });
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 60000 });
const r = await pg.evaluate(async () => {
  hideStarter(); const out = {};
  for (const form of ['rakete', 'schiff']) {
    _advOpen(); await new Promise(r => setTimeout(r, 400)); _advFormWahl(form);
    for (let i = 0; i < 60 && !(_advLast && _advLast.info.zeilen[0].startsWith(form === 'rakete' ? 'Rakete' : 'Piratenschiff')); i++) await new Promise(r => setTimeout(r, 250));
    const vorschau = { zeile: _advLast && _advLast.info.zeilen[0], passt: _advLast && _advLast.liste.every(t => t.passt), teile: _advLast && _advLast.n };
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
    _advAnsicht('zusammen'); await _advCreate(false); const zus = objects.length;
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
    _advOpen(); await new Promise(r => setTimeout(r, 300)); _advFormWahl(form); _advAnsicht('druck'); await _advCreate(false);
    const flach = objects.every(o => { const q = new THREE.Box3().setFromObject(o); return Math.abs(q.min.y) < 0.01; });
    out[form] = { vorschau, zus, druck: objects.length, flach, knoepfe: [...document.querySelectorAll('#adv-form-bg .vtb')].length };
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
const checks = [];
for (const f of ['rakete', 'schiff']) {
  checks.push([f + ': Vorschau rechnet, alle Teile passen aufs Bett', !!r[f].vorschau.zeile && r[f].vorschau.passt]);
  checks.push([f + ': zusammengebaut angelegt (ohne Steckstifte)', r[f].zus === r[f].vorschau.teile - 1]);
  checks.push([f + ': Drucklage mit Steckstiften, flach auf der Platte', r[f].druck === r[f].vorschau.teile && r[f].flach]);
}
checks.push(['vier Formknöpfe', r.rakete.knoepfe === 4]);
checks.push(['keine Fehler', errs.length === 0]);
let ok = true; for (const [n, v] of checks) { console.log((v ? '✔ ' : '✘ ') + n); ok = ok && v; }
if (errs.length) console.log(errs);
await b.close(); process.exit(ok ? 0 : 1);
