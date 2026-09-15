// Regressionstest: lange Server-Berechnungen lassen sich abbrechen (v1.18.23).
//
// Ralf, 15.9.26: „Beim Vereinen kommt kein X … ich bin dem Balken ausgeliefert."
// Geprüft wird:
//   1. Vereinen zeigt „✕ Abbrechen"; Klick → Balken + Sperr-Overlay weg, beide
//      Teile unverändert in der Szene, KEIN Ersatz-Gruppieren
//   2. dasselbe per Esc
//   3. Abziehen (OCCT-Netzschnitt) abbrechen → Körper + Bohrung unverändert,
//      der BSP-Rückfall rechnet nicht still weiter
//   4. echter Server: Vereinen zweier feiner Kugeln abbrechen → Arbeiterpool
//      meldet den Arbeiter binnen Sekunden wieder frei (Proxy legt mit auf)
//   5. ohne Abbruch läuft Vereinen normal durch (Zeit-Notbremse unberührt)
//
// Start: python3 volme3d_server.py 8766 --dev  (rohe volme3d.html; für Punkt 4
// muss der Server mit dem aktuellen volme3d_server.py laufen)
import { chromium } from 'playwright';
import https from 'node:https';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};
const pool = () => new Promise((res, rej) => {
  https.get('https://127.0.0.1:3001/pool', { rejectUnauthorized: false }, r => {
    let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s)));
  }).on('error', rej);
});
const busy = async () => (await pool()).arbeiter.filter(w => w.zustand === 'beschaeftigt').length;

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
  // Toasts mitschreiben
  window._toasts = [];
  const n0 = window.notify;
  window.notify = function (m, t) { window._toasts.push(String(m)); return n0.apply(this, arguments); };
});

// Langsamer Server: Anfragen an die Boolean-Routen hängen 60 s, reagieren aber auf abort
const slowFetch = on => pg.evaluate(on => {
  if (!window._fetch0) window._fetch0 = window.fetch;
  window._slowHits = 0;
  window.fetch = !on ? window._fetch0 : function (url, opt) {
    if (!/occt-(union|subtract)/.test(String(url))) return window._fetch0.apply(this, arguments);
    window._slowHits++;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Test: zu langsam')), 60000);
      opt?.signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('abgebrochen', 'AbortError')); });
    });
  };
}, on);

const twoBoxes = () => pg.evaluate(() => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0; deselect();
  addShape('box'); const a = objects[objects.length - 1];
  addShape('box'); const c = objects[objects.length - 1];
  c.position.x += 0.5; c.updateMatrixWorld(true);
  selectObjs([a, c]); window._toasts.length = 0;
  return objects.map(o => o.userData.id);
});
const state = () => pg.evaluate(() => ({
  ids: objects.map(o => o.userData.id),
  groups: objects.filter(o => o.userData.isGroup || o.userData.isUnion || o.userData.isSubtract).length,
  bar: !!_progEl, cancelBtn: !!document.querySelector('._pc'),
  blocker: [...document.body.children].some(e => e.style && e.style.zIndex === '99998'),
  toasts: window._toasts.slice()
}));

// ── 1. Vereinen per Knopf abbrechen ──────────────────────────────────────────
await slowFetch(true);
let ids0 = await twoBoxes();
await pg.evaluate(() => { window._unionP = unionSelected(); });
await pg.waitForSelector('._pc', { timeout: 5000 });
let s = await state();
ok('Vereinen: Abbrechen-Knopf sichtbar', s.cancelBtn && s.bar && s.blocker);
await pg.click('._pc');
await pg.evaluate(() => window._unionP);
s = await state();
ok('Knopf: Balken + Sperre weg', !s.bar && !s.blocker, s);
ok('Knopf: beide Teile unverändert, nicht gruppiert', JSON.stringify(s.ids) === JSON.stringify(ids0) && s.groups === 0, s);
ok('Knopf: Meldung „abgebrochen"', s.toasts.some(t => /Vereinen abgebrochen/.test(t)), s.toasts);

