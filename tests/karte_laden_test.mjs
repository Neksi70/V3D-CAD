// Ralf 9.11.2026: „Nach Klick auf Karte erzeugen wird der Button durchsichtig und es tut
// sich scheinbar nix. Hilfreich wäre ein Ladebalken und echtes Abbrechen. Man kann dann
// auch keinen neuen Versuch starten.“ Gemessen: Modellbau 0,2 s, Server 30–80 s oder hängen.
// Prüft mit nachgestellten Overpass-Servern (fetch ersetzt): Fortschritt sichtbar,
// Absage → nächster Server sofort, hängender Server → gestaffelt der nächste, Abbrechen
// stoppt alle Anfragen und gibt den Knopf frei, Zwischenspeicher. Start: npm run dev (8766)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
const URL = process.env.V3D_URL || 'http://localhost:8766/volme3d.html';
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl'] });
const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto(URL); await pg.waitForFunction(() => typeof addShape === 'function', null, { timeout: 30000 });
await pg.evaluate(() => { hideStarter(); _openMapModal(); });
await pg.waitForFunction(() => typeof L !== 'undefined' && _mapObj, null, { timeout: 30000 });
const r = await pg.evaluate(async () => {
  const warte = ms => new Promise(r => setTimeout(r, ms));
  _mapObj.setView([51.3593, 7.4741], 16);
  _MAP_STAFFEL_MS = 800;
  const d = 0.0003;
  const antwort = () => { const c = _mapObj.getCenter(); return { elements: [{ type: 'way', id: 1, tags: { building: 'yes', height: '12' },
    geometry: [[-d, -d], [d, -d], [d, d], [-d, d], [-d, -d]].map(([a, o]) => ({ lat: c.lat + a, lon: c.lng + o })) }] }; };
  // Verhalten je Server: 'absage' | 'haengt' | ms bis Antwort
  let plan = {}, log = [];
  const echt = window.fetch;
  window.fetch = (url, opt) => {
    const k = _MAP_SERVER.indexOf(String(url));
    if (k < 0) return echt(url, opt);
    const v = plan[k]; log.push(k + 1);
    const body = JSON.stringify(antwort());
    return new Promise((ok0, fail) => {
      let zu = false; const ok = x => { zu = true; ok0(x); };
      const sig = opt && opt.signal;
      if (sig) sig.addEventListener('abort', () => { if (zu) return; zu = true; log.push('x' + (k + 1)); fail(new DOMException('abort', 'AbortError')); });
      if (v === 'absage') setTimeout(() => ok(new Response('nein', { status: 406 })), 50);
      else if (typeof v === 'number') setTimeout(() => { if (!zu) ok(new Response(body, { status: 200 })); }, v);
    });
  };
  const out = {};
  const sicht = () => { const st = document.getElementById('map-status'); return st.style.display !== 'none' ? document.getElementById('map-status-txt').textContent + ' | ' + document.getElementById('map-status-zeit').textContent + ' | ' + document.getElementById('map-status-bar').style.width : null; };
  // 1) Absage, hängt, antwortet → Server 3 gewinnt, 2 wird abgebrochen
  plan = { 0: 'absage', 1: 'haengt', 2: 300 }; log = [];
  const n0 = objects.length;
  const p1 = _mapCreate(); await warte(600);
  out.laufend = { status: sicht(), knopf: document.getElementById('map-create-btn').textContent, gesperrt: document.getElementById('map-create-btn').disabled };
  await p1;
  out.fall1 = { log: log.join(','), neu: objects.length - n0, frei: !_mapBusy, offen: document.getElementById('map-modal').classList.contains('show') };
  // 2) alle hängen → Abbrechen nach 1,2 s → Fenster bleibt offen, Knopf frei
  _openMapModal(); await warte(300); _mapObj.setView([51.37, 7.48], 16);
  plan = { 0: 'haengt', 1: 'haengt', 2: 'haengt' }; log = [];
  const p2 = _mapCreate(); await warte(2000);
  out.vorAbbruch = sicht();
  _mapAbbrechenOderZu(); await p2;
  out.fall2 = { log: log.join(','), frei: !_mapBusy, knopfAn: !document.getElementById('map-create-btn').disabled, offen: document.getElementById('map-modal').classList.contains('show'), statusWeg: sicht() === null };
  // 3) neuer Versuch klappt direkt danach
  plan = { 0: 200 }; log = [];
  const n3 = objects.length; await _mapCreate();
  out.fall3 = { log: log.join(','), neu: objects.length - n3 };
  // 4) gleicher Ausschnitt nochmal → aus dem Zwischenspeicher, kein Server
  _openMapModal(); await warte(300); _mapObj.setView([51.37, 7.48], 16);
  plan = {}; log = []; const n4 = objects.length; await _mapCreate();
  out.fall4 = { log: log.join(','), neu: objects.length - n4 };
  // 5) alle sagen ab → klare Fehlermeldung, frei
  _openMapModal(); await warte(300); _mapObj.setView([51.40, 7.50], 16);
  plan = { 0: 'absage', 1: 'absage', 2: 'absage' }; log = [];
  await _mapCreate(); out.fall5 = { log: log.join(','), frei: !_mapBusy, offen: document.getElementById('map-modal').classList.contains('show') };
  window.fetch = echt;
  return out;
});
console.log(JSON.stringify(r, null, 1));
const checks = [
  ['Fortschritt sichtbar mit Text, Sekunden, Balken', !!r.laufend.status && /Kartendaten/.test(r.laufend.status) && / s \|/.test(r.laufend.status) && !/\| 0%$/.test(r.laufend.status)],
  ['Knopf zeigt „Wird erzeugt“ statt nur blass', /Wird erzeugt/.test(r.laufend.knopf) && r.laufend.gesperrt],
  ['Absage → sofort nächster, Hänger → gestaffelt, Gewinner bricht Rest ab', r.fall1.log === '1,2,3,x2' && r.fall1.neu >= 1 && r.fall1.frei && !r.fall1.offen],
  ['Hinweis auf Abbrechen bei langer Wartezeit sichtbar', /Ausweich-Server/.test(r.vorAbbruch || '')],
  ['Abbrechen stoppt alle Anfragen', /x1/.test(r.fall2.log) && /x2/.test(r.fall2.log) && /x3/.test(r.fall2.log)],
  ['nach Abbrechen: Fenster offen, Knopf frei, Status weg', r.fall2.frei && r.fall2.knopfAn && r.fall2.offen && r.fall2.statusWeg],
  ['neuer Versuch klappt sofort', r.fall3.log === '1' && r.fall3.neu >= 1],
  ['gleicher Ausschnitt aus dem Zwischenspeicher', r.fall4.log === '' && r.fall4.neu >= 1],
  ['alle Absagen → frei, Fenster bleibt offen', r.fall5.log === '1,2,3' && r.fall5.frei && r.fall5.offen],
  ['keine Seitenfehler', errs.length === 0],
];
let ok = true; for (const [n, v] of checks) { console.log((v ? '✔ ' : '✘ ') + n); ok = ok && v; }
if (errs.length) console.log(errs);
await b.close(); process.exit(ok ? 0 : 1);
