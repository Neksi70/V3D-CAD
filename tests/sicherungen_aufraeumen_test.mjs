// Aufräumen 30 s nach dem Start darf bei vielen großen Sicherungen nicht abstürzen und
// behält je Design nur die 2 neuesten großen Sicherungen (Volker 21.10.: Absturz bei
// jedem Start, Absturz-Protokoll). Kleine Sicherungen und angeheftete bleiben.
import { spawn } from 'child_process';
import fs from 'fs';
import { chromium } from '@playwright/test';
const PORT = 8945;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const dir = fs.mkdtempSync('/tmp/claude-1000/profil-');
const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1300, height: 850 } });
const URL = `http://127.0.0.1:${PORT}/volme3d.html`;
try {
  let page = ctx.pages()[0]; let crashed = false; page.on('crash', () => { crashed = true; });
  await page.goto(URL); await page.waitForFunction(() => typeof _bakDb === 'function');
  // 6 Designs × (10 große à 30 MB + 5 kleine + 1 angeheftete große) — zusammen ~2 GB
  await page.evaluate(async () => {
    const big = '{"objects":[' + '0,'.repeat(15e6) + '0]}', now = Date.now();
    const db = await _bakDb();
    for (let d = 0; d < 6; d++) {
      const list = [];
      for (let i = 0; i < 10; i++) list.push({ ts: now - i * 400e3 - 1000, json: big, n: 1, name: '', pinned: false });
      for (let i = 0; i < 5; i++) list.push({ ts: now - 5e6 - i * 4e6, json: '{"objects":[]}', n: 0, name: '', pinned: false });
      list.push({ ts: now - 9e6, json: big, n: 1, name: 'fest', pinned: true });
      await new Promise((res, rej) => { const tx = db.transaction('bak', 'readwrite'); tx.objectStore('bak').put(list, 'ds_test_' + d); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    }
  });
  console.log('Testzustand angelegt');
  await page.reload(); await page.waitForFunction(() => typeof _frLog !== 'undefined' && _frLog);
  await page.waitForFunction(() => _frLog.ev.some(e => e.k === 'aufraeumen-fertig' || e.k === 'aufraeumen-fehler'), null, { timeout: 180000, polling: 1000 }).catch(() => {});
  ok(!crashed, 'kein Absturz beim Aufräumen');
  const r = await page.evaluate(async () => {
    const ev = _frLog.ev.filter(e => /aufraeumen|sicherungen|browser-speicher/.test(e.k)).map(e => e.k + (e.d ? ' ' + JSON.stringify(e.d) : ''));
    const db = await _bakDb(); const out = {};
    for (let d = 0; d < 6; d++) {
      const list = await new Promise(res => { const q = db.transaction('bak', 'readonly').objectStore('bak').get('ds_test_' + d); q.onsuccess = () => res(q.result || []); });
      out[d] = { gross: list.filter(b => b.json.length > 20e6 && !b.pinned).length, klein: list.filter(b => b.json.length <= 20e6).length, fest: list.filter(b => b.pinned).length };
    }
    return { ev, out };
  });
  console.log('INFO ' + r.ev.join(' | '));
  ok(r.ev.some(e => e.startsWith('aufraeumen-fertig')), 'Aufräumen fertig');
  ok(Object.values(r.out).every(x => x.gross === 2 && x.fest === 1 && x.klein === 5), 'je Design: 2 neueste große + die angeheftete, alle 5 kleinen bleiben → ' + JSON.stringify(r.out[0]));
} finally { await ctx.close(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