// ── 2. Esc ───────────────────────────────────────────────────────────────────
ids0 = await twoBoxes();
await pg.evaluate(() => { window._unionP = unionSelected(); });
await pg.waitForSelector('._pc', { timeout: 5000 });
await pg.keyboard.press('Escape');
await pg.evaluate(() => window._unionP);
s = await state();
ok('Esc: abgebrochen, Teile unverändert', !s.bar && JSON.stringify(s.ids) === JSON.stringify(ids0) && s.groups === 0, s);

// ── 3. Abziehen abbrechen ────────────────────────────────────────────────────
ids0 = await pg.evaluate(() => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0; deselect();
  addShape('box'); const a = objects[objects.length - 1];
  addShape('cylinder'); const h = objects[objects.length - 1];
  h.userData.isHole = true; h.scale.multiplyScalar(0.4); h.updateMatrixWorld(true);
  selectObjs([a, h]); window._toasts.length = 0;
  return objects.map(o => o.userData.id);
});
await pg.evaluate(() => { subtractHoles(); });
await pg.waitForSelector('._pc', { timeout: 10000 });
await pg.waitForFunction(() => window._slowHits > 0, { timeout: 10000 });
await pg.click('._pc');
await pg.waitForFunction(() => window._toasts.some(t => /abgebrochen|Abzug fertig|Fehler/.test(t)), { timeout: 10000 });
await pg.waitForTimeout(500);
s = await state();
ok('Abziehen: Körper + Bohrung unverändert', JSON.stringify(s.ids) === JSON.stringify(ids0) && s.groups === 0, s);
ok('Abziehen: Meldung „abgebrochen", kein Rückfall-Ergebnis',
  s.toasts.some(t => /Abziehen abgebrochen/.test(t)) && !s.toasts.some(t => /Abzug fertig/.test(t)), s.toasts);
await slowFetch(false);

// ── 4. echter Server: Arbeiter wird frei ─────────────────────────────────────
const fineSpheres = () => pg.evaluate(() => {
  objects.slice().forEach(o => scene.remove(o)); objects.length = 0; deselect();
  const mk = x => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(2, 100, 60), new THREE.MeshStandardMaterial());
    m.position.set(x, 2, 0);
    m.userData = { id: idCtr++, name: 'Kugel', type: 'custom', color: '#888888' };
    scene.add(m); objects.push(m); m.updateMatrixWorld(true);
    return m;
  };
  const a = mk(0), c = mk(1.5);
  selectObjs([a, c]); window._toasts.length = 0;
  return objects.map(o => o.userData.id);
});
let idle = false;
for (let i = 0; i < 60 && !idle; i++) { idle = (await busy()) === 0; if (!idle) await new Promise(r => setTimeout(r, 3000)); }
ok('Pool vor dem Test frei', idle);
ids0 = await fineSpheres();
await pg.evaluate(() => { window._unionP = unionSelected(); });
await pg.waitForSelector('._pc', { timeout: 5000 });
let seenBusy = false;
for (let i = 0; i < 40 && !seenBusy; i++) { seenBusy = (await busy()) > 0; if (!seenBusy) await new Promise(r => setTimeout(r, 250)); }
ok('Server rechnet', seenBusy);
await pg.click('._pc');
await pg.evaluate(() => window._unionP);
let freed = false;
for (let i = 0; i < 20 && !freed; i++) { await new Promise(r => setTimeout(r, 500)); freed = (await busy()) === 0; }
ok('Arbeiter nach Abbruch binnen 10 s frei', freed);
s = await state();
ok('echter Server: Kugeln unverändert', JSON.stringify(s.ids) === JSON.stringify(ids0) && s.groups === 0, s);

// ── 5. ohne Abbruch normal ───────────────────────────────────────────────────
ids0 = await twoBoxes();
await pg.evaluate(() => unionSelected());
await pg.waitForTimeout(800);
s = await state();
ok('ohne Abbruch: ein verschmolzener Körper', s.ids.length === 1 && s.toasts.some(t => /Verschmolzen/.test(t)), s);

ok('keine Seitenfehler', pageErrors.length === 0, pageErrors);
await b.close();
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nalles OK');
process.exit(fails.length ? 1 : 0);
