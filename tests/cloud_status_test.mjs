// Cloud-Status + „Weitermachen“ (1.18.299) gegen eine nachgebaute Firestore-Cloud.
// Prüft: Upload wartet auf den ersten Abgleich · Gerätekennung · „zu groß“ sichtbar ·
// nur lokale Designs bleiben in der Liste · neuerer Stand von woanders wird nicht
// überschrieben · frischer Rechner bietet das zuletzt bearbeitete Design an.
// Aufruf: node tests/cloud_status_test.mjs   (V3D_ROOT = Ordner mit volme3d_server.py, Standard /home/v3da)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const ROOT = process.env.V3D_ROOT || '/home/v3da';
const PORT = 8977;
const srv = spawn('python3', [ROOT + '/volme3d_server.py', String(PORT), '--dev'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 1500));
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1400, height: 850 } });
const fehler = []; pg.on('pageerror', e => fehler.push(String(e).slice(0, 300)));
let ok = true; const check = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) ok = false; };
const warte = ms => pg.waitForTimeout(ms);
try {
  await pg.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await pg.waitForFunction(() => typeof hideStarter === 'function' && typeof _resumeOffer === 'function', null, { timeout: 30000 });
  await warte(2000);   // Firebase-Init (onAuthStateChanged mit null) abwarten
  await pg.evaluate(() => {
    hideStarter(); _newCreate(false); clearInterval(_autoSaveTimer);
    document.getElementById('auth-overlay')?.classList.add('hidden');
    // Nachgebaute Firestore-Cloud
    window.__fs = new Map(); window.__fsFail = new Set();
    const docRef = id => ({
      set: async o => { await new Promise(r => setTimeout(r, 20)); if (__fsFail.has(id)) throw Object.assign(new Error('offline'), { code: 'unavailable' }); __fs.set(id, JSON.parse(JSON.stringify(o))); },
      get: async () => ({ exists: __fs.has(id), data: () => __fs.get(id) }),
      delete: async () => { __fs.delete(id); },
      update: async o => { Object.assign(__fs.get(id), o); },
    });
    const snap = () => ({ docs: [...__fs.entries()].sort((a, b) => b[1].updated - a[1].updated).map(([id, d]) => ({ id, data: () => d })) });
    const designs = { doc: docRef, get: async () => snap(), orderBy: () => ({ get: async () => snap() }) };
    const leer = { doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) };
    window._fbDb = { collection: () => ({ doc: () => ({ collection: n => n === 'designs' ? designs : leer }) }) };
    window._fbUser = { uid: 'test', email: 'test@example.com' };
  });

  // A. Vor dem ersten Abgleich wird nichts hochgeladen
  const a = await pg.evaluate(async () => {
    _fsSyncDone = false;
    addShape('box'); _autoSaveSigLast = null; _doAutoSave();
    await new Promise(r => setTimeout(r, 1500));
    return { n: __fs.size, st: _dsCloudGet(currentDesignId), chip: document.getElementById('cloud-st').textContent, id: currentDesignId };
  });
  check(a.n === 0, 'A: vor dem Abgleich nichts in der Cloud (' + a.n + ')');
  check(a.st === 'wait' && a.chip.includes('Speichert'), 'A: Anzeige „' + a.chip + '“');
  const CUR = a.id;

  // B. Abgleich lädt hoch, mit Gerätekennung, kein Dialog auf dem eigenen Gerät
  const b = await pg.evaluate(async () => {
    await _fsLoadAllToCache();
    const d = __fs.get(currentDesignId);
    return { da: !!d, dev: d && d.device === _DS_DEVICE, modal: document.getElementById('resume-modal').classList.contains('show'), chip: document.getElementById('cloud-st').textContent };
  });
  check(b.da && b.dev, 'B: nach dem Abgleich in der Cloud, mit Gerätekennung');
  check(!b.modal, 'B: kein Weitermachen-Dialog auf demselben Gerät');
  check(b.chip.includes('In der Cloud'), 'B: Anzeige „' + b.chip + '“');

  // C. Zu groß → sichtbar „nur auf diesem Gerät“ + Hinweis in „Meine Designs“
  const c = await pg.evaluate(async () => {
    await _fsSaveDesign(currentDesignId, _sceneSnapshot(), '', 'Gross', true, 'GZ1:' + 'A'.repeat(1000000));
    const chip = document.getElementById('cloud-st').textContent;
    showDesigns(); const badges = document.querySelectorAll('#ds-grid .ds-local-badge').length; hideDesigns();
    _dsCloudSet(currentDesignId, 'ok');
    return { chip, badges };
  });
  check(c.chip.includes('Nur auf diesem Gerät'), 'C: Anzeige „' + c.chip + '“');
  check(c.badges === 1, 'C: Galerie zeigt „nur hier“ (' + c.badges + ')');

  // D. Nur lokal gespeichertes Design (Upload schlägt fehl) bleibt nach dem Abgleich in der Liste
  const d = await pg.evaluate(async () => {
    __fsFail.add('ds_lokal');
    dsSaveDesign('ds_lokal', _sceneSnapshot(), '', 'Nur lokal', true);
    await new Promise(r => setTimeout(r, 300));
    const st = _dsCloudGet('ds_lokal');
    await _fsLoadAllToCache();
    return { st, drin: !!dsGetMeta('ds_lokal'), daten: !!dsLoadData('ds_lokal') };
  });
  check(d.st === 'err', 'D: fehlgeschlagener Upload wird als Fehler gemerkt (' + d.st + ')');
  check(d.drin && d.daten, 'D: nur lokales Design bleibt nach dem Abgleich in „Meine Designs“');

  // E. Auf anderem Gerät neuer gespeichert → Dialog, Auto-Speichern überschreibt NICHT
  const e = await pg.evaluate(async () => {
    const snap1 = _sceneSnapshot();
    addShape('box'); const snap2 = _sceneSnapshot();
    _applySnapshot(snap1);
    const doc = __fs.get(currentDesignId);
    __fs.set(currentDesignId, { ...doc, device: 'anderes-geraet', updated: Date.now() + 3600e3, data: _dsCompress(JSON.stringify(snap2)) });
    await _fsLoadAllToCache();
    const modal = document.getElementById('resume-modal').classList.contains('show');
    const titel = document.getElementById('resume-title').textContent;
    addShape('box'); addShape('box');   // jemand arbeitet weiter, während der Dialog steht (→ 3 Körper)
    _autoSaveSigLast = null; _doAutoSave();
    await new Promise(r => setTimeout(r, 1200));
    return { modal, titel, hold: _dsHold, dev: __fs.get(currentDesignId).device, n1: objects.length };
  });
  check(e.modal && e.titel.includes('Neuerer Stand'), 'E: Dialog „' + e.titel + '“');
  check(e.hold && e.dev === 'anderes-geraet', 'E: Auto-Speichern ruht, neuerer Cloud-Stand unangetastet');
  await pg.click('#resume-acts .btn.pri');
  await warte(800);
  const e2 = await pg.evaluate(() => ({ n: objects.length, modal: document.getElementById('resume-modal').classList.contains('show'), hold: _dsHold }));
  check(e.n1 === 3 && e2.n === 2 && !e2.modal && !e2.hold,'E: neuerer Stand geladen (' + e2.n + ' Körper statt ' + e.n1 + ')');

  // F. Frischer Rechner: nichts offen → „Willkommen zurück“ → Weiterarbeiten
  const f = await pg.evaluate(async () => {
    localStorage.setItem('volme3d_designs', '[]');
    for (const k of Object.keys(localStorage)) if (k.startsWith('volme3d_d_') || k.startsWith('volme3d_t_')) localStorage.removeItem(k);
    localStorage.removeItem('volme3d_cur'); currentDesignId = null;
    _applySnapshot({ objects: [] });
    __fsFail.clear(); __fs.delete('ds_lokal');
    await _fsLoadAllToCache();
    return { modal: document.getElementById('resume-modal').classList.contains('show'), titel: document.getElementById('resume-title').textContent, name: document.getElementById('resume-name').textContent };
  });
  check(f.modal && f.titel.includes('Willkommen'), 'F: Dialog „' + f.titel + '“ mit „' + f.name + '“');
  await pg.mouse.move(5, 400);
  await pg.screenshot({ path: '/tmp/cloud_resume_dialog.png' });
  await pg.click('#resume-acts .btn.pri');
  await warte(800);
  const f2 = await pg.evaluate(() => ({ n: objects.length, cur: currentDesignId, lbl: document.getElementById('cloud-st').textContent }));
  check(f2.n === 2 && f2.cur === CUR, 'F: weitergearbeitet am zuletzt bearbeiteten Design (' + f2.n + ' Körper)');
  check(f2.lbl.includes('In der Cloud'), 'F: Anzeige „' + f2.lbl + '“');
  await pg.screenshot({ path: '/tmp/cloud_status_kopf.png', clip: { x: 0, y: 200, width: 900, height: 50 } });
  await pg.evaluate(() => _dsCloudSet(currentDesignId, 'big', '1.4'));
  await pg.screenshot({ path: '/tmp/cloud_status_gross.png', clip: { x: 0, y: 200, width: 900, height: 50 } });
  await pg.evaluate(() => _dsCloudSet(currentDesignId, 'ok'));

  check(fehler.length === 0, 'keine Seitenfehler' + (fehler.length ? ': ' + fehler.join(' | ') : ''));
} catch (err) { console.log('✗ Abbruch:', err.message); ok = false; }
await br.close(); srv.kill();
console.log(ok ? 'ALLES OK' : 'FEHLER');
process.exit(ok ? 0 : 1);

