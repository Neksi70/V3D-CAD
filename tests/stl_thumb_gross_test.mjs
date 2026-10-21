// Bibliothek: riesige 3MF ohne eingebautes PNG dürfen die Seite nicht einfrieren (21.10.,
// 50-MB-Scan „Mesh_….3mf" → „Diese Seite antwortet nicht"). Seit 1.18.232 liest ein Worker
// (lib/p3mf.js) das XML → auch der große Scan bekommt eine Vorschau, ohne zu blockieren.
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
const PORT = 8918;
const srv = spawn('python3', ['volme3d_server.py', String(PORT), '--dev'], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 1500));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/volme3d.html`);
  await page.waitForFunction(() => typeof _stlThumbOne === 'function' && typeof fflate !== 'undefined');
  await page.waitForTimeout(8000);   // App-Start blockiert selbst bis zu 1 s
  const r = await page.evaluate(async () => {
    // scan-artiges Gitter (kleine Dreiecke) — W×W Punkte, 2·(W−1)² Dreiecke
    const mk3mf = (W) => {
      const p = ['<model unit="millimeter"><resources><object id="1"><mesh><vertices>'];
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) p.push(`<vertex x="${(x * 0.1).toFixed(4)}" y="${(y * 0.1).toFixed(4)}" z="${(Math.sin(x * 0.05) * 3).toFixed(4)}"/>`);
      p.push('</vertices><triangles>');
      for (let y = 0; y < W - 1; y++) for (let x = 0; x < W - 1; x++) { const a = y * W + x; p.push(`<triangle v1="${a}" v2="${a + 1}" v3="${a + W}"/><triangle v1="${a + 1}" v2="${a + W + 1}" v3="${a + W}"/>`); }
      p.push('</triangles></mesh></object></resources><build><item objectid="1"/></build></model>');
      return fflate.zipSync({ '3D/3dmodel.model': fflate.strToU8(p.join('')) }).buffer;
    };
    const big = mk3mf(720), small = mk3mf(15);
    _stlReadBytes = async f => f.name.startsWith('Mesh') ? big : small;
    const t = Date.now();
    const fs = [{ name: 'Mesh_scan.3mf', path: 'Mesh_scan.3mf', size: big.byteLength, mtime: t },
                { name: 'Klein.3mf', path: 'Klein.3mf', size: small.byteLength, mtime: t }];
    const out = {};
    for (const f of fs) {
      f._thumbEl = document.createElement('div');
      let last = performance.now(), gap = 0, run = true;
      const tick = () => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; if (run) setTimeout(tick, 10); }; tick();
      // Lesen (Worker) getrennt messen; das Rendern danach hängt an der Grafikkarte —
      // headless läuft es in Software (SwiftShader) und ist dort viel langsamer als echt.
      let tRead = 0; const orig = _p3mfParseAsync;
      _p3mfParseAsync = async b => { const a = performance.now(); const r = await orig(b); tRead = performance.now() - a; gapRead = gap; return r; };
      let gapRead = 0;
      const t0 = performance.now(); await _stlThumbOne(f); run = false; _p3mfParseAsync = orig;
      out[f.name] = { ms: Math.round(performance.now() - t0), read: Math.round(tRead), gapRead: Math.round(gapRead), gap: Math.round(gap), url: !!f._thumbUrl, html: f._thumbEl.textContent };
    }
    out.cache = await _stlIdbGet('thumbs', 'v2|Mesh_scan.3mf|' + fs[0].size + '|' + t);
    out.zipMB = (big.byteLength / 1e6).toFixed(1);
    return out;
  });
  console.log(JSON.stringify(r));
  const b = r['Mesh_scan.3mf'], s = r['Klein.3mf'];
  ok(b.url, 'großes Scan-3MF bekommt eine Vorschau');
  ok(b.gapRead < 300, `großes Scan-3MF: Lesen blockiert die Seite nicht (längste Lücke ${b.gapRead} ms bei ${b.read} ms Lesezeit, Zip ${r.zipMB} MB)`);
  console.log(`INFO Vorschau gesamt ${b.ms} ms, längste Lücke inkl. Software-Rendern ${b.gap} ms`);
  ok(typeof r.cache === 'string' && r.cache.startsWith('data:image/png'), 'Vorschau wird gecacht');
  ok(s.url, 'kleines 3MF ohne PNG bekommt weiter eine gerenderte Vorschau');
  ok(!errs.length, 'keine Seitenfehler ' + errs.join(' | '));
} finally { await browser.close(); srv.kill(); }
console.log(fail ? `\n${fail} FEHLER` : '\nalles OK'); process.exit(fail ? 1 : 0);
