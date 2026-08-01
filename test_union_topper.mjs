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

console.log(JSON.stringify(res, null, 2));
console.log('\nMeldungen:'); notes.forEach(n => console.log(' •', n.slice(0, 160)));
console.log('\nSeitenfehler:', errs.length ? errs : 'keine');

const gross = notes.find(n => n.includes('Zu aufwendig zum Verschmelzen'));
const ok =
  res.nTri > 20000 && res.teile >= 3 &&
  res.ms < 5000 &&                       // sofort statt Minuten
  res.gruppiert && res.fortschrittWeg &&
  !!gross && gross.includes('überlappen') &&
  res.kleinDelta === -1 && /Verschmolzen/.test(res.kleinName || '') && res.kleinMs < 60000;

console.log(ok ? '\n✅ Vereinen: hängt nicht mehr, kleiner Fall geht weiter' : '\n❌ Vereinen: Prüfung fehlgeschlagen');
await browser.close(); srv.kill();
process.exit(ok && !errs.length ? 0 : 1);
