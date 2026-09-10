// Kommen die Anfasser (weiße Ecken / schwarze Kantenpunkte) nach JEDEM
// Flächen-Werkzeug wieder zurück?
//
// Ralf (10.9.2026): „Das drehen funktioniert, nur wenn ich jetzt die Größe
// verändern möchte, dann verschwinden einfach die Punkte, wo ich dran ziehen
// möchte." Ursache: Werkzeuge, die Flächen anklicken lassen (Gehäuse, Ziehen,
// Fläche unten), räumen die Griffe beim Start weg — sie würden die Flächen
// verdecken. Beim Verlassen rief der Code nur _doRepositionDimHandles(), und
// das SCHIEBT nur vorhandene Griffe; nach dem Leeren gab es keine mehr.
// Neu gebaut werden sie erst durch updateDimHandles().
//
// Start: npm run dev  (Port 8766, rohe volme3d.html — NICHT die dist!)
import { chromium } from 'playwright';

const URL = process.env.V3D_URL || 'http://127.0.0.1:8766/volme3d.html';
const fails = [];
const ok = (name, cond, extra) => {
  console.log((cond ? '  OK   ' : 'FEHLER ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) fails.push(name);
};

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
pg.on('pageerror', e => pageErrors.push(String(e)));
await pg.goto(URL, { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.addShape === 'function', { timeout: 60000 });
await pg.evaluate(() => {
  document.getElementById('start-modal')?.classList.remove('show');
  document.getElementById('auth-overlay')?.classList.add('hidden');
});

const res = await pg.evaluate(() => {
  const wrap = () => document.getElementById('dim-handles');
  const cnt   = () => wrap().children.length;
  const weiss = () => [...wrap().children].filter(e => e.className.includes('h-white')).length;
  const out = [];
  const probe = (name, enter, exit) => {
    objects.slice().forEach(o => scene.remove(o)); objects.length = 0;
    addShape('box'); const o = objects[objects.length - 1];
    selectObjs([o]); _doRepositionDimHandles();
    const vor = cnt();
    try { enter(o); } catch (e) { out.push({ name, fehler: String(e) }); return; }
    const drin = cnt();
    try { exit(); } catch (e) { out.push({ name, fehler: String(e) }); return; }
    _doRepositionDimHandles();
    out.push({ name, vor, drin, danach: cnt(), weissDanach: weiss() });
  };
  probe('Gehäuse',       () => enterShellMode(),  () => exitShellMode());
  probe('Fläche unten',  () => toggleFaceDown(),  () => exitFaceDownMode());
  probe('Ziehen',        () => enterPushPull(),   () => exitPushPull());
  probe('Ausrichten',    () => { addShape('box'); selectObjs([objects[0], objects[1]]); alignTool(); },
                         () => { exitSpecialMode(); selectObjs([objects[0]]); });
  return out;
});

for (const r of res) {
  if (r.fehler) { ok(r.name + ': prüfbar', false, r.fehler.slice(0, 80)); continue; }
  ok(r.name + ': Griffe vorher da', r.vor > 0, r);
  ok(r.name + ': Griffe im Werkzeug weg (verdecken sonst die Flächen)', r.drin === 0, r);
  ok(r.name + ': Griffe danach WIEDER da', r.danach > 0, r);
  ok(r.name + ': auch die weißen Ecken zum Skalieren', r.weissDanach > 0, r);
}

ok('keine JS-Fehler auf der Seite', pageErrors.length === 0, pageErrors.slice(0, 3));

await b.close();
console.log('\n' + (fails.length ? '❌ ' + fails.length + ' Fehler: ' + fails.join(' | ') : '✅ alles grün'));
process.exit(fails.length ? 1 : 0);
