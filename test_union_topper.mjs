// Ralfs Fall: Topper → Aufheben → Stecker verschieben → Vereinen.
// Darf NICHT mehr bei 85 % hängen, sondern muss sofort und verständlich
// auf Gruppieren ausweichen. Zusätzlich: ein kleiner Fall verschmilzt weiterhin.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 8807;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: process.cwd() });
await new Promise(r => setTimeout(r, 900));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
const notes = [];
await page.exposeFunction('_tnote', t => notes.push(t));
await page.goto(`http://localhost:${PORT}/volme3d.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => window._isReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const res = await page.evaluate(async () => {
  const out = {};
  const origNotify = window.notify;
  window.notify = (m, k) => { window._tnote(String(m)); return origNotify(m, k); };
  if (typeof hideStarter === 'function') hideStarter();

  // ── Topper wie Ralf ──
  document.getElementById('tt-text').value = 'Julia & Patrick';
  document.getElementById('tt-font').value = 'greatvibes_local';
  document.getElementById('tt-pins').value = '1';
  document.getElementById('tt-dheart').checked = false;
  document.getElementById('tt-explode').checked = false;
  _ttMotifClear();
  await new Promise(r => _npLoadFont('greatvibes_local', r));
  _ttCreate();
  await new Promise(r => setTimeout(r, 900));
  const grp = objects[objects.length - 1];
  selectObjs([grp]); ungroupSelected();
  await new Promise(r => setTimeout(r, 300));
  const all = objects.filter(o => /^(Schriftzug|Steg|Pin)/.test(o.userData.name || ''));
  const pin = all.find(o => /^Pin/.test(o.userData.name));
  if (pin) { pin.position.x += 0.8; pin.updateMatrixWorld(true); }
  const stls = _objsToUnionStls(all);
  out.teile = all.length;
  out.nTri = Math.round(stls.reduce((s, b) => s + (b.byteLength - 84) / 50, 0));

  selectObjs(all);
  const t = performance.now();
  await unionSelected();
  out.ms = Math.round(performance.now() - t);
  out.gruppiert = !!(objects.length && objects[objects.length - 1].userData.isUnion);
  out.fortschrittWeg = !document.querySelector('#progress-overlay, .prog-ov');

  // ── Gegenprobe: zwei kleine Körper müssen weiterhin echt verschmelzen ──
  newScene();
  await new Promise(r => setTimeout(r, 400));
  addShape('box'); await new Promise(r => setTimeout(r, 250));
  addShape('box'); await new Promise(r => setTimeout(r, 250));
  const bs = objects.slice(-2);
  bs[1].position.set(bs[0].position.x + 0.5, bs[0].position.y, bs[0].position.z);
  bs[1].updateMatrixWorld(true);
  selectObjs(bs);
  const n0 = objects.length, t2 = performance.now();
  await unionSelected();
  out.kleinMs = Math.round(performance.now() - t2);
  out.kleinDelta = objects.length - n0;
  out.kleinName = objects.length ? objects[objects.length - 1].userData.name : null;
  return out;
});

// ── Meldungsdauer: lange Hinweise müssen lesbar stehenbleiben ──
res.toast = await page.evaluate(async () => {
  const messe = async (txt) => {
    document.getElementById('notif').innerHTML = '';
    notify(txt, 'w');
    const el = document.querySelector('#notif .ni');
    // Ausblend-Verzögerung: zweiter Wert von animation-delay (Einblenden, Ausblenden).
    // Nicht aus der Kurzschreibweise parsen — die schreibt der Browser um.
    const delay = parseFloat((getComputedStyle(el).animationDelay || '').split(',')[1] || '0');
    const breite = el.getBoundingClientRect().width;
    await new Promise(r => setTimeout(r, 2600));           // über die alte Frist hinaus
    const el2 = document.querySelector('#notif .ni');
    const sichtbar = !!el2 && +getComputedStyle(el2).opacity > 0.5;
    return { len: txt.length, delay, sichtbar, breite: Math.round(breite) };
  };
  const kurz = await messe('Gruppiert');
  const lang = await messe('Zu aufwendig: 31.284 Dreiecke in 7 Teilen (ca. 188 s). Stattdessen gruppiert — '
    + 'zum Drucken reicht das, überlappende Teile werden ohnehin ein Stück. Echter Verbundkörper? Vorher 🔻 Vereinfachen.');
  document.querySelector('#notif .ni').click();            // Klick schließt sofort
  return { kurz, lang, nachKlick: !document.querySelector('#notif .ni') };
});

console.log(JSON.stringify(res, null, 2));
console.log('\nMeldungen:'); notes.forEach(n => console.log(' •', n.slice(0, 160)));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const gross = notes.find(n => n.includes('Zu aufwendig:'));
const ok =
  res.nTri > 20000 && res.teile >= 3 &&
  res.ms < 5000 &&                       // sofort statt Minuten
  res.gruppiert && res.fortschrittWeg &&
  !!gross && gross.includes('überlappen') && gross.length < 220 &&
  res.kleinDelta === -1 && /Verschmolzen/.test(res.kleinName || '') && res.kleinMs < 60000 &&
  // kurze Meldung wie bisher weg, lange steht noch; Klick schließt; Breite begrenzt
  res.toast.kurz.delay < 2.5 && !res.toast.kurz.sichtbar &&
  res.toast.lang.delay > 8 && res.toast.lang.sichtbar &&
  res.toast.lang.breite <= 430 && res.toast.nachKlick;

console.log(ok ? '\n✅ Vereinen: hängt nicht mehr, kleiner Fall geht weiter' : '\n❌ Vereinen: Prüfung fehlgeschlagen');
await browser.close(); srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
