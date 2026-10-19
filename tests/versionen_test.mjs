// Versionsverlauf: Ausdünnen, Festhalten, Wiederherstellen, Als Kopie öffnen (v1.18.207)
import { chromium } from '/home/v3da/node_modules/@playwright/test/index.mjs';
import { spawn } from 'child_process';
const PORT = 8879;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { cwd: '/home/v3da', stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 900));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'vor dem Umbau' : undefined));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
try {
  await p.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await p.waitForFunction(() => typeof _bakThin === 'function', { timeout: 60000 });
  // Ausdünnen
  let r = await p.evaluate(() => { hideStarter(); const now = Date.now(), L = [];
    for (let i = 0; i < 12; i++) L.push({ ts: now - i * 5 * 60e3 - 1000, json: 'a' + i, n: 1 });           // letzte Stunde
    for (let i = 0; i < 48; i++) L.push({ ts: now - 3600e3 - i * 30 * 60e3 - 1000, json: 'b' + i, n: 1 });  // 1–25 h, halbstündlich
    for (let i = 0; i < 70; i++) L.push({ ts: now - 26 * 3600e3 - i * 12 * 3600e3, json: 'c' + i, n: 1 }); // ab 26 h, halbtäglich (~36 Tage)
    L.push({ ts: now - 40 * 86400e3, json: 'p', n: 1, pinned: true, name: 'alt aber wichtig' });
    L.sort((a, b) => b.ts - a.ts);
    const T = _bakThin(L), age = b => (now - b.ts) / 3600e3;
    return { total: T.length, hour: T.filter(b => !b.pinned && age(b) < 1).length, day: T.filter(b => !b.pinned && age(b) >= 1 && age(b) < 24).length,
      old: T.filter(b => !b.pinned && age(b) >= 24 * 30).length, pinned: T.filter(b => b.pinned).length }; });
  ok(r.hour === 12 && r.day >= 22 && r.day <= 25 && r.old === 0 && r.pinned === 1, `Ausdünnen: letzte Stunde alle (${r.hour}), 1 pro Stunde (${r.day}), nichts > 30 Tage, Festgehaltenes bleibt (${JSON.stringify(r)})`);
  // echter Ablauf: Design mit 1 Box speichern, festhalten, zweite Box, speichern
  r = await p.evaluate(async () => { _newCreate(false); addShape('box'); _doAutoSave(); await new Promise(r => setTimeout(r, 400));
    await _bakPinNow(); await new Promise(r => setTimeout(r, 200));
    addShape('cylinder'); await _bakSnapshot(currentDesignId, _sceneSnapshot(), true, { thumb: captureThumbnail() });
    const L = await _bakList(currentDesignId); const panel = document.getElementById('bak-panel');
    return { n: L.length, pinned: L.filter(b => b.pinned).map(b => b.name + ':' + b.n), thumbs: L.filter(b => b.thumb && b.thumb.startsWith('data:image')).length, objs: objects.length, panel: !!panel, rows: panel ? panel.querySelectorAll('img').length : 0 }; });
  ok(r.n >= 2 && r.pinned.includes('vor dem Umbau:1') && r.thumbs >= 2 && r.panel, `Festgehalten „vor dem Umbau“ (1 Objekt), Vorschaubilder ${r.thumbs}, Fenster offen (${JSON.stringify(r)})`);
  // Wiederherstellen der festgehaltenen Version
  r = await p.evaluate(async () => { const L = await _bakList(currentDesignId), i = L.findIndex(b => b.pinned); await _bakRestore(i); await new Promise(r => setTimeout(r, 300));
    return { objs: objects.length, list: (await _bakList(currentDesignId)).length }; });
  ok(r.objs === 1, `Wiederhergestellt: wieder 1 Objekt (Stand mit 2 Objekten vorher gesichert, ${r.list} Versionen)`);
  // Als Kopie öffnen (Stand mit 2 Objekten) → neues Design, Original unverändert
  r = await p.evaluate(async () => { const orig = currentDesignId; const L = await _bakList(orig), i = L.findIndex(b => b.n === 2);
    _bakCopy(i); await new Promise(r => setTimeout(r, 500)); try { _cancelSize(); } catch (e) {}
    const origData = dsLoadData(orig); return { neu: currentDesignId !== orig, objs: objects.length, name: dsGetMeta(currentDesignId)?.name, origObjs: origData && origData.objects.length }; });
  ok(r.neu && r.objs === 2 && /Stand/.test(r.name) && r.origObjs === 1, `Als Kopie geöffnet: „${r.name}“ mit 2 Objekten, Original hat weiter 1`);
  ok(errs.length === 0, 'keine Seitenfehler ' + errs.join(' | '));
} catch (e) { console.log('ABBRUCH ' + String(e.message || e).split('\n')[0]); fail++; }
await b.close(); srv.kill();
console.log(fail ? `${fail} FEHLER` : 'ALLES OK'); process.exit(fail ? 1 : 0);
