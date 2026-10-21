// Absturz-Protokoll (Flugschreiber): nach einem harten Tab-Absturz geht das Protokoll beim
// nächsten Start an /api/absturz; ein normales Neuladen schickt nichts. (Volker 21.10.)
// Optional großer Scan: SCAN_URL=http://… (sonst ein erzeugtes 400k-Netz)
import { spawn } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { chromium } from '@playwright/test';
const PORT = 8942;
const ORDNER = path.join(os.homedir(), '.config/volme3d/absturz');
const vorher = new Set(fs.existsSync(ORDNER) ? fs.readdirSync(ORDNER) : []);
const neue = () => (fs.existsSync(ORDNER) ? fs.readdirSync(ORDNER) : []).filter(f => !vorher.has(f) && f.includes('dev@lokal'));
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const dir = fs.mkdtempSync('/tmp/claude-1000/profil-');
const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1300, height: 850 } });
const URL = `http://127.0.0.1:${PORT}/volme3d.html`;
const bereit = p => p.waitForFunction(() => typeof _importMeshFile === 'function' && typeof hideStarter === 'function' && typeof _frLog !== 'undefined' && _frLog);
try {
  let page = ctx.pages()[0];
  await page.goto(URL); await bereit(page);
  // großes Teil laden (Fenster → vereinfacht)
  await page.evaluate(async (scanUrl) => {
    try { hideStarter(); } catch (e) {}
    let buf;
    if (scanUrl) buf = await (await fetch(scanUrl)).arrayBuffer();
    else { const g = new THREE.SphereGeometry(20, 450, 450).toNonIndexed(); const p = g.attributes.position.array, n = p.length / 9;
      buf = new ArrayBuffer(84 + n * 50); const dv = new DataView(buf); dv.setUint32(80, n, true);
      for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, p[i * 9 + k], true); }
    const auto = setInterval(() => { const b = document.getElementById('bigmesh-simp'); if (document.getElementById('bigmesh-modal').classList.contains('show') && !b.disabled) b.click(); }, 100);
    await _importMeshFile(buf, scanUrl ? 'Scan.3mf' : 'Kugel.stl', false); clearInterval(auto);
    await new Promise(r => setTimeout(r, 2500));
  }, process.env.SCAN_URL || '');
  const ev = await page.evaluate(() => _frLog.ev.map(e => e.k));
  console.log('INFO Ereignisse: ' + ev.join(', '));
  ok(['import', 'gross-fenster', 'gross-wahl', 'import-gelesen', 'koerper-neu', 'koerper-gezeichnet'].every(k => ev.includes(k)), 'Schritte beim Laden mitgeschrieben');
  ok(await page.evaluate(() => !!_frLog.gpu && _frLog.gpu !== '?'), 'Grafikchip erfasst: ' + await page.evaluate(() => _frLog.gpu));

  // 1) harter Absturz → beim nächsten Start geht das Protokoll raus
  await page.goto('chrome://crash').catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  page = await ctx.newPage(); await page.goto(URL); await bereit(page);
  await new Promise(r => setTimeout(r, 2500));
  const n1 = neue();
  ok(n1.length === 1, `nach Absturz: Protokoll beim Server angekommen (${n1.join(', ')})`);
  if (n1[0]) {
    const j = JSON.parse(fs.readFileSync(path.join(ORDNER, n1[0]), 'utf8'));
    const ks = j.protokoll.ev.map(e => e.k);
    ok(ks.includes('koerper-gezeichnet') && j.protokoll.sauber === false && j.email === 'dev@lokal', `Protokoll vollständig: ${ks.length} Ereignisse, Version ${j.protokoll.ver}, GPU „${j.protokoll.gpu}“`);
  }
  // 2) normales Neuladen → nichts schicken
  await page.evaluate(() => _fr('import', { test: 1 }));   // auch mit „interessanten" Ereignissen
  await page.reload(); await bereit(page); await new Promise(r => setTimeout(r, 2500));
  ok(neue().length === 1, 'normales Neuladen schickt kein Protokoll');
} finally { await ctx.close(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  for (const f of neue()) fs.rmSync(path.join(ORDNER, f)); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
